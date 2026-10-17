import { render } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import HeroFilm from "./HeroFilm.tsx";

function stubMotion() {
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  }));
}

const beatsOf = (container: Element) =>
  [...container.querySelectorAll(".reel-beats li")].map((li) => li.textContent);

describe("HeroFilm", () => {
  it("lights the zombie film's beats by default", () => {
    stubMotion();
    const { container } = render(<HeroFilm src="/a.mp4" poster="/a.jpg" label="AI example" />);
    expect(beatsOf(container)).toEqual(["01Standoff", "02Embrace", "03Memory", "04Dawn"]);
  });

  it("shows another story's own beats when given them", () => {
    stubMotion();
    const { container } = render(
      <HeroFilm
        src="/x.mp4"
        poster="/x.jpg"
        label="AI example"
        beats={[
          { label: "The stranger", from: 0 },
          { label: "The ornament", from: 10 },
          { label: "Remembering", from: 17 },
        ]}
      />,
    );
    expect(beatsOf(container)).toEqual(["01The stranger", "02The ornament", "03Remembering"]);
  });
});
