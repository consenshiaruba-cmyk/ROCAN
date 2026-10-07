// SPEC Appendix A. Parsed once per process; invalid configuration fails fast at boot.

import { z } from 'zod';

const bool = z
  .enum(['0', '1', 'true', 'false'])
  .default('0')
  .transform((v) => v === '1' || v === 'true');

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  MOCK_MODE: bool,
  CLOCK_MODE: z.enum(['real', 'offset', 'frozen']).default('real'),
  DATABASE_URL: z.string().url(),
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: bool,
  S3_BUCKET_INCOMING: z.string().default('rocan-incoming'),
  S3_BUCKET_VAULT: z.string().default('rocan-vault'),
  S3_BUCKET_DERIVATIVES: z.string().default('rocan-derivatives'),
  S3_BUCKET_REPORTS: z.string().default('rocan-reports'),
  VAULT_LOCK_DAYS: z.coerce.number().int().positive().default(1825),
  SMTP_URL: z.string().url(),
  MAIL_FROM: z.string().default('ROCAN <no-reply@rocan.test>'),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:3000'),
  OPERATOR_NAME: z.string().default('ROCAN operator'),
});

export type Env = z.infer<typeof EnvSchema>;

export class UnsafeConfigurationError extends Error {
  override name = 'UnsafeConfigurationError';
}

/** SPEC Appendix A: mock features must be impossible to enable in production. */
export function assertSafeRuntime(env: Pick<Env, 'NODE_ENV' | 'MOCK_MODE'>): void {
  if (env.NODE_ENV === 'production' && env.MOCK_MODE) {
    throw new UnsafeConfigurationError('MOCK_MODE=1 is not allowed when NODE_ENV=production');
  }
}

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${issues}`);
  }
  assertSafeRuntime(parsed.data);
  return parsed.data;
}
