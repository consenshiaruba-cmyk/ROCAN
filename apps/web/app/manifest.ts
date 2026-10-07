import type { MetadataRoute } from 'next';

// SPEC §5.4: installable PWA. Names stay language-neutral; the UI language is a cookie.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'ROCAN: Raporta daño na naturalesa',
    short_name: 'ROCAN',
    description: 'Report harm to nature in Aruba, anonymously.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: '#0b5d3b',
    lang: 'pap',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
