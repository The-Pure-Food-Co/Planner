// One-off: clear the legacy display-name roster (app_config.userList) in the live
// Supabase DB. The seed placeholder names (David, Kees, Penny, …) were written here
// when the DB was first seeded; emptying lib/seed.ts does NOT remove them from an
// already-provisioned database. After this runs the roster self-heals: each real
// user is re-added to userList as they sign in (plannerStore.init → db.saveUserList).
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
const envLines = fs.readFileSync(envPath, 'utf8').split('\n');
const env = {};
for (const line of envLines) {
  const m = line.match(/^([^#=]+)=["']?(.+?)["']?\s*$/);
  if (m) env[m[1].trim()] = m[2].trim();
}

let connectionString = env.POSTGRES_URL_NON_POOLING;
if (!connectionString) {
  console.error('POSTGRES_URL_NON_POOLING not found in .env');
  process.exit(1);
}
// Strip sslmode so it doesn't force verify-full and override the explicit ssl
// option below (Supabase's chain is self-signed; see the Client config).
connectionString = connectionString.replace(/[?&]sslmode=[^&]*/i, '');

async function run() {
  // Supabase presents a self-signed cert in its chain, so full verification fails.
  // Relax it for THIS connection only (not a process-wide NODE_TLS override) — a
  // one-off admin script against our own DB using a connection string we already hold.
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const before = await client.query("select value from app_config where key = 'userList'");
  console.log('Current userList:', JSON.stringify(before.rows[0]?.value ?? null));

  await client.query(
    "insert into app_config (key, value) values ('userList', '[]'::jsonb) " +
    "on conflict (key) do update set value = excluded.value"
  );

  const after = await client.query("select value from app_config where key = 'userList'");
  console.log('New userList:    ', JSON.stringify(after.rows[0]?.value ?? null));

  await client.end();
  console.log('\nDone. Real users re-populate as they sign in.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
