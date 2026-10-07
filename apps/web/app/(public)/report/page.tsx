import { getLocale, getTranslations } from 'next-intl/server';
import { ReportWizard } from '../../../components/ReportWizard';
import { loadMeta } from '../../../lib/api/meta';
import { services } from '../../../lib/services';

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  return { title: (await getTranslations('wizard'))('title') };
}

export default async function ReportPage() {
  const locale = await getLocale();
  const meta = await loadMeta(services().db.sql);
  return (
    <ReportWizard
      categories={meta.categories.map((c) => ({
        code: c.code,
        name: c.name[locale] ?? c.name.en ?? c.code,
        description: c.description[locale] ?? c.description.en ?? '',
      }))}
      land={meta.land}
      areas={meta.areas.map((a) => ({ code: a.code, geometry: a.geometry }))}
      bounds={meta.bounds}
      provisional={meta.provisional_boundaries}
    />
  );
}
