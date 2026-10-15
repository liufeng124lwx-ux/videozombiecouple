import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import type { BillingView } from "@vzc/contracts";
import { describe, expect, it, vi } from "vitest";
import { apiError, mockApi } from "../../test/mock-api.ts";
import DeleteAccount from "./DeleteAccount.tsx";

const NO_PLAN: BillingView = { subscription: null, paidPaused: false, refundDebt: 0 };
const ACTIVE: BillingView = {
  subscription: {
    plan: "plus",
    interval: "month",
    status: "active",
    periodEnd: Date.UTC(2026, 10, 8),
    cancelAt: null,
  },
  paidPaused: false,
  refundDebt: 0,
};

describe("DeleteAccount (spec 5.5, design S15)", () => {
  it("asks to cancel a live plan first and deletes nothing", () => {
    const { calls } = mockApi({});
    const onCancelPlan = vi.fn();
    render(
      <DeleteAccount
        billing={ACTIVE}
        credits={342}
        onCancelPlan={onCancelPlan}
        navigate={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete account…" }));
    expect(screen.getByText("Cancel your plan first")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel plan" }));
    expect(onCancelPlan).toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it("deletes only after DELETE is typed, then leaves the page", async () => {
    const { calls } = mockApi({
      "POST /v1/account/delete": { body: { ok: true } },
      "GET /v1/me": { body: { user: null } },
    });
    const navigate = vi.fn();
    render(
      <DeleteAccount billing={NO_PLAN} credits={142} onCancelPlan={vi.fn()} navigate={navigate} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete account…" }));
    // An unused pack is still refundable for a while: say so before the credits are gone.
    expect(
      screen.getByText(
        "remove your 142 credits. Bought a pack in the last 14 days and haven't used it? Ask us for a refund first.",
      ),
    ).toBeTruthy();
    const confirm = screen.getByRole("button", { name: "Delete account" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.input(screen.getByLabelText("Type DELETE to confirm"), {
      target: { value: "delete" },
    });
    expect(confirm.disabled).toBe(true);
    fireEvent.input(screen.getByLabelText("Type DELETE to confirm"), {
      target: { value: "DELETE" },
    });
    fireEvent.click(confirm);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/"));
    expect(calls.find((c) => c.path === "/v1/account/delete")?.body).toEqual({ confirm: "DELETE" });
  });

  it("switches to cancel-first when the server finds a live plan", async () => {
    mockApi({ "POST /v1/account/delete": apiError("SUBSCRIPTION_ACTIVE", 409) });
    render(
      <DeleteAccount billing={NO_PLAN} credits={0} onCancelPlan={vi.fn()} navigate={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete account…" }));
    fireEvent.input(screen.getByLabelText("Type DELETE to confirm"), {
      target: { value: "DELETE" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete account" }));
    expect(await screen.findByText("Cancel your plan first")).toBeTruthy();
  });

  it("focuses the confirmation field and closes on Escape", () => {
    mockApi({});
    render(
      <DeleteAccount billing={NO_PLAN} credits={0} onCancelPlan={vi.fn()} navigate={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete account…" }));
    expect(document.activeElement).toBe(screen.getByLabelText("Type DELETE to confirm"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
