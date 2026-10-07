import { getTranslations } from 'next-intl/server';

export async function generateMetadata() {
  return { title: (await getTranslations('privacy'))('title') };
}

const SECTIONS = ['notStored', 'stored', 'evidence', 'secret', 'ai', 'retention'] as const;

export default async function Privacy() {
  const t = await getTranslations('privacy');
  return (
    <article className="stack">
      <h1>{t('title')}</h1>
      <p>{t('intro')}</p>
      {SECTIONS.map((s) => (
        <section key={s}>
          <h2>{t(`${s}Title`)}</h2>
          <p>{t(s)}</p>
        </section>
      ))}
    </article>
  );
}
