import { Hono } from "hono";
import type { AppEnv } from "../types.ts";
import { adminOnly } from "./access.ts";
import { addBan, bansPage, removeBan } from "./bans.ts";
import { job, jobs } from "./jobs.ts";
import { routesPage, saveRouteForm } from "./routes-page.ts";
import { saveFlags, switches } from "./switches.ts";
import { adjustCredits, saveDailyCap, user, users } from "./users.ts";

/** Spec 8.1: the admin, served by the API Worker so Cloudflare Access guards one origin. */
export const admin = new Hono<AppEnv>();
admin.use("*", adminOnly());

admin.get("/", switches);
admin.post("/flags", saveFlags);
admin.get("/users", users);
admin.get("/users/:id", user);
admin.post("/users/:id/credits", adjustCredits);
admin.post("/users/:id/cap", saveDailyCap);
admin.get("/jobs", jobs);
admin.get("/jobs/:id", job);
admin.get("/routes", routesPage);
admin.post("/routes/:id", saveRouteForm);
admin.get("/bans", bansPage);
admin.post("/bans", addBan);
admin.post("/bans/:id/delete", removeBan);
