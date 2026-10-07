// SPEC §4.2 i18n: Papiamento by default; the choice lives in a cookie (no URL prefix, so
// links and the offline cache stay simple).
import { UI_LANGUAGES, type UiLanguage } from '@rocan/core';

export const LOCALES = UI_LANGUAGES;
export const DEFAULT_LOCALE: UiLanguage = 'pap';
export const LOCALE_COOKIE = 'NEXT_LOCALE';
export const TIME_ZONE = 'America/Aruba';

export function isLocale(v: unknown): v is UiLanguage {
  return typeof v === 'string' && (LOCALES as readonly string[]).includes(v);
}
