// SPEC §13.3: the vault is write-once. Phase 3 builds on this; Phase 1 proves the bucket setup.
import { randomUUID } from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv, type Env } from '@rocan/config';
import { createS3, ensureBuckets, vaultLockMode } from '../src/index';

let env: Env;
let s3: S3Client;
const suffix = randomUUID().slice(0, 8);

beforeAll(() => {
  // Separate buckets per run so tests never touch the dev buckets.
  env = loadEnv({
    ...process.env,
    S3_BUCKET_INCOMING: `it-incoming-${suffix}`,
    S3_BUCKET_VAULT: `it-vault-${suffix}`,
    S3_BUCKET_DERIVATIVES: `it-derivatives-${suffix}`,
    S3_BUCKET_REPORTS: `it-reports-${suffix}`,
    VAULT_LOCK_DAYS: '1',
  });
  s3 = createS3(env);
});
afterAll(() => s3.destroy());

describe('object storage buckets', () => {
  it('creates all four buckets, then is idempotent', async () => {
    const first = await ensureBuckets(s3, env);
    expect(first.created.sort()).toEqual(
      [
        env.S3_BUCKET_INCOMING,
        env.S3_BUCKET_VAULT,
        env.S3_BUCKET_DERIVATIVES,
        env.S3_BUCKET_REPORTS,
      ].sort(),
    );
    const second = await ensureBuckets(s3, env);
    expect(second.created).toEqual([]);
    expect(second.existing).toHaveLength(4);
  });

  it('locks the vault in compliance mode', async () => {
    expect(await vaultLockMode(s3, env.S3_BUCKET_VAULT)).toBe('COMPLIANCE');
  });

  it('refuses to delete a locked original version', async () => {
    const key = `test/${randomUUID()}`;
    const put = await s3.send(
      new PutObjectCommand({ Bucket: env.S3_BUCKET_VAULT, Key: key, Body: 'original bytes' }),
    );
    expect(put.VersionId).toBeTruthy();
    await expect(
      s3.send(
        new DeleteObjectCommand({
          Bucket: env.S3_BUCKET_VAULT,
          Key: key,
          VersionId: put.VersionId,
        }),
      ),
    ).rejects.toMatchObject({ name: 'AccessDenied' });
    const got = await s3.send(
      new GetObjectCommand({ Bucket: env.S3_BUCKET_VAULT, Key: key, VersionId: put.VersionId }),
    );
    expect(await got.Body?.transformToString()).toBe('original bytes');
  });
});
