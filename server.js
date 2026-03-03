const express = require("express");
const crypto = require("crypto");
const { Pool } = require("pg");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// ============================================================
// Database connection (local Supabase Postgres)
// ============================================================
const pool = new Pool({
  host: "127.0.0.1",
  port: 54392,
  database: "postgres",
  user: "postgres",
  password: "postgres",
});

// ============================================================
// Configuration
// ============================================================
const TOKEN_BYTES = 32; // 256 bits of entropy (see documentation for reasoning)
const TOKEN_EXPIRY_MINUTES = 15;
const SESSION_EXPIRY_HOURS = 24;
const HMAC_SECRET = crypto.randomBytes(32); // Server-side secret for stateless tokens
const BASE_URL = "http://localhost:3000";

// ============================================================
// Utility: generate a cryptographically random token
// ============================================================
function generateToken() {
  const rawBytes = crypto.randomBytes(TOKEN_BYTES);
  // URL-safe Base64 encoding: replace +/ with -_, strip padding '='
  // This avoids percent-encoding overhead in URLs while preserving full entropy.
  const urlSafe = rawBytes
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return { rawBytes, urlSafe };
}

// ============================================================
// Utility: hash a token for storage (SHA-256)
//
// Why SHA-256 and not bcrypt/scrypt?
//   Magic link tokens are high-entropy random values (256 bits).
//   Brute-forcing 2^256 is computationally infeasible regardless
//   of hash speed. Slow hashes like bcrypt are designed to protect
//   LOW-entropy secrets (human-chosen passwords). For random tokens,
//   a single pass of SHA-256 is both secure and fast.
// ============================================================
function hashToken(tokenUrlSafe) {
  return crypto.createHash("sha256").update(tokenUrlSafe).digest();
}

// ============================================================
// APPROACH 1: Stateful (Database-backed) Magic Links
// ============================================================

