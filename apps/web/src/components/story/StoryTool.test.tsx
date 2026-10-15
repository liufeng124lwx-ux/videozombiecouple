import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import type { StoryView } from "@vzc/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api.ts";

const client = vi.hoisted(() => ({
  uploadPhoto: vi.fn(async () => "in/K.jpg"),
  createStory: vi.fn(async () => "S1"),
  getStory: vi.fn(),
  getSharedFilm: vi.fn(),
  render: vi.fn(async () => undefined),
  recompose: vi.fn(async () => undefined),
  getQuota: vi.fn(async () => ({ remaining: 3, limit: 3, resetAt: 0 })),
  newIdempotencyKey: () => "key-12345678",
}));
const me = vi.hoisted(() => ({ user: { id: "u1" } as unknown, credits: 0 }));
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
vi.mock("../../lib/me.ts", () => ({
  loadMe: async () => ({ user: me.user, credits: me.credits }),
  refreshMe: async () => ({ user: me.user, credits: me.credits }),
}));
vi.mock("../../lib/turnstile.ts", () => ({ getToken: async () => "tok" }));
vi.mock("../pricing/PackRows.tsx", () => ({
  default: (p: { returnPath: string }) => <div data-testid="packs">{p.returnPath}</div>,
}));

import StoryTool from "./StoryTool.tsx";

const view = (status: StoryView["status"], over: Partial<StoryView> = {}): StoryView => ({
  id: "S1",
  status,
  kind: "human",
  scene: "cabin-wheat",
  names: null,
  date: null,
  preview: null,
  video: null,
  progress: { done: 1, total: 5, etaMs: 60_000 },
  errorCode: null,
  recomposeLeft: 1,
  videoAttempts: 0,
  createdAt: 0,
  ...over,
});

function addPhotos() {
  const inputs = document.querySelectorAll<HTMLInputElement>('input[type="file"]');
  for (const input of inputs)
    fireEvent.change(input, {
      target: { files: [new File(["x"], "a.jpg", { type: "image/jpeg" })] },
    });
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  me.user = { id: "u1" };
  me.credits = 0;
  history.replaceState(null, "", "/");
  URL.createObjectURL = () => "blob:x";
});

