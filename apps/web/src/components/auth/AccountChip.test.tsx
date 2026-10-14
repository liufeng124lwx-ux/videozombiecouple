import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
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
});
