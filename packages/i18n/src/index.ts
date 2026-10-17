import { FILE_LIMITS, LOCALE_IDS, type LocaleId, sceneLabel } from "@vzc/catalog";
import { en } from "./en.ts";

export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;
type Params = Record<string, string | number>;

/**
 * Spec 2.3: a locale with a live page must have every key, or the build fails. Only English ships
 * in the browser bundle; the build registers the rest (src/all.ts), and a translated page carries
 * its own strings as `__vzcMessages` (BaseLayout.astro).
 */
const MESSAGES: Partial<Record<LocaleId, Messages>> = { en };

export function registerMessages(locale: LocaleId, messages: Messages): void {
  MESSAGES[locale] = messages;
}

const isLocaleId = (value: string | undefined): value is LocaleId =>
  (LOCALE_IDS as readonly string[]).includes(value ?? "");

const pageLang = (): string | undefined =>
  (globalThis as { document?: { documentElement?: { lang?: string } } }).document?.documentElement
    ?.lang;

let renderLocale: LocaleId = "en";

/** The build renders one page at a time: each page sets its locale before rendering. */
export function setLocale(locale: LocaleId): void {
  renderLocale = locale;
}

/** The locale of the page: `<html lang>` in the browser, the page being rendered at build time. */
export function currentLocale(): LocaleId {
  const lang = pageLang();
  return isLocaleId(lang) ? lang : renderLocale;
}

/** A path to a translated page, in the page's language: "/story?id=1" → "/es/story?id=1". */
export function localePath(path: string, locale: LocaleId = currentLocale()): string {
  if (locale === "en") return path;
  return path === "/" ? `/${locale}` : `/${locale}${path}`;
}

function messagesFor(locale: LocaleId): Messages | undefined {
  const known = MESSAGES[locale];
  if (known) return known;
  const fromPage = (globalThis as { __vzcMessages?: Messages }).__vzcMessages;
  return fromPage && pageLang() === locale ? fromPage : undefined;
}

export function hasMessages(locale: LocaleId): boolean {
  return messagesFor(locale) !== undefined;
}

export function t(
  key: MessageKey,
  params: Params = {},
  locale: LocaleId = currentLocale(),
): string {
  // In the browser a missing translation shows English rather than breaking the tool.
  const messages = messagesFor(locale) ?? (pageLang() !== undefined ? en : undefined);
  if (!messages) throw new Error(`No UI messages for ${locale}`);
  return messages[key].replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/** A scene's name in the page's language ("scene.<id>"), else the catalog's English label. */
export function sceneName(scene: string, locale: LocaleId = currentLocale()): string {
  const key = `scene.${scene}`;
  return key in en ? t(key as MessageKey, {}, locale) : sceneLabel(scene);
}

/** The message for an API error code (or "NETWORK"), with catalog numbers filled in. */
export function errorMessage(
  code: string,
  params: Params = {},
  locale: LocaleId = currentLocale(),
): string {
  const key = `error.${code}`;
  const known: MessageKey = key in en ? (key as MessageKey) : "error.INTERNAL";
  return t(known, { maxMb: Math.round(FILE_LIMITS.maxBytes / 1_000_000), ...params }, locale);
}

export { en };
