import postgres from 'postgres';

/** Create (or recreate) a throwaway database next to DATABASE_URL and return its URL. */
export async function freshDatabase(name: string): Promise<string> {
  const base = process.env.DATABASE_URL!;
  const admin = postgres(base, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
  const url = new URL(base);
  url.pathname = `/${name}`;
  return url.toString();
}

export async function dropDatabase(name: string): Promise<void> {
  const admin = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}
