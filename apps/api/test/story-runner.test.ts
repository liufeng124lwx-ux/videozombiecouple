import { ROUTES, TIERS } from "@vzc/catalog";
import type { StoryView } from "@vzc/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMPOSER_MAX_FAILURES } from "../src/durable-objects/story-runner.ts";
import type { ComposeRequest, ComposerApi, ScoreResponse } from "../src/services/composer.ts";
import { fakeComposer } from "../src/services/composer.ts";
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
  const calls = { score: 0, compose: 0, watermark: 0, composeRequests: [] as ComposeRequest[] };
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
    async watermark(request) {
      calls.watermark += 1;
      return base.watermark(request);
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

async function creditHold(
  h: Awaited<ReturnType<typeof setup>>,
  storyId: string,
  credits = 10,
  reserve = TIERS.video.credits,
): Promise<ChargeHold> {
  const wallet = h.wallets.instance("test");
  await wallet.grant("test", {
    kind: "pack",
    credits,
    expiresAt: null,
    sourceRef: `order-${storyId}`,
    reason: "test",
  });
  const reserved = await wallet.reserve("test", storyId, reserve, storyId);
  expect(reserved.ok).toBe(true);
  return { kind: "credits", userId: "test", reservationId: storyId, reserved: reserve };
}

const stepAttempts = (h: Awaited<ReturnType<typeof setup>>, id: string) =>
  JSON.parse(
    (h.db.prepare("SELECT steps FROM stories WHERE id=?").get(id) as { steps: string }).steps,
  ) as {
    id: string;
    attempts: unknown[];
  }[];

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
  await runner.start(spec);
  await untilStatus(h, runner, "preview_ready");
  return { spec, runner };
}

describe("StoryRunner: the free zombie photo", () => {
  it("checks the photo, makes one zombie portrait for free and stamps it; nothing is charged", async () => {
    const h = await setup();
    const calls = scripted(h);
    const { spec, runner } = await h.story({ product: "photo" });
    await runner.start(spec);
    const view = (await untilStatus(h, runner, "done")) as StoryView;
    expect(calls.score).toBe(1);
    expect(calls.watermark).toBe(1);
    expect(calls.compose).toBe(0);
    expect(view.photo).toContain(`out/${spec.id}/zombie.jpg`);
    expect(view.video).toBeNull();
    expect(await h.r2.BUCKET.head(`out/${spec.id}/zombie.jpg`)).not.toBeNull();
    // One keyframe call on the free pool, with the portrait prompt and only the one photo.
    const steps = stepAttempts(h, spec.id);
    expect(steps.map((s) => s.id)).toEqual(["score:sources", "kf:Z", "mark"]);
    expect(h.wallet.calls).toEqual([]);
    const row = h.db.prepare("SELECT status, output_key FROM stories WHERE id=?").get(spec.id);
    expect(row).toEqual({ status: "done", output_key: `out/${spec.id}/zombie.jpg` });
  });

  it("a photo is never rendered into a film, remade or retitled", async () => {
    const h = await setup();
    scripted(h);
    const { spec, runner } = await h.story({ product: "photo" });
    await runner.start(spec);
    await untilStatus(h, runner, "done");
    expect((await runner.render(h.noCharge)).ok).toBe(false);
    expect((await runner.remake()).ok).toBe(false);
    expect((await runner.recompose("A", "B")).ok).toBe(false);
  });

  it("refuses a photo that looks under age before generating anything", async () => {
    const h = await setup();
    const calls = scripted(h, { score: { minAge: 16 } });
    const { spec, runner } = await h.story({ product: "photo" });
    await runner.start(spec);
    const view = (await untilStatus(h, runner, "preview_failed")) as StoryView;
    expect(view.errorCode).toBe("UNDERAGE");
    expect(calls.watermark).toBe(0);
    expect(stepAttempts(h, spec.id).find((s) => s.id === "kf:Z")?.attempts).toEqual([]);
  });
});

