import type { LocaleId } from "@vzc/catalog";
import { en } from "./en.ts";
import { es } from "./es.ts";
import { fr } from "./fr.ts";
import { type Messages, registerMessages } from "./index.ts";
import { pt } from "./pt.ts";

/** Every locale's strings. Build-time only: importing this from an island ships all of them. */
export const MESSAGES: Record<LocaleId, Messages> = { en, es, pt, fr };

for (const [locale, messages] of Object.entries(MESSAGES))
  registerMessages(locale as LocaleId, messages);
