/**
 * Spec 2.2: numbers about the product come from the catalog: `<F k="…" />` in MDX bodies and
 * `{{key}}` in frontmatter. A digit next to a product unit anywhere else is hand-written.
 * "4K" is a name, not a number, so a bare K is not a unit here. "Two photos" is how the product
 * works, not a price or a limit, so photos are not a unit either.
 */
const CLAIM =
  /\$\s?\d|\d[\d,.]*\s*(%|credits?\b|free\b|videos?\b|previews?\b|films?\b|packs?\b|candidates?\b|a day\b|a month\b|per\b|hours?\b|h\b|days?\b|minutes?\b|seconds?\b|s\b|mb\b|kb\b|megapixels?\b|px\b|files?\b)/i;

export function handWrittenNumbers(source: string): string[] {
  const text = source.replace(/<F\s+k="[^"]+"\s*\/>/g, "").replace(/\{\{\s*[\w.]+\s*\}\}/g, "");
  return text.split("\n").filter((line) => CLAIM.test(line));
}
