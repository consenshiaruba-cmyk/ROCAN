'use client';

// SPEC §5.1 /track: status by code + secret. The secret never goes into the URL.

import { useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import type { CitizenStatus } from '@rocan/core';
import { loadLastReport } from '../lib/client/submit';

interface View {
  code: string;
  status: CitizenStatus;
  timeline: { status: CitizenStatus; at: string }[];
  messages: { body: string; at: string }[];
  can_withdraw: boolean;
}

export function TrackForm() {
  const t = useTranslations('track');
  const format = useFormatter();
  const [code, setCode] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'notFound' | 'rateLimited' | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [withdrawn, setWithdrawn] = useState(false);

  // Prefill from the report just sent on this device.
  useEffect(() => {
    const last = loadLastReport();
    if (last) {
      setCode(last.code);
      setSecret(last.secret);
    }
  }, []);

  async function call(path: string): Promise<View | null> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, secret }),
        cache: 'no-store',
      });
      if (res.status === 429) setError('rateLimited');
      else if (!res.ok) setError('notFound');
      else return (await res.json()) as View;
      return null;
    } catch {
      setError('notFound');
      return null;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <h1>{t('title')}</h1>
      <p>{t('intro')}</p>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setWithdrawn(false);
          setView(await call('/api/v1/track'));
        }}
      >
        <label className="field">
          <span>{t('code')}</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={t('codePlaceholder')}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            required
            data-testid="track-code"
          />
        </label>
        <label className="field">
          <span>{t('secret')}</span>
          <input
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            required
            data-testid="track-secret"
          />
        </label>
        <button
          type="submit"
          className="btn btn-primary btn-block"
          disabled={busy}
          data-testid="track-submit"
        >
          {busy ? t('checking') : t('check')}
        </button>
      </form>

      {error && (
        <p className="banner banner-error" role="alert">
          {t(error)}
        </p>
      )}

      {view && (
        <section aria-live="polite" className="stack">
          <h2>{t('status')}</h2>
          <p className="secret-box" data-testid="track-status" data-status={view.status}>
            <strong>{t(`statuses.${view.status}`)}</strong>
          </p>
          {withdrawn && <p role="status">{t('withdrawn')}</p>}
          <h2>{t('timeline')}</h2>
          <ol className="timeline">
            {view.timeline.map((s) => (
              <li key={`${s.status}-${s.at}`}>
                <strong>{t(`statuses.${s.status}`)}</strong>
                <br />
                <span className="muted small">
                  {format.dateTime(new Date(s.at), { dateStyle: 'medium', timeStyle: 'short' })}
                </span>
              </li>
            ))}
          </ol>
          {view.messages.length > 0 && (
            <>
              <h2>{t('messages')}</h2>
              {view.messages.map((m) => (
                <p key={m.at} className="banner banner-info">
                  {m.body}
                </p>
              ))}
            </>
          )}
          {view.can_withdraw && (
            <button
              type="button"
              className="btn btn-danger btn-block"
              onClick={async () => {
                if (!window.confirm(t('withdrawConfirm'))) return;
                const v = await call('/api/v1/track/withdraw');
                if (v) {
                  setView(v);
                  setWithdrawn(true);
                }
              }}
            >
              {t('withdraw')}
            </button>
          )}
        </section>
      )}
    </div>
  );
}
