const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

// Parse .env file
const envPath = path.join(__dirname, '..', '.env');
const envLines = fs.readFileSync(envPath, 'utf8').split('\n');
const env = {};
for (const line of envLines) {
  const m = line.match(/^([^#=]+)=["']?(.+?)["']?\s*$/);
  if (m) env[m[1].trim()] = m[2].trim();
}

const connectionString = env.POSTGRES_URL_NON_POOLING;
if (!connectionString) {
  console.error('POSTGRES_URL_NON_POOLING not found in .env');
  process.exit(1);
}

const sql = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'schema.sql'),
  'utf8'
);

// Split on ; boundaries, strip comment lines, keep non-empty statements
const statements = sql
  .split(';')
  .map((s) =>
    s
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n')
      .trim()
  )
  .filter((s) => s.length > 0);

async function run() {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  const client = new Client({
    connectionString,
  });
  await client.connect();
  console.log('Connected to Supabase Postgres\n');

  let ok = 0,
    skip = 0,
    fail = 0;
  for (const stmt of statements) {
    const preview = stmt.replace(/\s+/g, ' ').slice(0, 70);
    try {
      await client.query(stmt);
      console.log(`  ok  ${preview}`);
      ok++;
    } catch (err) {
      // Treat "already exists" type errors as non-fatal
      if (
        err.message.includes('already exists') ||
        err.message.includes('duplicate') ||
        err.message.includes('already member')
      ) {
        console.log(`skip  ${preview}`);
        skip++;
      } else {
        console.error(`FAIL  ${preview}`);
        console.error(`      ${err.message}`);
        fail++;
      }
    }
  }

  await client.end();
  console.log(`\n${ok} ok · ${skip} skipped · ${fail} failed`);
  if (fail > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
