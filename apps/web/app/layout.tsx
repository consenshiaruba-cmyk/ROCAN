import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('common');
  return {
    title: { default: `${t('appName')}: ${t('tagline')}`, template: `%s · ${t('appName')}` },
    description: t('tagline'),
    applicationName: t('appName'),
    appleWebApp: { capable: true, title: t('appName'), statusBarStyle: 'default' },
    icons: { icon: '/icons/icon-192.png', apple: '/icons/apple-touch-icon.png' },
  };
}

export const viewport: Viewport = {
  themeColor: '#0b5d3b',
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
