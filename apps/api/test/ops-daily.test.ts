import { OPS } from "@vzc/catalog";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkBalance } from "../src/ops/costs.ts";
import { refreshDisposable } from "../src/ops/disposable.ts";
import { anonymizeOld } from "../src/ops/privacy.ts";
import { checkHolds, checkLedger, checkWebhooks } from "../src/ops/reconcile.ts";
import { isDisposable } from "../src/services/disposable.ts";
import type { Bindings } from "../src/types.ts";
import { setup } from "./harness.ts";
import { row } from "./rows.ts";

const NOON = Date.UTC(2026, 9, 9, 12);
const DAY = 86_400_000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOON);
});
afterEach(() => vi.useRealTimers());

const recorder = () => {
  const sent: string[] = [];
  return { sent, send: async (_e: Bindings, text: string) => void sent.push(text) };
};

describe("daily reconciliation (spec 8.2)", () => {
  it("finds a credit bucket whose balance doesn't match its ledger", async () => {
    const h = await setup();
    const { userId } = await h.signIn();
    const env = h.env as unknown as Bindings;
    await h.wallets.instance(userId).grant(userId, {
      kind: "pack",
      credits: 60,
      expiresAt: null,
      sourceRef: "o1",
      reason: "test",
    });
    const r = recorder();
    await checkLedger(env, NOON, r.send);
    expect(r.sent).toEqual([]);
    h.db.prepare("UPDATE credit_buckets SET remaining=remaining+1 WHERE user_id=?").run(userId);
    await checkLedger(env, NOON, r.send);
    expect(r.sent[0]).toContain("ledger");
  });

  it("reports holds left open and webhooks not processed after an hour", async () => {
    const h = await setup();
    const env = h.env as unknown as Bindings;
    h.db
      .prepare(
        "INSERT INTO credit_reservations(id,user_id,job_id,parts,state,created_at,updated_at) VALUES('r1','u1','j1','[]','held',?,?)",
      )
      .run(NOON - OPS.staleHoldMs - 1, NOON - OPS.staleHoldMs - 1);
    h.db
      .prepare(
        "INSERT INTO billing_events(id,provider,type,mode,payload,received_at) VALUES('e1','waffo','order.paid','test','{}',?)",
      )
      .run(NOON - OPS.webhookStaleMs - 1);
    const r = recorder();
    await checkHolds(env, NOON, r.send);
    await checkWebhooks(env, NOON, r.send);
    expect(r.sent).toHaveLength(2);
  });
});

describe("kie balance (spec 8.2)", () => {
  it("alerts when the balance covers fewer than five days of average spend", async () => {
    const h = await setup({ FAKE_PROVIDER: "0" });
    h.db
      .prepare(
        "INSERT INTO jobs(id,owner,visitor_hash,ip_hash,capability,mode,mode_source,tier,prompt_version,input_key,crop_box,diagnosis,status,attempts,charge,priority,idempotency_key,created_at,expires_at) VALUES('j','g','v','ip','unblur.std','auto','auto','std','1','in/x.jpg','{}','{}','succeeded',?,'{\"kind\":\"quota\"}','free','k',?,?)",
      )
      .run(JSON.stringify([{ state: "succeeded", costUsd: 70 }]), NOON - DAY, NOON);
    const r = recorder();
    await checkBalance(h.env as unknown as Bindings, NOON, r.send, async () => 100);
    expect(r.sent).toEqual([]);
    await checkBalance(h.env as unknown as Bindings, NOON, r.send, async () => 40);
    expect(r.sent[0]).toContain("kie balance");
  });
});

