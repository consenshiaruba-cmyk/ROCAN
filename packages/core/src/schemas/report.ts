// Request schemas shared by the PWA, the API and the worker (CLAUDE.md conventions).
import { z } from 'zod';
import { CATEGORY_CODES, LOCATION_SOURCES, UI_LANGUAGES } from '../enums';
import { normalizeFollowUpSecret, normalizePublicCode } from '../codes';

export const MAX_PHOTOS = 5;
export const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
export const MAX_DESCRIPTION = 2000;
export const ALLOWED_PHOTO_MIMES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
] as const;

export const CreateUploadSchema = z
  .object({
    files: z
      .array(
        z
          .object({
            mime: z.enum(ALLOWED_PHOTO_MIMES),
            size: z.number().int().min(1).max(MAX_PHOTO_BYTES),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_PHOTOS),
  })
  .strict();
export type CreateUpload = z.infer<typeof CreateUploadSchema>;

const isoDate = z.iso.datetime({ offset: true });

export const CreateReportSchema = z
  .object({
    idempotency_key: z.uuid(),
    upload_id: z.uuid(),
    photo_count: z.number().int().min(1).max(MAX_PHOTOS),
    client_created_at: isoDate,
    location: z
      .object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) })
      .strict(),
    location_accuracy_m: z.number().min(0).max(100_000).nullable().optional(),
    location_source: z.enum(LOCATION_SOURCES),
    category_code: z.enum(CATEGORY_CODES).nullable().optional(),
    description: z.string().max(MAX_DESCRIPTION).nullable().optional(),
    observed_at: isoDate.nullable().optional(),
    is_ongoing: z.boolean().nullable().optional(),
    ui_language: z.enum(UI_LANGUAGES),
    offline: z.boolean(),
    follow_up_secret: z.string().transform((s, ctx) => {
      const n = normalizeFollowUpSecret(s);
      if (!n) {
        ctx.addIssue({ code: 'custom', message: 'invalid follow-up secret' });
        return z.NEVER;
      }
      return n;
    }),
  })
  .strict();
export type CreateReport = z.input<typeof CreateReportSchema>;
export type CreateReportParsed = z.output<typeof CreateReportSchema>;

export const TrackSchema = z
  .object({
    code: z
      .string()
      .max(32)
      .transform((s, ctx) => {
        const n = normalizePublicCode(s);
        if (!n) {
          ctx.addIssue({ code: 'custom', message: 'invalid code' });
          return z.NEVER;
        }
        return n;
      }),
    secret: z.string().max(200),
  })
  .strict();
