/**
 * Test support: a database of a test file's own, beside the one
 * `HF_TEST_DATABASE_URL` names.
 *
 * Vitest runs test files in parallel, and two files wiping one database under
 * each other fail in ways that look like the store's fault. Only imported by
 * tests, and only reached when a database is configured for them.
 */
import postgres from "postgres";

export async function ownDatabase(base: string, name: string): Promise<string> {
  const admin = postgres(base, { max: 1 });
  try {
    const exists = await admin`select 1 from pg_database where datname = ${name}`;
    // Created on a fresh machine and already there on every later run, so which
    // branch runs says where the suite is, not whether it works.
    /* v8 ignore next */
    if (exists.length === 0) await admin.unsafe(`create database ${name}`);
  } finally {
    await admin.end();
  }
  const url = new URL(base);
  url.pathname = `/${name}`;
  return url.toString();
}
