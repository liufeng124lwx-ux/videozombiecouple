import { Hono } from "hono";
import { admin } from "./admin/index.ts";
import { files } from "./files.ts";
import { fail } from "./http.ts";
import { localR2 } from "./local.ts";
import { ban } from "./middleware/ban.ts";
import { originGuard } from "./middleware/cors.ts";
import { flags } from "./middleware/flags.ts";
import { identity } from "./middleware/identity.ts";
import { requestId } from "./middleware/request-id.ts";
import { session } from "./middleware/session.ts";
import { account, ledger, removeAccount, setPassword } from "./routes/account.ts";
import {
  codeLogin,
  guestSignUp,
  linkLogin,
  logout,
  passwordLogin,
  requestEmailLogin,
} from "./routes/auth.ts";
import { billing, cancelPlan, changePlan, checkout, resumePlan } from "./routes/billing.ts";
import { googleCallback, googleStart } from "./routes/google.ts";
import { me } from "./routes/me.ts";
import {
  createStory,
  getSharedFilm,
  getStory,
  listStories,
  recomposeStory,
  remakeStory,
  renderStory,
} from "./routes/stories.ts";
import { createUpload } from "./routes/uploads.ts";
import { kieCallback, stripeWebhook, waffoWebhook } from "./routes/webhooks.ts";
import { reportRequest } from "./services/sentry.ts";
import type { AppEnv } from "./types.ts";

export const app = new Hono<AppEnv>();
app.use("*", requestId());
// Security headers on every answer: no framing, no sniffing, HTTPS only.
app.use("*", async (c, next) => {
  await next();
  c.header("x-content-type-options", "nosniff");
  c.header("x-frame-options", "DENY");
  c.header("strict-transport-security", "max-age=31536000; includeSubDomains");
  c.header("referrer-policy", "strict-origin-when-cross-origin");
});
app.use("*", originGuard());
app.use("/v1/*", identity());
app.use("/v1/*", session());
app.use("/v1/*", ban());
app.use("/v1/*", flags());
// Google sign-in arrives by navigation; it needs the guest identity to merge the guest's data.
app.use("/auth/*", identity());

app.get("/health", (c) => c.json({ ok: true }));
app.get("/v1/me", me);
app.post("/v1/auth/logout", logout);
app.post("/v1/auth/email", requestEmailLogin);
app.post("/v1/auth/code", codeLogin);
app.post("/v1/auth/guest", guestSignUp);
app.post("/v1/auth/link", linkLogin);
app.post("/v1/auth/password", passwordLogin);
app.post("/v1/account/password", setPassword);
app.get("/v1/account", account);
app.get("/v1/account/ledger", ledger);
app.post("/v1/account/delete", removeAccount);
app.get("/v1/billing", billing);
app.post("/v1/billing/checkout", checkout);
app.post("/v1/billing/subscription/change", changePlan);
app.post("/v1/billing/subscription/cancel", cancelPlan);
app.post("/v1/billing/subscription/resume", resumePlan);
app.get("/auth/google/start", googleStart);
app.get("/auth/google/callback", googleCallback);
app.post("/v1/uploads", createUpload);
app.post("/v1/stories", createStory);
app.get("/v1/stories", listStories);
app.get("/v1/stories/:id", getStory);
app.post("/v1/stories/:id/render", renderStory);
app.post("/v1/stories/:id/recompose", recomposeStory);
app.post("/v1/stories/:id/remake", remakeStory);
app.get("/v1/share/:id", getSharedFilm);
app.post("/webhooks/kie/:storyId", kieCallback);
app.post("/webhooks/waffo", waffoWebhook);
app.post("/webhooks/stripe", stripeWebhook);

app.route("/local-r2", localR2);
app.route("/files", files);
app.route("/admin", admin);

app.notFound((c) => fail(c, "NOT_FOUND"));
app.onError((error, c) => {
  console.error(
    JSON.stringify({ level: "error", requestId: c.get("requestId"), message: String(error) }),
  );
  reportRequest(c, error);
  return fail(c, "INTERNAL");
});
