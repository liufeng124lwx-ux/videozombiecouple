import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { h, hydrate, render as mount } from "preact";
import { describe, expect, it, vi } from "vitest";
import { notifySignedIn, onOpenSignIn } from "../../lib/bus.ts";
import { refreshMe } from "../../lib/me.ts";
import { mockApi } from "../../test/mock-api.ts";
import AccountChip from "./AccountChip.tsx";

const MEMBER = {
  user: { id: "u", email: "ann@example.com", hasPassword: false, google: true },
  owner: "u",
  credits: 342,
  banner: null,
};
const GUEST = { user: null, owner: "g", credits: null, banner: null };

describe("AccountChip (design S17)", () => {
  it("shows a member's credits and links to the account page", async () => {
    mockApi({ "GET /v1/me": { body: MEMBER } });
    document.cookie = "upx_in=1; path=/";
    await refreshMe();
    render(<AccountChip />);
    const link = await screen.findByRole("link", { name: /342 credits/ });
    expect(link.getAttribute("href")).toBe("/account");
  });

  it("offers sign-in to guests and opens the dialog", async () => {
    mockApi({ "GET /v1/me": { body: GUEST } });
    await refreshMe();
    const opened = vi.fn();
    const stop = onOpenSignIn(opened);
    render(<AccountChip />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign in" }));
    expect(opened).toHaveBeenCalled();
    stop();
  });

  it("falls back to Sign in when the API is down", async () => {
    mockApi({ "GET /v1/me": { status: 503, body: {} } });
    document.cookie = "upx_in=1; path=/";
    await refreshMe();
    render(<AccountChip />);
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeTruthy();
  });

  it("updates after someone signs in on this page", async () => {
    mockApi({ "GET /v1/me": [{ body: GUEST }, { body: MEMBER }] });
    await refreshMe();
    render(<AccountChip />);
    await screen.findByRole("button", { name: "Sign in" });
    notifySignedIn(false);
    await waitFor(() => expect(screen.getByRole("link", { name: /342 credits/ })).toBeTruthy());
  });

  it("hydrates over the server's markup without leaving a Sign in button beside the credits", async () => {
    mockApi({ "GET /v1/me": { body: MEMBER } });
    // The server has no cookies: its first render is what the page ships.
    document.cookie = "upx_in=; path=/; max-age=0";
    const server = document.createElement("div");
    mount(h(AccountChip, {}), server);
    const shipped = server.innerHTML;
    mount(null, server);
    document.cookie = "upx_in=1; path=/";
    await refreshMe();
    const page = document.createElement("div");
    page.innerHTML = shipped;
    document.body.append(page);
    hydrate(h(AccountChip, {}), page);
    await waitFor(() => expect(page.querySelector("a.account-chip")).toBeTruthy());
    expect(page.querySelector("button")).toBeNull();
    expect(page.querySelectorAll("a.account-chip")).toHaveLength(1);
    page.remove();
  });

  it("gives members a My films link to their stories", async () => {
    mockApi({ "GET /v1/me": { body: MEMBER } });
    document.cookie = "upx_in=1; path=/";
    await refreshMe();
    render(<AccountChip />);
    const link = await screen.findByRole("link", { name: "My films" });
    expect(link.getAttribute("href")).toBe("/account#stories");
  });

  it("points back to a film that is still rendering, from any page", async () => {
    localStorage.setItem("vzc-story", "S9");
    mockApi({
      "GET /v1/me": { body: GUEST },
      "GET /v1/stories/S9": {
        body: { id: "S9", status: "rendering", progress: { done: 3, total: 13, etaMs: 120_000 } },
      },
    });
    await refreshMe();
    render(<AccountChip />);
    const link = await screen.findByRole("link", { name: /Rendering/ });
    expect(link.getAttribute("href")).toBe("/story?id=S9");
    expect(link.textContent).toContain("2 min");
    localStorage.clear();
  });

  it("says nothing about a remembered film that is already done", async () => {
    localStorage.setItem("vzc-story", "S9");
    mockApi({
      "GET /v1/me": { body: GUEST },
      "GET /v1/stories/S9": {
        body: { id: "S9", status: "done", progress: { done: 13, total: 13, etaMs: 0 } },
      },
    });
    await refreshMe();
    render(<AccountChip />);
    await screen.findByRole("button", { name: "Sign in" });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("link", { name: /Rendering/ })).toBeNull();
    localStorage.clear();
  });
});
