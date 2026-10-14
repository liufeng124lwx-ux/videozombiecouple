// Creates VideoZombieCouple's Waffo products and webhook for one environment, from packages/catalog.
//
//   node scripts/waffo-setup.ts test          # plan only
//   node scripts/waffo-setup.ts test --yes    # create what is missing
//
// Reads ~/.vzc-secrets/waffo-<mode>.pem (private key) and waffo-ids.txt ("MER_… STO_…"),
// keeps what it created in ~/.vzc-secrets/waffo-<mode>-state.json so a rerun creates nothing
// twice, and prints WAFFO_MERCHANT_ID / WAFFO_STORE_ID / WAFFO_PRODUCTS for the wrangler config.
// The private key is never printed.
import { createHash, createSign } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { SALE_PRODUCTS } from "../packages/catalog/src/plans.ts";
import { TIERS } from "../packages/catalog/src/tiers.ts";

const mode = process.argv[2];
if (mode !== "test" && mode !== "prod")
  throw new Error("usage: node scripts/waffo-setup.ts test|prod [--yes]");
const apply = process.argv.includes("--yes");
const dir = join(homedir(), ".vzc-secrets");
const privateKey = readFileSync(join(dir, `waffo-${mode}.pem`), "utf8");
const [merchantId, storeId] = readFileSync(
  join(dir, mode === "test" ? "waffo-ids.txt" : "waffo-ids-prod.txt"),
  "utf8",
)
  .trim()
  .split(/\s+/);
if (!merchantId?.startsWith("MER_") || !storeId?.startsWith("STO_"))
  throw new Error("bad waffo ids file");
const statePath = join(dir, `waffo-${mode}-state.json`);
const state: { products: Record<string, string>; webhook?: string } = existsSync(statePath)
  ? JSON.parse(readFileSync(statePath, "utf8"))
  : { products: {} };

const API =
  mode === "test"
    ? "https://api-staging.videozombiecouple.com"
    : "https://api.videozombiecouple.com";
// The events apps/api/src/billing handles; nothing else is subscribed.
const EVENTS = [
  "order.completed",
  "refund.succeeded",
  "subscription.activated",
  "subscription.renewed",
  "subscription.canceling",
  "subscription.canceled",
  "subscription.uncanceled",
  "subscription.past_due",
  "subscription.recovered",
  "subscription.plan_changed",
];

type Item = {
  key: string;
  name: string;
  description: string;
  usd: number;
  period?: "monthly" | "yearly";
};
// Spec §7: one-time video packs only (10 credits = 1 video).
const items: Item[] = SALE_PRODUCTS.flatMap((product): Item[] => {
  if (product.kind !== "pack") return [];
  const videos = product.credits / TIERS.video.credits;
  return [
    {
      key: product.key,
      name: `VideoZombieCouple ${videos} video${videos === 1 ? "" : "s"}`,
      description: `${videos} zombie love story video${videos === 1 ? "" : "s"}, credits never expire`,
      usd: product.usd,
    },
  ];
});

async function call(path: string, body: unknown): Promise<Record<string, unknown>> {
  const text = JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const hash = createHash("sha256").update(text).digest("base64");
  const signature = createSign("RSA-SHA256")
    .update(`POST\n${path}\n${timestamp}\n${hash}`)
    .sign(privateKey, "base64");
  const res = await fetch(`https://api.waffo.ai${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-merchant-id": merchantId as string,
      "x-timestamp": timestamp,
      "x-signature": signature,
    },
    body: text,
  });
  const json = (await res.json().catch(() => ({}))) as {
    data?: Record<string, unknown>;
    errors?: unknown;
  };
  if (!res.ok || !json.data)
    throw new Error(`${path}: ${res.status} ${JSON.stringify(json.errors ?? json).slice(0, 300)}`);
  return json.data;
}

const idOf = (data: Record<string, unknown>) => {
  const found = JSON.stringify(data).match(/"(PROD_[0-9A-Za-z]{22})"/);
  if (!found) throw new Error(`no product id in ${JSON.stringify(data).slice(0, 200)}`);
  return found[1] as string;
};

for (const item of items) {
  if (state.products[item.key]) {
    console.log(`  have    ${item.key} → ${state.products[item.key]}`);
    continue;
  }
  console.log(
    `  ${apply ? "create " : "missing"} ${item.key}: ${item.name}, $${item.usd}${item.period ? `, ${item.period}` : ""}`,
  );
  if (!apply) continue;
  const common = {
    storeId,
    name: item.name,
    description: item.description,
    prices: { USD: { amount: item.usd.toFixed(2), taxIncluded: false, taxCategory: "saas" } },
    metadata: { productKey: item.key },
  };
  const data = item.period
    ? await call("/v1/actions/subscription-product/create-product", {
        ...common,
        billingPeriod: item.period,
      })
    : await call("/v1/actions/onetime-product/create-product", common);
  state.products[item.key] = idOf(data);
  writeFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
}

if (state.webhook) console.log(`  have    webhook ${API}/webhooks/waffo`);
else {
  console.log(
    `  ${apply ? "create " : "missing"} webhook ${API}/webhooks/waffo (${EVENTS.length} events, testMode ${mode === "test"})`,
  );
  if (apply) {
    const data = await call("/v1/actions/store/add-webhook", {
      storeId,
      channel: "http",
      url: `${API}/webhooks/waffo`,
      events: EVENTS,
      testMode: mode === "test",
    });
    state.webhook = String(
      (data.webhook as { id?: string } | undefined)?.id ?? data.id ?? "created",
    );
    writeFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
  }
}

console.log(
  `\nWAFFO_MERCHANT_ID=${merchantId}\nWAFFO_STORE_ID=${storeId}\nWAFFO_PRODUCTS=${JSON.stringify(state.products)}`,
);
