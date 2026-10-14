import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { describe, expect, it } from "vitest";
import { saveConsent } from "../../lib/consent.ts";
import { refreshMe } from "../../lib/me.ts";
import { mockApi } from "../../test/mock-api.ts";
import CookieBanner from "./CookieBanner.tsx";

const me = (consentRequired: boolean) => ({
  body: { user: null, owner: "g", credits: null, banner: null, consentRequired, paid: false },
});

async function show(consentRequired: boolean | "down") {
  mockApi({
    "GET /v1/me": consentRequired === "down" ? { status: 503, body: {} } : me(consentRequired),
  });
  await refreshMe();
  render(<CookieBanner />);
  await refreshMe();
}

describe("CookieBanner (spec 7.5, design S17)", () => {
  it("asks EU visitors, with Reject and Accept looking the same", async () => {
    await show(true);
    const accept = await screen.findByRole("button", { name: "Accept" });
    const reject = screen.getByRole("button", { name: "Reject" });
    expect(accept.className).toBe(reject.className);
    fireEvent.click(accept);
    expect(document.cookie).toContain("upx_consent=granted");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("asks when the API cannot say where the visitor is", async () => {
    await show("down");
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("stays away from visitors outside those countries and from those who chose", async () => {
    await show(false);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    saveConsent("denied");
    await show(true);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("opens again from Cookie settings in the footer", async () => {
    await show(false);
    const settings = document.createElement("button");
    settings.setAttribute("data-cookie-settings", "");
    document.body.appendChild(settings);
    fireEvent.click(settings);
    fireEvent.click(await screen.findByRole("button", { name: "Reject" }));
    expect(document.cookie).toContain("upx_consent=denied");
    settings.remove();
  });
});
