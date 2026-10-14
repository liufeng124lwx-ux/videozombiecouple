// KIE key for the eval harness: env var first, then ~/.vzc-secrets/eval.env. Never print it.
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const SECRETS_FILE = join(homedir(), ".vzc-secrets", "eval.env");

export function parseKey(text: string): string | null {
  const m = text.match(/^KIE_API_KEY=(.+)$/m);
  return m ? m[1].trim() : null;
}

export async function loadKey(): Promise<string> {
  if (process.env.KIE_API_KEY) return process.env.KIE_API_KEY;
  if (existsSync(SECRETS_FILE)) {
    const key = parseKey(await readFile(SECRETS_FILE, "utf8"));
    if (key) return key;
  }
  throw new Error(`KIE_API_KEY not found (env or ${SECRETS_FILE})`);
}
