// Integration tests run against the docker compose services (or CI service containers).
// Defaults match docker-compose.yml so `pnpm test:integration` works after `pnpm services:up`.
const defaults: Record<string, string> = {
  DATABASE_URL: 'postgres://rocan:rocan@localhost:5432/rocan',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_ACCESS_KEY_ID: 'rocan',
  S3_SECRET_ACCESS_KEY: 'rocan-dev-secret',
  S3_FORCE_PATH_STYLE: '1',
  SMTP_URL: 'smtp://localhost:1025',
  MAILPIT_API: 'http://localhost:8025',
  MOCK_MODE: '1',
  NODE_ENV: 'test',
};

export default function setup(): void {
  for (const [key, value] of Object.entries(defaults)) process.env[key] ??= value;
}
