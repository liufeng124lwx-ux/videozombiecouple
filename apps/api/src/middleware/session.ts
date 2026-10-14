import { createMiddleware } from "hono/factory";
import { sessionUserId } from "../services/session.ts";
import type { AppEnv } from "../types.ts";

/** Runs after identity(): a signed-in request owns jobs as `u:<id>` instead of the guest. */
export const session = () =>
  createMiddleware<AppEnv>(async (c, next) => {
    const userId = await sessionUserId(c);
    c.set("userId", userId);
    if (userId) c.set("owner", `u:${userId}`);
    await next();
  });
