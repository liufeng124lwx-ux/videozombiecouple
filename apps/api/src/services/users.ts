import { ulid } from "./ids.ts";

export type User = {
  id: string;
  email: string;
  hasPassword: boolean;
  googleSub: string | null;
  suspiciousAt: number | null;
  /** False for an account made at a guest checkout until the email is proven. */
  verified: boolean;
  createdAt: number;
};

type Row = {
  id: string;
  email: string;
  password_hash: string | null;
  google_sub: string | null;
  suspicious_at: number | null;
  email_verified_at: number | null;
  created_at: number;
};

const COLUMNS =
  "id, email, password_hash, google_sub, suspicious_at, email_verified_at, created_at";

const toUser = (row: Row): User => ({
  id: row.id,
  email: row.email,
  hasPassword: row.password_hash !== null,
  googleSub: row.google_sub,
  suspiciousAt: row.suspicious_at,
  verified: row.email_verified_at !== null,
  createdAt: row.created_at,
});

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

async function one(db: D1Database, where: string, value: string): Promise<User | null> {
  const row = await db
    .prepare(`SELECT ${COLUMNS} FROM users WHERE ${where}=? AND deleted_at IS NULL`)
    .bind(value)
    .first<Row>();
  return row ? toUser(row) : null;
}

export const userById = (db: D1Database, id: string) => one(db, "id", id);
export const userByEmail = (db: D1Database, email: string) =>
  one(db, "email", normalizeEmail(email));
export const userByGoogleSub = (db: D1Database, sub: string) => one(db, "google_sub", sub);

export async function passwordHashOf(db: D1Database, id: string): Promise<string | null> {
  const row = await db
    .prepare("SELECT password_hash FROM users WHERE id=? AND deleted_at IS NULL")
    .bind(id)
    .first<{ password_hash: string | null }>();
  return row?.password_hash ?? null;
}

/**
 * Creates an account. Sign-ins prove the email (a code, a link or Google) and create it verified;
 * the guest sign-up before checkout creates it unverified (`verified: false`). When a concurrent
 * request created the same email first, returns that account instead (review focus 1).
 */
export async function createUser(
  db: D1Database,
  email: string,
  fields: { googleSub?: string; verified?: boolean } = {},
): Promise<{ id: string; created: boolean }> {
  const normalized = normalizeEmail(email);
  const id = ulid();
  const now = Date.now();
  try {
    await db
      .prepare(
        "INSERT INTO users(id,email,google_sub,email_verified_at,created_at) VALUES(?,?,?,?,?)",
      )
      .bind(id, normalized, fields.googleSub ?? null, fields.verified === false ? null : now, now)
      .run();
  } catch (error) {
    const existing = await userByEmail(db, normalized);
    if (existing) return { id: existing.id, created: false };
    throw error;
  }
  return { id, created: true };
}
