/**
 * scripts/provisionUser.js
 * --------------------------------------------------------------
 * Standalone CLI script (NOT mounted as a route) that creates or
 * updates a Firebase Authentication account for the Phase 3 staff
 * auth layer, and assigns the { agency, role } custom claims the
 * backend maps into the frozen payload contract
 * ({ uid, email, agency, role }).
 *
 * Usage:
 *     node scripts/provisionUser.js --email=new@marikina.gov.ph --password=temp123 --agency=FIRE --role=dispatcher
 *
 * Required args:
 *   --email    account email (used to log in)
 *   --password plaintext password (stored by Firebase Auth, never here)
 *   --agency   MEDICAL | FIRE | FLOOD | CRIME | ALL
 *   --role     dispatcher | admin
 *
 * Idempotent: if the email already exists in Firebase Auth, the
 * password is reset and the claims are re-set — safe to re-run when
 * re-provisioning (e.g. the 5 seed accounts from data/mockUsers.js).
 *
 * Replaces the Phase 2 bcrypt + mockUsers.addUser() flow; same CLI
 * interface, so call sites/scripts that invoke it don't change.
 * --------------------------------------------------------------
 */

const { initializeFirebase, getFirebaseAuth } = require('../config/firebase');

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

  initializeFirebase();
  const auth = getFirebaseAuth();

  let uid;
  let created = false;

  try {
    const existing = await auth.getUserByEmail(email);
    uid = existing.uid;
    await auth.updateUser(uid, { password });
    console.log('♻️   Existing Firebase Auth user updated (password reset).');
  } catch (err) {
    if (err.code !== 'auth/user-not-found') {
      throw err;
    }
    const user = await auth.createUser({ email, password });
    uid = user.uid;
    created = true;
    console.log('✅  Firebase Auth user created.');
  }

  // Custom claims ride inside every ID token issued from now on —
  // that's where authService.buildPayload() reads agency/role from.
  await auth.setCustomUserClaims(uid, { agency, role });

  console.log(`   uid    : ${uid}`);
  console.log(`   email  : ${email}`);
  console.log(`   agency : ${agency}`);
  console.log(`   role   : ${role}`);
  console.log(created ? '   claims : set' : '   claims : re-set');

  // firebase-admin keeps a credential-refresh timer alive; exit
  // explicitly so the CLI returns to the shell instead of hanging.
  process.exit(0);
}

main().catch((err) => {
  console.error('❌  Unexpected error:', err.message);
  process.exit(1);
});
