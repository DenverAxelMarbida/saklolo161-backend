/**
 * services/passwordPolicy.js
 * --------------------------------------------------------------
 * Single source of truth for staff password strength rules,
 * shared by:
 *   - POST /api/users            (admin create-user)
 *   - POST /api/users/me/password (self-service change)
 *
 * Policy: >= 16 characters with at least one lowercase letter,
 * one uppercase letter, one number, and one special (non-
 * alphanumeric) character. Firebase only enforces 6 characters,
 * so this layer is what makes the rule consistent everywhere.
 *
 * PASSWORD_REQUIREMENTS is exported so the UI can render a live
 * checklist from the same definitions (mirrored in the web repo's
 * src/lib/passwordPolicy.js — the two repos can't share modules,
 * so the rule set is duplicated and kept identical).
 * --------------------------------------------------------------
 */

const PASSWORD_REQUIREMENTS = [
  {
    id: 'length',
    label: 'At least 16 characters',
    message: 'must be at least 16 characters',
    test: (password) => password.length >= 16,
  },
  {
    id: 'lowercase',
    label: 'One lowercase letter',
    message: 'must contain at least 1 lowercase letter',
    test: (password) => /[a-z]/.test(password),
  },
  {
    id: 'uppercase',
    label: 'One uppercase letter',
    message: 'must contain at least 1 uppercase letter',
    test: (password) => /[A-Z]/.test(password),
  },
  {
    id: 'number',
    label: 'One number',
    message: 'must contain at least 1 number',
    test: (password) => /[0-9]/.test(password),
  },
  {
    id: 'special',
    label: 'One special character',
    message: 'must contain at least 1 special character',
    test: (password) => /[^A-Za-z0-9]/.test(password),
  },
];

/**
 * Returns the list of unmet requirement messages (empty when valid).
 * Non-string input reports every requirement as unmet instead of
 * throwing, so callers never crash on a malformed body.
 *
 * @param {string} password
 * @returns {string[]}
 */
function passwordFailures(password) {
  if (typeof password !== 'string') {
    return PASSWORD_REQUIREMENTS.map((requirement) => requirement.message);
  }
  return PASSWORD_REQUIREMENTS.filter(
    (requirement) => !requirement.test(password)
  ).map((requirement) => requirement.message);
}

/**
 * @param {string} password
 * @returns {boolean}
 */
function isStrongPassword(password) {
  return passwordFailures(password).length === 0;
}

module.exports = { PASSWORD_REQUIREMENTS, passwordFailures, isStrongPassword };
