'use client';

// SPEC §5.1 /report/done: show the code and secret once, with copy and save-as-image.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { loadLastReport, type LastReport } from '../lib/client/submit';

function saveAsImage(r: LastReport, title: string, codeLabel: string, secretLabel: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 900;
  canvas.height = 420;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#0b5d3b';
  ctx.font = 'bold 40px system-ui, sans-serif';
  ctx.fillText(title, 40, 70);
  ctx.fillStyle = '#111111';
  ctx.font = '28px system-ui, sans-serif';
  ctx.fillText(codeLabel, 40, 140);
  ctx.font = 'bold 48px ui-monospace, monospace';
  ctx.fillText(r.code, 40, 200);
  ctx.font = '28px system-ui, sans-serif';
  ctx.fillText(secretLabel, 40, 270);
  ctx.font = 'bold 34px ui-monospace, monospace';
  ctx.fillText(r.secret, 40, 330);
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = `${r.code}.png`;
  a.click();
}

export function DoneView() {
  const t = useTranslations('done');
  const [report, setReport] = useState<LastReport | null | undefined>(undefined);
  const [copied, setCopied] = useState(false);

  useEffect(() => setReport(loadLastReport()), []);

  if (report === undefined) return null;
  if (report === null)
    return (
      <div className="stack">
        <h1>{t('title')}</h1>
        <p>{t('missing')}</p>
        <Link href="/track" className="btn btn-block">
          {t('track')}
        </Link>
      </div>
    );

  return (
    <div className="stack">
      <h1>{t('title')}</h1>
      <p className="banner banner-info">{t('intro')}</p>
      <div className="secret-box">
        <p>
          {t('code')}
          <br />
          <code data-testid="public-code">{report.code}</code>
        </p>
        <p>
          {t('secret')}
          <br />
          <code data-testid="secret">{report.secret}</code>
        </p>
      </div>
      <p className="muted small">{t('warning')}</p>
      <div className="row">
        <button
          type="button"
          className="btn"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(`${report.code}\n${report.secret}`);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? t('copied') : t('copy')}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => saveAsImage(report, t('imageTitle'), t('code'), t('secret'))}
        >
          {t('saveImage')}
        </button>
      </div>
      <Link href="/track" className="btn btn-primary btn-block" data-testid="go-track">
        {t('track')}
      </Link>
      <Link href="/report" className="btn btn-block">
        {t('another')}
      </Link>
    </div>
  );
}
