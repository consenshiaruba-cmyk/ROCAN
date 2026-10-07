import { getTranslations } from 'next-intl/server';
import { DoneView } from '../../../../components/DoneView';

export async function generateMetadata() {
  return { title: (await getTranslations('done'))('title') };
}

export default function DonePage() {
  return <DoneView />;
}
