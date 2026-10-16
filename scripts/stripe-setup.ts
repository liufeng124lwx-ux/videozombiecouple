// Creates VideoZombieCouple's Stripe products, prices and webhook for one environment, from
// packages/catalog. Stripe Managed Payments (merchant of record) needs real Products with an eligible
// tax code, so prices live in Stripe too; a catalog price change adds a new default price.
//
//   node scripts/stripe-setup.ts test          # plan only
//   node scripts/stripe-setup.ts test --yes    # create what is missing
//
// Reads the secret key from ~/.vzc-secrets/stripe-<mode>-secret.txt, keeps what it created in
// ~/.vzc-secrets/stripe-<mode>-state.json, writes the webhook signing secret (shown by Stripe only
// once) to ~/.vzc-secrets/stripe-<mode>-whsec.txt, and prints STRIPE_PRICES for the wrangler
// config. No secret is ever printed.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { SALE_PRODUCTS } from "../packages/catalog/src/plans.ts";
import { TIERS } from "../packages/catalog/src/tiers.ts";

const mode = process.argv[2];
if (mode !== "test" && mode !== "live")
  throw new Error("usage: node scripts/stripe-setup.ts test|live [--yes]");
const apply = process.argv.includes("--yes");
const dir = join(homedir(), ".vzc-secrets");
const secret = readFileSync(join(dir, `stripe-${mode}-secret.txt`), "utf8").trim();
if (!secret.startsWith(mode === "test" ? "sk_test_" : "sk_live_") && !secret.startsWith("rk_"))
  throw new Error(`stripe-${mode}-secret.txt is not a ${mode} key`);
const statePath = join(dir, `stripe-${mode}-state.json`);
type State = {
  products: Record<string, { product: string; price: string; usd: number }>;
  webhook?: string;
};
const state: State = existsSync(statePath)
  ? JSON.parse(readFileSync(statePath, "utf8"))
  : { products: {} };
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });

const API =
  mode === "test"
    ? "https://api-staging.videozombiecouple.com"
    : "https://api.videozombiecouple.com";
/** AI as a Service, cloud based, personal use: eligible for Managed Payments. */
const TAX_CODE = "txcd_10105001";
// Fulfilment, refunds (Stripe may refund under Managed Payments) and disputes.
const EVENTS = ["checkout.session.completed", "charge.refunded", "charge.dispute.created"];

async function stripe(
  path: string,
  form: Record<string, string>,
): Promise<Record<string, unknown>> {
  const res = await fetch(`https://api.stripe.com${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(form).toString(),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok)
    throw new Error(`${path}: ${res.status} ${JSON.stringify(json.error ?? json).slice(0, 300)}`);
  return json;
}

const items = SALE_PRODUCTS.flatMap((product) => {
  if (product.kind !== "pack") return [];
  const videos = product.credits / TIERS.video.credits;
  const name =
    product.kind === "pack" && product.label
      ? `VideoZombieCouple — ${product.label}`
      : `VideoZombieCouple — ${videos} video${videos === 1 ? "" : "s"}`;
  return [
    {
      key: product.key,
      name,
      description: `${videos} AI zombie love story film${videos === 1 ? "" : "s"} made from your photos. Credits never expire.`,
      cents: Math.round(product.usd * 100),
      usd: product.usd,
    },
  ];
});

for (const item of items) {
  const have = state.products[item.key];
  if (have && have.usd === item.usd) {
    console.log(`  have    ${item.key} → ${have.product} / ${have.price}`);
    continue;
  }
  console.log(
    `  ${apply ? (have ? "reprice" : "create ") : "missing"} ${item.key}: ${item.name}, $${item.usd}`,
  );
  if (!apply) continue;
  if (!have) {
    const product = await stripe("/v1/products", {
      name: item.name,
      description: item.description,
      tax_code: TAX_CODE,
      "metadata[productKey]": item.key,
      "default_price_data[currency]": "usd",
      "default_price_data[unit_amount]": String(item.cents),
      "default_price_data[tax_behavior]": "exclusive",
    });
    state.products[item.key] = {
      product: String(product.id),
      price: String(product.default_price),
      usd: item.usd,
    };
  } else {
    const price = await stripe("/v1/prices", {
      product: have.product,
      currency: "usd",
      unit_amount: String(item.cents),
      tax_behavior: "exclusive",
      "metadata[productKey]": item.key,
    });
    await stripe(`/v1/products/${have.product}`, { default_price: String(price.id) });
    await stripe(`/v1/prices/${have.price}`, { active: "false" });
    state.products[item.key] = { product: have.product, price: String(price.id), usd: item.usd };
  }
  save();
}

if (state.webhook) console.log(`  have    webhook ${API}/webhooks/stripe`);
else {
  console.log(
    `  ${apply ? "create " : "missing"} webhook ${API}/webhooks/stripe (${EVENTS.length} events)`,
  );
  if (apply) {
    const form: Record<string, string> = {
      url: `${API}/webhooks/stripe`,
      description: "VideoZombieCouple: fulfil packs, take back refunded credits, flag disputes",
    };
    EVENTS.forEach((e, i) => {
      form[`enabled_events[${i}]`] = e;
    });
    const hook = await stripe("/v1/webhook_endpoints", form);
    writeFileSync(join(dir, `stripe-${mode}-whsec.txt`), `${String(hook.secret)}\n`, {
      mode: 0o600,
    });
    state.webhook = String(hook.id);
    save();
  }
}

console.log(
  `\nSTRIPE_PRICES=${JSON.stringify(Object.fromEntries(items.map((i) => [i.key, state.products[i.key]?.price ?? "(missing)"])))}`,
);
