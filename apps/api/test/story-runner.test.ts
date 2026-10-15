import { ROUTES, TIERS } from "@vzc/catalog";
import type { StoryView } from "@vzc/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMPOSER_MAX_FAILURES } from "../src/durable-objects/story-runner.ts";
import type { ComposeRequest, ComposerApi, ScoreResponse } from "../src/services/composer.ts";
import { fakeComposer } from "../src/services/composer.ts";
import { reserveQuota } from "../src/services/quota.ts";
import type { ChargeHold } from "../src/services/settle.ts";
import { setup } from "./harness.ts";

const T0 = Date.UTC(2026, 9, 14, 12);
const MIN = 60_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

/** A scripted composer: wraps the fake and can fail or change the score answer. */
function scripted(
  h: Awaited<ReturnType<typeof setup>>,
  over: { scoreErrors?: number; composeErrors?: number; score?: Partial<ScoreResponse> } = {},
) {
  const base = fakeComposer(h.env as never);
  const calls = { score: 0, compose: 0, composeRequests: [] as ComposeRequest[] };
  let scoreErrors = over.scoreErrors ?? 0;
  let composeErrors = over.composeErrors ?? 0;
  const api: ComposerApi = {
    async score(request) {
      calls.score += 1;
      if (scoreErrors > 0) {
        scoreErrors -= 1;
        throw new Error("composer 503");
      }
      return { ...(await base.score(request)), ...over.score };
    },
    async compose(request) {
      calls.compose += 1;
      calls.composeRequests.push(request);
      if (composeErrors > 0) {
        composeErrors -= 1;
        throw new Error("composer 503");
      }
      return base.compose(request);
    },
  };
  h.env.COMPOSER_IMPL = api;
  return calls;
}

async function previewHold(
  h: Awaited<ReturnType<typeof setup>>,
  nonce: string,
): Promise<ChargeHold> {
  const counters = [{ name: "quota:preview:user:test", limit: 3 }];
  expect(await reserveQuota(h.env as never, counters, nonce)).toBe(true);
  return { kind: "quota", nonce, counters: counters.map((c) => c.name) };
}

async function creditHold(
  h: Awaited<ReturnType<typeof setup>>,
  storyId: string,
  credits = 10,
): Promise<ChargeHold> {
  const wallet = h.wallets.instance("test");
  await wallet.grant("test", {
    kind: "pack",
    credits,
    expiresAt: null,
    sourceRef: `order-${storyId}`,
    reason: "test",
  });
  const reserved = await wallet.reserve("test", storyId, TIERS.video.credits, storyId);
  expect(reserved.ok).toBe(true);
  return { kind: "credits", userId: "test", reservationId: storyId, reserved: TIERS.video.credits };
}

const stepAttempts = (h: Awaited<ReturnType<typeof setup>>, id: string) =>
  JSON.parse(
    (h.db.prepare("SELECT steps FROM stories WHERE id=?").get(id) as { steps: string }).steps,
  ) as {
    id: string;
    attempts: unknown[];
  }[];

const quotaUsed = (h: Awaited<ReturnType<typeof setup>>) =>
  h.limiters.instance("quota:preview:user:test").used();

async function untilStatus(
  h: Awaited<ReturnType<typeof setup>>,
  runner: { view(): Promise<unknown> },
  status: string,
  maxMin = 120,
) {
  for (let i = 0; i < maxMin * 6; i++) {
    const view = (await runner.view()) as { status: string };
    if (view.status === status) return view as StoryView;
    await h.advance(10_000);
  }
  throw new Error(`never reached ${status}: ${JSON.stringify(await runner.view())}`);
}

async function readyStory(h: Awaited<ReturnType<typeof setup>>) {
  const { spec, runner } = await h.story();
  await runner.start(spec, await previewHold(h, spec.id));
  await untilStatus(h, runner, "preview_ready");
  return { spec, runner };
}

