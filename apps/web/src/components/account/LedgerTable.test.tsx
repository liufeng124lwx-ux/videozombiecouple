import { fireEvent, render, screen } from "@testing-library/preact";
import { describe, expect, it } from "vitest";
import { mockApi } from "../../test/mock-api.ts";
import LedgerTable from "./LedgerTable.tsx";

const row = (id: number, delta: number, type: string, reason: string | null) => ({
  id,
  delta,
  type,
  reason,
  jobId: null,
  orderId: null,
  createdAt: Date.UTC(2026, 9, 9, 10, id),
});

describe("LedgerTable (spec 5.5: 20 a page, newest first)", () => {
  it("pages older and newer with the cursor the API returns", async () => {
    const { calls } = mockApi({
      "GET /v1/account/ledger": [
        { body: { entries: [row(40, -10, "reserve", null)], next: 40 } },
        { body: { entries: [row(12, 30, "grant", "pack3")], next: null } },
        { body: { entries: [row(40, -10, "reserve", null)], next: 40 } },
      ],
    });
    render(<LedgerTable />);
    expect(await screen.findByText("Story video")).toBeTruthy();
    expect(screen.getByText("−1 video")).toBeTruthy();
    expect((screen.getByRole("button", { name: "← Newer" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole("button", { name: "Older →" }));
    expect(await screen.findByText("Video pack")).toBeTruthy();
    expect(screen.getByText("+3 videos")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Older →" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole("button", { name: "← Newer" }));
    expect(await screen.findByText("Story video")).toBeTruthy();
    expect(calls.map((c) => c.path)).toEqual([
      "/v1/account/ledger",
      "/v1/account/ledger?before=40",
      "/v1/account/ledger",
    ]);
  });

  it("says when there is nothing yet", async () => {
    mockApi({ "GET /v1/account/ledger": { body: { entries: [], next: null } } });
    render(<LedgerTable />);
    expect(await screen.findByText("No purchases or videos yet.")).toBeTruthy();
  });
});
