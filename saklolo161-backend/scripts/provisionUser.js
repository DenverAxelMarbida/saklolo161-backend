/**
 * scripts/provisionUser.js
 * --------------------------------------------------------------
 * Standalone CLI script (NOT mounted as a route) that creates a
 * new mock dispatcher/admin account for the Phase 2 staff-auth
 * layer. Hashes the password with bcryptjs and appends the user
 * via data/mockUsers.js's addUser().
 *
 * Usage:
 *     node scripts/provisionUser.js --email=new@marikina.gov.ph --password=temp123 --agency=FIRE --role=dispatcher
 *
 * Required args:
 *   --email    account email (used to log in)
 *   --password plaintext password (hashed with bcryptjs cost 10)
 *   --agency   MEDICAL | FIRE | FLOOD | CRIME | ALL
 *   --role     dispatcher | admin
 *
 * IMPORTANT: data/mockUsers.js is an in-memory array, so the new
 * user lives only in this script's process and disappears when the
 * server restarts — fine for local dev/testing, not for persistence.
 * This script's interface (email/password/agency/role in, user
 * created) is exactly what gets pointed at Firebase Auth's
 * user-creation API in Phase 3 instead, leaving the call sites
 * unchanged.
 * --------------------------------------------------------------
 */

const bcrypt = require('bcryptjs');
const mockUsers = require('../data/mockUsers');

const USAGE = `node scripts/provisionUser.js --email=you@marikina.gov.ph --password=temp123 --agency=FIRE --role=dispatcher`;

const VALID_AGENCIES = ['MEDICAL', 'FIRE', 'FLOOD', 'CRIME', 'ALL'];
const VALID_ROLES = ['dispatcher', 'admin'];

/**
 * Parses --key=value flags from process.argv into an object.
 */
function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    if (eq === -1) continue;
    const key = arg.slice(2, eq);
    const value = arg.slice(eq + 1);
    args[key] = value;
  }
  return args;
}

function fail(message) {
  console.error(`❌  ${message}`);
  console.error(`Usage: ${USAGE}`);
  process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const email = (args.email || '').trim();
  const password = args.password || '';
  const agency = (args.agency || '').trim().toUpperCase();
  const role = (args.role || '').trim().toLowerCase();

  if (!email || !password || !agency || !role) {
    fail('All of --email, --password, --agency, --role are required.');
  }
  if (!VALID_AGENCIES.includes(agency)) {
    fail(`agency must be one of: ${VALID_AGENCIES.join(', ')}.`);
  }
  if (!VALID_ROLES.includes(role)) {
    fail(`role must be one of: ${VALID_ROLES.join(', ')}.`);
  }
  if (mockUsers.findByEmail(email)) {
    fail(`A user with email "${email}" already exists.`);
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const newUser = {
    uid: `u${mockUsers.getAll().length + 1}`,
    email,
    passwordHash,
    agency,
    role,
  };

  mockUsers.addUser(newUser);

  console.log('✅  Mock user created (in-memory only, resets on server restart).');
  console.log(`   uid    : ${newUser.uid}`);
  console.log(`   email  : ${newUser.email}`);
  console.log(`   agency : ${newUser.agency}`);
  console.log(`   role   : ${newUser.role}`);
}

main().catch((err) => {
  console.error('❌  Unexpected error:', err.message);
  process.exit(1);
});