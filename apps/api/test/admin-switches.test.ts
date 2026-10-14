import { ROUTES } from "@vzc/catalog";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadRoutes } from "../src/services/routes-store.ts";
import { ADMIN_ENV, adminKit } from "./admin-kit.ts";
import { jobBody, setup } from "./harness.ts";
import { row } from "./rows.ts";

afterEach(() => vi.unstubAllGlobals());

const flags = (h: Awaited<ReturnType<typeof setup>>) => JSON.parse(h.kv.store.get("flags") ?? "{}");

describe("admin switches (spec 8.1, 4.2)", () => {
  it("saves the switches and the banner, keeping what ops wrote", async () => {
    const h = await setup(ADMIN_ENV);
    const kit = await adminKit(h.env);
    h.kv.store.set("flags", JSON.stringify({ somethingOpsKeeps: 1 }));
    const response = await kit.post("/admin/flags", {
      freePaused: "on",
      bannerText: "Maintenance <tonight>",
      bannerHref: "/pricing",
      offline: "unblur.4k",
    });
    expect(response.status).toBe(303);
    expect(flags(h)).toMatchObject({
      somethingOpsKeeps: 1,
      paused: false,
      freePaused: true,
      freePausedBy: "admin",
      banner: { text: "Maintenance <tonight>", href: "/pricing" },
      offline: ["unblur.4k"],
    });
    const page = await (await kit.get("/admin")).text();
    expect(page).toContain("Maintenance &lt;tonight&gt;");
    expect(h.db.prepare("SELECT action FROM admin_audit").all()).toEqual([{ action: "flags" }]);
    expect((await h.call("/v1/me")).body.banner).toEqual({
      text: "Maintenance <tonight>",
      href: "/pricing",
    });
  });

  it("leaves the cost breaker's pause as the breaker's, so it still lifts at midnight", async () => {
    const h = await setup(ADMIN_ENV);
    const kit = await adminKit(h.env);
    h.kv.store.set("flags", JSON.stringify({ freePaused: true, freePausedBy: "ops" }));
    await kit.post("/admin/flags", { freePaused: "on", offline: ["unblur.4k", "unblur.pro"] });
    expect(flags(h)).toMatchObject({ freePausedBy: "ops", offline: ["unblur.4k", "unblur.pro"] });
    await kit.post("/admin/flags", {});
    expect(flags(h)).toMatchObject({ freePaused: false, freePausedBy: null, offline: [] });
  });

  it("resumes paid jobs with a limit for today, and records it", async () => {
    const h = await setup(ADMIN_ENV);
    const kit = await adminKit(h.env);
    h.kv.store.set("flags", JSON.stringify({ paidPaused: true, paidPausedBy: "ops" }));
    await kit.post("/admin/flags", { paidLimitUsd: "75" });
    const today = Date.now() - (Date.now() % 86_400_000);
    expect(flags(h)).toMatchObject({
      paidPaused: false,
      paidPausedBy: null,
      paidLimit: { day: today, usd: 75 },
    });
    expect(h.db.prepare("SELECT action FROM admin_audit").all()).toEqual([{ action: "flags" }]);
  });

  it("does not prefill the limit, so a resume without a number books a fresh line", async () => {
    const h = await setup(ADMIN_ENV);
    const kit = await adminKit(h.env);
    const today = Date.now() - (Date.now() % 86_400_000);
    row(h, {
      kind: "credits",
      createdAt: Date.now(),
      attempts: [{ state: "succeeded", costUsd: 45, finishedAt: Date.now() }],
    });
    h.kv.store.set(
      "flags",
      JSON.stringify({ paidPaused: true, paidPausedBy: "ops", paidLimit: { day: today, usd: 40 } }),
    );
    const page = await (await kit.get("/admin")).text();
    expect(page).toMatch(/name="paidLimitUsd"[^>]*value=""/);
    await kit.post("/admin/flags", { paidLimitUsd: "" });
    const saved = flags(h);
    expect(saved.paidPaused).toBe(false);
    expect(saved.paidLimit.usd).toBeGreaterThan(45);
  });

  it("records who paused processing: the admin, or the kie key's daily cap", async () => {
    const h = await setup(ADMIN_ENV);
    const kit = await adminKit(h.env);
    await kit.post("/admin/flags", { paused: "on" });
    expect(flags(h)).toMatchObject({ paused: true, pausedBy: "admin" });
    h.kv.store.set("flags", JSON.stringify({ paused: true, pausedBy: "kie-cap", pausedAt: 123 }));
    await kit.post("/admin/flags", { paused: "on" });
    expect(flags(h)).toMatchObject({ paused: true, pausedBy: "kie-cap", pausedAt: 123 });
    await kit.post("/admin/flags", {});
    expect(flags(h)).toMatchObject({ paused: false, pausedBy: null, pausedAt: null });
  });

  it("renders what each pause showed, so a save can tell a change from a stale form", async () => {
    const h = await setup(ADMIN_ENV);
    const kit = await adminKit(h.env);
    h.kv.store.set(
      "flags",
      JSON.stringify({ paidPaused: true, paidPausedBy: "ops", paidPausedAt: Date.UTC(2026, 9, 9) }),
    );
    const page = await (await kit.get("/admin")).text();
    expect(page).toMatch(/name="shown_paidPaused" value="on"/);
    expect(page).toMatch(/name="shown_paused" value="off"/);
    expect(page).toMatch(/name="shown_freePaused" value="off"/);
    expect(page).toContain("2026-10-09");
    expect(page).not.toContain("leave empty to keep");
  });

  it("a stale save during an ops paid pause keeps it paused and the limit unchanged", async () => {
    const h = await setup(ADMIN_ENV);
    const kit = await adminKit(h.env);
    const today = Date.now() - (Date.now() % 86_400_000);
    h.kv.store.set(
      "flags",
      JSON.stringify({
        paidPaused: true,
        paidPausedBy: "ops",
        paidPausedAt: 5,
        paidLimit: { day: today, usd: 40 },
      }),
    );
    // The form was loaded before ops paused paid jobs: it showed the box off and sends it off.
    await kit.post("/admin/flags", {
      shown_paused: "off",
      shown_freePaused: "off",
      shown_paidPaused: "off",
      paidLimitUsd: "",
    });
    expect(flags(h)).toMatchObject({
      paidPaused: true,
      paidPausedBy: "ops",
      paidPausedAt: 5,
      paidLimit: { day: today, usd: 40 },
    });
  });

  it("a stale save after the kie-cap pause lifted does not pause again", async () => {
    const h = await setup(ADMIN_ENV);
    const kit = await adminKit(h.env);
    // Shown during the kie-cap pause; the cap lifted before the admin pressed Save.
    h.kv.store.set("flags", JSON.stringify({ paused: false, pausedBy: null, pausedAt: null }));
    await kit.post("/admin/flags", {
      paused: "on",
      shown_paused: "on",
      shown_freePaused: "off",
      shown_paidPaused: "off",
    });
    expect(flags(h)).toMatchObject({ paused: false, pausedBy: null, pausedAt: null });
  });

  it("a banner-only save changes nothing else", async () => {
    const h = await setup(ADMIN_ENV);
    const kit = await adminKit(h.env);
    const stored = {
      paused: true,
      pausedBy: "kie-cap",
      pausedAt: 1,
      freePaused: true,
      freePausedBy: "ops",
      paidPaused: true,
      paidPausedBy: "ops",
      paidPausedAt: 2,
      paidLimit: { day: Date.now() - (Date.now() % 86_400_000), usd: 40 },
      offline: [],
    };
    h.kv.store.set("flags", JSON.stringify(stored));
    await kit.post("/admin/flags", {
      paused: "on",
      freePaused: "on",
      paidPaused: "on",
      shown_paused: "on",
      shown_freePaused: "on",
      shown_paidPaused: "on",
      bannerText: "Hello",
    });
    expect(flags(h)).toEqual({ ...stored, banner: { text: "Hello", href: null } });
  });

  it("an admin lifting their own paid pause with an empty field keeps today's limit", async () => {
    const h = await setup(ADMIN_ENV);
    const kit = await adminKit(h.env);
    const today = Date.now() - (Date.now() % 86_400_000);
    h.kv.store.set(
      "flags",
      JSON.stringify({
        paidPaused: true,
        paidPausedBy: "admin",
        paidLimit: { day: today, usd: 40 },
      }),
    );
    await kit.post("/admin/flags", { shown_paidPaused: "on", paidLimitUsd: "" });
    expect(flags(h)).toMatchObject({
      paidPaused: false,
      paidPausedBy: null,
      paidLimit: { day: today, usd: 40 },
    });
  });

  it("turns the kie-cap pause into the admin's when asked to keep it past the reset", async () => {
    const h = await setup(ADMIN_ENV);
    const kit = await adminKit(h.env);
    h.kv.store.set("flags", JSON.stringify({ paused: true, pausedBy: "kie-cap", pausedAt: 7 }));
    expect(await (await kit.get("/admin")).text()).toContain('name="keepPaused"');
    await kit.post("/admin/flags", { paused: "on", shown_paused: "on", keepPaused: "on" });
    expect(flags(h)).toMatchObject({ paused: true, pausedBy: "admin", pausedAt: 7 });
  });

  it("stops new jobs for a capability taken offline, and only those", async () => {
    const h = await setup(ADMIN_ENV);
    const kit = await adminKit(h.env);
    await kit.post("/admin/flags", { offline: "unblur.std" });
    await h.pass();
    const refused = await h.call("/v1/jobs", { method: "POST", body: jobBody(await h.upload()) });
    expect(refused.body.error?.code).toBe("PROVIDER_DOWN");
    await kit.post("/admin/flags", {});
    const ok = await h.call("/v1/jobs", { method: "POST", body: jobBody(await h.upload()) });
    expect(ok.status).toBe(201);
  });

  it("switches a route off and edits its rank and timeout", async () => {
    const h = await setup(ADMIN_ENV);
    const kit = await adminKit(h.env);
    const route = ROUTES[0];
    if (!route) throw new Error("no routes");
    expect(await (await kit.get("/admin/routes")).text()).toContain(route.id);
    const response = await kit.post(`/admin/routes/${route.id}`, {
      rank: "5",
      timeoutMs: "60000",
    });
    expect(response.status).toBe(303);
    const saved = await loadRoutes(h.env.DB as D1Database);
    expect(saved.find((r) => r.id === route.id)).toMatchObject({
      enabled: false,
      rank: 5,
      timeoutMs: 60_000,
    });
    expect(saved.length).toBe(ROUTES.length);
    expect(
      (await kit.post(`/admin/routes/${route.id}`, { rank: "0", timeoutMs: "60000" })).status,
    ).toBe(400);
    expect((await kit.post("/admin/routes/nope", { rank: "1", timeoutMs: "60000" })).status).toBe(
      404,
    );
    expect(h.db.prepare("SELECT action, target FROM admin_audit").all()).toEqual([
      { action: "route", target: route.id },
    ]);
  });
});
