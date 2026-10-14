import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { MODES } from "@vzc/catalog";
import { vi } from "vitest";
import { Dispatcher } from "../src/durable-objects/dispatcher.ts";
import { RateLimiter } from "../src/durable-objects/rate-limiter.ts";
import { StoryRunner } from "../src/durable-objects/story-runner.ts";
import { Wallet } from "../src/durable-objects/wallet.ts";
import { ipSegment } from "../src/middleware/identity.ts";
import { app } from "../src/router.ts";
import { hashIdentity } from "../src/services/crypto.ts";
import { HUMAN_PASS_TTL_SEC, HUMAN_PASS_USES } from "../src/services/human-pass.ts";
import { ulid } from "../src/services/ids.ts";
import { randomHex, SESSION_TTL_MS, sha256Hex } from "../src/services/session.ts";
import type { ChargeHold } from "../src/services/settle.ts";
import { createUser } from "../src/services/users.ts";
import type { StorySpec } from "../src/stories/types.ts";

export const ORIGIN = "https://videozombiecouple.com";
export const HMAC_KEY = "test-hmac-key";
export const VISITOR = "0123456789abcdef0123456789abcdef";
export const IP = "203.0.113.42";

/** D1 over node:sqlite with every real migration; batch() is one transaction like D1's. */
function d1() {
  const db = new DatabaseSync(":memory:");
  const dir = new URL("../migrations/", import.meta.url);
  for (const file of readdirSync(dir).sort()) db.exec(readFileSync(new URL(file, dir), "utf8"));
  const run = (query: string, args: unknown[]) => {
    const result = db.prepare(query).run(...(args as never[]));
    return { meta: { changes: Number(result.changes) } };
  };
  type Statement = { query: string; args: unknown[] };
  const statement = (query: string, args: unknown[] = []) => ({
    query,
    args,
    bind: (...values: unknown[]) => statement(query, values),
    first: async <T>() => (db.prepare(query).get(...(args as never[])) as T) ?? null,
    all: async <T>() => ({ results: db.prepare(query).all(...(args as never[])) as T[] }),
    run: async () => run(query, args),
  });
  const D1 = {
    prepare: (query: string) => statement(query),
    batch: async (statements: Statement[]) => {
      db.exec("BEGIN");
      try {
        const results = statements.map((s) => run(s.query, s.args));
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { db, D1: D1 as unknown as D1Database };
}

function kv() {
  const store = new Map<string, string>();
  const KV = {
    get: async (key: string, type?: string) => {
      const value = store.get(key) ?? null;
      return value !== null && type === "json" ? JSON.parse(value) : value;
    },
    put: async (key: string, value: string, options?: { expirationTtl?: number }) => {
      // Like Workers KV: a TTL under 60 seconds is rejected.
      if (options?.expirationTtl !== undefined && options.expirationTtl < 60)
        throw new Error(`KV PUT failed: 400 Invalid expiration_ttl of ${options.expirationTtl}`);
      store.set(key, value);
    },
    delete: async (key: string) => void store.delete(key),
  };
  return { store, KV: KV as unknown as KVNamespace };
}

type StoredObject = { body: Uint8Array; contentType: string | undefined };

function r2() {
  const objects = new Map<string, StoredObject>();
  const meta = (key: string, object: StoredObject) => ({
    key,
    size: object.body.byteLength,
    httpMetadata: { contentType: object.contentType },
  });
  const bucket = {
    head: async (key: string) => {
      const object = objects.get(key);
      return object ? meta(key, object) : null;
    },
    get: async (key: string, options?: { range?: { offset?: number; length?: number } }) => {
      const object = objects.get(key);
      if (!object) return null;
      const offset = options?.range?.offset ?? 0;
      const length = options?.range?.length ?? object.body.byteLength - offset;
      const bytes = object.body.slice(offset, Math.min(object.body.byteLength, offset + length));
      return { ...meta(key, object), arrayBuffer: async () => bytes.slice().buffer };
    },
    put: async (
      key: string,
      value: ArrayBuffer | Uint8Array | string,
      options?: { httpMetadata?: { contentType?: string } },
    ) => {
      const body = new Uint8Array(await new Response(value as BodyInit).arrayBuffer());
      objects.set(key, { body, contentType: options?.httpMetadata?.contentType });
      return meta(key, objects.get(key) as StoredObject);
    },
    delete: async (key: string) => void objects.delete(key),
    list: async (options?: { prefix?: string }) => ({
      objects: [...objects.keys()]
        .filter((key) => key.startsWith(options?.prefix ?? ""))
        .sort()
        .map((key) => ({ key })),
      truncated: false,
    }),
  };
  return { objects, BUCKET: bucket as unknown as R2Bucket };
}

/** Durable Object storage: the key-value API plus one alarm. */
export function storage() {
  const data = new Map<string, unknown>();
  let alarm: number | null = null;
  return {
    data,
    alarmAt: () => alarm,
    clearAlarm: () => {
      alarm = null;
    },
    api: {
      get: async (key: string) => structuredClone(data.get(key)),
      put: async (key: string, value: unknown) => {
        // Like Durable Object storage: one value may not exceed 128 KiB.
        if (new TextEncoder().encode(JSON.stringify(value) ?? "").length > 131_072)
          throw new Error(`Values cannot be larger than 131072 bytes (key ${key})`);
        data.set(key, structuredClone(value));
      },
      delete: async (key: string) => data.delete(key),
      getAlarm: async () => alarm,
      setAlarm: async (time: number | Date) => {
        alarm = typeof time === "number" ? time : time.getTime();
      },
      deleteAlarm: async () => {
        alarm = null;
      },
    },
  };
}

type Entry<T> = { instance: T; store: ReturnType<typeof storage> };

/** An in-memory Durable Object namespace: one instance per name, storage survives restart(). */
export function namespace<T extends object>(make: (ctx: DurableObjectState) => T) {
  const entries = new Map<string, Entry<T>>();
  const context = (store: ReturnType<typeof storage>, name: string) =>
    ({
      id: { name, toString: () => name },
      storage: store.api,
      blockConcurrencyWhile: async <R>(callback: () => Promise<R>) => callback(),
      waitUntil: () => {},
    }) as unknown as DurableObjectState;
  const entry = (name: string): Entry<T> => {
    let found = entries.get(name);
    if (!found) {
      const store = storage();
      found = { instance: make(context(store, name)), store };
      entries.set(name, found);
    }
    return found;
  };
  return {
    entries,
    instance: (name: string) => entry(name).instance,
    /** Simulates an eviction or crash: a fresh instance over the same storage. */
    restart: (name: string) => {
      const found = entry(name);
      found.instance = make(context(found.store, name));
      return found.instance;
    },
    binding: {
      idFromName: (name: string) => name,
      get: (id: string) => entry(id).instance,
    },
  };
}

type Namespace = ReturnType<typeof namespace<object>>;

/** Retries the runtime gives an alarm handler that throws, before dropping the alarm. */
export const ALARM_RETRIES = 6;

/** A JPEG with just SOI, APP0, SOF0 and EOI: enough for a header parser. */
export function jpeg(width: number, height: number): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const sof0 = [
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    0x03,
    1,
    0x22,
    0,
    2,
    0x11,
    1,
    3,
    0x11,
    1,
  ];
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof0, 0xff, 0xd9]);
}

