/**
 * data/mockUsers.js
 * --------------------------------------------------------------
 * In-memory "database" used ONLY for Phase 2 mock accounts.
 *
 * This provides seed dispatcher/admin accounts for the staff auth
 * layer before Firebase Auth is wired up (Phase 3). Account storage
 * lives here so `services/authService.js` can resolve credentials
 * without touching a real database.
 *
 * This array is mutated at runtime by the auth flow (new users get
 * pushed via addUser), but it resets every time the server restarts —
 * that's expected for mock mode.
 *
 * Passwords are NEVER stored in plaintext. Each entry's `passwordHash`
 * is a bcrypt hash (bcryptjs, cost 10) of the shared development
 * password "changeme123". They were generated once via:
 *
 *     node -e "require('bcryptjs').hash('changeme123',10).then(console.log)"
 *
 * and pasted below. Do not edit these by hand; regenerate the hashes
 * (or add users via the setup script) instead of writing plaintext.
 * --------------------------------------------------------------
 */

let users = [
  {
    uid: 'u1',
    email: 'fire@marikina.gov.ph',
    passwordHash:
      '$2b$10$PQB6qDFdgsXAtdepcubQiOqOFsXriuU6MYzBwBFi5DB84ZO2HLvF2',
    agency: 'FIRE',
    role: 'dispatcher',
  },
  {
    uid: 'u2',
    email: 'medical@marikina.gov.ph',
    passwordHash:
      '$2b$10$q0X/YDIJDMjJLHArWZ5KuOjI5hCuxHtdXqdwlTFBEbDCVNbFjF45G',
    agency: 'MEDICAL',
    role: 'dispatcher',
  },
  {
    uid: 'u3',
    email: 'flood@marikina.gov.ph',
    passwordHash:
      '$2b$10$t4L9Vd52Ti0dYC20KUoevu8tIjHKfmZphZzVizbrZ3hiiAE1SxGjC',
    agency: 'FLOOD',
    role: 'dispatcher',
  },
  {
    uid: 'u4',
    email: 'crime@marikina.gov.ph',
    passwordHash:
      '$2b$10$cKgtdGOfhP3fAyBcQXoqZeApGAXO1YCaE9Sg5b44GqFh9/jZDkGSK',
    agency: 'CRIME',
    role: 'dispatcher',
  },
  {
    uid: 'u5',
    email: 'admin@marikina.gov.ph',
    passwordHash:
      '$2b$10$kRpwtHYy.zyBt5bIQ/t9neqq.On6dT.Idh.aLetunJh12j5oLJ/cq',
    agency: 'ALL',
    role: 'admin',
  },
];

module.exports = {
  getAll: () => users,
  findByEmail: (email) => users.find((user) => user.email === email),
  addUser: (user) => {
    users.push(user);
    return user;
  },
};
