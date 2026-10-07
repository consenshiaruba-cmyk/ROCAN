import { describe, expect, it } from 'vitest';
import { CATEGORY_CODES } from '@rocan/core';
import {
  DEV_UPLOAD_TOKEN_SECRET,
  UnsafeConfigurationError, assertSafeRuntime, loadEnv, loadRepoConfig } from '../src/index';

const baseEnv = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  S3_ACCESS_KEY_ID: 'k',
  S3_SECRET_ACCESS_KEY: 's',
  SMTP_URL: 'smtp://localhost:1025',
  UPLOAD_TOKEN_SECRET: 'a-real-production-secret-that-is-long-enough-123',
};

describe('environment', () => {
  it('refuses MOCK_MODE in production (SPEC Appendix A)', () => {
    expect(() => loadEnv({ ...baseEnv, NODE_ENV: 'production', MOCK_MODE: '1' })).toThrow(
      UnsafeConfigurationError,
    );
    expect(() => assertSafeRuntime({ NODE_ENV: 'production', MOCK_MODE: true })).toThrow();
    expect(loadEnv({ ...baseEnv, NODE_ENV: 'production', MOCK_MODE: '0' }).MOCK_MODE).toBe(false);
    expect(loadEnv({ ...baseEnv, NODE_ENV: 'development', MOCK_MODE: '1' }).MOCK_MODE).toBe(true);
  });

  it('refuses the development upload secret in production', () => {
    expect(() =>
      loadEnv({ ...baseEnv, NODE_ENV: 'production', UPLOAD_TOKEN_SECRET: DEV_UPLOAD_TOKEN_SECRET }),
    ).toThrow(/UPLOAD_TOKEN_SECRET/);
  });

  it('reports missing variables by name', () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/);
  });
});

describe('repository config', () => {
  const config = loadRepoConfig();

  it('has the four agencies and OM receives no incidents', () => {
    expect(config.agencies.map((a) => a.code)).toEqual(['DNM', 'ACF', 'DOW', 'OM']);
    expect(config.agencies.find((a) => a.code === 'OM')?.receives_incidents).toBe(false);
  });

  it('has all 13 categories with all four languages and only unverified legal refs', () => {
    expect(config.categories.map((c) => c.code).sort()).toEqual([...CATEGORY_CODES].sort());
    for (const c of config.categories) {
      for (const lang of ['pap', 'nl', 'en', 'es'] as const) {
        expect(c.name[lang].length, `${c.code} name.${lang}`).toBeGreaterThan(0);
        expect(c.description[lang].length, `${c.code} description.${lang}`).toBeGreaterThan(0);
      }
      // SPEC §16 item 4: nothing is verified until a jurist checks it.
      expect(c.legal_refs.every((r) => !r.verified)).toBe(true);
    }
  });

  it('gives routing rules stable ids', () => {
    expect(config.routingRules.map((r) => r.id)).toContain('R10');
  });

  it('marks every geo layer as a placeholder', () => {
    for (const f of config.protectedAreas.features) expect(f.properties.source).toMatch(/PLACEHOLDER/);
    expect(config.districts.features).toHaveLength(8);
  });
});
