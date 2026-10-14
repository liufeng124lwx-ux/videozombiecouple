import { getImage } from "astro:assets";

const files = import.meta.glob<{ default: ImageMetadata }>("../assets/samples/*.jpg", {
  eager: true,
});

export type Responsive = {
  src: string;
  srcset: string;
  sizes: string;
  width: number;
  height: number;
};

function source(name: string): ImageMetadata {
  const found = Object.entries(files).find(([path]) => path.endsWith(`/${name}`));
  if (!found) throw new Error(`No sample image ${name}`);
  return found[1].default;
}

/** AVIF in a few widths (build time, via astro:assets); `sizes` describes the slot it fills. */
export async function sampleImage(
  name: string,
  sizes: string,
  widths: number[] = [360, 540, 720],
): Promise<Responsive> {
  const src = source(name);
  const usable = widths.filter((w) => w <= src.width);
  const images = await Promise.all(
    usable.map((width) => getImage({ src, width, format: "avif", quality: 58 })),
  );
  const last = images[images.length - 1];
  if (!last) throw new Error(`Sample ${name} is smaller than every width`);
  return {
    src: last.src,
    srcset: images.map((img, i) => `${img.src} ${usable[i]}w`).join(", "),
    sizes,
    width: 720,
    height: 1280,
  };
}
