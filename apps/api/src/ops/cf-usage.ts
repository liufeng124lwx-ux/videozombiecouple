import { OPS } from "@vzc/catalog";
import type { Bindings } from "../types.ts";
import { deliver, raise, resolve, type Send } from "./alerts.ts";

/**
 * Hosting stays on Cloudflare until its cost says otherwise: every Monday, vzc's own usage
 * (both environments) from the GraphQL Analytics API, priced at list price. The account and its $5
 * plan are shared with another project, so free allowances are left out: this is an upper bound
 * on what vzc adds. Runs only where CF_ANALYTICS_TOKEN is set (production).
 * Token: Account Analytics Read, Workers Scripts Read, D1 Read.
 */
const API = "https://api.cloudflare.com/client/v4";
const SCRIPTS = ["vzc-api", "vzc-api-staging"];
const BUCKETS = ["vzc", "vzc-staging", "vzc-backups"];
const DAYS = 7;
const MONTH_DAYS = 30;

/** https://developers.cloudflare.com/workers/platform/pricing/ and /r2/pricing/ (2026-10). */
const PRICE = {
  workerRequestsPerM: 0.3,
  cpuMsPerM: 0.02,
  doRequestsPerM: 0.15,
  doGbSecondsPerM: 12.5,
  rowsReadPerM: 0.001,
  rowsWrittenPerM: 1,
  r2ClassAPerM: 4.5,
  r2ClassBPerM: 0.36,
  r2GbMonth: 0.015,
};

/** R2's free operations; reads and heads are Class B; the rest are Class A. */
const R2_FREE = new Set(["DeleteObject", "DeleteObjects", "DeleteBucket", "AbortMultipartUpload"]);
const R2_CLASS_B = new Set([
  "GetObject",
  "HeadObject",
  "HeadBucket",
  "UsageSummary",
  "GetBucketEncryption",
  "GetBucketLocation",
  "GetBucketCors",
  "GetBucketLifecycleConfiguration",
]);

export type Usage = {
  days: number;
  workerRequests: number;
  cpuMs: number;
  doRequests: number;
  doGbSeconds: number;
  rowsRead: number;
  rowsWritten: number;
  r2ClassA: number;
  r2ClassB: number;
  r2StoredGb: number;
};

type Group = {
  sum?: Record<string, number>;
  max?: Record<string, number>;
  dimensions?: Record<string, string>;
};

const total = (groups: Group[] | undefined, field: string) =>
  (groups ?? []).reduce((n, g) => n + (g.sum?.[field] ?? 0), 0);

async function list<T>(url: string, token: string, fetchImpl: typeof fetch): Promise<T[]> {
  const response = await fetchImpl(url, { headers: { authorization: `Bearer ${token}` } });
  const body = (await response.json()) as { success?: boolean; result?: T[] };
  if (!response.ok || !body.success) throw new Error(`Cloudflare API ${response.status}: ${url}`);
  return body.result ?? [];
}

