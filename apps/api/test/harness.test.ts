import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jpeg, namespace, setup } from "./harness.ts";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.UTC(2026, 9, 9, 12));
});
afterEach(() => vi.useRealTimers());

describe("harness", () => {
  it("applies the migrations", async () => {
    const h = await setup();
    const tables = h.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(tables).toEqual(expect.arrayContaining(["bans", "jobs", "provider_routes"]));
  });

  it("serves R2 range reads", async () => {
    const h = await setup();
    const bucket = h.env.BUCKET as R2Bucket;
    await bucket.put("in/a.jpg", jpeg(10, 20));
    const head = await bucket.head("in/a.jpg");
    expect(head?.size).toBe(jpeg(10, 20).byteLength);
    const part = await bucket.get("in/a.jpg", { range: { offset: 0, length: 2 } });
    expect([...new Uint8Array(await (part as R2ObjectBody).arrayBuffer())]).toEqual([0xff, 0xd8]);
  });

  it("keeps Durable Object storage across a restart", async () => {
    const ns = namespace((ctx) => ({ ctx }));
    await ns.instance("x").ctx.storage.put("k", { n: 1 });
    const fresh = ns.restart("x");
    expect(await fresh.ctx.storage.get("k")).toEqual({ n: 1 });
  });

  it("fires alarms in time order while advancing the clock", async () => {
    const h = await setup();
    const fired: number[] = [];
    const ns = namespace((ctx) => ({
      ctx,
      alarm: async () => {
        fired.push(Date.now());
        if (fired.length < 3) await ctx.storage.setAlarm(Date.now() + 1_000);
      },
    }));
    h.namespaces.test = ns as never;
    const start = Date.now();
    await ns.instance("a").ctx.storage.setAlarm(start + 500);
    await h.advance(10_000);
    expect(fired).toEqual([start + 500, start + 1_500, start + 2_500]);
    expect(Date.now()).toBe(start + 10_000);
  });

  it("runs D1 batches as one transaction", async () => {
    const h = await setup();
    const db = h.env.DB as D1Database;
    const insert = "INSERT INTO bans(hash,kind,expires,reason) VALUES(?,?,?,?)";
    await expect(
      db.batch([
        db.prepare(insert).bind("a", "ip", 1, "x"),
        db.prepare("INSERT INTO nope VALUES(1)"),
      ]),
    ).rejects.toThrow();
    expect(h.db.prepare("SELECT COUNT(*) AS n FROM bans").get()).toEqual({ n: 0 });
    await db.batch([
      db.prepare(insert).bind("a", "ip", 1, "x"),
      db.prepare(insert).bind("b", "ip", 1, "x"),
    ]);
    expect(h.db.prepare("SELECT COUNT(*) AS n FROM bans").get()).toEqual({ n: 2 });
  });

  it("lists R2 keys by prefix and records sent mail", async () => {
    const h = await setup();
    const bucket = h.env.BUCKET as R2Bucket;
    for (const key of ["out/J/a1.png", "out/J/a2.png", "out/K/a1.png"]) await bucket.put(key, "x");
    const listed = await bucket.list({ prefix: "out/J/" });
    expect(listed.objects.map((o) => o.key)).toEqual(["out/J/a1.png", "out/J/a2.png"]);
    const email = h.env.EMAIL as { send: (m: unknown) => Promise<unknown> };
    await email.send({ to: "a@b.co", subject: "s", text: "t", html: "h", from: "f" });
    expect(h.mail).toEqual([{ to: "a@b.co", subject: "s", text: "t", html: "h", from: "f" }]);
  });

  it("applies the accounts migration", async () => {
    const h = await setup();
    const tables = h.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(tables).toEqual(
      expect.arrayContaining(["users", "sessions", "credit_buckets", "credit_ledger"]),
    );
  });

  it("applies the billing migration", async () => {
    const h = await setup();
    const tables = h.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(tables).toEqual(expect.arrayContaining(["orders", "subscriptions", "billing_events"]));
    const columns = h.db
      .prepare("PRAGMA table_info(users)")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(columns).toEqual(expect.arrayContaining(["paid_paused_at", "refund_debt"]));
  });
});
