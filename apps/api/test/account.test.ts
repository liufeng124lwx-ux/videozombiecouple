import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setup } from "./harness.ts";

const NOON = Date.UTC(2026, 9, 9, 12);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOON);
});
afterEach(() => vi.useRealTimers());

async function member() {
  const h = await setup();
  const { userId, session } = await h.signIn("ann@example.com");
  const wallet = h.wallets.instance(userId);
  return { h, userId, session, wallet };
}

describe("account (spec 5.5)", () => {
  it("shows the email, sign-in methods and the balance split", async () => {
    const { h, userId, session, wallet } = await member();
    await wallet.grant(userId, {
      kind: "subscription",
      credits: 150,
      expiresAt: NOON + 30 * 86_400_000,
      sourceRef: null,
      reason: "renewal",
    });
    await wallet.grant(userId, {
      kind: "pack",
      credits: 60,
      expiresAt: null,
      sourceRef: null,
      reason: "pack",
    });
    const response = await h.call("/v1/account", { session });
    expect(response.body).toEqual({
      email: "ann@example.com",
      hasPassword: false,
      google: false,
      createdAt: NOON,
      balance: {
        total: 210,
        subscription: { credits: 150, expiresAt: NOON + 30 * 86_400_000 },
        permanent: 60,
      },
    });
    expect((await h.call("/v1/me", { session })).body.credits).toBe(210);
  });

  it("pages the ledger 20 at a time, newest first, without the zero rows", async () => {
    const { h, userId, session, wallet } = await member();
    await wallet.grant(userId, {
      kind: "pack",
      credits: 100,
      expiresAt: null,
      sourceRef: null,
      reason: "pack",
    });
    for (let i = 0; i < 12; i++) {
      await wallet.reserve(userId, `j${i}`, 1, `j${i}`);
      await wallet.commitReservation(`j${i}`, 1, `j${i}`);
    }
    for (let i = 12; i < 22; i++) {
      await wallet.reserve(userId, `j${i}`, 1, `j${i}`);
      await wallet.releaseReservation(`j${i}`, `j${i}`);
    }
    const first = await h.call("/v1/account/ledger", { session });
    const entries = first.body.entries as { id: number; delta: number; type: string }[];
    expect(entries).toHaveLength(20);
    expect(entries.every((e) => e.delta !== 0)).toBe(true);
    expect(entries[0]?.type).toBe("release");
    const second = await h.call(`/v1/account/ledger?before=${first.body.next}`, { session });
    const rest = second.body.entries as { type: string }[];
    expect(rest).toHaveLength(13);
    expect(rest[rest.length - 1]?.type).toBe("grant");
    expect(second.body.next).toBeNull();
  });

  it("needs a session", async () => {
    const h = await setup();
    expect((await h.call("/v1/account")).body.error?.code).toBe("UNAUTHORIZED");
    expect((await h.call("/v1/account/ledger")).status).toBe(401);
    expect((await h.call("/v1/me")).body.credits).toBeNull();
  });
});
