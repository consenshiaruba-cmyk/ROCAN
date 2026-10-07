import type { ReactNode } from 'react';
import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import { ServiceWorkerRegister } from '../../components/ServiceWorkerRegister';

export default async function PublicLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations('common');
  const locale = await getLocale();
  return (
    <>
      <a className="skip-link" href="#main">
        {t('skip')}
      </a>
      <header className="site-header">
        <Link href="/" className="brand">
          <img src="/icons/icon-192.png" alt="" width={32} height={32} />
          <span>{t('appName')}</span>
        </Link>
        <LanguageSwitcher current={locale} />
      </header>
      <main id="main" className="container">
        {children}
      </main>
      <footer className="site-footer">
        <nav aria-label={t('appName')}>
          <Link href="/track">{t('nav.track')}</Link>
          <Link href="/about">{t('nav.about')}</Link>
          <Link href="/privacy">{t('nav.privacy')}</Link>
        </nav>
        {(locale === 'pap' || locale === 'es') && <p className="muted small">{t('draftNotice')}</p>}
      </footer>
      <ServiceWorkerRegister />
    </>
  );
}
