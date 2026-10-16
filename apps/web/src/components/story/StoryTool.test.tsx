import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { fact } from "@vzc/catalog";
import { type StoryView, UPLOAD_CONSENT_VERSION } from "@vzc/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api.ts";

const client = vi.hoisted(() => ({
  uploadPhoto: vi.fn(async () => "in/K.jpg"),
  createStory: vi.fn(async () => "S1"),
  getStory: vi.fn(),
  getSharedFilm: vi.fn(),
  render: vi.fn(async () => undefined),
  guestSignUp: vi.fn(async () => {
    me.user = { id: "g1", verified: false };
  }),
  remake: vi.fn(async () => undefined),
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
  default: (p: { returnPath: string; story?: string }) => (
    <div data-testid="packs" data-story={p.story ?? ""}>
      {p.returnPath}
    </div>
  ),
}));

import StoryTool from "./StoryTool.tsx";

const view = (status: StoryView["status"], over: Partial<StoryView> = {}): StoryView => ({
  id: "S1",
  status,
  kind: "human",
  story: "zombie",
  scene: "cabin-wheat",
  names: null,
  date: null,
  preview: null,
  video: null,
  progress: { done: 1, total: 5, etaMs: 60_000 },
  errorCode: null,
  recomposeLeft: 1,
  videoAttempts: 0,
  remakeLeft: 1,
  createdAt: 0,
  ...over,
});

function agree() {
  fireEvent.click(screen.getByRole("checkbox", { name: /Both people in these photos are adults/ }));
}

