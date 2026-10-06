/**
 * routes/userRoutes.js
 * --------------------------------------------------------------
 * Admin user-management endpoints. Every route runs verifyAuth
 * first (authentication → req.user), then requireAdmin
 * (authorization → 403 for non-admins).
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
} = require('../controllers/userController');

// GET /api/users - list all accounts (admin only)
router.get('/', verifyAuth, requireAdmin, listUsers);

// POST /api/users - create an account with { email, password, agency, role }
router.post('/', verifyAuth, requireAdmin, createUser);

// PATCH /api/users/:uid/status - enable/disable an account (before /:uid)
router.patch('/:uid/status', verifyAuth, requireAdmin, setUserEnabled);

// PATCH /api/users/:uid - update email / agency / role
router.patch('/:uid', verifyAuth, requireAdmin, updateUser);

module.exports = router;
