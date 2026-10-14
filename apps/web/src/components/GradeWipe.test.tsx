import { fireEvent, render, screen } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import GradeWipe from "./GradeWipe.tsx";

const frames = {
  cold: { src: "/a.avif", alt: "The standoff in the cabin" },
  warm: { src: "/c.avif", alt: "The memory in the wheat field" },
};

function stubMotion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: reduce && q.includes("reduce"),
    addEventListener() {},
    removeEventListener() {},
  }));
}

describe("GradeWipe", () => {
  it("shows both frames with alt text, split at 50% by default", () => {
    stubMotion(false);
    render(<GradeWipe {...frames} mode="drag" />);
    expect(screen.getByAltText("The standoff in the cabin")).toBeTruthy();
    expect(screen.getByAltText("The memory in the wheat field")).toBeTruthy();
    expect(screen.getByRole("slider").getAttribute("aria-valuenow")).toBe("50");
  });

  it("moves the cut 5% per arrow key and stays within 0–100", () => {
    stubMotion(false);
    render(<GradeWipe {...frames} mode="drag" />);
    const slider = screen.getByRole("slider");
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(slider.getAttribute("aria-valuenow")).toBe("55");
    for (let i = 0; i < 30; i++) fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect(slider.getAttribute("aria-valuenow")).toBe("0");
    fireEvent.keyDown(slider, { key: "End" });
    expect(slider.getAttribute("aria-valuenow")).toBe("100");
  });

  it("follows a controlled progress and is not draggable then", () => {
    stubMotion(false);
    const { container, rerender } = render(<GradeWipe {...frames} mode="progress" value={20} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.getPropertyValue("--cut")).toBe("20%");
    rerender(<GradeWipe {...frames} mode="progress" value={80} />);
    expect(root.style.getPropertyValue("--cut")).toBe("80%");
    expect(screen.queryByRole("slider")).toBeNull();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("80");
  });

  it("holds still at the middle for reduced motion in auto mode", () => {
    stubMotion(true);
    const { container } = render(<GradeWipe {...frames} mode="auto" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.classList.contains("drift")).toBe(false);
    expect(root.style.getPropertyValue("--cut")).toBe("50%");
  });

  it("drifts in auto mode when motion is allowed", () => {
    stubMotion(false);
    const { container } = render(<GradeWipe {...frames} mode="auto" />);
    expect((container.firstElementChild as HTMLElement).classList.contains("drift")).toBe(true);
  });
});
