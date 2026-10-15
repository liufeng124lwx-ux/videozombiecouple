import { CONSENT_COUNTRIES } from "@vzc/catalog";
import type { MeView } from "@vzc/contracts";
import type { Context } from "hono";
import { readFlags } from "../middleware/flags.ts";
import { userById } from "../services/users.ts";
import type { AppEnv } from "../types.ts";
import { liveSubscription } from "./billing.ts";

export async function me(c: Context<AppEnv>) {
  c.header("cache-control", "no-store");
  const userId = c.get("userId");
  const user = userId ? await userById(c.env.DB, userId) : null;
  const view: MeView = {
    user: user
      ? {
          id: user.id,
          email: user.email,
          hasPassword: user.hasPassword,
          google: user.googleSub !== null,
          verified: user.verified,
        }
      : null,
    owner: c.get("owner"),
    credits: user
      ? (await c.env.WALLET.get(c.env.WALLET.idFromName(user.id)).balance(user.id)).total
      : null,
    banner: (await readFlags(c.env.KV)).banner,
    consentRequired: needsConsent(c.req.header("cf-ipcountry")),
    paid: user ? (await liveSubscription(c.env.DB, user.id)) !== null : false,
  };
  return c.json(view);
}

/** Cloudflare sends XX for unknown and T1 for Tor; without a country we ask, to be safe. */
function needsConsent(country: string | undefined): boolean {
  const code = (country ?? "").toUpperCase();
  return code === "" || code === "XX" || code === "T1" || CONSENT_COUNTRIES.has(code);
}