// POST /api/magic-link/request
// Body: { "email": "alice@example.com" }
// Generates a token, stores its hash, "sends" an email (simulated).
app.post("/api/magic-link/request", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Email is required" });

  try {
    const userResult = await pool.query(
      "SELECT id, email FROM users WHERE email = $1",
      [email]
    );

    if (userResult.rows.length === 0) {
      // Return same response to avoid user enumeration
      return res.json({
        message: "If that email is registered, a login link has been sent.",
      });
    }

    const user = userResult.rows[0];
    const { urlSafe } = generateToken();
    const tokenHash = hashToken(urlSafe);
    const expiresAt = new Date(
      Date.now() + TOKEN_EXPIRY_MINUTES * 60 * 1000
    );

    await pool.query(
      `INSERT INTO magic_link_tokens (user_id, token_hash, expires_at, created_ip)
       VALUES ($1, $2, $3, $4)`,
      [user.id, tokenHash, expiresAt, req.ip]
    );

    const loginUrl = `${BASE_URL}/api/magic-link/verify?token=${urlSafe}`;

    // In production this would send an actual email.
    // For the POC we log it and return it in the response.
    console.log(`\n--- SIMULATED EMAIL to ${email} ---`);
    console.log(`Click to login: ${loginUrl}`);
    console.log(`Expires: ${expiresAt.toISOString()}`);
    console.log(`-----------------------------------\n`);

    res.json({
      message: "If that email is registered, a login link has been sent.",
      _debug: { loginUrl, expiresAt },
    });
  } catch (err) {
    console.error("Error requesting magic link:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/magic-link/verify?token=...
// Verifies the token, marks it used, creates a session.
app.get("/api/magic-link/verify", async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: "Token is required" });

  const tokenHash = hashToken(token);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Atomic lookup + claim: the WHERE clause ensures the token is
    // both valid (exists, not used, not expired) and we atomically
    // mark it used in a single statement, preventing race conditions
    // where two concurrent requests try to use the same token.
    const result = await client.query(
      `UPDATE magic_link_tokens
       SET used_at = now(), used_ip = $2
       WHERE token_hash = $1
         AND used_at IS NULL
         AND expires_at > now()
       RETURNING user_id`,
      [tokenHash, req.ip]
    );

    if (result.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    const userId = result.rows[0].user_id;

    // Create a session
    const { urlSafe: sessionToken } = generateToken();
    const sessionHash = hashToken(sessionToken);
    const sessionExpires = new Date(
      Date.now() + SESSION_EXPIRY_HOURS * 3600 * 1000
    );

    await client.query(
      `INSERT INTO sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [userId, sessionHash, sessionExpires]
    );

    await client.query(
      "UPDATE users SET last_login = now() WHERE id = $1",
      [userId]
    );

    await client.query("COMMIT");

    const userResult = await pool.query(
      "SELECT id, email, name FROM users WHERE id = $1",
      [userId]
    );

    res.json({
      message: "Login successful",
      session_token: sessionToken,
      user: userResult.rows[0],
      expires_at: sessionExpires,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error verifying magic link:", err);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
});

// ============================================================
// APPROACH 2: Stateless (HMAC-based) Magic Links
//
// Instead of storing tokens in the database, we construct a
// self-contained signed payload: HMAC(userId + expiry, secret).
// The server only needs its secret key to verify the link.
//
// Trade-offs vs. stateful:
//   + No database write/read on the hot path
//   + No cleanup of expired tokens needed
//   - Cannot revoke a token once issued (until it expires)
//   - Cannot enforce single-use without state
//   - If the server secret leaks, all tokens are compromised
// ============================================================

function createStatelessToken(userId) {
  const expiresAt = Math.floor(
    Date.now() / 1000 + TOKEN_EXPIRY_MINUTES * 60
  );
  const payload = `${userId}.${expiresAt}`;
  const signature = crypto
    .createHmac("sha256", HMAC_SECRET)
    .update(payload)
    .digest("base64url");
  return { token: `${payload}.${signature}`, expiresAt };
}

function verifyStatelessToken(token) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [userId, expiresAtStr, signature] = parts;
  const expiresAt = parseInt(expiresAtStr, 10);
  if (isNaN(expiresAt)) return null;

  // Check expiry
  if (Math.floor(Date.now() / 1000) > expiresAt) return null;

  // Recompute HMAC and compare using timing-safe equality
  const payload = `${userId}.${expiresAtStr}`;
  const expected = crypto
    .createHmac("sha256", HMAC_SECRET)
    .update(payload)
    .digest("base64url");

  // Timing-safe comparison prevents timing attacks where an attacker
  // measures response time to guess the signature byte-by-byte.
  const sigBuf = Buffer.from(signature, "base64url");
  const expBuf = Buffer.from(expected, "base64url");
  if (sigBuf.length !== expBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;

  return { userId, expiresAt };
}

// POST /api/magic-link/stateless/request
app.post("/api/magic-link/stateless/request", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Email is required" });

  try {
    const userResult = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [email]
    );

    if (userResult.rows.length === 0) {
      return res.json({
        message: "If that email is registered, a login link has been sent.",
      });
    }

    const user = userResult.rows[0];
    const { token, expiresAt } = createStatelessToken(user.id);
    const loginUrl = `${BASE_URL}/api/magic-link/stateless/verify?token=${encodeURIComponent(token)}`;

    console.log(`\n--- SIMULATED EMAIL (stateless) to ${email} ---`);
    console.log(`Click to login: ${loginUrl}`);
    console.log(`Expires: ${new Date(expiresAt * 1000).toISOString()}`);
    console.log(`----------------------------------------------\n`);

    res.json({
      message: "If that email is registered, a login link has been sent.",
      _debug: { loginUrl, expiresAt: new Date(expiresAt * 1000) },
    });
  } catch (err) {
    console.error("Error requesting stateless magic link:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/magic-link/stateless/verify?token=...
app.get("/api/magic-link/stateless/verify", async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: "Token is required" });

  const result = verifyStatelessToken(token);
  if (!result) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  try {
    const userResult = await pool.query(
      "SELECT id, email, name FROM users WHERE id = $1",
      [result.userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: "User not found" });
    }

    await pool.query(
      "UPDATE users SET last_login = now() WHERE id = $1",
      [result.userId]
    );

    res.json({
      message: "Login successful (stateless)",
      user: userResult.rows[0],
    });
  } catch (err) {
    console.error("Error verifying stateless magic link:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================================
// Utility endpoints
// ============================================================

// GET /api/users — list all demo users
app.get("/api/users", async (_req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, email, name, last_login FROM users ORDER BY name"
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error listing users:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/tokens — list all magic link tokens (debug)
app.get("/api/tokens", async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.id, u.email, t.expires_at, t.used_at, t.created_at
       FROM magic_link_tokens t
       JOIN users u ON u.id = t.user_id
       ORDER BY t.created_at DESC
       LIMIT 50`
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error listing tokens:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================================
// Start server
// ============================================================
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`\nMagic Link POC server running at ${BASE_URL}`);
  console.log(`Supabase Studio: http://127.0.0.1:54393\n`);
});
