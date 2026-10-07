import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';
import { parse } from 'yaml';

export const ROOT = join(import.meta.dirname, '..');
export const LANGS = ['pap', 'nl', 'en', 'es'] as const;
export type Lang = (typeof LANGS)[number];

export function messages(lang: Lang) {
  return JSON.parse(readFileSync(join(ROOT, `apps/web/messages/${lang}.json`), 'utf8'));
}

const categories = parse(readFileSync(join(ROOT, 'config/categories.yaml'), 'utf8')).categories as {
  code: string;
  name: Record<Lang, string>;
}[];

export function categoryName(code: string, lang: Lang): string {
  return categories.find((c) => c.code === code)!.name[lang];
}

export const FIXTURES = {
  tyres: join(ROOT, 'fixtures/images/dumped-tyres.jpg'),
  turtle: join(ROOT, 'fixtures/images/turtle-nest.png'),
  reef: join(ROOT, 'fixtures/images/reef-damage.webp'),
};

/** Each test acts as its own connection (TRUST_PROXY=1), so rate limits don't collide. */
export function uniqueIp(): string {
  const n = () => Math.floor(Math.random() * 250) + 1;
  return `10.${n()}.${n()}.${n()}`;
}

export async function asNewClient(
  page: Page,
  context: BrowserContext,
  lang: Lang,
  baseURL: string,
) {
  await context.addCookies([{ name: 'NEXT_LOCALE', value: lang, url: baseURL }]);
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': uniqueIp() });
}
