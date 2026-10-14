import { fireEvent, render, screen } from "@testing-library/preact";
import { describe, expect, it } from "vitest";
import PackRows from "./PackRows.tsx";

describe("PackRows", () => {
  it("preselects the 3-video pack and shows price per video", () => {
    render(<PackRows returnPath="/pricing" />);
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    expect(radios).toHaveLength(3);
    expect(radios.find((r) => r.checked)?.value).toBe("pack3");
    expect(screen.getByText("$4.00 a video")).toBeTruthy();
    expect(screen.getByRole("button").textContent).toContain("$11.99");
  });

  it("updates the button when another pack is picked", () => {
    render(<PackRows returnPath="/pricing" />);
    fireEvent.click(screen.getAllByRole("radio")[2] as HTMLElement);
    expect(screen.getByRole("button").textContent).toContain("$29.99");
  });
});
