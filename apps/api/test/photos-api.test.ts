import { PHOTO } from "@vzc/catalog";
import { UPLOAD_CONSENT_VERSION } from "@vzc/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setup } from "./harness.ts";

const T0 = Date.UTC(2026, 9, 15, 12);
const OTHER = "fedcba9876543210fedcba9876543210";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

type H = Awaited<ReturnType<typeof setup>>;

async function photo(h: H, options: { visitor?: string; ip?: string; key?: string } = {}) {
  await h.pass(options.visitor, options.ip);
  const photoKey = await h.upload({ visitor: options.visitor, ip: options.ip });
  return h.call("/v1/photos", {
    method: "POST",
    visitor: options.visitor,
    ip: options.ip,
    body: {
      photoKey,
      consent: UPLOAD_CONSENT_VERSION,
      idempotencyKey: options.key ?? `photo-${photoKey.slice(3, 29)}`,
    },
  });
}

describe("POST /v1/photos (the free AI zombie filter)", () => {
  it("makes one watermarked zombie photo for a guest, kept for a day, never listed as a film", async () => {
    const h = await setup({ FAKE_COMPOSER: "1" });
    const res = await photo(h);
    expect(res.status).toBe(201);
    const id = res.body.storyId as string;
    await h.untilStory(id, "done");
    const view = await h.call(`/v1/stories/${id}`);
    expect(view.body.photo).toContain(`out/${id}/zombie.jpg`);
    expect(view.body.video).toBeNull();
    const row = h.db
      .prepare(
        "SELECT product, prompt_version, consent_version, created_at, expires_at FROM stories WHERE id=?",
      )
      .get(id) as {
      product: string;
      prompt_version: string;
      consent_version: string;
      created_at: number;
      expires_at: number;
    };
    expect(row.product).toBe("photo");
    expect(row.prompt_version).toBe(PHOTO.promptVersion);
    expect(row.consent_version).toBe(UPLOAD_CONSENT_VERSION);
    expect(row.expires_at - row.created_at).toBe(PHOTO.keepHours * 3_600_000);
    // Members' story lists show their films only.
    const member = await h.signIn("m@example.com");
    h.db
      .prepare("UPDATE stories SET user_id=?, owner=? WHERE id=?")
      .run(member.userId, `u:${member.userId}`, id);
    const list = await h.call("/v1/stories", { session: member.session });
    expect(list.body.stories).toEqual([]);
  });

  it("is one free photo a day per browser; a refused photo does not use it up", async () => {
    const h = await setup({ FAKE_COMPOSER: "1" });
    const first = await photo(h);
    await h.untilStory(first.body.storyId as string, "done");
    const second = await photo(h);
    expect(second.body.error?.code).toBe("DAILY_LIMIT");
    // A photo the check refused (here: marked refused by hand) frees the day's photo again.
    h.db
      .prepare("UPDATE stories SET status='preview_failed' WHERE id=?")
      .run(first.body.storyId as string);
    expect((await photo(h)).status).toBe(201);
    // The next day there is a new one.
    vi.setSystemTime(T0 + 2 * 86_400_000);
    h.db.prepare("UPDATE stories SET status='done'").run();
    expect((await photo(h)).status).toBe(201);
  });

  it("allows a network three free photos a day across browsers", async () => {
    const h = await setup({ FAKE_COMPOSER: "1" });
    for (let i = 0; i < PHOTO.freePerIpDay; i++) {
      const visitor = `${String(i).repeat(32)}`.slice(0, 32);
      const res = await photo(h, { visitor });
      expect(res.status).toBe(201);
      h.db.prepare("UPDATE stories SET status='done' WHERE id=?").run(res.body.storyId as string);
    }
    expect((await photo(h, { visitor: OTHER })).body.error?.code).toBe("DAILY_LIMIT");
  });

  it("needs consent, a human check, and stops when the free budget is spent", async () => {
    const h = await setup({ FAKE_COMPOSER: "1" });
    await h.pass();
    const photoKey = await h.upload();
    const post = (body: Record<string, unknown>) => h.call("/v1/photos", { method: "POST", body });
    expect((await post({ photoKey, idempotencyKey: "photo-no-consent-00" })).body.error?.code).toBe(
      "CONSENT_REQUIRED",
    );
    h.kv.store.set("flags", JSON.stringify({ freePaused: true }));
    vi.setSystemTime(T0 + 61_000); // flags are cached for a minute
    expect(
      (
        await post({
          photoKey,
          consent: UPLOAD_CONSENT_VERSION,
          idempotencyKey: "photo-paused-0000",
        })
      ).body.error?.code,
    ).toBe("FREE_TIER_PAUSED");
  });
});