function addPhotos({ consent = true } = {}) {
  if (consent) agree();
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
  it("checks the photos, then a signed-in member without videos picks a pack (nothing is free)", async () => {
    client.getStory.mockResolvedValue(view("preview_ready"));
    render(<StoryTool posters={{}} pollMs={10} />);
    addPhotos();
    const go = await screen.findByRole("button", { name: "Make my film" });
    await waitFor(() => expect((go as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(go);
    await screen.findByText("Your photos are ready");
    expect(client.uploadPhoto).toHaveBeenCalledTimes(2);
    expect(client.createStory).toHaveBeenCalledWith(
      expect.objectContaining({ survivorKey: "in/K.jpg", kind: "human", scene: "cabin-wheat" }),
      expect.any(Function),
    );
    const packs = await screen.findByTestId("packs");
    // After checkout the buyer comes back to this story and the film starts by itself.
    expect(packs.textContent).toBe("/story?id=S1&render=1");
    expect(client.render).not.toHaveBeenCalled();
  });

  it("cannot start until the uploader confirms both people agreed; sends the consent version", async () => {
    client.getStory.mockResolvedValue(view("preview_ready"));
    render(<StoryTool posters={{}} pollMs={10} />);
    addPhotos({ consent: false });
    const go = (await screen.findByRole("button", { name: "Make my film" })) as HTMLButtonElement;
    await new Promise((r) => setTimeout(r, 20));
    expect(go.disabled).toBe(true);
    const box = screen.getByRole("checkbox", { name: /Both people in these photos are adults/ });
    expect((box as HTMLInputElement).checked).toBe(false);
    expect(screen.getByRole("link", { name: "Biometric data notice" }).getAttribute("href")).toBe(
      "/privacy#biometric-data",
    );
    agree();
    await waitFor(() => expect(go.disabled).toBe(false));
    fireEvent.click(go);
    await waitFor(() =>
      expect(client.createStory).toHaveBeenCalledWith(
        expect.objectContaining({ consent: UPLOAD_CONSENT_VERSION }),
        expect.any(Function),
      ),
    );
  });

  it("a member with videos makes the film straight away", async () => {
    me.credits = 10;
    client.getStory.mockResolvedValue(view("preview_ready"));
    localStorage.setItem("vzc-story", "S1");
    render(<StoryTool posters={{}} pollMs={10} />);
    fireEvent.click(await screen.findByRole("button", { name: "Make the film" }));
    await waitFor(() => expect(client.render).toHaveBeenCalled());
  });

  it("a guest leaves an email, becomes the buyer, then picks a pack", async () => {
    me.user = null;
    client.getStory.mockResolvedValue(view("preview_ready"));
    localStorage.setItem("vzc-story", "S1");
    render(<StoryTool posters={{}} pollMs={10} />);
    const email = await screen.findByLabelText("Where should we send your film?");
    fireEvent.input(email, { target: { value: "new@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue to payment" }));
    await waitFor(() =>
      expect(client.guestSignUp).toHaveBeenCalledWith("new@example.com", expect.any(Function)),
    );
    await screen.findByTestId("packs");
  });

  it("an email that already has an account asks to sign in instead", async () => {
    me.user = null;
    client.guestSignUp.mockRejectedValueOnce(new ApiError("LOGIN_REQUIRED"));
    client.getStory.mockResolvedValue(view("preview_ready"));
    localStorage.setItem("vzc-story", "S1");
    const opened = vi.fn();
    window.addEventListener("upx:open-signin", opened);
    render(<StoryTool posters={{}} pollMs={10} />);
    fireEvent.input(await screen.findByLabelText("Where should we send your film?"), {
      target: { value: "known@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue to payment" }));
    await waitFor(() => expect(opened).toHaveBeenCalled());
    expect(screen.queryByTestId("packs")).toBeNull();
  });

  it("the finished film says when it is deleted and offers one free remake", async () => {
    localStorage.setItem("vzc-story", "S1");
    client.getStory.mockResolvedValue(
      view("done", {
        video: { url: "v", poster: "p", expiresAt: Date.UTC(2026, 9, 18) },
        remakeLeft: 1,
      }),
    );
    render(<StoryTool posters={{}} pollMs={10} />);
    await screen.findByText(/We delete your film on October 1[78]/);
    fireEvent.click(screen.getByRole("button", { name: /Remake it once for free/ }));
    await waitFor(() => expect(client.remake).toHaveBeenCalledWith("S1"));
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
      story: "zombie",
      video: { url: "https://f/v.mp4", poster: "https://f/p.jpg", expiresAt: 0 },
    });
    render(<StoryTool posters={{}} mode="story" pollMs={10} />);
    await screen.findByText("Ana & Leo");
    expect(document.querySelector("video")?.getAttribute("src")).toBe("https://f/v.mp4");
    expect(screen.getByRole("link", { name: "Make your own" }).getAttribute("href")).toBe("/");
    expect(client.getStory).not.toHaveBeenCalled();
  });

  it("shows a shared Christmas film as 50 Christmases and 32 seconds, never a zombie film", async () => {
    history.replaceState(null, "", `/story?id=S1&t=${"a".repeat(32)}`);
    client.getSharedFilm.mockResolvedValue({
      scene: "snow-cabin",
      names: "Ana & Leo",
      date: null,
      story: "christmas",
      video: { url: "https://f/v.mp4", poster: "https://f/p.jpg", expiresAt: 0 },
    });
    const { container } = render(<StoryTool posters={{}} mode="story" pollMs={10} />);
    await screen.findByText("50 Christmases");
    expect(container.textContent).toContain(`${fact("story.christmas.seconds")}-second`);
    expect(container.textContent?.toLowerCase()).not.toContain("zombie");
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

  it("while rendering: a monitor with the film's own stills, the real shot list, one progress bar", async () => {
    localStorage.setItem("vzc-story", "S1");
    client.getStory.mockResolvedValue(
      view("rendering", {
        progress: { done: 7, total: 13, etaMs: 150_000 },
        stages: [
          { id: "frames", state: "done" },
          { id: "shot:1", state: "done" },
          { id: "shot:2", state: "running" },
          { id: "shot:3", state: "waiting" },
          { id: "shot:4", state: "waiting" },
          { id: "shot:5", state: "waiting" },
          { id: "compose", state: "waiting" },
        ],
        frames: ["https://r2/kfA.jpg", "https://r2/kfC.jpg"],
      }),
    );
    const { container } = render(<StoryTool posters={{}} pollMs={10} />);
    await screen.findByText("Rolling camera");
    expect(screen.getAllByRole("progressbar")).toHaveLength(1);
    const stills = [...container.querySelectorAll<HTMLImageElement>(".monitor img")];
    expect(stills.map((i) => i.getAttribute("src"))).toEqual([
      "https://r2/kfA.jpg",
      "https://r2/kfC.jpg",
    ]);
    const rows = [...container.querySelectorAll(".shot-list li")];
    expect(rows.map((r) => r.getAttribute("data-state"))).toEqual([
      "done",
      "done",
      "running",
      "waiting",
      "waiting",
      "waiting",
      "waiting",
    ]);
    expect(rows[2]?.textContent).toContain("The trembling hand");
    expect(screen.getByText(/About 3 min left/)).toBeTruthy();
  });

  it("before any still is ready the monitor shows a slate, not empty boxes", async () => {
    localStorage.setItem("vzc-story", "S1");
    client.getStory.mockResolvedValue(view("rendering", { stages: [], frames: [] }));
    const { container } = render(<StoryTool posters={{}} pollMs={10} />);
    await screen.findByText("Rolling camera");
    expect(container.querySelector(".monitor .slate")).toBeTruthy();
    expect(container.querySelector(".waiting-frames")).toBeNull();
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

  it("locks the swap in the pet version", async () => {
    render(<StoryTool posters={{}} pollMs={10} />);
    fireEvent.click(screen.getByRole("radio", { name: "With a pet" }));
    expect(
      (screen.getByRole("button", { name: "Swap who turns" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText("Role: The pet who turns")).toBeTruthy();
  });

  describe("christmas", () => {
    const xmas = (status: StoryView["status"], over: Partial<StoryView> = {}) =>
      view(status, { story: "christmas", scene: "snow-cabin", ...over });

    it('sends story "christmas" and the chosen christmas scene on create', async () => {
      client.getStory.mockResolvedValue(xmas("preview_ready"));
      render(<StoryTool posters={{}} preset={{ story: "christmas" }} pollMs={10} />);
      fireEvent.click(screen.getByRole("radio", { name: /Old city flat/ }));
      addPhotos();
      const go = await screen.findByRole("button", { name: "Make my film" });
      await waitFor(() => expect((go as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(go);
      await waitFor(() =>
        expect(client.createStory).toHaveBeenCalledWith(
          expect.objectContaining({ story: "christmas", scene: "city-flat", kind: "human" }),
          expect.any(Function),
        ),
      );
    });

    it('scene picker lists the story\'s own scenes; farmhouse shows "soon" and is disabled', () => {
      render(<StoryTool posters={{}} preset={{ story: "christmas" }} pollMs={10} />);
      const tiles = screen.getAllByRole("radio").filter((r) => r.classList.contains("scene-tile"));
      expect(tiles.map((r) => r.querySelector(".scene-name")?.textContent)).toEqual([
        "Snowy cabin",
        "Old city flat",
        "Farmhouse",
      ]);
      const farm = tiles[2] as HTMLButtonElement;
      expect(farm.disabled).toBe(true);
      expect(farm.classList.contains("soon")).toBe(true);
      expect(farm.textContent).toContain("Soon");
      expect(tiles[0]?.getAttribute("aria-checked")).toBe("true");
    });

    it("has no pet version and casts you and your partner", () => {
      render(<StoryTool posters={{}} preset={{ story: "christmas" }} pollMs={10} />);
      expect(screen.queryByRole("radio", { name: "With a pet" })).toBeNull();
      expect(screen.getByText("Role: You")).toBeTruthy();
      expect(screen.getByText("Role: Your partner")).toBeTruthy();
    });

    it("needs the story's credits, not a zombie video's", async () => {
      me.credits = 10;
      client.getStory.mockResolvedValue(xmas("preview_ready"));
      localStorage.setItem("vzc-story", "S1");
      render(<StoryTool posters={{}} pollMs={10} />);
      const packs = await screen.findByTestId("packs");
      expect(packs.getAttribute("data-story")).toBe("christmas");
      expect(screen.queryByRole("button", { name: "Make the film" })).toBeNull();
      expect(client.render).not.toHaveBeenCalled();
    });

    it("enough credits for the story makes the film straight away", async () => {
      me.credits = 20;
      client.getStory.mockResolvedValue(xmas("preview_ready"));
      localStorage.setItem("vzc-story", "S1");
      render(<StoryTool posters={{}} pollMs={10} />);
      fireEvent.click(await screen.findByRole("button", { name: "Make the film" }));
      await waitFor(() => expect(client.render).toHaveBeenCalled());
    });

    it("christmas stages have their own labels", async () => {
      localStorage.setItem("vzc-story", "S1");
      const ids = ["frames", "shot:1", "shot:2", "shot:3", "shot:5", "shot:6", "shot:7", "shot:8"];
      client.getStory.mockResolvedValue(
        xmas("rendering", {
          stages: [...ids, "compose"].map((id) => ({ id, state: "waiting" as const })),
        }),
      );
      const { container } = render(<StoryTool posters={{}} pollMs={10} />);
      await screen.findByText("Rolling camera");
      const names = [...container.querySelectorAll(".shot-list li .name")].map(
        (n) => n.textContent,
      );
      expect(names).toHaveLength(9);
      expect(new Set(names).size).toBe(9);
      expect(names[4]).not.toBe("First light");
    });

    it("film length comes from the story", async () => {
      localStorage.setItem("vzc-story", "S1");
      client.getStory.mockResolvedValue(xmas("rendering"));
      const { container } = render(<StoryTool posters={{}} pollMs={10} />);
      await screen.findByText("Rolling camera");
      const secs = fact("story.christmas.seconds");
      expect(container.querySelector(".monitor .tc")?.textContent).toContain(`/ 00:${secs}`);
    });

    it("the ready screen tells the story's length", async () => {
      client.getStory.mockResolvedValue(xmas("preview_ready"));
      localStorage.setItem("vzc-story", "S1");
      render(<StoryTool posters={{}} pollMs={10} />);
      await screen.findByText(new RegExp(`${fact("story.christmas.seconds")}-second film`));
    });

    it("christmas download is named our-christmas-film.mp4", async () => {
      localStorage.setItem("vzc-story", "S1");
      client.getStory.mockResolvedValue(
        xmas("done", { video: { url: "v", poster: "p", expiresAt: 0 } }),
      );
      render(<StoryTool posters={{}} pollMs={10} />);
      const link = await screen.findByRole("link", { name: "Download the video" });
      expect(link.getAttribute("download")).toBe("our-christmas-film.mp4");
      const writeText = vi.fn(async () => undefined);
      Object.assign(navigator, { clipboard: { writeText }, share: undefined });
      fireEvent.click(screen.getByRole("button", { name: "Copy caption" }));
      expect(writeText).toHaveBeenCalledWith(`Our ${fact("story.christmas.years")}th Christmas.`);
    });
  });
});