describe("StoryTool", () => {
  it("makes a free preview from two photos, then asks for a pack when there are no credits", async () => {
    client.getStory.mockResolvedValue(
      view("preview_ready", { preview: { A: "https://r2/a.jpg", C: "https://r2/c.jpg" } }),
    );
    client.render.mockRejectedValueOnce(new ApiError("CREDITS_LOW"));
    render(<StoryTool posters={{}} pollMs={10} />);
    addPhotos();
    const go = await screen.findByRole("button", { name: "Get my free preview" });
    await waitFor(() => expect((go as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(go);
    await screen.findByText("Does this look like you?");
    expect(client.uploadPhoto).toHaveBeenCalledTimes(2);
    expect(client.createStory).toHaveBeenCalledWith(
      expect.objectContaining({ survivorKey: "in/K.jpg", kind: "human", scene: "cabin-wheat" }),
      expect.any(Function),
    );
    fireEvent.click(screen.getByRole("button", { name: /Make the film/ }));
    const packs = await screen.findByTestId("packs");
    // After checkout the buyer comes back to this story and the film starts by itself.
    expect(packs.textContent).toBe("/story?id=S1&render=1");
  });

  it("buys a pack then renders on return", async () => {
    history.replaceState(null, "", "/story?id=S1&render=1");
    client.getStory.mockResolvedValue(view("preview_ready", { preview: { A: "a", C: "c" } }));
    render(<StoryTool posters={{}} mode="story" pollMs={10} />);
    await waitFor(() =>
      expect(client.render).toHaveBeenCalledWith("S1", expect.any(String), expect.any(Function)),
    );
  });

  it("after checkout waits for the payment's credits instead of offering packs again", async () => {
    history.replaceState(null, "", "/story?id=S1&render=1");
    sessionStorage.setItem("upx-checkout", JSON.stringify({ credits: 0, at: Date.now() }));
    client.getStory.mockResolvedValue(view("preview_ready", { preview: { A: "a", C: "c" } }));
    client.render.mockRejectedValueOnce(new ApiError("CREDITS_LOW"));
    render(<StoryTool posters={{}} mode="story" pollMs={10} />);
    await screen.findByText("Confirming your payment…");
    expect(screen.queryByTestId("packs")).toBeNull();
    me.credits = 10;
    await waitFor(() => expect(client.render).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId("packs")).toBeNull();
    expect(sessionStorage.getItem("upx-checkout")).toBeNull();
  });

  it("makes a failed film again from the same preview", async () => {
    localStorage.setItem("vzc-story", "S1");
    client.getStory.mockResolvedValue(
      view("failed", {
        errorCode: "COMPOSE_FAILED",
        videoAttempts: 1,
        preview: { A: "a", C: "c" },
      }),
    );
    render(<StoryTool posters={{}} pollMs={10} />);
    fireEvent.click(await screen.findByRole("button", { name: "Make it again" }));
    await waitFor(() =>
      expect(client.render).toHaveBeenCalledWith("S1", expect.any(String), expect.any(Function)),
    );
    expect(client.createStory).not.toHaveBeenCalled();
  });

  it("shows a shared film read-only to anyone with the link", async () => {
    history.replaceState(null, "", `/story?id=S1&t=${"a".repeat(32)}`);
    client.getSharedFilm.mockResolvedValue({
      scene: "cabin-wheat",
      names: "Ana & Leo",
      date: null,
      video: { url: "https://f/v.mp4", poster: "https://f/p.jpg", expiresAt: 0 },
    });
    render(<StoryTool posters={{}} mode="story" pollMs={10} />);
    await screen.findByText("Ana & Leo");
    expect(document.querySelector("video")?.getAttribute("src")).toBe("https://f/v.mp4");
    expect(screen.getByRole("link", { name: "Make your own" }).getAttribute("href")).toBe("/");
    expect(client.getStory).not.toHaveBeenCalled();
  });

  it("shares the film's public link", async () => {
    localStorage.setItem("vzc-story", "S1");
    client.getStory.mockResolvedValue(
      view("done", {
        preview: { A: "a", C: "c" },
        video: { url: "v", poster: "p", expiresAt: 0 },
        shareToken: "b".repeat(32),
      }),
    );
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText }, share: undefined });
    render(<StoryTool posters={{}} pollMs={10} />);
    fireEvent.click(await screen.findByRole("button", { name: "Share" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(`${location.origin}/story?id=S1&t=${"b".repeat(32)}`),
    );
  });

  it("masks the whole tool from session recordings (photos, frames, film)", async () => {
    const { container } = render(<StoryTool posters={{}} pollMs={10} />);
    expect(container.firstElementChild?.getAttribute("data-clarity-mask")).toBe("true");
  });

  it("scene tiles show each scene's film clip", async () => {
    const posters = { "cabin-wheat": { still: "/s.jpg", clip: "/c.mp4" } };
    const { container } = render(<StoryTool posters={posters} pollMs={10} />);
    const clip = container.querySelector(".scene-tile video") as HTMLVideoElement;
    expect(clip.getAttribute("src")).toBe("/c.mp4");
    expect(clip.getAttribute("poster")).toBe("/s.jpg");
  });

  it("resumes a running story after reload", async () => {
    localStorage.setItem("vzc-story", "S1");
    client.getStory.mockResolvedValue(view("rendering", { preview: { A: "a", C: "c" } }));
    render(<StoryTool posters={{}} pollMs={10} />);
    await screen.findByText("Rolling camera");
    expect(client.createStory).not.toHaveBeenCalled();
  });

  it("shows a refund message when the video fails", async () => {
    localStorage.setItem("vzc-story", "S1");
    client.getStory.mockResolvedValue(
      view("failed", {
        errorCode: "COMPOSE_FAILED",
        videoAttempts: 1,
        preview: { A: "a", C: "c" },
      }),
    );
    render(<StoryTool posters={{}} pollMs={10} />);
    await screen.findByText(/went back to your balance/);
    expect(screen.getByRole("button", { name: "Make it again" })).toBeTruthy();
  });

  it("asks guests to sign in before the preview", async () => {
    me.user = null;
    const opened = vi.fn();
    window.addEventListener("upx:open-signin", opened);
    render(<StoryTool posters={{}} pollMs={10} />);
    addPhotos();
    const go = await screen.findByRole("button", { name: "Get my free preview" });
    await waitFor(() => expect((go as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(go);
    await waitFor(() => expect(opened).toHaveBeenCalled());
    expect(client.uploadPhoto).not.toHaveBeenCalled();
  });

  it("locks the swap in the pet version", async () => {
    render(<StoryTool posters={{}} pollMs={10} />);
    fireEvent.click(screen.getByRole("radio", { name: "With a pet" }));
    expect(
      (screen.getByRole("button", { name: "Swap who turns" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText("The pet who turns")).toBeTruthy();
  });
});
