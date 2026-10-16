import { describe, expect, it } from "vitest";
import { wireFolds } from "./fold.ts";

describe("folded long reads (phones)", () => {
  it("the button unfolds its own section, then goes away; the text was in the page all along", () => {
    document.body.innerHTML = `
      <section><div class="long-read" data-fold><h2>Why</h2><p>All of the text.</p></div>
        <div class="fold-more"><button type="button" data-unfold>Read the full guide</button></div></section>
      <section><div class="long-read" data-fold><p>Other</p></div>
        <div class="fold-more"><button type="button" data-unfold>Read the full guide</button></div></section>`;
    wireFolds(document);
    const [first, second] = [...document.querySelectorAll(".long-read")];
    expect(first?.textContent).toContain("All of the text.");
    (document.querySelector("[data-unfold]") as HTMLButtonElement).click();
    expect(first?.hasAttribute("data-fold")).toBe(false);
    expect(second?.hasAttribute("data-fold")).toBe(true);
    expect(document.querySelectorAll("[data-unfold]")).toHaveLength(1);
    // Focus moves into the text that just opened.
    expect(document.activeElement).toBe(first);
  });
});
