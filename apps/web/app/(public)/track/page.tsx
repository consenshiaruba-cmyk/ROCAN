import { getTranslations } from 'next-intl/server';
import { TrackForm } from '../../../components/TrackForm';

export async function generateMetadata() {
  return { title: (await getTranslations('track'))('title') };
}

export default function TrackPage() {
  return <TrackForm />;
}
