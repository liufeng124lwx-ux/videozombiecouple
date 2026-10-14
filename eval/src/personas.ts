// Synthetic eval subjects: AI-generated people (no real photos), diverse on purpose.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type Kind = "human" | "pet";
export type Pair = { id: string; kind: Kind; survivor: string; infected: string };

export const PERSONAS: { id: string; kind: Kind; survivor: string; infected: string }[] = [
  { id: "p01", kind: "human", survivor: "East Asian man in his late 20s, short black hair", infected: "East Asian woman in her late 20s, shoulder-length black hair" },
  { id: "p02", kind: "human", survivor: "Black woman in her 30s, natural curly hair", infected: "Black man in his 30s, short fade haircut and a beard" },
  { id: "p03", kind: "human", survivor: "white man in his 20s, messy blond hair", infected: "white woman in her 20s, long red hair" },
  { id: "p04", kind: "human", survivor: "South Asian woman in her 30s, long dark braid", infected: "South Asian man in his 30s, glasses and short hair" },
  { id: "p05", kind: "human", survivor: "Latina woman in her 20s, wavy brown hair", infected: "Latino man in his 20s, buzz cut" },
  { id: "p06", kind: "human", survivor: "Middle Eastern man in his 40s, salt-and-pepper beard", infected: "Middle Eastern woman in her 40s wearing a hijab" },
  { id: "p07", kind: "human", survivor: "white woman in her 50s, short grey bob", infected: "white man in his 50s, completely bald" },
  { id: "p08", kind: "human", survivor: "Black man in his 20s, long locs", infected: "East Asian woman in her 20s, pink dyed bob" },
  { id: "p09", kind: "human", survivor: "white woman in her 30s with freckles and a ponytail", infected: "white woman in her 30s with a short pixie cut" },
  { id: "p10", kind: "human", survivor: "Southeast Asian man in his 30s, undercut hairstyle", infected: "Southeast Asian man in his 30s, curly hair" },
  { id: "q01", kind: "pet", survivor: "white woman in her 30s, long brown hair", infected: "orange tabby cat" },
  { id: "q02", kind: "pet", survivor: "Black man in his 30s, short hair", infected: "golden retriever dog" },
];

export function portraitPrompt(desc: string, isAnimal: boolean): string {
  return isAnimal
    ? `Photorealistic smartphone photo of a ${desc}, facing the camera, head and shoulders, neutral indoor background, natural light, single animal, no text.`
    : `Photorealistic smartphone portrait photo of a ${desc}, facing the camera, head and shoulders, neutral indoor background, natural light, single person, no text.`;
}

export async function loadPairs(evalDir: string): Promise<Pair[]> {
  return JSON.parse(await readFile(join(evalDir, "data", "pairs.json"), "utf8"));
}
