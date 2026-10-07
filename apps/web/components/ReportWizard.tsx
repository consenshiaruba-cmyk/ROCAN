'use client';

// SPEC §5.2: the four-step report wizard.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { RealClock } from '@rocan/clock';
import {
  MAX_DESCRIPTION,
  MAX_PHOTO_BYTES,
  MAX_PHOTOS,
  cryptoRandomInt,
  generateFollowUpSecret,
  isWithinAruba,
  type MultiPolygonCoords,
  type UiLanguage,
} from '@rocan/core';
import { LocationPicker, type PickedLocation } from './LocationPicker';
import {
  SubmitFailure,
  photoMime,
  saveLastReport,
  submitReport,
  type SubmitError,
} from '../lib/client/submit';

export interface WizardCategory {
  code: string;
  name: string;
  description: string;
}

interface Props {
  categories: WizardCategory[];
  land: MultiPolygonCoords;
  areas: { code: string; geometry: MultiPolygonCoords }[];
  bounds: [[number, number], [number, number]];
  provisional: boolean;
}

const STEPS = ['photos', 'location', 'what', 'review'] as const;
const NOT_SURE = 'NOT_SURE';
const clock = new RealClock();

type When = 'now' | 'today' | 'other';
type Ongoing = 'yes' | 'no' | 'unknown';

