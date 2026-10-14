import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { errorMessage } from "@vzc/i18n";
import { describe, expect, it, vi } from "vitest";
import { notifySignedIn, onOpenSignIn } from "../../lib/bus.ts";
import { pendingCheckout } from "../../lib/checkout.ts";
import { refreshMe } from "../../lib/me.ts";
import { apiError, mockApi } from "../../test/mock-api.ts";
import BuyButton from "./BuyButton.tsx";

const GUEST = {
  body: {
    user: null,
    owner: "g",
    credits: null,
    banner: null,
    consentRequired: false,
    paid: false,
  },
};
const MEMBER = {
  body: {
    user: { id: "u", email: "ann@example.com", hasPassword: false, google: false },
    owner: "u",
    credits: 5,
    banner: null,
    consentRequired: false,
    paid: false,
  },
};
const CHECKOUT = { body: { url: "https://checkout.waffo.example/s#token=abc" } };

function buy(navigate = vi.fn()) {
  render(<BuyButton productKey="pack60" label="Buy" navigate={navigate} />);
  fireEvent.click(screen.getByRole("button", { name: "Buy" }));
  return navigate;
}

describe("BuyButton (spec 6.4)", () => {
  it("sends a member to checkout with the return page and GA4 client id", async () => {
    const { calls } = mockApi({ "GET /v1/me": MEMBER, "POST /v1/billing/checkout": CHECKOUT });
    document.cookie = "_ga=GA1.1.111.222; path=/";
    await refreshMe();
    const navigate = buy();
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("https://checkout.waffo.example/s#token=abc"),
    );
    expect(calls.find((c) => c.path === "/v1/billing/checkout")?.body).toEqual({
      productKey: "pack60",
      returnPath: "/pricing",
      clientId: "111.222",
    });
    expect(pendingCheckout()?.credits).toBe(5);
  });

  it("asks a guest to sign in first, then goes straight on to checkout", async () => {
    const { calls } = mockApi({
      "GET /v1/me": [GUEST, MEMBER],
      "POST /v1/billing/checkout": CHECKOUT,
    });
    await refreshMe();
    const opened = vi.fn();
    const stop = onOpenSignIn(opened);
    const navigate = buy();
    await waitFor(() =>
      expect(opened).toHaveBeenCalledWith(expect.objectContaining({ next: "/pricing?buy=pack60" })),
    );
    expect(calls.some((c) => c.path === "/v1/billing/checkout")).toBe(false);
    notifySignedIn(false);
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    stop();
  });

  it("continues a purchase after coming back from Google or the email link", async () => {
    mockApi({ "GET /v1/me": MEMBER, "POST /v1/billing/checkout": CHECKOUT });
    await refreshMe();
    history.replaceState(null, "", "/pricing?buy=pack60");
    const navigate = vi.fn();
    render(<BuyButton productKey="pack60" label="Buy" navigate={navigate} />);
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(location.search).toBe("");
  });

  it("points members who already have a plan to their account", async () => {
    mockApi({
      "GET /v1/me": MEMBER,
      "POST /v1/billing/checkout": apiError("SUBSCRIPTION_ACTIVE", 409),
    });
    await refreshMe();
    buy();
    expect(
      (await screen.findByRole("link", { name: "Go to your account" })).getAttribute("href"),
    ).toBe("/account");
  });

  it("says when payments are down, and that nothing was charged", async () => {
    mockApi({
      "GET /v1/me": MEMBER,
      "POST /v1/billing/checkout": apiError("PAYMENTS_UNAVAILABLE", 503),
    });
    await refreshMe();
    buy();
    expect((await screen.findByRole("alert")).textContent).toBe(
      errorMessage("PAYMENTS_UNAVAILABLE"),
    );
  });
  it("returns to the page the purchase started from", async () => {
    const { calls } = mockApi({ "GET /v1/me": MEMBER, "POST /v1/billing/checkout": CHECKOUT });
    await refreshMe();
    render(
      <BuyButton
        productKey="pack60"
        label="Buy"
        navigate={vi.fn()}
        returnPath="/fix-blurry-photo"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Buy" }));
    await waitFor(() =>
      expect(calls.find((c) => c.path === "/v1/billing/checkout")?.body).toMatchObject({
        returnPath: "/fix-blurry-photo",
      }),
    );
  });

  it("gives the recommended plan the primary button and keeps the others quiet (spec 3.3: the running light is only for the upgrade tier and See plans)", () => {
    mockApi({ "GET /v1/me": GUEST });
    render(<BuyButton productKey="pack60" label="Main" primary navigate={vi.fn()} />);
    render(<BuyButton productKey="pack60" label="Other" navigate={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Main" }).className).toBe("btn btn-primary");
    expect(screen.getByRole("button", { name: "Other" }).className).toBe("btn");
  });
});
