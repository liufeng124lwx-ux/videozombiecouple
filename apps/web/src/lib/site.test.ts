import { describe, expect, it } from "vitest";
import { absoluteUrl, buildMode, siteOrigin } from "./site.ts";

describe("site (spec 2.1, 2.4)", () => {
  it("treats only PUBLIC_DEPLOY_ENV=production as a production build", () => {
    expect(buildMode({ PUBLIC_DEPLOY_ENV: "production" })).toBe("production");
    expect(buildMode({ PUBLIC_DEPLOY_ENV: "staging" })).toBe("preview");
    expect(buildMode({})).toBe("preview");
  });

  it("builds absolute URLs without trailing slashes", () => {
    const env = { PUBLIC_SITE_ORIGIN: "https://staging.videozombiecouple.com/" };
    expect(siteOrigin(env)).toBe("https://staging.videozombiecouple.com");
    expect(absoluteUrl("/pricing", env)).toBe("https://staging.videozombiecouple.com/pricing");
    expect(absoluteUrl("/", env)).toBe("https://staging.videozombiecouple.com/");
    expect(absoluteUrl("/pricing", {})).toBe("https://videozombiecouple.com/pricing");
  });
});