export function ReportWizard({ categories, land, areas, bounds, provisional }: Props) {
  const t = useTranslations('wizard');
  const c = useTranslations('common');
  const locale = useLocale() as UiLanguage;
  const router = useRouter();

  // One submission identity per wizard session (SPEC §5.3; phase-2 decision 2).
  const identity = useMemo(
    () => ({
      idempotencyKey: crypto.randomUUID(),
      secret: generateFollowUpSecret(cryptoRandomInt),
    }),
    [],
  );
  const uploadIdRef = useRef<string | undefined>(undefined);

  const [step, setStep] = useState(0);
  const [photos, setPhotos] = useState<File[]>([]);
  const [photoErrors, setPhotoErrors] = useState<string[]>([]);
  const [location, setLocation] = useState<PickedLocation | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [when, setWhen] = useState<When>('now');
  const [whenDate, setWhenDate] = useState('');
  const [ongoing, setOngoing] = useState<Ongoing>('unknown');
  const [consent, setConsent] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [sending, setSending] = useState<{ done: number; total: number } | null>(null);
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  const previews = useMemo(() => photos.map((p) => URL.createObjectURL(p)), [photos]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);
  useEffect(() => heading.current?.focus(), [step]);

  function addPhotos(list: FileList | null) {
    if (!list) return;
    const errors: string[] = [];
    const next = [...photos];
    for (const f of Array.from(list)) {
      if (next.length >= MAX_PHOTOS) {
        errors.push(t('photos.tooMany', { max: MAX_PHOTOS }));
        break;
      }
      if (!photoMime(f)) errors.push(t('photos.wrongType', { name: f.name }));
      else if (f.size > MAX_PHOTO_BYTES) errors.push(t('photos.tooLarge', { name: f.name }));
      else next.push(f);
    }
    uploadIdRef.current = undefined; // a different set of photos needs a new upload
    setPhotos(next);
    setPhotoErrors(errors);
  }

  const stepValid = [
    photos.length > 0,
    location !== null && isWithinAruba(location, land),
    category !== null,
    consent,
  ];

  function next() {
    if (!stepValid[step]) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function back() {
    setShowErrors(false);
    setStep((s) => Math.max(s - 1, 0));
  }

  async function send() {
    if (!stepValid.every(Boolean) || !location) {
      setShowErrors(true);
      return;
    }
    setSubmitError(null);
    setSending({ done: 0, total: photos.length });
    const now = clock.now();
    try {
      const { publicCode } = await submitReport(
        {
          photos,
          uploadId: uploadIdRef.current,
          report: {
            idempotency_key: identity.idempotencyKey,
            client_created_at: now.toISOString(),
            location: { lat: location.lat, lon: location.lon },
            location_accuracy_m: location.accuracy,
            location_source: location.source,
            category_code: category === NOT_SURE ? null : (category as never),
            description: description.trim() || null,
            observed_at:
              when === 'now'
                ? now.toISOString()
                : when === 'other' && whenDate
                  ? new Date(whenDate).toISOString()
                  : null,
            is_ongoing: ongoing === 'unknown' ? null : ongoing === 'yes',
            ui_language: locale,
            offline: false,
            follow_up_secret: identity.secret,
          },
        },
        (done, total) => setSending({ done, total }),
      );
      saveLastReport({ code: publicCode, secret: identity.secret });
      router.push('/report/done');
    } catch (err) {
      const failure = err instanceof SubmitFailure ? err : new SubmitFailure('generic');
      uploadIdRef.current =
        (failure as SubmitFailure & { uploadId?: string }).uploadId ?? uploadIdRef.current;
      setSubmitError(failure.kind);
      setSending(null);
    }
  }

  const stepName = STEPS[step]!;
  const selectedCategory = categories.find((x) => x.code === category);

  return (
    <div>
      <ol className="steps" aria-hidden="true">
        {STEPS.map((s, i) => (
          <li key={s} data-done={i <= step} />
        ))}
      </ol>
      <p className="muted small">{t('stepOf', { step: step + 1, total: STEPS.length })}</p>
      <h1 ref={heading} tabIndex={-1} data-testid="step-title">
        {t(`steps.${stepName}`)}
      </h1>

      {stepName === 'photos' && (
        <div className="stack">
          <p>{t('photos.intro', { max: MAX_PHOTOS })}</p>
          <p className="banner banner-info">{t('photos.hint')}</p>
          <div className="row">
            <label className="btn">
              {t('photos.take')}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="visually-hidden"
                onChange={(e) => {
                  addPhotos(e.target.files);
                  e.target.value = '';
                }}
              />
            </label>
            <label className="btn">
              {t('photos.choose')}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
                multiple
                className="visually-hidden"
                data-testid="photo-input"
                onChange={(e) => {
                  addPhotos(e.target.files);
                  e.target.value = '';
                }}
              />
            </label>
          </div>
          <p aria-live="polite" data-testid="photo-count">
            {t('photos.count', { count: photos.length })}
          </p>
          {photoErrors.map((e) => (
            <p key={e} className="banner banner-error" role="alert">
              {e}
            </p>
          ))}
          {photos.length > 0 && (
            <div className="photo-grid">
              {previews.map((src, i) => (
                <figure key={src}>
                  <img src={src} alt={t('photos.alt', { n: i + 1 })} />
                  <button
                    type="button"
                    aria-label={t('photos.remove', { n: i + 1 })}
                    onClick={() => {
                      uploadIdRef.current = undefined;
                      setPhotos(photos.filter((_, j) => j !== i));
                    }}
                  >
                    ×
                  </button>
                </figure>
              ))}
            </div>
          )}
          {showErrors && !stepValid[0] && (
            <p className="banner banner-error" role="alert">
              {t('photos.needOne')}
            </p>
          )}
        </div>
      )}

      {stepName === 'location' && (
        <>
          <LocationPicker
            land={land}
            areas={areas}
            bounds={bounds}
            provisional={provisional}
            value={location}
            onChange={setLocation}
          />
          {showErrors && location === null && (
            <p className="banner banner-error" role="alert">
              {t('location.needPin')}
            </p>
          )}
        </>
      )}

      {stepName === 'what' && (
        <div className="stack">
          <fieldset className="category-grid">
            <legend>{t('what.intro')}</legend>
            {categories.map((cat) => (
              <label key={cat.code} className="choice">
                <input
                  type="radio"
                  name="category"
                  value={cat.code}
                  checked={category === cat.code}
                  onChange={() => setCategory(cat.code)}
                />
                <span>
                  <strong>{cat.name}</strong>
                  <span className="muted small">{cat.description}</span>
                </span>
              </label>
            ))}
            <label className="choice">
              <input
                type="radio"
                name="category"
                value={NOT_SURE}
                checked={category === NOT_SURE}
                onChange={() => setCategory(NOT_SURE)}
              />
              <span>
                <strong>{t('what.notSure')}</strong>
                <span className="muted small">{t('what.notSureHint')}</span>
              </span>
            </label>
          </fieldset>
          {showErrors && category === null && (
            <p className="banner banner-error" role="alert">
              {t('what.needCategory')}
            </p>
          )}

          <label className="field">
            <span>{t('what.description')}</span>
            <span className="muted small" id="desc-hint">
              {t('what.descriptionHint')}
            </span>
            <textarea
              value={description}
              maxLength={MAX_DESCRIPTION}
              aria-describedby="desc-hint"
              onChange={(e) => setDescription(e.target.value)}
            />
            <span className="muted small">
              {t('what.chars', { count: description.length, max: MAX_DESCRIPTION })}
            </span>
          </label>

          <fieldset className="radio-row">
            <legend>{t('what.when')}</legend>
            {(['now', 'today', 'other'] as const).map((w) => (
              <label key={w}>
                <input type="radio" name="when" checked={when === w} onChange={() => setWhen(w)} />
                {t(`what.${w === 'now' ? 'whenNow' : w === 'today' ? 'whenToday' : 'whenOther'}`)}
              </label>
            ))}
          </fieldset>
          {when === 'other' && (
            <label className="field">
              <span>{t('what.whenDate')}</span>
              <input
                type="datetime-local"
                value={whenDate}
                onChange={(e) => setWhenDate(e.target.value)}
              />
            </label>
          )}

          <fieldset className="radio-row">
            <legend>{t('what.ongoing')}</legend>
            {(['yes', 'no', 'unknown'] as const).map((o) => (
              <label key={o}>
                <input
                  type="radio"
                  name="ongoing"
                  checked={ongoing === o}
                  onChange={() => setOngoing(o)}
                />
                {t(`what.${o}`)}
              </label>
            ))}
          </fieldset>
        </div>
      )}

      {stepName === 'review' && (
        <div className="stack">
          <p>{t('review.intro')}</p>
          <dl className="summary">
            <dt>{t('review.photos')}</dt>
            <dd>{t('photos.count', { count: photos.length })}</dd>
            <dt>{t('review.location')}</dt>
            <dd>{location && `${location.lat.toFixed(5)}, ${location.lon.toFixed(5)}`}</dd>
            <dt>{t('review.category')}</dt>
            <dd>{selectedCategory?.name ?? t('what.notSure')}</dd>
            <dt>{t('review.description')}</dt>
            <dd>{description.trim() || t('review.none')}</dd>
          </dl>
          <p className="muted">{t('review.anonymous')}</p>
          <label className="choice">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              data-testid="consent"
            />
            <span>{t('review.consent')}</span>
          </label>
          {showErrors && !consent && (
            <p className="banner banner-error" role="alert">
              {t('review.needConsent')}
            </p>
          )}
          {submitError && (
            <p className="banner banner-error" role="alert" data-testid="submit-error">
              {t(`errors.${submitError}`)}
            </p>
          )}
          {sending && (
            <p aria-live="polite" role="status">
              {t('review.sending', sending)}
            </p>
          )}
        </div>
      )}

      <div className="wizard-nav">
        {step > 0 && (
          <button type="button" className="btn" onClick={back} disabled={!!sending}>
            {c('back')}
          </button>
        )}
        {stepName !== 'review' ? (
          <button type="button" className="btn btn-primary" onClick={next} data-testid="next">
            {c('next')}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            onClick={send}
            disabled={!!sending}
            data-testid="send"
          >
            {t('review.send')}
          </button>
        )}
      </div>
    </div>
  );
}
