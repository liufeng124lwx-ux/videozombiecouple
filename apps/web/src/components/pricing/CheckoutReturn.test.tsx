import { act, render, screen } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import { rememberCheckout } from "../../lib/checkout.ts";
import { mockApi } from "../../test/mock-api.ts";
import CheckoutReturn from "./CheckoutReturn.tsx";

const me = (credits: number) => ({
  body: {
    user: { id: "u", email: "a@b.co", hasPassword: false, google: false },
    owner: "u",
    credits,
    banner: null,
    consentRequired: false,
    paid: false,
  },
});

async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("CheckoutReturn (spec 6.4, design S12)", () => {
  it("confirms the payment as soon as the credits arrive", async () => {
    vi.useFakeTimers();
    mockApi({ "GET /v1/me": [me(5), me(5), me(65)] });
    rememberCheckout(5);
    history.replaceState(null, "", "/pricing?paid=1");
    render(<CheckoutReturn />);
    expect(screen.getByRole("status").textContent).toBe("Confirming your payment…");
    expect(location.search).toBe("");
    await wait(4_100);
    expect(screen.getByRole("status").textContent).toBe("60 credits added. Thanks!");
  });

  it("says the credits are on their way when the webhook is late, without asking to pay again", async () => {
    vi.useFakeTimers();
    const { calls } = mockApi({ "GET /v1/me": me(5) });
    rememberCheckout(5);
    history.replaceState(null, "", "/pricing?paid=1");
    render(<CheckoutReturn />);
    await wait(61_000);
    expect(screen.getByRole("status").textContent).toContain("won’t be charged twice");
    const polls = calls.length;
    await wait(10_000);
    expect(calls.length).toBe(polls);
  });

  it("does nothing on a normal visit", () => {
    const { calls } = mockApi({});
    history.replaceState(null, "", "/pricing");
    render(<CheckoutReturn />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(calls).toHaveLength(0);
  });
});
