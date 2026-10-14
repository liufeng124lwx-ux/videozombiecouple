import { OPS } from "@vzc/catalog";
import { describe, expect, it, vi } from "vitest";
import { deliver, raise, resolve } from "../src/ops/alerts.ts";
import type { Bindings } from "../src/types.ts";
import { setup } from "./harness.ts";

const ALERT = {
  key: "health:keyframe",
  title: "Health check failed",
  detail: "keyframe: timeout",
};

describe("ops alerts (spec 8.3)", () => {
  it("sends an alert once an hour while it stays open, and once when it clears", async () => {
    const h = await setup();
    const env = h.env as unknown as Bindings;
    const sent: string[] = [];
    const send = async (_env: Bindings, text: string) => void sent.push(text);
    expect(await raise(env, ALERT, 0, send)).toBe(true);
    expect(await raise(env, ALERT, OPS.alertQuietMs - 1, send)).toBe(false);
    expect(await raise(env, ALERT, OPS.alertQuietMs, send)).toBe(true);
    expect(await resolve(env, ALERT.key, ALERT.title, OPS.alertQuietMs + 5, send)).toBe(true);
    expect(await resolve(env, ALERT.key, ALERT.title, OPS.alertQuietMs + 6, send)).toBe(false);
    expect(sent).toHaveLength(3);
    expect(sent[0]).toContain("Health check failed");
    expect(sent[2]).toContain("Resolved");
  });

  it("goes to Telegram and email, and never throws when they fail", async () => {
    const h = await setup({
      TELEGRAM_BOT_TOKEN: "bot-token",
      TELEGRAM_CHAT_ID: "42",
      ALERT_EMAIL: "ops@videozombiecouple.com",
    });
    const fetch = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await deliver(h.env as unknown as Bindings, "Health check failed\nkeyframe");
    expect(fetch).toHaveBeenCalledWith(
      "https://api.telegram.org/botbot-token/sendMessage",
      expect.objectContaining({ method: "POST" }),
    );
    expect(h.mail[0]).toMatchObject({
      to: "ops@videozombiecouple.com",
      subject: "Health check failed",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("down");
      }),
    );
    await expect(deliver(h.env as unknown as Bindings, "x")).resolves.toBeUndefined();
    vi.unstubAllGlobals();
  });
});