describe("StoryRunner", () => {
  it("before payment only the photos are checked: no keyframe, no model call", async () => {
    const h = await setup();
    const calls = scripted(h);
    const { spec, runner } = await h.story();
    await runner.start(spec);
    const view = (await untilStatus(h, runner, "preview_ready")) as { preview: unknown };
    expect(view.preview).toBeNull();
    expect(calls.score).toBe(1);
    expect([...h.r2.objects.keys()].filter((k) => k.startsWith(`kf/${spec.id}/`))).toEqual([]);
    const row = h.db.prepare("SELECT status FROM stories WHERE id=?").get(spec.id) as {
      status: string;
    };
    expect(row.status).toBe("preview_ready");
  });

  it("after payment: four candidates scored, picks set; every A candidate failing refunds", async () => {
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
    const { spec, runner } = await readyStory(h);
    await runner.render(await creditHold(h, spec.id));
    const view = (await untilStatus(h, runner, "failed")) as { errorCode: string };
    expect(view.errorCode).toBe("CONTENT_REJECTED");
    expect(h.wallet.calls).toContainEqual(["release", "test", spec.id, spec.id]);
  });

  it("refuses to render before the photos are checked", async () => {
    const h = await setup();
    // The composer is briefly down: the check is retried later, the story is still checking.
    scripted(h, { scoreErrors: 1 });
    const { spec, runner } = await h.story();
    await runner.start(spec);
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

  it("while rendering, shows the shot list and the chosen keyframes as they come in", async () => {
    const h = await setup();
    scripted(h);
    const { spec, runner } = await readyStory(h);
    const ids = ["frames", "shot:1", "shot:2", "shot:3", "shot:4", "shot:5", "compose"];
    expect((await runner.view()) as StoryView).toMatchObject({ stages: [], frames: [] });
    await runner.render(await creditHold(h, spec.id));
    let view = (await runner.view()) as StoryView;
    expect(view.stages?.map((s) => s.id)).toEqual(ids);
    expect(view.stages?.[0]?.state).not.toBe("done");
    expect(view.frames).toEqual([]);
    for (
      let i = 0;
      i < 720 && !view.stages?.some((s) => s.id.startsWith("shot:") && s.state === "done");
      i++
    ) {
      await h.advance(10_000);
      view = (await runner.view()) as StoryView;
    }
    expect(view.status).toBe("rendering");
    expect(view.stages?.[0]?.state).toBe("done");
    // A and C after scoring, then B: signed links to this story's own keyframes.
    expect(view.frames?.length).toBe(3);
    for (const url of view.frames ?? []) expect(url).toContain(spec.id);
    const done = await untilStatus(h, runner, "done");
    expect(done.stages?.every((s) => s.state === "done")).toBe(true);
  });

  it("emails the owner once when the film is ready, not again after a title change", async () => {
    const h = await setup();
    scripted(h);
    h.db
      .prepare("INSERT INTO users(id,email,email_verified_at,created_at) VALUES(?,?,?,?)")
      .run("test", "ann@example.com", Date.now(), Date.now());
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

  it("a story gets at most three paid attempts", async () => {
    const h = await setup();
    scripted(h, { composeErrors: 1_000 });
    const { spec, runner } = await readyStory(h);
    const wallet = h.wallets.instance("test");
    await wallet.grant("test", {
      kind: "pack",
      credits: 40,
      expiresAt: null,
      sourceRef: "order-x",
      reason: "test",
    });
    for (let n = 1; n <= 4; n++) {
      const reservationId = n === 1 ? spec.id : `${spec.id}:v${n}`;
      expect((await wallet.reserve("test", reservationId, 10, spec.id)).ok).toBe(true);
      const outcome = await runner.render({
        kind: "credits",
        userId: "test",
        reservationId,
        reserved: 10,
      });
      if (n === 4) {
        expect(outcome).toEqual({ ok: false, reason: "attempts" });
        break;
      }
      expect(outcome).toEqual({ ok: true });
      await untilStatus(h, runner, "failed", 240);
    }
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
    const { spec, runner } = await readyStory(h);
    await runner.render(await creditHold(h, spec.id));
    for (let i = 0; i < 5; i++) await runner.poke();
    await untilStatus(h, runner, "done");
    for (let i = 0; i < 3; i++) await runner.poke();
    const steps = JSON.parse(
      (h.db.prepare("SELECT steps FROM stories WHERE id=?").get(spec.id) as { steps: string })
        .steps,
    ) as { id: string; attempts: unknown[] }[];
    for (const step of steps.filter((s) => s.id.startsWith("kf:A") || s.id.startsWith("kf:C")))
      expect(step.attempts).toHaveLength(1);
    expect(h.wallet.calls.filter((c) => c[0] === "commit")).toHaveLength(1);
  });

  it("remakes a paid film once for free while the photos exist", async () => {
    const h = await setup();
    const calls = scripted(h);
    const { spec, runner } = await readyStory(h);
    await runner.render(await creditHold(h, spec.id));
    await untilStatus(h, runner, "done");
    const commits = h.wallet.calls.filter((c) => c[0] === "commit").length;
    expect(await runner.remake()).toEqual({ ok: true });
    const view = (await untilStatus(h, runner, "done")) as { remakeLeft: number };
    expect(view.remakeLeft).toBe(0);
    expect(calls.compose).toBe(2);
    expect(h.wallet.calls.filter((c) => c[0] === "commit").length).toBe(commits);
    expect(await runner.remake()).toEqual({ ok: false, reason: "used" });
  });

  it("refuses a remake once the photos are deleted", async () => {
    const h = await setup();
    scripted(h);
    const { spec, runner } = await readyStory(h);
    await runner.render(await creditHold(h, spec.id));
    await untilStatus(h, runner, "done");
    await h.r2.BUCKET.delete(spec.survivorKey);
    expect(await runner.remake()).toEqual({ ok: false, reason: "photos_gone" });
    expect(((await runner.view()) as { status: string }).status).toBe("done");
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
    await runner.start(spec);
    const view = (await untilStatus(h, runner, "preview_failed")) as { errorCode: string };
    expect(view.errorCode).toBe("FACE_NOT_FOUND");
    // Checked before any model call: no keyframe was made.
    expect([...h.r2.objects.keys()].filter((k) => k.startsWith(`kf/${spec.id}/`))).toEqual([]);
  });

  it("keeps a margin over 18: an estimated 20 is refused, an estimated 21 passes", async () => {
    const at = async (minAge: number) => {
      const h = await setup();
      scripted(h, { score: { minAge } });
      const { spec, runner } = await h.story();
      await runner.start(spec);
      for (let i = 0; i < 60; i++) {
        const view = (await runner.view()) as { status: string; errorCode: string | null };
        if (view.status !== "previewing") return view.errorCode ?? view.status;
        await h.advance(10_000);
      }
      return "timeout";
    };
    expect(await at(20)).toBe("UNDERAGE");
    expect(await at(21)).toBe("preview_ready");
  });

  it("fails the preview with UNDERAGE when a source looks under 18", async () => {
    const h = await setup();
    scripted(h, { score: { minAge: 14 } });
    const { spec, runner } = await h.story();
    await runner.start(spec);
    const view = (await untilStatus(h, runner, "preview_failed")) as { errorCode: string };
    expect(view.errorCode).toBe("UNDERAGE");
    expect([...h.r2.objects.keys()].filter((k) => k.startsWith(`kf/${spec.id}/`))).toEqual([]);
  });

  it("fails the preview with PHOTO_REJECTED when moderation flags an upload", async () => {
    const h = await setup();
    scripted(h);
    const checked: string[] = [];
    h.env.MODERATION_IMPL = {
      async check(url: string) {
        checked.push(url);
        return url.includes("infected")
          ? { flagged: true, labels: ["explicit_nudity"] }
          : { flagged: false, labels: [] };
      },
    };
    const { spec, runner } = await h.story();
    await runner.start(spec);
    const view = (await untilStatus(h, runner, "preview_failed")) as { errorCode: string };
    expect(view.errorCode).toBe("PHOTO_REJECTED");
    expect(checked).toHaveLength(2);
  });

  it("lets the photos through when moderation is down (fail open), and can be set to fail closed", async () => {
    const down = {
      async check(): Promise<never> {
        throw new Error("seeapi: inference_failed");
      },
    };
    const open = await setup();
    scripted(open);
    open.env.MODERATION_IMPL = down;
    const a = await open.story();
    await a.runner.start(a.spec);
    await untilStatus(open, a.runner, "preview_ready");

    const closed = await setup({ MODERATION_FAIL: "closed" });
    scripted(closed);
    closed.env.MODERATION_IMPL = down;
    const b = await closed.story();
    await b.runner.start(b.spec);
    const view = (await untilStatus(closed, b.runner, "preview_failed")) as { errorCode: string };
    expect(view.errorCode).toBe("PROVIDER_DOWN");
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

describe("StoryRunner: stories", () => {
  async function christmas(h: Awaited<ReturnType<typeof setup>>) {
    const { spec, runner } = await h.story({ story: "christmas", scene: "snow-cabin" });
    for (const name of ["ornament.jpg", "hands.mp4", "window.mp4", "music.m4a"])
      await h.r2.BUCKET.put(`assets/stories/christmas/snow-cabin/${name}`, new Uint8Array([1]));
    await runner.start(spec);
    await untilStatus(h, runner, "preview_ready");
    return { spec, runner };
  }

  // enabled by Task 5 (the runner executes the describe step)
  it.skip("renders a Christmas film: eleven keyframes, seven shots, clips from the scene, 20 credits", async () => {
    const h = await setup();
    const calls = scripted(h);
    const { spec, runner } = await christmas(h);
    expect(await runner.render(await creditHold(h, spec.id, 20, 20))).toEqual({ ok: true });
    const view = await untilStatus(h, runner, "done");
    expect(view.story).toBe("christmas");
    const req = calls.composeRequests[0];
    expect(req?.shots.map((s) => s.grade)).toEqual([
      "cold",
      "cold",
      "cold",
      "cold",
      "cold",
      "amber",
      "golden",
      "amber-dawn",
      "amber-dawn",
    ]);
    expect(req?.shots[3]?.url).toContain("assets/stories/christmas/shared/hands.mp4");
    expect(req?.shots[8]?.url).toContain("assets/stories/christmas/snow-cabin/window.mp4");
    expect(req?.shots.map((s) => s.flash)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
    ]);
    expect(req?.holdSec).toBe(0);
    expect(req?.titleAt).toBe(30);
    expect(req?.overlays.map((o) => o.start)).toEqual([0, 10]);
    expect(req?.caption.line1).toMatch(/^Our first Christmas · \d{4}$/);
    expect(req?.musicUrl).toContain("assets/stories/christmas/snow-cabin/music.m4a");
    const kie = stepAttempts(h, spec.id)
      .filter((s) => s.attempts.length > 0)
      .map((s) => s.id);
    expect(kie.filter((id) => id.startsWith("kf:"))).toHaveLength(11);
    expect(kie.filter((id) => id.startsWith("shot:"))).toHaveLength(7);
    expect(h.wallet.calls.some((c) => c[0] === "commit" && c[2] === spec.id && c[3] === 20)).toBe(
      true,
    );
  });

  it("a failed Christmas film gives all 20 credits back", async () => {
    const h = await setup({
      FAKE_SCRIPT: JSON.stringify(
        Object.fromEntries(
          ROUTES.filter((r) => r.capability === "shot").map((r) => [
            r.model,
            Array(40).fill({ kind: "fail", failMsg: "content policy violation" }),
          ]),
        ),
      ),
    });
    scripted(h);
    const { spec, runner } = await christmas(h);
    await runner.render(await creditHold(h, spec.id, 20, 20));
    await untilStatus(h, runner, "failed");
    expect(h.wallet.calls).toContainEqual(["release", "test", spec.id, spec.id]);
    expect(h.wallet.calls.some((c) => c[0] === "commit")).toBe(false);
  });

  it("a zombie film already running when stories shipped (no story field) still finishes", async () => {
    const h = await setup();
    const calls = scripted(h);
    const { spec, runner } = await readyStory(h);
    expect(spec.story).toBeUndefined();
    await runner.render(await creditHold(h, spec.id));
    const view = await untilStatus(h, runner, "done");
    expect(view.story).toBe("zombie");
    expect(calls.composeRequests[0]?.caption.line1).toBe("Even at the end of the world.");
    expect(calls.composeRequests[0]?.holdSec).toBe(1);
    expect(calls.composeRequests[0]?.titleAt).toBeNull();
    expect(calls.composeRequests[0]?.overlays).toEqual([]);
    expect(h.wallet.calls.some((c) => c[0] === "commit" && c[2] === spec.id && c[3] === 10)).toBe(
      true,
    );
  });
});
