import { afterEach, describe, expect, it } from "vitest";
import { cloudflareUsage, monthlyUsd, weeklyCloudflareReport } from "../src/ops/cf-usage.ts";
import type { Bindings } from "../src/types.ts";
import { setup } from "./harness.ts";

const NOW = Date.UTC(2026, 9, 12, 4);
const ACCOUNT = "acc123";

afterEach(() => {});

type Seen = { url: string; body: string };

/** Cloudflare's APIs as the report sees them: namespaces, D1 list, then one GraphQL query. */
function fakeCloudflare(scale = 1) {
  const seen: Seen[] = [];
  const fetchImpl = (async (input: string, init?: RequestInit) => {
    const url = String(input);
    seen.push({ url, body: String(init?.body ?? "") });
    if (url.endsWith("/workers/durable_objects/namespaces"))
      return Response.json({
        success: true,
        result: [
          { id: "ns-ours", script: "vzc-api" },
          { id: "ns-ours-staging", script: "vzc-api-staging" },
          { id: "ns-video", script: "v2m-api" },
        ],
      });
    if (url.includes("/d1/database"))
      return Response.json({
        success: true,
        result: [
          { uuid: "d1-ours", name: "vzc" },
          { uuid: "d1-video", name: "v2m-prod" },
        ],
      });
    return Response.json({
      data: {
        viewer: {
          accounts: [
            {
              workers: [{ sum: { requests: 2_000_000 * scale, cpuTimeUs: 4_000_000_000 * scale } }],
              doRequests: [{ sum: { requests: 1_000_000 * scale } }],
              doPeriodic: [
                { sum: { duration: 50_000 * scale, rowsRead: 0, rowsWritten: 200_000 * scale } },
              ],
              d1: [{ sum: { rowsRead: 9_000_000 * scale, rowsWritten: 300_000 * scale } }],
              r2Ops: [
                { sum: { requests: 100_000 * scale }, dimensions: { actionType: "PutObject" } },
                { sum: { requests: 400_000 * scale }, dimensions: { actionType: "GetObject" } },
                { sum: { requests: 90_000 * scale }, dimensions: { actionType: "DeleteObject" } },
              ],
              r2Storage: [
                { max: { payloadSize: 20e9 * scale }, dimensions: { bucketName: "vzc" } },
              ],
            },
          ],
        },
      },
    });
  }) as typeof fetch;
  return { seen, fetchImpl };
}

describe("weekly Cloudflare usage (monitoring before any self-hosting)", () => {
  it("counts only vzc's own Workers, Durable Objects, D1 databases and buckets", async () => {
    const h = await setup({ CF_ANALYTICS_TOKEN: "t", R2_ACCOUNT_ID: ACCOUNT });
    const { seen, fetchImpl } = fakeCloudflare();
    const usage = await cloudflareUsage(h.env as unknown as Bindings, NOW, fetchImpl);
    const graphql = seen.find((s) => s.url.endsWith("/graphql"));
    expect(graphql?.body).toContain("vzc-api");
    expect(graphql?.body).toContain("ns-ours");
    expect(graphql?.body).toContain("d1-ours");
    expect(graphql?.body).not.toContain("ns-video");
    expect(graphql?.body).not.toContain("d1-video");
    expect(graphql?.body).not.toContain("v2m");
    expect(usage).toMatchObject({
      days: 7,
      workerRequests: 2_000_000,
      doRequests: 1_000_000,
      r2ClassA: 100_000,
      r2ClassB: 400_000,
      r2StoredGb: 20,
    });
  });

  it("prices a month at list price with no free allowance (an upper bound: the $5 plan is shared)", async () => {
    const h = await setup({ CF_ANALYTICS_TOKEN: "t", R2_ACCOUNT_ID: ACCOUNT });
    const usage = await cloudflareUsage(
      h.env as unknown as Bindings,
      NOW,
      fakeCloudflare().fetchImpl,
    );
    // 30/7 of a week: requests 8.57M × $0.30, CPU 17.1M ms × $0.02, DO 4.29M × $0.15, DO GB-s 0.214M × $12.50,
    // DO rows written 0.857M × $1, D1 rows read 38.6M × $0.001 and written 1.29M × $1,
    // R2 A 0.43M × $4.50, B 1.71M × $0.36, 20 GB × $0.015: about $11.26.
    expect(monthlyUsd(usage)).toBeCloseTo(11.26, 1);
  });

  it("reports weekly, and raises an alert once a month would cost more than the threshold", async () => {
    const h = await setup({ CF_ANALYTICS_TOKEN: "t", R2_ACCOUNT_ID: ACCOUNT });
    const sent: string[] = [];
    const send = async (_e: Bindings, text: string) => void sent.push(text);
    await weeklyCloudflareReport(
      h.env as unknown as Bindings,
      NOW,
      send,
      fakeCloudflare().fetchImpl,
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Cloudflare usage");
    expect(sent[0]).toContain("$11.26");
    await weeklyCloudflareReport(
      h.env as unknown as Bindings,
      NOW,
      send,
      fakeCloudflare(3).fetchImpl,
    );
    expect(sent.some((t) => t.startsWith("Cloudflare costs for vzc are high"))).toBe(true);
  });

  it("does nothing until the analytics token is set (staging, local)", async () => {
    const h = await setup();
    const sent: string[] = [];
    const { seen, fetchImpl } = fakeCloudflare();
    await weeklyCloudflareReport(
      h.env as unknown as Bindings,
      NOW,
      async (_e, t) => void sent.push(t),
      fetchImpl,
    );
    expect(sent).toEqual([]);
    expect(seen).toEqual([]);
  });
});
