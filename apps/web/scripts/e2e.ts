/**
 * The story journey in a real browser, against the built site and a scripted API. Phone width.
 * A guest adds two sample photos (AI-generated people), the photos are checked (nothing is
 * generated for free), the guest leaves an email and gets the pack picker, and a finished film
 * plays with its deletion date. Turnstile is stubbed; nothing leaves the machine but the page.
 *
 *   pnpm --filter @vzc/web e2e
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { chromium, type Page, type Route } from "playwright";

const PORT = 4398;
const SITE = `http://localhost:${PORT}`;
const API = "http://api.e2e.test";
const FILES = "http://files.e2e.test";

function step(name: string, ok: boolean, detail = "") {
  console.log(`e2e: ${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) throw new Error(name);
}

async function serve(): Promise<ChildProcess> {
  const server = spawn("pnpm", ["exec", "astro", "preview", "--port", String(PORT)], {
    stdio: "ignore",
  });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(SITE)).ok) return server;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  server.kill();
  throw new Error("preview server did not start");
}

/** The API, scripted: a signed-in account with no credits and one story. */
function scriptedApi(page: Page) {
  let polls = 0;
  let created = false;
  let guest = false;
  let state: "preview" | "done" = "preview";
  const uploads: number[] = [];
  const frame = readFileSync("src/assets/samples/p02-A.jpg");
  const view = () => ({
    id: "01E2ESTORY0000000000000000",
    status: !created
      ? "previewing"
      : state === "done"
        ? "done"
        : polls < 2
          ? "previewing"
          : "preview_ready",
    kind: "human",
    scene: "cabin-wheat",
    names: null,
    date: null,
    preview: null,
    video:
      state === "done"
        ? { url: `${FILES}/film.mp4`, poster: `${FILES}/a.jpg`, expiresAt: Date.now() + 864e5 }
        : null,
    progress: { done: Math.min(polls, 5), total: 6, etaMs: 60_000 },
    errorCode: null,
    recomposeLeft: 1,
    videoAttempts: state === "done" ? 1 : 0,
    remakeLeft: 1,
    shareToken: state === "done" ? "a".repeat(32) : null,
    createdAt: Date.now(),
  });
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({
      status,
      contentType: "application/json",
      headers: { "access-control-allow-origin": SITE, "access-control-allow-credentials": "true" },
      body: JSON.stringify(body),
    });
  page.route(`${API}/**`, async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS")
      return route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-origin": SITE,
          "access-control-allow-credentials": "true",
          "access-control-allow-headers": "content-type, x-turnstile, x-device, x-human-pass",
          "access-control-allow-methods": "GET, POST",
        },
      });
    const path = new URL(req.url()).pathname;
    if (path === "/v1/me")
      return json(route, {
        user: guest
          ? {
              id: "g1",
              email: "e2e@example.com",
              hasPassword: false,
              google: false,
              verified: false,
            }
          : null,
        owner: guest ? "u:g1" : "g:x",
        credits: guest ? 0 : null,
        banner: null,
        consentRequired: false,
        paid: false,
      });
    if (path === "/v1/auth/guest") {
      guest = true;
      return json(route, { ok: true }, 201);
    }
    if (path === "/v1/uploads")
      return json(
        route,
        {
          key: `in/${Math.random()}.jpg`,
          url: `${FILES}/put`,
          method: "PUT",
          headers: { "content-type": "image/jpeg" },
          expiresInSec: 600,
        },
        201,
      );
    if (path === "/v1/stories" && req.method() === "POST") {
      created = true;
      return json(route, { storyId: "01E2ESTORY0000000000000000" }, 201);
    }
    if (path.endsWith("/render"))
      return json(route, { error: { code: "CREDITS_LOW", requestId: "e2e" } }, 402);
    if (path.startsWith("/v1/stories/")) {
      polls++;
      return json(route, view());
    }
    if (path.startsWith("/v1/billing")) return json(route, { products: [] });
    return json(route, { error: { code: "NOT_FOUND", requestId: "e2e" } }, 404);
  });
  page.route(`${FILES}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/put" && route.request().method() === "PUT")
      uploads.push(route.request().postDataBuffer()?.length ?? 0);
    if (path === "/put")
      return route.fulfill({
        status: 200,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "content-type",
          "access-control-allow-methods": "PUT",
        },
      });
    return route.fulfill({ status: 200, contentType: "image/jpeg", body: frame });
  });
  return { finish: () => void (state = "done"), uploads };
}

async function main() {
  const build = spawnSync("pnpm", ["build"], {
    stdio: "inherit",
    env: {
      ...process.env,
      PUBLIC_API_ORIGIN: API,
      PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
    },
  });
  if (build.status !== 0) throw new Error("build failed");
  const server = await serve();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
    });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("requestfailed", (r) =>
      console.log(
        `e2e:      request failed ${r.method()} ${r.url().slice(0, 80)} ${r.failure()?.errorText ?? ""}`,
      ),
    );
    // Turnstile: an invisible widget that always passes.
    // A string, not a function: tsx would wrap a function with helpers the page doesn't have.
    await page.addInitScript(`
      window.turnstile = {
        render(el, o) { window.__ts = o.callback; return "w1"; },
        execute() { setTimeout(() => window.__ts("tok"), 10); },
        remove() {},
      };
    `);
    await page.route("https://challenges.cloudflare.com/**", (r) => r.abort());
    const api = scriptedApi(page);

    await page.goto(`${SITE}/`);
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    step("home fits a phone", width <= 390, `${width}px`);

    const inputs = page.locator('#make input[type="file"]');
    step("two photo slots", (await inputs.count()) === 2);
    await inputs.nth(0).setInputFiles("src/assets/samples/p02-survivor.jpg");
    await inputs.nth(1).setInputFiles("src/assets/samples/p02-infected.jpg");
    const go = page.getByRole("button", { name: "Make my film" });
    await go.waitFor({ timeout: 60_000 });
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll("button")].some(
          (b) => b.textContent?.includes("Make my film") && !(b as HTMLButtonElement).disabled,
        ),
      null,
      { timeout: 60_000 },
    );
    step("photos accepted by the face check", true);
    await go.click();
    await page.getByText("Your photos are ready").waitFor({ timeout: 30_000 });
    step(
      "both photos reached storage as JPEGs",
      api.uploads.length === 2 && api.uploads.every((n) => n > 10_000),
      api.uploads.join(","),
    );
    step("photos checked, nothing generated for free", true);

    await page.getByLabel("Where should we send your film?").fill("e2e@example.com");
    await page.getByRole("button", { name: "Continue to payment" }).click();
    await page.locator(".pay").waitFor({ timeout: 10_000 });
    step("guest email → pack picker", true);

    api.finish();
    await page.reload();
    await page.locator(".tool-done video").waitFor({ timeout: 30_000 });
    step("finished film plays on resume", true);
    step(
      "says when the film is deleted",
      (await page.getByText(/We delete your film on/).count()) > 0,
    );
    step("no page errors", errors.length === 0, errors.join(" | "));
  } catch (error) {
    // Leave evidence for the CI log: what the tool said, and a screenshot.
    const page = browser.contexts()[0]?.pages()[0];
    if (page) {
      console.error(
        "e2e: tool text:",
        (
          await page
            .locator("#make")
            .innerText()
            .catch(() => "?")
        ).slice(0, 600),
      );
      await page.screenshot({ path: "e2e-failure.png", fullPage: false }).catch(() => undefined);
    }
    throw error;
  } finally {
    await browser.close();
    server.kill();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
