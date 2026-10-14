import { afterEach, describe, expect, it, vi } from "vitest";
import { hashIdentity } from "../src/services/crypto.ts";
import { ADMIN_ENV, adminKit } from "./admin-kit.ts";
import { HMAC_KEY, setup, VISITOR } from "./harness.ts";

afterEach(() => vi.unstubAllGlobals());

describe("admin bans (spec 7.1, 8.1)", () => {
  it("bans a whole IP segment, and lifting it removes the ban", async () => {
    const h = await setup(ADMIN_ENV);
    const kit = await adminKit(h.env);
    const form = { kind: "ip", value: "198.51.100.7", days: "7", reason: "card testing" };
    expect((await kit.post("/admin/bans", form)).status).toBe(303);
    expect((await h.call("/v1/me", { ip: "198.51.100.200" })).status).toBe(403);
    expect((await h.call("/v1/me", { ip: "198.51.101.1" })).status).toBe(200);
    const listing = await (await kit.get("/admin/bans")).text();
    expect(listing).toContain("card testing");
    expect(listing).toContain("198.51.100.0/24");
    const row = h.db.prepare("SELECT id FROM bans").get() as { id: number };
    expect((await kit.post(`/admin/bans/${row.id}/delete`, {})).status).toBe(303);
    expect(h.db.prepare("SELECT COUNT(*) AS n FROM bans").get()).toEqual({ n: 0 });
    expect(h.db.prepare("SELECT action FROM admin_audit ORDER BY id").all()).toEqual([
      { action: "ban" },
      { action: "unban" },
    ]);
  });

  it("bans an account by its user id, and a visitor by their id", async () => {
    const h = await setup(ADMIN_ENV);
    const kit = await adminKit(h.env);
    const { userId, session } = await h.signIn();
    await kit.post("/admin/bans", {
      kind: "account",
      value: userId,
      days: "1",
      reason: "chargebacks",
    });
    expect((await h.call("/v1/me", { session })).status).toBe(403);
    await kit.post("/admin/bans", {
      kind: "visitor",
      value: "bad0bad0bad0bad0bad0bad0bad0bad0",
      days: "1",
      reason: "abuse",
    });
    expect(
      (await h.call("/v1/me", { visitor: "bad0bad0bad0bad0bad0bad0bad0bad0", ip: "203.0.113.9" }))
        .status,
    ).toBe(403);
  });

  it("refuses a ban without a reason, with a bad duration, or on an IP that doesn't parse", async () => {
    const h = await setup(ADMIN_ENV);
    const kit = await adminKit(h.env);
    const post = (form: Record<string, string>) => kit.post("/admin/bans", form);
    expect((await post({ kind: "ip", value: "198.51.100.7", days: "7", reason: "" })).status).toBe(
      400,
    );
    expect((await post({ kind: "ip", value: "198.51.100.7", days: "0", reason: "x" })).status).toBe(
      400,
    );
    expect((await post({ kind: "ip", value: "not-an-ip", days: "7", reason: "x" })).status).toBe(
      400,
    );
    expect((await post({ kind: "planet", value: "x", days: "7", reason: "x" })).status).toBe(400);
    expect((await post({ kind: "visitor", value: "vid-bad", days: "7", reason: "x" })).status).toBe(
      400,
    );
    expect(h.db.prepare("SELECT COUNT(*) AS n FROM bans").get()).toEqual({ n: 0 });
  });

  it("bans the visitor behind a job from its stored hash, since raw ids are never kept", async () => {
    const h = await setup(ADMIN_ENV);
    const kit = await adminKit(h.env);
    const visitorHash = await hashIdentity(`visitor:${VISITOR}`, HMAC_KEY);
    const { spec } = await h.job();
    h.db.prepare("UPDATE jobs SET visitor_hash=? WHERE id=?").run(visitorHash, spec.id);
    const page = await (await kit.get(`/admin/jobs/${spec.id}`)).text();
    expect(page).toContain(`value="${visitorHash}"`);
    const response = await kit.post("/admin/bans", {
      kind: "visitor",
      hash: visitorHash,
      days: "7",
      reason: "abuse",
      job: spec.id,
    });
    expect(response.status).toBe(303);
    expect((await h.call("/v1/me", { ip: "203.0.113.9" })).status).toBe(403);
    expect(
      (await kit.post("/admin/bans", { kind: "visitor", hash: "short", days: "7", reason: "x" }))
        .status,
    ).toBe(400);
  });
});
