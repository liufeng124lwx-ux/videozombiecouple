import { fireEvent, render, screen } from "@testing-library/preact";
import { PACKS, usd } from "@vzc/catalog";
import { describe, expect, it } from "vitest";
import PackRows from "./PackRows.tsx";

describe("PackRows", () => {
  it("preselects the 3-video pack and shows price per video", () => {
    render(<PackRows returnPath="/pricing" />);
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    expect(radios).toHaveLength(3);
    expect(radios.find((r) => r.checked)?.value).toBe("pack3");
    expect(screen.getByText("$4.66 a video")).toBeTruthy();
    expect(screen.getByRole("button").textContent).toContain("$13.99");
  });

  it("updates the button when another pack is picked", () => {
    render(<PackRows returnPath="/pricing" />);
    fireEvent.click(screen.getAllByRole("radio")[2] as HTMLElement);
    expect(screen.getByRole("button").textContent).toContain("$21.99");
  });

  it("a balance lets the smaller pack back in; allPacks lists every pack after the story's", () => {
    render(<PackRows returnPath="/story" story="christmas" balance={10} />);
    expect((screen.getAllByRole("radio") as HTMLInputElement[]).map((r) => r.value)).toEqual([
      "christmas1",
      "pack1",
      "pack3",
      "pack5",
    ]);
  });

  it("a story's pack comes first and is picked", () => {
    const xmas = PACKS.find((p) => p.story === "christmas");
    render(<PackRows returnPath="/story?id=S1&render=1" story="christmas" />);
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    expect(radios[0]?.value).toBe("christmas1");
    expect(radios[0]?.checked).toBe(true);
    expect(screen.getByRole("button").textContent).toContain(usd(xmas?.usd ?? 0));
    // Only packs that pay for one whole film: pack1 (one video's credits) is not enough.
    expect(radios.map((r) => r.value)).toEqual(["christmas1", "pack3", "pack5"]);
  });

  it("without a story, story packs stay off the list", () => {
    render(<PackRows returnPath="/pricing" />);
    const values = (screen.getAllByRole("radio") as HTMLInputElement[]).map((r) => r.value);
    expect(values).not.toContain("christmas1");
  });
});
