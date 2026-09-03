import type { I18nKey } from "@/i18n";

export const LANGUAGES = [
	{ code: "en", name: "English", nameKey: "lang.en" },
	{ code: "es", name: "Spanish", nameKey: "lang.es" },
	{ code: "it", name: "Italian", nameKey: "lang.it" },
	{ code: "fr", name: "French", nameKey: "lang.fr" },
	{ code: "de", name: "German", nameKey: "lang.de" },
	{ code: "pt", name: "Portuguese", nameKey: "lang.pt" },
	{ code: "ru", name: "Russian", nameKey: "lang.ru" },
	{ code: "ja", name: "Japanese", nameKey: "lang.ja" },
	{ code: "zh", name: "Chinese", nameKey: "lang.zh" },
] as const;

export type Language = (typeof LANGUAGES)[number];
export type LanguageCode = Language["code"];
