import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

const config: NextConfig = {
  transpilePackages: [
    '@rocan/config',
    '@rocan/db',
    '@rocan/health',
    '@rocan/media',
    '@rocan/core',
    '@rocan/clock',
  ],
  serverExternalPackages: ['@node-rs/argon2', 'pg-boss'],
  poweredByHeader: false,
  // SPEC §13.2: baseline headers; the full CSP lands in Phase 8.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(self), geolocation=(self), microphone=(), payment=(), usb=()',
          },
        ],
      },
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },
};

export default withNextIntl(config);
