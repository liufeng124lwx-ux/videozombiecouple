import { existsSync, readFileSync } from "node:fs";
import { RETENTION, SALE_PRODUCTS } from "@vzc/catalog";
import { describe, expect, it } from "vitest";
import { stripeConfig } from "../src/billing/stripe.ts";
import type { Bindings } from "../src/types.ts";

type Config = any;
const read = (file: string): Config =>
  JSON.parse(
    readFileSync(new URL(file, import.meta.url), "utf8")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/,(\s*[}\]])/g, "$1"),
  );

describe("deployable configs (spec 1.4)", () => {
  const staging = read("../wrangler.jsonc");
  const production = read("../wrangler.production.jsonc");

  it("binds the same things in both environments, to different resources", () => {
    const shape = (c: Config) => ({
      main: c.main,
      kv: c.kv_namespaces.map((k: Config) => k.binding),
      d1: c.d1_databases.map((d: Config) => d.binding),
      r2: c.r2_buckets.map((r: Config) => r.binding),
      dos: c.durable_objects.bindings,
      exports: c.exports,
      email: c.send_email,
      analytics: c.analytics_engine_datasets.map((a: Config) => a.binding),
      crons: c.triggers.crons,
      vars: Object.keys(c.vars).sort(),
    });
    expect(shape(production)).toEqual(shape(staging));
    expect(production.name).toBe("vzc-api");
    expect(production.d1_databases[0].database_name).toBe("vzc");
    expect(production.r2_buckets[0].bucket_name).toBe("vzc");
    expect(production.vars.R2_BUCKET_NAME).toBe("vzc");
    expect(production.analytics_engine_datasets[0].dataset).not.toBe(
      staging.analytics_engine_datasets[0].dataset,
    );
  });

  it("points production at the live site, live payments and the real provider", () => {
    expect(production.routes).toEqual([
      { pattern: "api.videozombiecouple.com", custom_domain: true },
    ]);
    expect(production.vars).toMatchObject({
      ALLOWED_ORIGIN: "https://videozombiecouple.com",
      API_ORIGIN: "https://api.videozombiecouple.com",
      TURNSTILE_HOSTNAME: "videozombiecouple.com",
    });
    expect(production.vars.FAKE_PROVIDER).toBeUndefined();
  });

  // apps/web comes back in the frontend plan; until then there is no site config to check.
  it.skipIf(!existsSync(new URL("../../web/wrangler.production.jsonc", import.meta.url)))(
    "serves the production site from the apex and www",
    () => {
      const web = read("../../web/wrangler.production.jsonc");
      expect(web.name).toBe("vzc-web");
      expect(web.routes.map((r: Config) => r.pattern).sort()).toEqual([
        "videozombiecouple.com",
        "www.videozombiecouple.com",
      ]);
      expect(web.assets).toEqual(read("../../web/wrangler.jsonc").assets);
    },
  );

  it("backs up the cron's R2 cleanup with lifecycle rules, and never touches samples/ (spec 1.3)", () => {
    const { rules } = read("../../../infra/r2-lifecycle.json");
    const age = (prefix: string) =>
      rules.find((r: Config) => r.conditions?.prefix === prefix)?.deleteObjectsTransition?.condition
        ?.maxAge;
    // Uploads a day, photos and keyframes 3 days for everyone; shots and films live as long as the
    // longest film (a verified account's), a day after the cron would delete both.
    expect(age("in/")).toBe(RETENTION.inputHours * 3_600);
    for (const prefix of ["keep/", "kf/"]) expect(age(prefix)).toBe(RETENTION.workDays * 86_400);
    for (const prefix of ["shot/", "out/"])
      expect(age(prefix)).toBe((RETENTION.memberFilmDays + 1) * 86_400);
    expect(rules.some((r: Config) => r.conditions?.prefix?.startsWith("samples"))).toBe(false);
    expect(rules.every((r: Config) => r.enabled === true)).toBe(true);
    // Applied on every deploy: production once kept films 15 days while the site promised 30.
    const deploy = readFileSync(new URL("../../../scripts/deploy.sh", import.meta.url), "utf8");
    expect(deploy).toMatch(/r2 bucket lifecycle set "\$bucket" --file "\$root\/infra\/r2-lifecycle\.json"/);
  });

  it("lets only the site upload to and read from the bucket", () => {
    const { rules } = read("../../../infra/r2-cors.json");
    expect(rules).toHaveLength(1);
    expect(rules[0].allowed.origins).toEqual(["https://videozombiecouple.com"]);
    expect(rules[0].allowed.methods.sort()).toEqual(["GET", "HEAD", "PUT"]);
  });

  it("runs the vars through the real parsers: staging sells every pack through Stripe, production once its key is set", () => {
    const parse = (vars: Config, key: string) =>
      stripeConfig({ ...vars, STRIPE_SECRET_KEY: key } as unknown as Bindings);
    expect(Object.keys(parse(staging.vars, "sk_test_x")?.prices ?? {}).sort()).toEqual(
      SALE_PRODUCTS.map((p) => p.key).sort(),
    );
    expect(parse(production.vars, "rk_live_x")?.live).toBe(true);
    expect(Object.keys(parse(production.vars, "rk_live_x")?.prices ?? {}).sort()).toEqual(
      SALE_PRODUCTS.map((p) => p.key).sort(),
    );
    expect(staging.vars.WAFFO_MODE).toBeUndefined();
    expect(production.vars.WAFFO_MODE).toBeUndefined();
  });
});
