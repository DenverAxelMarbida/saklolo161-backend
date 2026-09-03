/**
 * routes/authRoutes.js
 * --------------------------------------------------------------
 * Maps HTTP verbs + paths to authController functions.
 * Mounted at /api/auth in server.js.
 * --------------------------------------------------------------
 */

const express = require('express');
const router = express.Router();

const { login } = require('../controllers/authController');

// POST /api/auth/login - authenticate staff (dispatcher/admin) and issue a JWT
router.post('/login', login);

module.exports = router;
