import { fireEvent, render, screen } from "@testing-library/preact";
import { describe, expect, it } from "vitest";
import { refreshMe } from "../../lib/me.ts";
import { mockApi } from "../../test/mock-api.ts";
import AnnouncementBar from "./AnnouncementBar.tsx";

const me = (banner: unknown) => ({ body: { user: null, owner: "g", credits: null, banner } });

describe("AnnouncementBar (design S17)", () => {
  it("shows the banner and remembers when it is dismissed", async () => {
    mockApi({ "GET /v1/me": me({ text: "Video unblur is coming soon", href: "/blog/video" }) });
    await refreshMe();
    const { unmount } = render(<AnnouncementBar />);
    expect(
      (await screen.findByRole("link", { name: "Video unblur is coming soon" })).getAttribute(
        "href",
      ),
    ).toBe("/blog/video");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("region")).toBeNull();
    unmount();
    render(<AnnouncementBar />);
    await refreshMe();
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("shows nothing without a banner", async () => {
    mockApi({ "GET /v1/me": me(null) });
    await refreshMe();
    render(<AnnouncementBar />);
    await refreshMe();
    expect(screen.queryByRole("region")).toBeNull();
  });
});