export async function cloudflareUsage(
  env: Bindings,
  now: number,
  fetchImpl: typeof fetch = fetch,
): Promise<Usage> {
  const token = env.CF_ANALYTICS_TOKEN ?? "";
  const account = env.R2_ACCOUNT_ID;
  const namespaces = (
    await list<{ id: string; script: string }>(
      `${API}/accounts/${account}/workers/durable_objects/namespaces`,
      token,
      fetchImpl,
    )
  )
    .filter((ns) => SCRIPTS.includes(ns.script))
    .map((ns) => ns.id);
  const databases = (
    await list<{ uuid: string; name: string }>(
      `${API}/accounts/${account}/d1/database?per_page=100`,
      token,
      fetchImpl,
    )
  )
    .filter((db) => db.name === "vzc" || db.name.startsWith("vzc-"))
    .map((db) => db.uuid);
  const from = new Date(now - DAYS * 86_400_000);
  const variables = {
    account,
    start: from.toISOString(),
    end: new Date(now).toISOString(),
    startDate: from.toISOString().slice(0, 10),
    scripts: SCRIPTS,
    namespaces,
    databases,
    buckets: BUCKETS,
  };
  const query = `query Usage($account: string!, $start: Time!, $end: Time!, $startDate: Date!, $scripts: [string!], $namespaces: [string!], $databases: [string!], $buckets: [string!]) {
  viewer { accounts(filter: { accountTag: $account }) {
    workers: workersInvocationsAdaptive(limit: 10000, filter: { scriptName_in: $scripts, datetime_geq: $start, datetime_leq: $end }) { sum { requests cpuTimeUs } }
    doRequests: durableObjectsInvocationsAdaptiveGroups(limit: 10000, filter: { scriptName_in: $scripts, date_geq: $startDate }) { sum { requests } }
    doPeriodic: durableObjectsPeriodicGroups(limit: 10000, filter: { namespaceId_in: $namespaces, date_geq: $startDate }) { sum { duration rowsRead rowsWritten } }
    d1: d1AnalyticsAdaptiveGroups(limit: 10000, filter: { databaseId_in: $databases, date_geq: $startDate }) { sum { rowsRead rowsWritten } }
    r2Ops: r2OperationsAdaptiveGroups(limit: 10000, filter: { bucketName_in: $buckets, datetime_geq: $start, datetime_leq: $end }) { sum { requests } dimensions { actionType } }
    r2Storage: r2StorageAdaptiveGroups(limit: 10000, filter: { bucketName_in: $buckets, datetime_geq: $start, datetime_leq: $end }, orderBy: [datetime_DESC]) { max { payloadSize } dimensions { bucketName datetime } }
  } }
}`;
  const response = await fetchImpl(`${API}/graphql`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await response.json()) as {
    data?: { viewer?: { accounts?: Record<string, Group[]>[] } };
    errors?: { message: string }[];
  };
  const a = body.data?.viewer?.accounts?.[0];
  if (!response.ok || !a)
    throw new Error(`Cloudflare GraphQL: ${body.errors?.[0]?.message ?? response.status}`);
  let classA = 0;
  let classB = 0;
  for (const g of a.r2Ops ?? []) {
    const type = g.dimensions?.actionType ?? "";
    const n = g.sum?.requests ?? 0;
    if (R2_FREE.has(type)) continue;
    if (R2_CLASS_B.has(type)) classB += n;
    else classA += n;
  }
  // Newest first: the first entry per bucket is its current size.
  const stored = new Map<string, number>();
  for (const g of a.r2Storage ?? []) {
    const bucket = g.dimensions?.bucketName ?? "";
    if (!stored.has(bucket)) stored.set(bucket, g.max?.payloadSize ?? 0);
  }
  return {
    days: DAYS,
    workerRequests: total(a.workers, "requests"),
    cpuMs: total(a.workers, "cpuTimeUs") / 1000,
    doRequests: total(a.doRequests, "requests"),
    doGbSeconds: total(a.doPeriodic, "duration"),
    rowsRead: total(a.doPeriodic, "rowsRead") + total(a.d1, "rowsRead"),
    rowsWritten: total(a.doPeriodic, "rowsWritten") + total(a.d1, "rowsWritten"),
    r2ClassA: classA,
    r2ClassB: classB,
    r2StoredGb: [...stored.values()].reduce((n, b) => n + b, 0) / 1e9,
  };
}

/** A month (30 days) of this usage at list price, without free allowances. */
export function monthlyUsd(u: Usage): number {
  const k = MONTH_DAYS / u.days;
  const m = 1e6;
  return (
    ((u.workerRequests * k) / m) * PRICE.workerRequestsPerM +
    ((u.cpuMs * k) / m) * PRICE.cpuMsPerM +
    ((u.doRequests * k) / m) * PRICE.doRequestsPerM +
    ((u.doGbSeconds * k) / m) * PRICE.doGbSecondsPerM +
    ((u.rowsRead * k) / m) * PRICE.rowsReadPerM +
    ((u.rowsWritten * k) / m) * PRICE.rowsWrittenPerM +
    ((u.r2ClassA * k) / m) * PRICE.r2ClassAPerM +
    ((u.r2ClassB * k) / m) * PRICE.r2ClassBPerM +
    u.r2StoredGb * PRICE.r2GbMonth
  );
}

const fmt = (n: number) =>
  n >= 1e6
    ? `${(n / 1e6).toFixed(2)}M`
    : n >= 1e3
      ? `${(n / 1e3).toFixed(1)}k`
      : String(Math.round(n));
const ALERT = "Cloudflare costs for vzc are high";

export async function weeklyCloudflareReport(
  env: Bindings,
  now: number,
  send: Send = deliver,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (!env.CF_ANALYTICS_TOKEN) return;
  const u = await cloudflareUsage(env, now, fetchImpl);
  const usd = monthlyUsd(u);
  await send(
    env,
    [
      `Cloudflare usage, last ${u.days} days (both environments)`,
      `Worker requests ${fmt(u.workerRequests)}, CPU ${fmt(u.cpuMs)} ms`,
      `Durable Objects ${fmt(u.doRequests)} requests, ${fmt(u.doGbSeconds)} GB-s`,
      `SQLite rows read ${fmt(u.rowsRead)}, written ${fmt(u.rowsWritten)}`,
      `R2 Class A ${fmt(u.r2ClassA)}, Class B ${fmt(u.r2ClassB)}, stored ${u.r2StoredGb.toFixed(1)} GB`,
      `≈ $${usd.toFixed(2)} per month at list price (free allowances left out; alert above $${OPS.cloudflareMonthlyUsdAlert})`,
    ].join("\n"),
  );
  if (usd > OPS.cloudflareMonthlyUsdAlert)
    await raise(
      env,
      {
        key: "cloudflare-cost",
        title: ALERT,
        detail: `≈ $${usd.toFixed(2)} per month. Time to look at moving the costliest part to a server (docs/launch-checklist.md, hosting).`,
      },
      now,
      send,
    );
  else await resolve(env, "cloudflare-cost", ALERT, now, send);
}
