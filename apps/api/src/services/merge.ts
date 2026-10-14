import type { Context } from "hono";
import type { AppEnv } from "../types.ts";

/**
 * Spec 5.1: previews need an account, so a guest has no stories or preview quota to bring along.
 * Kept as the sign-in hook for future guest data.
 */
export async function mergeGuest(_c: Context<AppEnv>, _userId: string): Promise<void> {}
