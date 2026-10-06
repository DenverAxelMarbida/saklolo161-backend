/**
 * routes/userRoutes.js
 * --------------------------------------------------------------
 * User-management endpoints. Two auth tiers:
 *
 *   - POST /me/password → verifyAuth ONLY. Any authenticated
 *     dispatcher or admin may change their OWN password (uid comes
 *     from the token — never the body). No requireAdmin here.
 *   - Everything else → verifyAuth + requireAdmin (403 for
 *     non-admins).
 *
 * Intentionally NO DELETE route: accounts are disabled (PATCH
 * /:uid/status), never deleted, so attribution survives.
 * Mounted at /api/users in server.js.
 * --------------------------------------------------------------
 */

const express = require('express');
const router = express.Router();

const verifyAuth = require('../middlewares/verifyAuth');
const requireAdmin = require('../middlewares/requireAdmin');
const {
  listUsers,
  createUser,
  updateUser,
  setUserEnabled,
  changeOwnPassword,
} = require('../controllers/userController');

// POST /api/users/me/password - change own password (any authenticated user)
router.post('/me/password', verifyAuth, changeOwnPassword);

// GET /api/users - list all accounts (admin only)
router.get('/', verifyAuth, requireAdmin, listUsers);

// POST /api/users - create an account with { email, password, agency, role }
router.post('/', verifyAuth, requireAdmin, createUser);

// PATCH /api/users/:uid/status - enable/disable an account (before /:uid)
router.patch('/:uid/status', verifyAuth, requireAdmin, setUserEnabled);

// PATCH /api/users/:uid - update email / agency / role
router.patch('/:uid', verifyAuth, requireAdmin, updateUser);

module.exports = router;
