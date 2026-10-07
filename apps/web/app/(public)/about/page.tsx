import { getTranslations } from 'next-intl/server';

export async function generateMetadata() {
  return { title: (await getTranslations('about'))('title') };
}

export default async function About() {
  const t = await getTranslations('about');
  return (
    <article className="stack">
      <h1>{t('title')}</h1>
      <p>{t('p1')}</p>
      <p>{t('p2')}</p>
      <p>{t('p3')}</p>
      <p className="banner banner-emergency">{t('p4')}</p>
    </article>
  );
}
