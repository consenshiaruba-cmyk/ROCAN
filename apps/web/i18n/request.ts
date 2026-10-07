import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { DEFAULT_LOCALE, LOCALE_COOKIE, TIME_ZONE, isLocale } from './config';

export default getRequestConfig(async () => {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(value) ? value : DEFAULT_LOCALE;
  return {
    locale,
    timeZone: TIME_ZONE,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
