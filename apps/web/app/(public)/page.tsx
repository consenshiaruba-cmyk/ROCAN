import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

export default async function Home() {
  const t = await getTranslations('home');
  const c = await getTranslations('common');
  return (
    <div className="stack">
      <p className="banner banner-emergency" role="note">
        {c('emergency')}
      </p>
      <h1>{t('title')}</h1>
      <p>{t('intro')}</p>
      <Link href="/report" className="btn btn-primary btn-block" data-testid="start-report">
        {t('cta')}
      </Link>
      <Link href="/track" className="btn btn-block">
        {t('track')}
      </Link>
      <h2>{t('howTitle')}</h2>
      <ol className="how">
        <li>{t('how1')}</li>
        <li>{t('how2')}</li>
        <li>{t('how3')}</li>
        <li>{t('how4')}</li>
      </ol>
    </div>
  );
}