describe("StoryRunner", () => {
  it("preview succeeds: four candidates, scored, picks set, quota committed", async () => {
    const h = await setup();
    const calls = scripted(h);
    const { spec, runner } = await h.story();
    await runner.start(spec, await previewHold(h, spec.id));
    const view = (await untilStatus(h, runner, "preview_ready")) as {
      preview: { A: string; C: string } | null;
    };
    expect(view.preview?.A).toContain(`kf/${spec.id}/kf-A-1.jpg`);
    expect(view.preview?.C).toContain(`kf/${spec.id}/kf-C-1.jpg`);
    // One check of the two photos, then one scoring of the candidates.
    expect(calls.score).toBe(2);
    expect(await quotaUsed(h)).toBe(1);
    const row = h.db.prepare("SELECT status FROM stories WHERE id=?").get(spec.id) as {
      status: string;
    };
    expect(row.status).toBe("preview_ready");
  });

  it("preview fails when every A candidate fails, and gives the quota back", async () => {
    const reject = { kind: "fail", failMsg: "content policy violation" };
    const h = await setup({
      FAKE_SCRIPT: JSON.stringify(
        Object.fromEntries(
          ROUTES.filter((r) => r.capability === "keyframe").map((r) => [
            r.model,
            Array(8).fill(reject),
          ]),
        ),
      ),
    });
    scripted(h);
    const { spec, runner } = await h.story();
    await runner.start(spec, await previewHold(h, spec.id));
    const view = (await untilStatus(h, runner, "preview_failed")) as { errorCode: string };
    expect(view.errorCode).toBe("CONTENT_REJECTED");
    expect(await quotaUsed(h)).toBe(0);
  });

  it("refuses to render before the preview is ready", async () => {
    const h = await setup();
    scripted(h);
    const { spec, runner } = await h.story();
    await runner.start(spec, await previewHold(h, spec.id));
    expect(await runner.render(h.noCharge)).toEqual({ ok: false, reason: "not_ready" });
  });

  it("renders B, five shots and compose, then commits the video credits", async () => {
    const h = await setup();
    const calls = scripted(h);
    const { spec, runner } = await readyStory(h);
    expect(await runner.render(await creditHold(h, spec.id))).toEqual({ ok: true });
    const view = (await untilStatus(h, runner, "done")) as { video: { url: string } | null };
    expect(view.video?.url).toContain(`out/${spec.id}/video.mp4`);
    expect(await h.r2.BUCKET.head(`out/${spec.id}/video.mp4`)).not.toBeNull();
    expect(calls.composeRequests[0]?.shots.map((s) => s.grade)).toEqual([
      "cold",
      "cold",
      "cold",
      "warm",
      "dawn",
    ]);
    expect(calls.composeRequests[0]?.shots.map((s) => s.seconds)).toEqual([3, 2, 3, 3, 3]);
    // Shot 3 ends on the embrace (keyframe B): keep the end of the clip, not the start.
    expect(calls.composeRequests[0]?.shots.map((s) => s.anchor)).toEqual([
      "start",
      "start",
      "end",
      "start",
      "start",
    ]);
    expect(h.wallet.calls).toContainEqual(["commit", "test", spec.id, 10, spec.id]);
  });

  it("emails the owner once when the film is ready, not again after a title change", async () => {
    const h = await setup();
    scripted(h);
    h.db
      .prepare("INSERT INTO users(id,email,created_at) VALUES(?,?,?)")
      .run("test", "ann@example.com", Date.now());
    const { spec, runner } = await readyStory(h);
    await runner.render(await creditHold(h, spec.id));
    await untilStatus(h, runner, "done");
    expect(h.mail.filter((m) => m.to === "ann@example.com")).toHaveLength(1);
    expect(h.mail[0]?.text).toContain(`/story?id=${spec.id}`);
    await runner.recompose("A", "B");
    await h.advance(MIN);
    await untilStatus(h, runner, "done");
    expect(h.mail).toHaveLength(1);
  });

  it("a shot that exhausts its routes fails the video and releases the credits", async () => {
    const down = { kind: "fail", failMsg: "internal error" };
    const h = await setup({
      FAKE_SCRIPT: JSON.stringify(
        Object.fromEntries(
          ROUTES.filter((r) => r.capability === "shot").map((r) => [r.model, Array(12).fill(down)]),
        ),
      ),
    });
    scripted(h);
    const { spec, runner } = await readyStory(h);
    await runner.render(await creditHold(h, spec.id));
    const view = (await untilStatus(h, runner, "failed")) as { errorCode: string };
    expect(view.errorCode).toBe("PROVIDER_DOWN");
    expect(h.wallet.calls).toContainEqual(["release", "test", spec.id, spec.id]);
    expect(h.wallet.calls.some((c) => c[0] === "commit")).toBe(false);
  });

  it("renders a failed video again with a new hold, reusing the shots that worked", async () => {
    const h = await setup();
    const calls = scripted(h, { composeErrors: COMPOSER_MAX_FAILURES });
    const { spec, runner } = await readyStory(h);
    await runner.render(await creditHold(h, spec.id, 20));
    expect((await untilStatus(h, runner, "failed", 240)).videoAttempts).toBe(1);
    expect(h.wallet.calls).toContainEqual(["release", "test", spec.id, spec.id]);
    const retry = {
      kind: "credits",
      userId: "test",
      reservationId: `${spec.id}:v2`,
      reserved: 10,
    } as const;
    const wallet = h.wallets.instance("test");
    expect((await wallet.reserve("test", retry.reservationId, 10, spec.id)).ok).toBe(true);
    expect(await runner.render(retry)).toEqual({ ok: true });
    const done = await untilStatus(h, runner, "done", 240);
    expect(done.videoAttempts).toBe(2);
    expect(h.wallet.calls).toContainEqual(["commit", "test", `${spec.id}:v2`, 10, spec.id]);
    // The first attempt's shots were kept: only compose ran again.
    expect(calls.compose).toBe(COMPOSER_MAX_FAILURES + 1);
  });

  it("retries a failing composer with backoff, then succeeds", async () => {
    const h = await setup();
    const calls = scripted(h, { composeErrors: 2 });
    const { spec, runner } = await readyStory(h);
    await runner.render(await creditHold(h, spec.id));
    await untilStatus(h, runner, "done");
    expect(calls.compose).toBe(3);
  });

  it("gives up on compose after repeated errors and refunds", async () => {
    const h = await setup();
    const calls = scripted(h, { composeErrors: 99 });
    const { spec, runner } = await readyStory(h);
    await runner.render(await creditHold(h, spec.id));
    const view = (await untilStatus(h, runner, "failed", 240)) as { errorCode: string };
    expect(calls.compose).toBe(COMPOSER_MAX_FAILURES);
    expect(view.errorCode).toBe("COMPOSE_FAILED");
    expect(h.wallet.calls).toContainEqual(["release", "test", spec.id, spec.id]);
  });

  it("poke is idempotent: repeated callbacks never resubmit or add attempts", async () => {
    const h = await setup();
    scripted(h);
    const { spec, runner } = await h.story();
    await runner.start(spec, await previewHold(h, spec.id));
    for (let i = 0; i < 5; i++) await runner.poke();
    await untilStatus(h, runner, "preview_ready");
    for (let i = 0; i < 3; i++) await runner.poke();
    const steps = JSON.parse(
      (h.db.prepare("SELECT steps FROM stories WHERE id=?").get(spec.id) as { steps: string })
        .steps,
    ) as { id: string; attempts: unknown[] }[];
    for (const step of steps.filter((s) => s.id.startsWith("kf:A") || s.id.startsWith("kf:C")))
      expect(step.attempts).toHaveLength(1);
    expect(((await runner.view()) as { status: string }).status).toBe("preview_ready");
    expect(await quotaUsed(h)).toBe(1);
  });

  it("recompose reruns only compose, once, without another charge", async () => {
    const h = await setup();
    const calls = scripted(h);
    const { spec, runner } = await readyStory(h);
    await runner.render(await creditHold(h, spec.id));
    await untilStatus(h, runner, "done");
    const commits = h.wallet.calls.filter((c) => c[0] === "commit").length;
    expect(await runner.recompose("Tom & Amy", "2019")).toEqual({ ok: true });
    await h.advance(MIN);
    const view = (await untilStatus(h, runner, "done")) as { names: string; recomposeLeft: number };
    expect(view.names).toBe("Tom & Amy");
    expect(view.recomposeLeft).toBe(0);
    expect(calls.compose).toBe(2);
    expect(calls.composeRequests[1]?.caption.line2).toBe("Tom & Amy · 2019");
    expect(h.wallet.calls.filter((c) => c[0] === "commit").length).toBe(commits);
    expect(await runner.recompose("X", "Y")).toEqual({ ok: false, reason: "used" });
  });

  it("fails the preview with FACE_NOT_FOUND when a source photo has no face", async () => {
    const h = await setup();
    scripted(h, { score: { sourceFaces: { survivor: false, infected: true } } });
    const { spec, runner } = await h.story();
    await runner.start(spec, await previewHold(h, spec.id));
    const view = (await untilStatus(h, runner, "preview_failed")) as { errorCode: string };
    expect(view.errorCode).toBe("FACE_NOT_FOUND");
    expect(await quotaUsed(h)).toBe(0);
    // Checked before any model call: no keyframe was made.
    expect([...h.r2.objects.keys()].filter((k) => k.startsWith(`kf/${spec.id}/`))).toEqual([]);
  });

  it("fails the preview with UNDERAGE when a source looks under 18", async () => {
    const h = await setup();
    scripted(h, { score: { minAge: 14 } });
    const { spec, runner } = await h.story();
    await runner.start(spec, await previewHold(h, spec.id));
    const view = (await untilStatus(h, runner, "preview_failed")) as { errorCode: string };
    expect(view.errorCode).toBe("UNDERAGE");
    expect([...h.r2.objects.keys()].filter((k) => k.startsWith(`kf/${spec.id}/`))).toEqual([]);
  });

  it("render twice reserves once", async () => {
    const h = await setup();
    scripted(h);
    const { spec, runner } = await readyStory(h);
    const charge = await creditHold(h, spec.id);
    expect(await runner.render(charge)).toEqual({ ok: true });
    expect(await runner.render(charge)).toEqual({
      ok: false,
      reason: "already",
      activeReservation: spec.id,
    });
  });
});
