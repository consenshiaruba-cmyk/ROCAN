import type { ReactNode } from 'react';

export const metadata = {
  title: 'ROCAN',
  description: 'Report harm to nature in Aruba',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pap">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0, padding: 16 }}>
        {children}
      </body>
    </html>
  );
}
