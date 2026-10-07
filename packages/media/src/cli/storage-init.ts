import { loadEnv } from '@rocan/config';
import { createS3, ensureBuckets } from '../storage';

const env = loadEnv();
const s3 = createS3(env);
try {
  const r = await ensureBuckets(s3, env);
  console.log(
    'buckets created:',
    r.created.join(', ') || '-',
    '| existing:',
    r.existing.join(', ') || '-',
  );
  for (const w of r.warnings) console.warn('warning:', w);
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  s3.destroy();
}
