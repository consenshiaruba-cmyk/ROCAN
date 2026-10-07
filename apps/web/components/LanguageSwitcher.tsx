'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LOCALES, LOCALE_COOKIE } from '../i18n/config';

export function LanguageSwitcher({ current }: { current: string }) {
  const t = useTranslations('common');
  const router = useRouter();
  return (
    <label>
      <span className="visually-hidden">{t('language')}</span>
      <select
        className="lang-select"
        value={current}
        data-testid="language"
        onChange={(e) => {
          document.cookie = `${LOCALE_COOKIE}=${e.target.value}; path=/; max-age=31536000; samesite=lax`;
          router.refresh();
        }}
      >
        {LOCALES.map((l) => (
          <option key={l} value={l} lang={l}>
            {t(`languages.${l}`)}
          </option>
        ))}
      </select>
    </label>
  );
}
