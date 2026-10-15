import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const page = (id: string) =>
  readFileSync(join(import.meta.dirname, "pages/en", `${id}.mdx`), "utf8");
const TRAINING = "We never use your photos to train AI.";
const ADDRESS = "30 N Gould St Ste R, Sheridan, WY 82801";
const HELLO = "hello@videozombiecouple.com";
const DMCA = "dmca@videozombiecouple.com";

describe("compliance pages (spec §8.1, plan Task 7)", () => {
  it("privacy names every processor, the retention, the face promise and the cookies", () => {
    const text = page("privacy");
    for (const name of [
      "Cloudflare",
      "kie.ai",
      "Google",
      "ByteDance",
      "OpenAI",
      "Kuaishou",
      "SeeAPI",
      "Stripe",
      "Google Analytics",
      "Microsoft Clarity",
    ])
      expect(text, name).toContain(name);
    expect(text).toContain(TRAINING);
    expect(text).toMatch(/[Ff]ace features[^.]*never stored/);
    expect(text).toMatch(/under 18/);
    // The age margin and the nudity check are stated as they run.
    expect(text).toContain('looks younger than <F k="age.minEstimated" />');
    expect(text).not.toContain("sends nothing to AI providers");
    expect(text).toContain('<F k="retention.photosDays" />');
    expect(text).toContain('<F k="retention.guestFilmDays" />');
    expect(text).toContain('<F k="retention.memberFilmDays" />');
    expect(text).toContain("## Cookies");
    for (const cookie of ["upx_sess", "upx_in", "vid", "upx_consent", "_ga", "_clck"])
      expect(text, cookie).toContain(cookie);
    expect(text).toMatch(/under (the age of )?13/);
    expect(text).toContain("GDPR");
    expect(text).toContain("CCPA");
    expect(text).toContain("Arrayon Inc.");
    expect(text).toContain(HELLO);
    expect(text).toContain(DMCA);
  });

  it("privacy has a public biometric data policy: what, why, consent, retention schedule, no sale", () => {
    const text = page("privacy");
    expect(text).toContain("## Biometric data");
    for (const part of [
      "Illinois Biometric Information Privacy Act",
      "face geometry",
      "Before every upload",
      "never sell, lease, trade or otherwise profit from",
      "never written to disk",
      "aren’t available in Illinois",
    ])
      expect(text, part).toContain(part);
  });

  it("terms say how the upload confirmation works and how to get a film taken down within 48 hours", () => {
    const text = page("terms");
    expect(text).toContain("ticking the box before every upload");
    expect(text).toContain("## Report a video");
    expect(text).toContain('within <F k="takedown.hours" /> hours');
  });

  it("terms cover adults only, whose photos, AI accuracy, banned uses, no affiliation and Wyoming law", () => {
    const text = page("terms");
    for (const phrase of [
      "at least 18",
      "anyone under 18",
      "adults who agreed",
      "personal use",
      "may not be accurate",
      "You may not",
      "not affiliated with",
      "TikTok",
      "terminate",
      "State of Wyoming",
      "Arrayon Inc.",
    ])
      expect(text, phrase).toContain(phrase);
    expect(text).toMatch(/not affiliated with[^.]*TikTok/);
  });

  it("refund policy quotes the catalog's pack window and returns failed videos", () => {
    const text = page("refund");
    expect(text).toContain('<F k="refund.packDays" />');
    expect(text).toContain("{{refund.packDays}}");
    expect(text).toMatch(/fails to generate, the video goes back to your balance/);
    expect(text).not.toMatch(/subscription/i);
  });

  it("DMCA page gives the registered agent", () => {
    const text = page("dmca");
    for (const fact of ["DMCA-1082308", DMCA, ADDRESS, "counter-notice"])
      expect(text, fact).toContain(fact);
  });

  it("about and contact name the company, its address and its inboxes", () => {
    for (const id of ["about", "contact"]) {
      const text = page(id);
      expect(text, id).toContain("Arrayon Inc.");
      expect(text, id).toContain(ADDRESS);
      expect(text, id).toContain(HELLO);
    }
    expect(page("contact")).toContain(DMCA);
  });

  it("no compliance page still talks about the image product", () => {
    for (const id of ["privacy", "terms", "refund", "dmca", "about", "contact"])
      expect(page(id), id).not.toMatch(/unblur|UnblurPix/i);
  });
});