describe("kie balance reconciliation (cost guardrails spec 5)", () => {
  it("alerts when the balance fell much more than the spend we recorded", async () => {
    const h = await setup({ FAKE_PROVIDER: "0" });
    const env = h.env as unknown as Bindings;
    const sent: string[] = [];
    const send = async (_e: Bindings, text: string) => void sent.push(text);
    await checkBalance(env, NOON - DAY, send, async () => 100);
    row(h, {
      kind: "credits",
      createdAt: NOON - 3_600_000,
      attempts: [{ state: "succeeded", costUsd: 5, finishedAt: NOON - 3_600_000 }],
    });
    await checkBalance(env, NOON, send, async () => 80);
    expect(sent.some((t) => /recorded/i.test(t))).toBe(true);
  });

  it("stays quiet when they match, or the balance went up (a top-up)", async () => {
    const h = await setup({ FAKE_PROVIDER: "0" });
    const env = h.env as unknown as Bindings;
    const sent: string[] = [];
    const send = async (_e: Bindings, text: string) => void sent.push(text);
    await checkBalance(env, NOON - DAY, send, async () => 100);
    row(h, {
      kind: "credits",
      createdAt: NOON - 3_600_000,
      attempts: [{ state: "succeeded", costUsd: 5, finishedAt: NOON - 3_600_000 }],
    });
    await checkBalance(env, NOON, send, async () => 95);
    await checkBalance(env, NOON + DAY, send, async () => 500);
    expect(sent.some((t) => /recorded/i.test(t))).toBe(false);
  });

  it("says that staging and eval spend share the balance", async () => {
    const h = await setup({ FAKE_PROVIDER: "0", ENVIRONMENT: "production" });
    const env = h.env as unknown as Bindings;
    const sent: string[] = [];
    const send = async (_e: Bindings, text: string) => void sent.push(text);
    await checkBalance(env, NOON - DAY, send, async () => 100);
    await checkBalance(env, NOON, send, async () => 80);
    expect(sent.find((t) => /recorded/i.test(t))).toMatch(/staging/i);
  });

  it("skips the comparison outside production, but still checks for a low balance", async () => {
    const h = await setup({ FAKE_PROVIDER: "0", ENVIRONMENT: "staging" });
    const env = h.env as unknown as Bindings;
    const sent: string[] = [];
    const send = async (_e: Bindings, text: string) => void sent.push(text);
    row(h, {
      createdAt: NOON - DAY,
      attempts: [{ state: "succeeded", costUsd: 70, finishedAt: NOON - DAY }],
    });
    await checkBalance(env, NOON - DAY, send, async () => 100);
    await checkBalance(env, NOON, send, async () => 20);
    expect(sent.some((t) => /recorded/i.test(t))).toBe(false);
    expect(sent.some((t) => /kie balance is running low/i.test(t))).toBe(true);
  });

  it("resolves an open reconcile alert once the balance rises (a top-up)", async () => {
    const h = await setup({ FAKE_PROVIDER: "0" });
    const env = h.env as unknown as Bindings;
    const sent: string[] = [];
    const send = async (_e: Bindings, text: string) => void sent.push(text);
    await checkBalance(env, NOON - DAY, send, async () => 100);
    row(h, {
      kind: "credits",
      createdAt: NOON - 3_600_000,
      attempts: [{ state: "succeeded", costUsd: 5, finishedAt: NOON - 3_600_000 }],
    });
    await checkBalance(env, NOON, send, async () => 80);
    expect(sent.some((t) => /recorded/i.test(t))).toBe(true);
    await checkBalance(env, NOON + DAY, send, async () => 500);
    expect(sent.some((t) => t.startsWith("Resolved") && /recorded/i.test(t))).toBe(true);
  });
});

describe("privacy (spec 8.2)", () => {
  it("strips identity and names from stories older than 90 days", async () => {
    const h = await setup();
    const { spec } = await h.story({
      createdAt: NOON - OPS.anonymizeAfterDays * DAY - 1,
      names: "Tom & Amy",
      date: "2019",
    });
    const fresh = await h.story({ names: "Ann & Bo" });
    await anonymizeOld(h.env as unknown as Bindings, NOON);
    const row = (id: string) =>
      h.db
        .prepare(
          "SELECT owner, user_id, idempotency_key, visitor_hash, ip_hash, fp_hash, names, date, kind, scene FROM stories WHERE id=?",
        )
        .get(id);
    expect(row(spec.id)).toEqual({
      owner: "anon",
      user_id: "anon",
      idempotency_key: spec.id,
      visitor_hash: "anon",
      ip_hash: "anon",
      fp_hash: null,
      names: null,
      date: null,
      kind: "human",
      scene: "cabin-wheat",
    });
    expect(row(fresh.spec.id)).toMatchObject({ visitor_hash: "visitor-hash", names: "Ann & Bo" });
  });
});

describe("throwaway domains (spec 5.4)", () => {
  it("refreshes the list weekly from the public blocklist", async () => {
    const h = await setup();
    const env = h.env as unknown as Bindings;
    await refreshDisposable(
      env,
      async () => new Response("burner.example\n# comment\nTEMP.example\n"),
    );
    expect(await isDisposable(env, "a@burner.example")).toBe(true);
    expect(await isDisposable(env, "a@temp.example")).toBe(true);
    await expect(
      refreshDisposable(env, async () => new Response("", { status: 500 })),
    ).rejects.toThrow();
    expect(await isDisposable(env, "a@burner.example")).toBe(true);
  });
});
