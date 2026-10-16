import { act, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import StickyCta from "./StickyCta.tsx";

type Callback = (entries: { isIntersecting: boolean; target: Element }[]) => void;
let observed: { cb: Callback; el: Element } | null = null;

class FakeObserver {
  cb: Callback;
  constructor(cb: Callback) {
    this.cb = cb;
  }
  observe(el: Element) {
    observed = { cb: this.cb, el };
  }
  disconnect() {}
}

afterEach(() => {
  observed = null;
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

function scrollTo(y: number) {
  Object.defineProperty(window, "scrollY", { value: y, configurable: true });
  window.dispatchEvent(new Event("scroll"));
}

describe("StickyCta (phones: the main action stays one tap away)", () => {
  it("appears once the first screen is scrolled past, hides over the tool, and links to it", async () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    const make = document.createElement("section");
    make.id = "make";
    document.body.append(make);
    render(<StickyCta href="#make" label="Make my film" target="make" />);
    // Hidden, it is also out of reach of screen readers and the tab key.
    const link = () => screen.queryByRole("link", { name: "Make my film" });
    // On the first screen the hero has its own button.
    expect(link()).toBeNull();
    await act(() => scrollTo(900));
    expect(link()?.getAttribute("href")).toBe("#make");
    // Over the tool itself it would cover the form.
    await act(() => observed?.cb([{ isIntersecting: true, target: make }]));
    expect(link()).toBeNull();
    await act(() => observed?.cb([{ isIntersecting: false, target: make }]));
    expect(link()).not.toBeNull();
  });
});
