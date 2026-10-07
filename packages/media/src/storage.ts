// SPEC §4.1, §9.2, §13.3: the four buckets. The vault is versioned and Object-Locked in
// compliance mode so nobody (including the app) can delete or overwrite an original
// before the retention period ends.

import {
  CreateBucketCommand,
  GetObjectLockConfigurationCommand,
  HeadBucketCommand,
  PutBucketLifecycleConfigurationCommand,
  PutObjectLockConfigurationCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { Env } from '@rocan/config';

export type StorageEnv = Pick<
  Env,
  | 'S3_ENDPOINT'
  | 'S3_REGION'
  | 'S3_ACCESS_KEY_ID'
  | 'S3_SECRET_ACCESS_KEY'
  | 'S3_FORCE_PATH_STYLE'
  | 'S3_BUCKET_INCOMING'
  | 'S3_BUCKET_VAULT'
  | 'S3_BUCKET_DERIVATIVES'
  | 'S3_BUCKET_REPORTS'
  | 'VAULT_LOCK_DAYS'
>;

export function createS3(env: StorageEnv): S3Client {
  return new S3Client({
    region: env.S3_REGION,
    ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
  });
}

async function exists(s3: S3Client, bucket: string): Promise<boolean> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    return true;
  } catch (err) {
    const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404 || (err as Error).name === 'NotFound') return false;
    throw err;
  }
}

export interface EnsureBucketsResult {
  created: string[];
  existing: string[];
  warnings: string[];
}

export async function ensureBuckets(s3: S3Client, env: StorageEnv): Promise<EnsureBucketsResult> {
  const result: EnsureBucketsResult = { created: [], existing: [], warnings: [] };

  const plain = [env.S3_BUCKET_INCOMING, env.S3_BUCKET_DERIVATIVES, env.S3_BUCKET_REPORTS];
  for (const bucket of plain) {
    if (await exists(s3, bucket)) {
      result.existing.push(bucket);
      continue;
    }
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    result.created.push(bucket);
  }

  // Incoming uploads expire after a day (SPEC §5.3). Not every S3-compatible store
  // supports lifecycle rules; the hourly incoming.cleanup job covers the gap.
  try {
    await s3.send(
      new PutBucketLifecycleConfigurationCommand({
        Bucket: env.S3_BUCKET_INCOMING,
        LifecycleConfiguration: {
          Rules: [
            {
              ID: 'expire-incoming',
              Status: 'Enabled',
              Filter: { Prefix: '' },
              Expiration: { Days: 1 },
            },
          ],
        },
      }),
    );
  } catch (err) {
    result.warnings.push(
      `lifecycle on ${env.S3_BUCKET_INCOMING} not applied: ${(err as Error).message}`,
    );
  }

  const vault = env.S3_BUCKET_VAULT;
  if (await exists(s3, vault)) {
    result.existing.push(vault);
  } else {
    // Object Lock can only be enabled at creation; it also turns on versioning.
    await s3.send(new CreateBucketCommand({ Bucket: vault, ObjectLockEnabledForBucket: true }));
    result.created.push(vault);
  }
  await s3.send(
    new PutObjectLockConfigurationCommand({
      Bucket: vault,
      ObjectLockConfiguration: {
        ObjectLockEnabled: 'Enabled',
        Rule: { DefaultRetention: { Mode: 'COMPLIANCE', Days: env.VAULT_LOCK_DAYS } },
      },
    }),
  );
  return result;
}

export async function vaultLockMode(s3: S3Client, vault: string): Promise<string | undefined> {
  const res = await s3.send(new GetObjectLockConfigurationCommand({ Bucket: vault }));
  return res.ObjectLockConfiguration?.Rule?.DefaultRetention?.Mode;
}
