const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { pool } = require('./db');

const SESSION_DAYS = 30;

async function hashPassword(pw) {
  return bcrypt.hash(pw, 10);
}

async function verifyPassword(pw, hash) {
  return bcrypt.compare(pw, hash);
}

function newSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function createSession(userId) {
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await pool.query(
    'INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)',
    [token, userId, expiresAt]
  );
  return { token, expiresAt };
}

async function getUserFromToken(token) {
  if (!token) return null;
  const { rows } = await pool.query(
    `SELECT u.id, u.email
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.expires_at > now()`,
    [token]
  );
  return rows[0] || null;
}

async function deleteSession(token) {
  if (!token) return;
  await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
}

// Express middleware — requires a valid session cookie, attaches req.user, else 401
function requireAuth(req, res, next) {
  getUserFromToken(req.cookies && req.cookies.session)
    .then(user => {
      if (!user) return res.status(401).json({ error: 'Not logged in.' });
      req.user = user;
      next();
    })
    .catch(err => res.status(500).json({ error: err.message }));
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSession,
  getUserFromToken,
  deleteSession,
  requireAuth
};
