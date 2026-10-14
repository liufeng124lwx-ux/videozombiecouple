import { afterEach, describe, expect, it, vi } from "vitest";
import { ADMIN_ENV, adminKit } from "./admin-kit.ts";
import { setup } from "./harness.ts";

afterEach(() => vi.unstubAllGlobals());

describe("admin access (spec 8.1)", () => {
  it("doesn't exist until Access and the admin list are configured", async () => {
    const h = await setup();
    const kit = await adminKit(h.env);
    expect((await kit.get("/admin")).status).toBe(404);
  });

  it("lets an admin in, with noindex and no caching", async () => {
    const h = await setup(ADMIN_ENV);
    const kit = await adminKit(h.env);
    const response = await kit.get("/admin");
    expect(response.status).toBe(200);
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toContain("boss@videozombiecouple.com");
  });

  it("turns away a missing, forged, expired or foreign token, and non-admins", async () => {
    const h = await setup(ADMIN_ENV);
    const kit = await adminKit(h.env);
    const good = await kit.token();
    expect((await kit.get("/admin", good)).status).toBe(200);
    const cases = [
      "",
      `${good.slice(0, -4)}AAAA`,
      await kit.token({ exp: Math.floor(Date.now() / 1000) - 10 }),
      await kit.token({ aud: ["someone-else"] }),
      await kit.token({ iss: "https://evil.cloudflareaccess.com" }),
      await kit.token({ email: "intruder@example.com" }),
    ];
    for (const token of cases) expect((await kit.get("/admin", token)).status).toBe(403);
    // Access rotated its key: an unknown kid fetches the keys again.
    const rotated = await adminKit(h.env);
    expect((await rotated.get("/admin")).status).toBe(200);
  });

  it("refuses writes from another origin", async () => {
    const h = await setup(ADMIN_ENV);
    const kit = await adminKit(h.env);
    expect((await kit.post("/admin/flags", {})).status).toBe(303);
    expect((await kit.post("/admin/flags", {}, { origin: "https://evil.example" })).status).toBe(
      403,
    );
    expect((await kit.post("/admin/flags", {}, { origin: null })).status).toBe(403);
  });
});
