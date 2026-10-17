import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import satori from "satori";
import sharp from "sharp";
/** Two frames of one couple: the cold standoff and the warm memory. */
export type Sample = { before: string; after: string };

export const OG_SIZE = { width: 1200, height: 630 } as const;
export type OgLabels = { before: string; after: string };
type Node = { type: string; props: Record<string, unknown> };

const node = (
  type: string,
  style: Record<string, unknown>,
  children?: unknown,
  attrs = {},
): Node => ({
  type,
  props: { style, children, ...attrs },
});

const PHOTO_WIDTH = 378;
/** Words longer than this ("CHRISTMAS", "HALLOWEEN") overflow the text column at 64px. */
const LONG_WORD = 8;
const longestWord = (title: string) => Math.max(...title.split(/\s+/).map((w) => w.length));
const TEXT_WIDTH = OG_SIZE.width - 2 * PHOTO_WIDTH - 4;

/** Share card: the cold standoff and the warm memory split by the ember cut, then the page name. */
export function ogTree(
  title: string,
  photos: { before: string; after: string } | null,
  labels: OgLabels,
): Node {
  const brand = node(
    "div",
    { display: "flex", fontSize: 24, fontWeight: 700, letterSpacing: 2, color: "#8C9DAE" },
    "VIDEOZOMBIECOUPLE",
  );
  const name = node(
    "div",
    {
      fontSize: photos ? (longestWord(title) > LONG_WORD ? 50 : 64) : 96,
      lineHeight: 0.95,
      letterSpacing: -1.5,
      textTransform: "uppercase",
    },
    title,
  );
  const text = node(
    "div",
    {
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      width: photos ? TEXT_WIDTH : OG_SIZE.width,
      height: OG_SIZE.height,
      padding: 56,
      background: "#0B0F14",
      color: "#E6ECF2",
      fontWeight: 800,
    },
    [brand, name],
  );
  const root = {
    display: "flex",
    width: OG_SIZE.width,
    height: OG_SIZE.height,
    fontFamily: "Archivo",
  };
  if (!photos) return node("div", root, [text]);
  const half = (src: string, label: string) =>
    node(
      "div",
      { display: "flex", position: "relative", width: PHOTO_WIDTH, height: OG_SIZE.height },
      [
        node("img", { width: PHOTO_WIDTH, height: OG_SIZE.height, objectFit: "cover" }, undefined, {
          src,
          width: PHOTO_WIDTH,
          height: OG_SIZE.height,
        }),
        node(
          "div",
          {
            position: "absolute",
            top: 20,
            left: 20,
            padding: "6px 14px",
            borderRadius: 2,
            background: "rgba(11,15,20,0.72)",
            color: "#E6ECF2",
            fontSize: 22,
            fontWeight: 700,
            textTransform: "uppercase",
          },
          label,
        ),
      ],
    );
  return node("div", root, [
    half(photos.before, labels.before),
    node("div", { width: 4, height: OG_SIZE.height, background: "#F0A040" }),
    half(photos.after, labels.after),
    text,
  ]);
}

const require = createRequire(import.meta.url);
const font = (weight: 700 | 800) =>
  readFileSync(require.resolve(`@fontsource/archivo/files/archivo-latin-${weight}-normal.woff`));
const dataUrl = (file: string) => `data:image/jpeg;base64,${readFileSync(file).toString("base64")}`;

/** Runs at build time (and in tests) with apps/web as the working directory. */
export const SAMPLE_DIR = join(process.cwd(), "src/assets/samples");

export async function renderOg(
  title: string,
  sample: Sample | null,
  labels: OgLabels,
  dir = SAMPLE_DIR,
): Promise<Uint8Array<ArrayBuffer>> {
  const photos = sample
    ? { before: dataUrl(join(dir, sample.before)), after: dataUrl(join(dir, sample.after)) }
    : null;
  const svg = await satori(ogTree(title, photos, labels) as never, {
    ...OG_SIZE,
    fonts: [
      { name: "Archivo", data: font(800), weight: 800, style: "normal" },
      { name: "Archivo", data: font(700), weight: 700, style: "normal" },
    ],
  });
  const png = new Resvg(svg).render().asPng();
  return new Uint8Array(await sharp(png).jpeg({ quality: 82, mozjpeg: true }).toBuffer());
}
