import { RATE_LIMITS } from "@vzc/catalog";
import {
  CodeLoginSchema,
  EmailLoginSchema,
  GuestSignUpSchema,
  LinkLoginSchema,
  PasswordLoginSchema,
} from "@vzc/contracts";
import type { Context } from "hono";
import { fail } from "../http.ts";
import { checkCode, issueCode, issueLinkToken, redeemLinkToken } from "../services/codes.ts";
import { isDisposable } from "../services/disposable.ts";
import { requireHuman } from "../services/human-pass.ts";
import { hitRate } from "../services/limits.ts";
import { completeLogin, safeNext, guestSignUp as signUpGuest } from "../services/login.ts";
import { sendMail } from "../services/mail.ts";
import { hashPassword, verifyPassword } from "../services/password.ts";
import { endSession, sha256Hex, startSession } from "../services/session.ts";
import { passwordHashOf, userByEmail } from "../services/users.ts";
import type { AppEnv } from "../types.ts";

const HOUR = 3_600_000;
const body = (c: Context<AppEnv>) => c.req.json().catch(() => null);

let dummy: Promise<string> | undefined;
/** A real PBKDF2 hash of a throwaway password, computed once per isolate. */
const dummyHash = () => {
  dummy ??= hashPassword("vzc-no-such-account");
  return dummy;
};

/** An hourly limit on `name`; returns the error response when it is used up. */
async function limit(c: Context<AppEnv>, name: string, perHour: number): Promise<Response | null> {
  const rate = await hitRate(c.env, name, perHour, HOUR);
  return rate.allowed ? null : fail(c, "RATE_LIMITED", rate.retryAfterSec);
}

/** Spec 5.1 / 7.1: one email with a 6-digit code and a link; a new email becomes an account. */
export async function requestEmailLogin(c: Context<AppEnv>) {
  const parsed = EmailLoginSchema.safeParse(await body(c));
  if (!parsed.success) return fail(c, "BAD_REQUEST");
  const { email } = parsed.data;
  const byIp = await limit(
    c,
    `rate:mail:ip:${c.get("ipSegmentHash")}`,
    RATE_LIMITS.loginMailPerIpHour,
  );
  if (byIp) return byIp;
  if (!(await requireHuman(c, "login"))) return fail(c, "CHALLENGE_REQUIRED");
  // Counted only after the human check, so nobody can use up another person's emails for free.
  const byEmail = await limit(
    c,
    `rate:mail:email:${await sha256Hex(email)}`,
    RATE_LIMITS.loginMailPerEmailHour,
  );
  if (byEmail) return byEmail;
  if (!(await userByEmail(c.env.DB, email)) && (await isDisposable(c.env, email)))
    return fail(c, "EMAIL_REJECTED");
  const code = await issueCode(c.env, email);
  const token = await issueLinkToken(c.env, email);
  const next = encodeURIComponent(safeNext(parsed.data.next));
  await sendMail(c.env, {
    to: email,
    subject: `${code} is your VideoZombieCouple sign-in code`,
    intro:
      "Enter this code on the VideoZombieCouple page you came from, or open the link on this device.",
    code,
    link: {
      href: `${c.env.ALLOWED_ORIGIN}/account?login=${token}&next=${next}`,
      label: "Sign in to VideoZombieCouple",
    },
  });
  return c.json({ sent: true }, 202);
}

/**
 * Owner, 2026-10-15: pay without signing up. A new email becomes an unverified account and this
 * browser is signed into it; an email that already has an account gets LOGIN_REQUIRED, and the
 * page asks for the emailed code instead.
 */
export async function guestSignUp(c: Context<AppEnv>) {
  const parsed = GuestSignUpSchema.safeParse(await body(c));
  if (!parsed.success) return fail(c, "BAD_REQUEST");
  const { email } = parsed.data;
  const byIp = await limit(
    c,
    `rate:mail:ip:${c.get("ipSegmentHash")}`,
    RATE_LIMITS.loginMailPerIpHour,
  );
  if (byIp) return byIp;
  if (!(await requireHuman(c, "login"))) return fail(c, "CHALLENGE_REQUIRED");
  if (await isDisposable(c.env, email)) return fail(c, "EMAIL_REJECTED");
  const result = await signUpGuest(c, email);
  if (!result.ok) return fail(c, "LOGIN_REQUIRED");
  c.header("cache-control", "no-store");
  return c.json({ ok: true }, 201);
}

export async function codeLogin(c: Context<AppEnv>) {
  const parsed = CodeLoginSchema.safeParse(await body(c));
  if (!parsed.success) return fail(c, "CODE_INVALID");
  // The RateLimiter DO is atomic, unlike the attempt counter stored with the code in KV.
  const limited =
    (await limit(c, `rate:code:ip:${c.get("ipSegmentHash")}`, RATE_LIMITS.codeAttemptsPerIpHour)) ??
    (await limit(
      c,
      `rate:code:email:${await sha256Hex(parsed.data.email)}`,
      RATE_LIMITS.codeAttemptsPerEmailHour,
    ));
  if (limited) return limited;
  const checked = await checkCode(c.env, parsed.data.email, parsed.data.code);
  if (checked !== "ok") return fail(c, checked === "expired" ? "CODE_EXPIRED" : "CODE_INVALID");
  const result = await completeLogin(c, parsed.data.email);
  c.header("cache-control", "no-store");
  return c.json({ ok: true, created: result.created });
}

export async function linkLogin(c: Context<AppEnv>) {
  const parsed = LinkLoginSchema.safeParse(await body(c));
  if (!parsed.success) return fail(c, "CODE_INVALID");
  const limited = await limit(
    c,
    `rate:code:ip:${c.get("ipSegmentHash")}`,
    RATE_LIMITS.codeAttemptsPerIpHour,
  );
  if (limited) return limited;
  const email = await redeemLinkToken(c.env, parsed.data.token);
  if (!email) return fail(c, "CODE_EXPIRED");
  const result = await completeLogin(c, email);
  c.header("cache-control", "no-store");
  return c.json({ ok: true, created: result.created });
}

export async function logout(c: Context<AppEnv>) {
  await endSession(c);
  return c.json({ ok: true });
}

/** Same answer for a wrong password and an unknown email, so the form does not reveal accounts. */
export async function passwordLogin(c: Context<AppEnv>) {
  const parsed = PasswordLoginSchema.safeParse(await body(c));
  if (!parsed.success) return fail(c, "INVALID_CREDENTIALS");
  const { email, password } = parsed.data;
  for (const [name, limit] of [
    [`rate:pw:visitor:${c.get("visitorHash")}`, RATE_LIMITS.passwordPerVisitorHour],
    [`rate:pw:email:${await sha256Hex(email)}`, RATE_LIMITS.passwordPerEmailHour],
  ] as const) {
    const rate = await hitRate(c.env, name, limit, HOUR);
    if (!rate.allowed) return fail(c, "RATE_LIMITED", rate.retryAfterSec);
  }
  const user = await userByEmail(c.env.DB, email);
  const stored = user ? await passwordHashOf(c.env.DB, user.id) : null;
  // Hash even without an account, so the answer takes as long and reveals nothing.
  const valid = await verifyPassword(password, stored ?? (await dummyHash()));
  if (!user || !stored || !valid) return fail(c, "INVALID_CREDENTIALS");
  await startSession(c, user.id);
  c.header("cache-control", "no-store");
  return c.json({ ok: true, created: false });
}
