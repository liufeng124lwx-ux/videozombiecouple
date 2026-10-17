import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { makeHref } from "@vzc/catalog";
import { type StoryView, UPLOAD_CONSENT_VERSION } from "@vzc/contracts";
import { errorMessage, t } from "@vzc/i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api.ts";

const client = vi.hoisted(() => ({
  uploadPhoto: vi.fn(async () => "in/K.jpg"),
  createPhoto: vi.fn(async () => "P1"),
  getStory: vi.fn(),
  newIdempotencyKey: () => "key-12345678",
}));
vi.mock("../../lib/story/client.ts", () => client);
vi.mock("../../lib/story/prepare.ts", () => ({
  preparePhoto: vi.fn(async () => ({
    ok: true,
    jpeg: new Blob(["j"]),
    width: 900,
    height: 1200,
    face: "ok",
  })),
}));
vi.mock("../../lib/turnstile.ts", () => ({ getToken: async () => "tok" }));

import PhotoTool from "./PhotoTool.tsx";

const view = (status: StoryView["status"], over: Partial<StoryView> = {}): StoryView => ({
  id: "P1",
  status,
  kind: "human",
  story: "zombie",
  scene: "cabin-wheat",
  names: null,
  date: null,
  preview: null,
  video: null,
  photo: null,
  progress: { done: 1, total: 3, etaMs: 40_000 },
  errorCode: null,
  recomposeLeft: 0,
  videoAttempts: 0,
  remakeLeft: 0,
  createdAt: 0,
  ...over,
});

function choose() {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, {
    target: { files: [new File(["x"], "me.jpg", { type: "image/jpeg" })] },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  URL.createObjectURL = () => "blob:x";
});

describe("PhotoTool (the free AI zombie filter)", () => {
  it("needs consent and a photo, then shows the zombie photo with a download and the film", async () => {
    client.getStory
      .mockResolvedValueOnce(view("previewing"))
      .mockResolvedValue(view("done", { photo: "https://r2/out/P1/zombie.jpg" }));
    render(<PhotoTool pollMs={5} />);
    const go = screen.getByRole("button", { name: "Make my zombie photo" }) as HTMLButtonElement;
    choose();
    await new Promise((r) => setTimeout(r, 10));
    expect(go.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: /I'm .* or older/ }));
    await waitFor(() => expect(go.disabled).toBe(false));
    fireEvent.click(go);
    const img = (await screen.findByAltText("Your AI zombie photo")) as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("https://r2/out/P1/zombie.jpg");
    expect(client.createPhoto).toHaveBeenCalledWith(
      { photoKey: "in/K.jpg", consent: UPLOAD_CONSENT_VERSION, idempotencyKey: "key-12345678" },
      expect.any(Function),
    );
    expect(screen.getByRole("link", { name: /Download/ }).getAttribute("href")).toBe(
      "https://r2/out/P1/zombie.jpg",
    );
    // The film is made on the featured story's page (showcase spec §5a), not on the home page.
    expect(screen.getByRole("link", { name: /Make the film/ }).getAttribute("href")).toBe(
      makeHref(Date.now()),
    );
  });

  it("says when today's free photo is used", async () => {
    client.createPhoto.mockRejectedValueOnce(new ApiError("DAILY_LIMIT"));
    render(<PhotoTool pollMs={5} />);
    choose();
    fireEvent.click(screen.getByRole("checkbox", { name: /I'm .* or older/ }));
    const go = screen.getByRole("button", { name: "Make my zombie photo" }) as HTMLButtonElement;
    await waitFor(() => expect(go.disabled).toBe(false));
    fireEvent.click(go);
    expect((await screen.findByRole("alert")).textContent).toBe(t("photo.dailyLimit"));
  });

  it("explains a refused photo (nothing was made)", async () => {
    client.getStory.mockResolvedValue(view("preview_failed", { errorCode: "UNDERAGE" }));
    render(<PhotoTool pollMs={5} />);
    choose();
    fireEvent.click(screen.getByRole("checkbox", { name: /I'm .* or older/ }));
    const go = screen.getByRole("button", { name: "Make my zombie photo" }) as HTMLButtonElement;
    await waitFor(() => expect(go.disabled).toBe(false));
    fireEvent.click(go);
    expect((await screen.findByRole("alert")).textContent).toBe(errorMessage("UNDERAGE"));
  });
});
