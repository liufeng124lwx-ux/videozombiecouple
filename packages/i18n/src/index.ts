import { fact, type LocaleId } from "@vzc/catalog";
import { en } from "./en.ts";

export type MessageKey = keyof typeof en;
type Messages = Record<MessageKey, string>;
type Params = Record<string, string | number>;

/** Spec 2.3: a locale with a live page must be listed here with every key, or the build fails. */
const MESSAGES: Partial<Record<LocaleId, Messages>> = { en };

export function hasMessages(locale: LocaleId): boolean {
  return MESSAGES[locale] !== undefined;
}

export function t(key: MessageKey, params: Params = {}, locale: LocaleId = "en"): string {
  const messages = MESSAGES[locale];
  if (!messages) throw new Error(`No UI messages for ${locale}`);
  return messages[key].replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/** The message for an API error code (or "NETWORK"), with catalog numbers filled in. */
export function errorMessage(code: string, params: Params = {}, locale: LocaleId = "en"): string {
  const key = `error.${code}`;
  const known: MessageKey = key in en ? (key as MessageKey) : "error.INTERNAL";
  return t(known, { maxMb: fact("file.maxMb"), ...params }, locale);
}

export { en };
