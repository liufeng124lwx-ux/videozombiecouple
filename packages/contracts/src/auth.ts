import { z } from "zod";

export const EmailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const EmailLoginSchema = z.object({
  email: EmailSchema,
  /** Same-site path to return to after the link in the email is opened. */
  next: z.string().max(200).optional(),
});

/** Buying without signing in: the email the film and receipts go to (owner, 2026-10-15). */
export const GuestSignUpSchema = z.object({ email: EmailSchema });

export const CodeLoginSchema = z.object({ email: EmailSchema, code: z.string().regex(/^\d{6}$/) });
export const LinkLoginSchema = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) });

export const PasswordSchema = z.string().min(8).max(128);
export const PasswordLoginSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1).max(128),
});
export const SetPasswordSchema = z.object({ password: PasswordSchema });

export const DeleteAccountSchema = z.object({ confirm: z.literal("DELETE") });

/** Design S17: one dismissible line above the header, set from /admin (KV flags.banner). */
export type Banner = { text: string; href: string | null };

export type MeView = {
  user: { id: string; email: string; hasPassword: boolean; google: boolean } | null;
  owner: string;
  /** Total spendable credits; null for guests. */
  credits: number | null;
  banner: Banner | null;
  /** Spec 7.5: the visitor is in the EU, EEA, UK or Switzerland (or we can't tell): ask first. */
  consentRequired: boolean;
  /** Spec 9 user_kind: the member has a live subscription. */
  paid: boolean;
};

/** Spec 5.5: subscription credits (with their expiry) apart from credits that do not expire. */
export type BalanceView = {
  total: number;
  subscription: { credits: number; expiresAt: number } | null;
  permanent: number;
};

export type LedgerEntryView = {
  id: number;
  delta: number;
  type: string;
  reason: string | null;
  jobId: string | null;
  orderId: string | null;
  createdAt: number;
};

export type AccountView = {
  email: string;
  hasPassword: boolean;
  google: boolean;
  createdAt: number;
  balance: BalanceView;
};

/** Only plain same-site paths, so a sign-in or payment return can't bounce to another site. */
export function isSameSitePath(value: string): boolean {
  return value.length <= 200 && /^\/(?!\/)[\w\-./?=&%]*$/.test(value);
}
