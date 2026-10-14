import { TIERS } from "@vzc/catalog";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setup, storyBody } from "./harness.ts";
import { signWebhook, waffoEvent, waffoKit } from "./waffo-kit.ts";

const T0 = Date.UTC(2026, 9, 14, 12);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

describe("a couple's journey (spec §4.1)", () => {
  it("signs in, previews for free, buys a pack, renders, downloads and retitles once", async () => {
    const kit = await waffoKit();
    const h = await setup({ ...kit.env, FAKE_COMPOSER: "1" });
    const { userId, session } = await h.signIn("ann@example.com");
    await h.pass();

    // Two photos and a free preview.
    const survivor = await h.upload();
    const infected = await h.upload();
    const created = await h.call("/v1/stories", {
      method: "POST",
      session,
      body: storyBody(survivor, infected, { names: "Ann & Ben", date: "2019" }),
    });
    expect(created.status).toBe(201);
    const id = created.body.storyId as string;
    await h.untilStory(id, "preview_ready");
    const ready = await h.call(`/v1/stories/${id}`, { session });
    expect((ready.body.preview as { A: string; C: string }).A).toContain(`kf/${id}/`);
    expect((await h.call("/v1/quota", { session })).body.remaining).toBe(2);

    // Buys the 3-video pack.
    const event = waffoEvent("order.completed", {
      orderId: `ORD_${"j".repeat(22)}`,
      merchantProvidedBuyerIdentity: userId,
      productMetadata: { productKey: "pack3" },
      chargedAmount: "11.99",
    });
    const raw = JSON.stringify(event);
    const delivered = await h.call("/webhooks/waffo", {
      method: "POST",
      body: event,
      headers: { "x-waffo-signature": await signWebhook(raw, kit.keys.privateKey) },
    });
    expect(delivered.status).toBe(200);
    const balance = async () => (await h.wallets.instance(userId).balance(userId)).total;
    expect(await balance()).toBe(30);

    // Renders the video.
    const render = await h.call(`/v1/stories/${id}/render`, {
      method: "POST",
      session,
      body: { idempotencyKey: "render-ann-1" },
    });
    expect(render.status).toBe(202);
    await h.untilStory(id, "done");
    const done = await h.call(`/v1/stories/${id}`, { session });
    expect((done.body.video as { url: string }).url).toContain(`out/${id}/video.mp4`);
    expect(await balance()).toBe(30 - TIERS.video.credits);

    // One free retitle, then no more; no extra charge.
    const retitle = await h.call(`/v1/stories/${id}/recompose`, {
      method: "POST",
      session,
      body: { names: "Ann & Ben", date: "since 2019" },
    });
    expect(retitle.status).toBe(202);
    await h.untilStory(id, "done");
    expect((await h.call(`/v1/stories/${id}`, { session })).body.date).toBe("since 2019");
    const again = await h.call(`/v1/stories/${id}/recompose`, {
      method: "POST",
      session,
      body: { names: "X", date: "Y" },
    });
    expect(again.body.error?.code).toBe("RECOMPOSE_USED");
    expect(await balance()).toBe(30 - TIERS.video.credits);
  });
});
