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

  it("the pricing page lists the Christmas film but still picks the popular pack", () => {
    render(<PackRows returnPath="/pricing" story="christmas" allPacks />);
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    expect(radios.map((r) => r.value)).toEqual(["christmas1", "pack1", "pack3", "pack5"]);
    expect(radios.find((r) => r.checked)?.value).toBe("pack3");
    expect(screen.getAllByText("1 Christmas film").length).toBeGreaterThan(0);
  });

  it("returning to /pricing?buy=pack3 picks pack3 and mounts its buy button", () => {
    history.replaceState(null, "", "/pricing?buy=pack3");
    render(<PackRows returnPath="/pricing" story="christmas" allPacks />);
    expect((screen.getAllByRole("radio") as HTMLInputElement[]).find((r) => r.checked)?.value).toBe(
      "pack3",
    );
    expect(screen.getByRole("button").textContent).toContain("$13.99");
    history.replaceState(null, "", "/");
  });

  it("returning to /pricing?buy=christmas1 picks the Christmas film", () => {
    history.replaceState(null, "", "/pricing?buy=christmas1");
    render(<PackRows returnPath="/pricing" story="christmas" allPacks />);
    expect((screen.getAllByRole("radio") as HTMLInputElement[]).find((r) => r.checked)?.value).toBe(
      "christmas1",
    );
    expect(screen.getByRole("button").textContent).toContain("$9.99");
    history.replaceState(null, "", "/");
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
