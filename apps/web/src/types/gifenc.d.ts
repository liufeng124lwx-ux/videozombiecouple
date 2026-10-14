declare module "gifenc/dist/gifenc.esm.js" {
  type Format = "rgb565" | "rgb444" | "rgba4444";
  export type Palette = number[][];
  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: { format?: Format; oneBitAlpha?: boolean | number },
  ): Palette;
  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: Palette,
    format?: Format,
  ): Uint8Array;
  export interface Encoder {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      options?: {
        palette?: Palette;
        delay?: number;
        transparent?: boolean;
        transparentIndex?: number;
        dispose?: number;
        repeat?: number;
      },
    ): void;
    finish(): void;
    bytes(): Uint8Array;
  }
  export function GIFEncoder(options?: { auto?: boolean; initialCapacity?: number }): Encoder;
}