/** A valid POST /v1/jobs body for an upload. */
export function jobBody(uploadKey: string, overrides: Record<string, unknown> = {}) {
  return {
    uploadKey,
    capability: "unblur.std",
    mode: "auto",
    modeSource: "auto",
    cropBox: { x: 0, y: 0.0625, w: 1, h: 0.875 },
    diagnosis: {
      sharpness: 31,
      blur: "motion",
      angleDeg: 160,
      faces: [],
      textDensity: 0.02,
      oldPhoto: false,
    },
    idempotencyKey: `idem-${uploadKey.slice(3, 29)}`,
    ...overrides,
  };
}

export async function setup(extra: Record<string, unknown> = {}) {
  const { db, D1 } = d1();
  const store = kv();
  const bucket = r2();
  const mail: { to: string; from: string; subject: string; text: string; html: string }[] = [];
  const env: Record<string, unknown> = {
    DB: D1,
    KV: store.KV,
    BUCKET: bucket.BUCKET,
    ALLOWED_ORIGIN: ORIGIN,
    API_ORIGIN: "https://api.videozombiecouple.com",
    // Tests that need staging pass ENVIRONMENT: "staging" to setup().
    ENVIRONMENT: "production",
    COOKIE_DOMAIN: ".videozombiecouple.com",
    HMAC_KEY,
    TURNSTILE_SECRET: "test-turnstile-secret",
    TURNSTILE_HOSTNAME: "videozombiecouple.com",
    R2_ACCOUNT_ID: "test-account",
    R2_BUCKET_NAME: "vzc-test",
    R2_ACCESS_KEY_ID: "test-access-key",
    R2_SECRET_ACCESS_KEY: "test-secret-key",
    KIE_API_KEY: "test-kie-key",
    FAKE_PROVIDER: "1",
    EMAIL: { send: async (message: (typeof mail)[number]) => void mail.push(message) },
    EMAIL_FROM: "VideoZombieCouple <no-reply@videozombiecouple.com>",
  };
  /** Real Wallet DOs behind a recorder: tests read settlement calls and can make commits fail. */
  const wallets = namespace((ctx) => new Wallet(ctx, env as never));
  const wallet = {
    calls: [] as unknown[][],
    /** The next N commits throw, as if the Wallet DO were unreachable. */
    failures: 0,
    /** The next N releases throw the same way. */
    releaseFailures: 0,
    binding: {
      idFromName: (name: string) => name,
      get: (userId: string) => {
        const real = wallets.instance(userId);
        return {
          grant: real.grant.bind(real),
          reserve: real.reserve.bind(real),
          balance: real.balance.bind(real),
          forfeitAll: real.forfeitAll.bind(real),
          renewSubscription: real.renewSubscription.bind(real),
          clawback: real.clawback.bind(real),
          commitReservation: async (reservationId: string, credits: number, jobId: string) => {
            if (wallet.failures > 0) {
              wallet.failures -= 1;
              throw new Error("wallet unavailable");
            }
            wallet.calls.push(["commit", userId, reservationId, credits, jobId]);
            await real.commitReservation(reservationId, credits, jobId);
          },
          releaseReservation: async (reservationId: string, jobId: string) => {
            if (wallet.releaseFailures > 0) {
              wallet.releaseFailures -= 1;
              throw new Error("wallet unavailable");
            }
            wallet.calls.push(["release", userId, reservationId, jobId]);
            await real.releaseReservation(reservationId, jobId);
          },
        };
      },
    },
  };
  env.WALLET = wallet.binding;
  const analytics: AnalyticsEngineDataPoint[] = [];
  env.ANALYTICS = { writeDataPoint: (point: AnalyticsEngineDataPoint) => analytics.push(point) };
  // --- durable objects (later tasks register their classes here) ---
  const namespaces: Record<string, Namespace> = {};
  const limiters = namespace((ctx) => new RateLimiter(ctx, env as never));
  namespaces.limiters = limiters as unknown as Namespace;
  env.RATE_LIMITER = limiters.binding;
  const dispatchers = namespace((ctx) => new Dispatcher(ctx, env as never));
  namespaces.dispatchers = dispatchers as unknown as Namespace;
  env.DISPATCHER = dispatchers.binding;
  const runners = namespace((ctx) => new StoryRunner(ctx, env as never));
  namespaces.runners = runners as unknown as Namespace;
  env.STORY_RUNNER = runners.binding;
  // --- end durable objects ---
  Object.assign(env, extra);

  async function call(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      headers?: Record<string, string>;
      visitor?: string;
      ip?: string;
      session?: string;
    } = {},
  ) {
    const response = await app.request(
      path,
      {
        method: options.method ?? "GET",
        headers: {
          origin: ORIGIN,
          "content-type": "application/json",
          cookie: [
            `vid=${options.visitor ?? VISITOR}`,
            ...(options.session ? [`upx_sess=${options.session}`] : []),
          ].join("; "),
          "CF-Connecting-IP": options.ip ?? IP,
          ...options.headers,
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      },
      env as never,
    );
    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { text }; // plain-text answers, e.g. webhooks
    }
    return {
      status: response.status,
      headers: response.headers,
      body: parsed as Record<string, unknown> & {
        error?: { code: string; retryAfterSec?: number };
      },
    };
  }

  /**
   * Moves the fake clock forward, firing due alarms in time order like the runtime would. An
   * alarm that throws is re-armed one second later (the runtime retries failed alarms) and the
   * error is rethrown.
   */
  const alarmRetries = new Map<Entry<object>, number>();
  async function advance(ms: number) {
    const target = Date.now() + ms;
    for (let round = 0; round < 10_000; round++) {
      let next: { at: number; entry: Entry<object> } | null = null;
      for (const ns of Object.values(namespaces)) {
        for (const entry of ns.entries.values()) {
          const at = entry.store.alarmAt();
          if (at !== null && at <= target && (next === null || at < next.at)) next = { at, entry };
        }
      }
      if (!next) break;
      vi.setSystemTime(Math.max(Date.now(), next.at));
      next.entry.store.clearAlarm();
      try {
        await (next.entry.instance as { alarm?: () => Promise<void> }).alarm?.();
        alarmRetries.delete(next.entry);
      } catch (error) {
        // The runtime retries a throwing alarm handler a few times with backoff, then drops it.
        const retries = alarmRetries.get(next.entry) ?? 0;
        if (retries < ALARM_RETRIES) {
          alarmRetries.set(next.entry, retries + 1);
          await next.entry.store.api.setAlarm(Date.now() + 2_000 * 2 ** retries);
        } else alarmRetries.delete(next.entry);
        throw error;
      }
    }
    vi.setSystemTime(Math.max(Date.now(), target));
  }

  /** A human pass for this browser, as a passed Turnstile check would grant. */
  async function pass(visitor = VISITOR, ip = IP) {
    const visitorHash = await hashIdentity(`visitor:${visitor}`, HMAC_KEY);
    const ipp = await hashIdentity(`ip:${ipSegment(ip)}`, HMAC_KEY);
    const value = { ipp, left: HUMAN_PASS_USES, expiresAt: Date.now() + HUMAN_PASS_TTL_SEC * 1000 };
    store.store.set(`human:${visitorHash}`, JSON.stringify(value));
  }

  /** A verified account with a live session, as a finished sign-in would leave it. */
  async function signIn(email = "user@example.com") {
    const { id: userId } = await createUser(D1, email);
    const session = randomHex(32);
    db.prepare("INSERT INTO sessions(id_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)").run(
      await sha256Hex(session),
      userId,
      Date.now(),
      Date.now() + SESSION_TTL_MS,
    );
    return { userId, session };
  }

  /** A stories row, both photos in R2 and its runner, as POST /v1/stories would leave them. */
  async function story(overrides: Partial<StorySpec> = {}) {
    const id = overrides.id ?? ulid();
    const spec: StorySpec = {
      id,
      owner: "u:test",
      userId: "test",
      kind: "human",
      scene: "cabin-wheat",
      names: null,
      date: null,
      survivorKey: `keep/${id}/survivor.jpg`,
      infectedKey: `keep/${id}/infected.jpg`,
      createdAt: Date.now(),
      ...overrides,
    };
    await bucket.BUCKET.put(spec.survivorKey, jpeg(1024, 1024));
    await bucket.BUCKET.put(spec.infectedKey, jpeg(1024, 1024));
    db.prepare(
      "INSERT INTO stories(id,owner,user_id,visitor_hash,fp_hash,ip_hash,kind,scene,prompt_version,names,date,survivor_key,infected_key,status,idempotency_key,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      spec.id,
      spec.owner,
      spec.userId,
      "visitor-hash",
      null,
      "ip-hash",
      spec.kind,
      spec.scene,
      MODES[spec.kind].promptVersion,
      spec.names,
      spec.date,
      spec.survivorKey,
      spec.infectedKey,
      "previewing",
      `idem-${spec.id}`,
      spec.createdAt,
      spec.createdAt + 86_400_000,
    );
    return { spec, runner: runners.instance(spec.id) };
  }

  /** A charge hold that touches nothing, for runner tests that do not look at billing. */
  const noCharge: ChargeHold = { kind: "none" };

  /** A finished browser upload: asks for a key like the page does, then PUTs a JPEG. */
  async function upload(
    options: { visitor?: string; ip?: string; width?: number; height?: number } = {},
  ) {
    const response = await call("/v1/uploads", {
      method: "POST",
      body: { contentType: "image/jpeg", bytes: 1_000 },
      visitor: options.visitor,
      ip: options.ip,
    });
    if (response.status !== 201)
      throw new Error(`upload refused: ${JSON.stringify(response.body)}`);
    const key = response.body.key as string;
    await bucket.BUCKET.put(key, jpeg(options.width ?? 2048, options.height ?? 1536));
    return key;
  }

  return {
    db,
    env,
    kv: store,
    r2: bucket,
    call,
    advance,
    pass,
    signIn,
    story,
    noCharge,
    upload,
    namespaces,
    limiters,
    dispatchers,
    runners,
    wallet,
    wallets,
    analytics,
    mail,
  };
}
