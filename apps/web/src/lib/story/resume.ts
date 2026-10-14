/** The story this browser is working on, so a reload or a trip to checkout comes back to it. */
const STORY = "vzc-story";
const RENDER = "vzc-render:";

export function rememberStory(id: string): void {
  try {
    localStorage.setItem(STORY, id);
  } catch {}
}

export function rememberedStory(): string | null {
  try {
    return localStorage.getItem(STORY);
  } catch {
    return null;
  }
}

export function forgetStory(): void {
  try {
    localStorage.removeItem(STORY);
  } catch {}
}

/** One render key per story: a retry after checkout or a double click charges once. */
export function renderKey(storyId: string, make: () => string): string {
  try {
    const saved = localStorage.getItem(RENDER + storyId);
    if (saved) return saved;
    const key = make();
    localStorage.setItem(RENDER + storyId, key);
    return key;
  } catch {
    return make();
  }
}
