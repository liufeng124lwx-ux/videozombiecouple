import { afterEach, describe, expect, it, vi } from "vitest";
import { ADMIN_ENV, adminKit } from "./admin-kit.ts";
import { setup } from "./harness.ts";

afterEach(() => vi.unstubAllGlobals());

async function member() {
  const h = await setup(ADMIN_ENV);
  const kit = await adminKit(h.env);
  const { userId } = await h.signIn("ann@example.com");
  const wallet = h.wallets.instance(userId);
  const balance = async () => (await wallet.balance(userId)).total;
  return { h, kit, userId, balance };
}

describe("admin users (spec 8.1)", () => {
  it("finds a user by email or id and shows their credits, orders and jobs", async () => {
    const { kit, userId } = await member();
    const byEmail = await (await kit.get("/admin/users?q=ann%40example.com")).text();
    expect(byEmail).toContain(userId);
    const detail = await (await kit.get(`/admin/users/${userId}`)).text();
    expect(detail).toContain("ann@example.com");
    expect(detail).toContain("Credit buckets");
    expect(detail).toContain("Orders");
    expect(detail).toContain("Jobs");
    expect((await kit.get("/admin/users/nobody")).status).toBe(404);
  });

  it("adds credits once per form, takes them away without going negative, and audits both", async () => {
    const { h, kit, userId, balance } = await member();
    const add = { delta: "5", reason: "support: refund for a failed job", nonce: "n1" };
    expect((await kit.post(`/admin/users/${userId}/credits`, add)).status).toBe(303);
    await kit.post(`/admin/users/${userId}/credits`, add);
    expect(await balance()).toBe(5);
    const take = { delta: "-3", reason: "abuse", nonce: "n2" };
    await kit.post(`/admin/users/${userId}/credits`, take);
    await kit.post(`/admin/users/${userId}/credits`, take);
    expect(await balance()).toBe(2);
    await kit.post(`/admin/users/${userId}/credits`, { delta: "-8", reason: "abuse", nonce: "n3" });
    expect(await balance()).toBe(0);
    const rows = h.db.prepare("SELECT actor, action, target FROM admin_audit ORDER BY id").all();
    expect(rows).toEqual(
      Array(3).fill({ actor: "boss@videozombiecouple.com", action: "credits", target: userId }),
    );
  });

  it("refuses an adjustment without a reason, or out of range", async () => {
    const { kit, userId, balance } = await member();
    const post = (form: Record<string, string>) => kit.post(`/admin/users/${userId}/credits`, form);
    expect((await post({ delta: "5", reason: " ", nonce: "a" })).status).toBe(400);
    expect((await post({ delta: "0", reason: "x", nonce: "b" })).status).toBe(400);
    expect((await post({ delta: "20000", reason: "x", nonce: "c" })).status).toBe(400);
    expect(await post({ delta: "5", reason: "x", nonce: "d" }).then((r) => r.status)).toBe(303);
    expect(
      (await kit.post("/admin/users/nobody/credits", { delta: "5", reason: "x", nonce: "e" }))
        .status,
    ).toBe(404);
    expect(await balance()).toBe(5);
  });

  it("escapes what users typed", async () => {
    const { h, kit } = await member();
    const { userId } = await h.signIn("x@example.com");
    h.db
      .prepare("UPDATE users SET email=? WHERE id=?")
      .run("<script>alert(1)</script>@example.com", userId);
    const text = await (await kit.get(`/admin/users/${userId}`)).text();
    expect(text).not.toContain("<script>alert(1)</script>");
    expect(text).toContain("&lt;script&gt;");
  });

  it("applies a double-clicked form once, even when both posts race", async () => {
    const { h, kit, userId, balance } = await member();
    await kit.post(`/admin/users/${userId}/credits`, { delta: "5", reason: "x", nonce: "g" });
    const take = { delta: "-3", reason: "abuse", nonce: "race" };
    // A slow wallet lets both posts pass the duplicate check before either one takes credits.
    const wallet = h.wallets.instance(userId);
    const real = wallet.balance.bind(wallet);
    wallet.balance = async (id: string) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return real(id);
    };
    await Promise.all([
      kit.post(`/admin/users/${userId}/credits`, take),
      kit.post(`/admin/users/${userId}/credits`, take),
    ]);
    expect(await balance()).toBe(2);
  });

  it("records what couldn't be taken as debt, and shows the person an adjustment, not a refund", async () => {
    const { h, kit, userId } = await member();
    await kit.post(`/admin/users/${userId}/credits`, {
      delta: "5",
      reason: "goodwill",
      nonce: "p",
    });
    await kit.post(`/admin/users/${userId}/credits`, { delta: "-8", reason: "abuse", nonce: "q" });
    expect(h.db.prepare("SELECT refund_debt FROM users WHERE id=?").get(userId)).toEqual({
      refund_debt: 3,
    });
    expect(
      h.db
        .prepare("SELECT type, reason FROM credit_ledger WHERE user_id=? ORDER BY id")
        .all(userId),
    ).toEqual([
      { type: "admin_adjust", reason: "admin" },
      { type: "admin_adjust", reason: "admin" },
    ]);
  });
});

describe("admin daily credit cap (cost guardrails spec 4)", () => {
  it("sets the cap, clears it with an empty value, and audits both", async () => {
    const { h, kit, userId } = await member();
    const cap = () =>
      h.db.prepare("SELECT daily_credit_cap AS cap FROM users WHERE id=?").get(userId);
    expect((await kit.post(`/admin/users/${userId}/cap`, { cap: "50" })).status).toBe(303);
    expect(cap()).toEqual({ cap: 50 });
    await kit.post(`/admin/users/${userId}/cap`, { cap: "" });
    expect(cap()).toEqual({ cap: null });
    const rows = h.db
      .prepare("SELECT actor, action, target, before, after FROM admin_audit ORDER BY id")
      .all() as Record<string, string>[];
    expect(rows.map((r) => [r.action, r.target])).toEqual([
      ["daily_cap", userId],
      ["daily_cap", userId],
    ]);
    expect(rows[0]?.after).toContain("50");
  });
});
