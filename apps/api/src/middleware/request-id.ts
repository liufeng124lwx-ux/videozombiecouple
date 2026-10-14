import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../types.ts";

export const requestId = () =>
  createMiddleware<AppEnv>(async (c, next) => {
    const id = crypto.randomUUID();
    c.set("requestId", id);
    await next();
    c.header("x-request-id", id);
  });
