"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

if (typeof process.loadEnvFile !== "function") {
  throw new Error("CivicFix admin login requires Node.js 20.12 or newer.");
}

const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const express = require("express");
const cors = require("cors");
const Database = require("better-sqlite3");

const ADMIN_USERNAME = (process.env.ADMIN_USERNAME || "").trim();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:5500";
const PORT = Number(process.env.PORT || 3000);
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const SESSION_COOKIE = "civicfix_admin";
const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000;
const SESSION_LIFETIME_SECONDS = SESSION_LIFETIME_MS / 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 10;

if (!ADMIN_USERNAME.trim()) {
  throw new Error("Set ADMIN_USERNAME in backend/.env before starting CivicFix.");
}
if (ADMIN_PASSWORD.length > 256) {
  throw new Error("ADMIN_PASSWORD must be 256 characters or fewer.");
}if (ADMIN_USERNAME.length > 80) {
  throw new Error("ADMIN_USERNAME must be 80 characters or fewer.");
}
if (
  ADMIN_PASSWORD.length < 12 ||
  ADMIN_PASSWORD.toLowerCase().startsWith("replace-")
) {
  throw new Error("Set a unique ADMIN_PASSWORD of at least 12 characters in backend/.env.");
}

let allowedFrontendOrigin;
try {
  allowedFrontendOrigin = new URL(FRONTEND_ORIGIN).origin;
} catch {
  throw new Error("FRONTEND_ORIGIN in backend/.env must be a valid website origin.");
}

const passwordSalt = crypto
  .createHash("sha256")
  .update("civicfix-admin-password-v1|" + ADMIN_USERNAME)
  .digest()
  .subarray(0, 16);
const configuredPasswordHash = crypto.scryptSync(ADMIN_PASSWORD, passwordSalt, 64);
const configuredUsernameHash = crypto
  .createHash("sha256")
  .update(ADMIN_USERNAME, "utf8")
  .digest();

function credentialsAreValid(username, password) {
  const usernameToCheck = typeof username === "string" ? username : "";
  const passwordToCheck =
    typeof password === "string" ? password.slice(0, 256) : "";
  const suppliedUsernameHash = crypto
    .createHash("sha256")
    .update(usernameToCheck, "utf8")
    .digest();
  const usernameMatches = crypto.timingSafeEqual(
    suppliedUsernameHash,
    configuredUsernameHash
  );
  const suppliedPasswordHash = crypto.scryptSync(
    passwordToCheck,
    passwordSalt,
    64
  );
  const passwordMatches = crypto.timingSafeEqual(
    suppliedPasswordHash,
    configuredPasswordHash
  );

  return (
    typeof username === "string" &&
    typeof password === "string" &&
    password.length <= 256 &&
    usernameMatches &&
    passwordMatches
  );
}

const databasePath = process.env.CIVICFIX_DB_PATH
  ? path.resolve(process.env.CIVICFIX_DB_PATH)
  : path.join(__dirname, "civicfix.db");
const db = new Database(databasePath);

db.exec(
  "CREATE TABLE IF NOT EXISTS reports (" +
    "id INTEGER PRIMARY KEY AUTOINCREMENT," +
    "trackingId TEXT UNIQUE NOT NULL," +
    "issueType TEXT NOT NULL," +
    "location TEXT NOT NULL," +
    "description TEXT NOT NULL," +
    "severity TEXT NOT NULL," +
    "status TEXT NOT NULL DEFAULT 'Submitted'," +
    "createdAt TEXT NOT NULL" +
  ");" +
  "CREATE TABLE IF NOT EXISTS admin_sessions (" +
    "id TEXT PRIMARY KEY," +
    "username TEXT NOT NULL," +
    "expiresAt INTEGER NOT NULL," +
    "createdAt TEXT NOT NULL" +
  ");" +
  "CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires_at " +
  "ON admin_sessions(expiresAt);"
);

const findAllReports = db.prepare("SELECT * FROM reports ORDER BY id DESC");
const findReport = db.prepare("SELECT * FROM reports WHERE trackingId = ?");
const createReport = db.prepare(
  "INSERT INTO reports " +
    "(trackingId, issueType, location, description, severity, status, createdAt) " +
    "VALUES (?, ?, ?, ?, ?, 'Submitted', ?)"
);
const updateReport = db.prepare(
  "UPDATE reports SET status = ? WHERE trackingId = ?"
);

const findAdminSession = db.prepare(
  "SELECT id, username, expiresAt FROM admin_sessions WHERE id = ?"
);
const createAdminSession = db.prepare(
  "INSERT INTO admin_sessions (id, username, expiresAt, createdAt) VALUES (?, ?, ?, ?)"
);
const deleteAdminSession = db.prepare(
  "DELETE FROM admin_sessions WHERE id = ?"
);
const deleteExpiredSessions = db.prepare(
  "DELETE FROM admin_sessions WHERE expiresAt <= ?"
);

const reportStores = [{ db, findAllReports, findReport, updateReport }];
const secondaryDatabasePath = path.resolve(__dirname, "..", "civicfix.db");

if (
  !process.env.CIVICFIX_DB_PATH &&
  secondaryDatabasePath !== path.resolve(databasePath) &&
  fs.existsSync(secondaryDatabasePath)
) {
  const secondaryDb = new Database(secondaryDatabasePath);
  const hasReportsTable = secondaryDb
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'reports'"
    )
    .get();

  if (hasReportsTable) {
    reportStores.push({
      db: secondaryDb,
      findAllReports: secondaryDb.prepare(
        "SELECT * FROM reports ORDER BY id DESC"
      ),
      findReport: secondaryDb.prepare(
        "SELECT * FROM reports WHERE trackingId = ?"
      ),
      updateReport: secondaryDb.prepare(
        "UPDATE reports SET status = ? WHERE trackingId = ?"
      )
    });
  } else {
    secondaryDb.close();
  }
}

function findReportAcrossStores(trackingId) {
  for (const store of reportStores) {
    const report = store.findReport.get(trackingId);
    if (report) return report;
  }

  return null;
}

function getAllReports() {
  const reportsByTrackingId = new Map();

  for (const store of reportStores) {
    for (const report of store.findAllReports.all()) {
      if (!reportsByTrackingId.has(report.trackingId)) {
        reportsByTrackingId.set(report.trackingId, report);
      }
    }
  }

  return [...reportsByTrackingId.values()].sort((left, right) => {
    const dateDifference =
      new Date(right.createdAt || 0).getTime() -
      new Date(left.createdAt || 0).getTime();

    return Number.isNaN(dateDifference) || dateDifference === 0
      ? Number(right.id || 0) - Number(left.id || 0)
      : dateDifference;
  });
}

const app = express();

app.use(
  cors({
    origin: allowedFrontendOrigin,
    credentials: true
  })
);
app.use(express.json({ limit: "2mb" }));

const loginAttempts = new Map();

function isLoginRateLimited(key) {
  const now = Date.now();

  for (const [attemptKey, attempt] of loginAttempts) {
    if (attempt.resetAt <= now) loginAttempts.delete(attemptKey);
  }

  const attempt = loginAttempts.get(key);
  return Boolean(attempt && attempt.count >= MAX_LOGIN_ATTEMPTS);
}

function recordFailedLogin(key) {
  const now = Date.now();
  const attempt = loginAttempts.get(key);

  if (!attempt || attempt.resetAt <= now) {
    loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return;
  }

  attempt.count += 1;
}

function clearLoginFailures(key) {
  loginAttempts.delete(key);
}

function readSessionCookie(req) {
  const cookies = String(req.headers.cookie || "").split(";");

  for (const cookie of cookies) {
    const separator = cookie.indexOf("=");
    if (separator < 0) continue;

    const name = cookie.slice(0, separator).trim();
    if (name !== SESSION_COOKIE) continue;

    try {
      return decodeURIComponent(cookie.slice(separator + 1).trim());
    } catch {
      return "";
    }
  }

  return "";
}

function hashSessionId(sessionId) {
  return crypto.createHash("sha256").update(sessionId, "utf8").digest("hex");
}

function setSessionCookie(res, sessionId) {
  const attributes = [
    SESSION_COOKIE + "=" + encodeURIComponent(sessionId),
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=" + SESSION_LIFETIME_SECONDS
  ];

  if (IS_PRODUCTION) attributes.push("Secure");
  res.append("Set-Cookie", attributes.join("; "));
}

function clearSessionCookie(res) {
  const attributes = [
    SESSION_COOKIE + "=",
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT"
  ];

  if (IS_PRODUCTION) attributes.push("Secure");
  res.append("Set-Cookie", attributes.join("; "));
}

function getAdminSession(req) {
  const rawSessionId = readSessionCookie(req);
  if (!/^[A-Za-z0-9_-]{43}$/.test(rawSessionId)) return null;

  const sessionId = hashSessionId(rawSessionId);
  const session = findAdminSession.get(sessionId);

  if (!session || session.expiresAt <= Date.now()) {
    if (session) deleteAdminSession.run(sessionId);
    return null;
  }

  return { id: sessionId, username: session.username };
}

function requireAdmin(req, res, next) {
  const session = getAdminSession(req);

  if (!session) {
    return res.status(401).json({
      success: false,
      message: "Admin login required."
    });
  }

  req.adminSession = session;
  next();
}

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "CivicFix API is running"
  });
});

app.get("/api/admin/session", (req, res) => {
  const session = getAdminSession(req);

  res.set("Cache-Control", "no-store").json({
    success: true,
    authenticated: Boolean(session),
    username: session ? session.username : null
  });
});

app.post("/api/admin/login", (req, res) => {
  const clientKey = req.socket.remoteAddress || "unknown";

  if (isLoginRateLimited(clientKey)) {
    return res.status(429).json({
      success: false,
      message: "Too many sign-in attempts. Wait 15 minutes and try again."
    });
  }

  const body = req.body || {};
  const username = body.username;
  const password = body.password;

  if (!credentialsAreValid(username, password)) {
    recordFailedLogin(clientKey);
    return res.status(401).json({
      success: false,
      message: "The username or password is incorrect."
    });
  }

  clearLoginFailures(clientKey);

  const currentSession = getAdminSession(req);
  if (currentSession) deleteAdminSession.run(currentSession.id);

  deleteExpiredSessions.run(Date.now());

  const rawSessionId = crypto.randomBytes(32).toString("base64url");
  const sessionId = hashSessionId(rawSessionId);
  const expiresAt = Date.now() + SESSION_LIFETIME_MS;

  createAdminSession.run(
    sessionId,
    ADMIN_USERNAME,
    expiresAt,
    new Date().toISOString()
  );

  setSessionCookie(res, rawSessionId);
  res.set("Cache-Control", "no-store").json({
    success: true,
    message: "Signed in successfully.",
    authenticated: true,
    username: ADMIN_USERNAME
  });
});

app.post("/api/admin/logout", (req, res) => {
  const session = getAdminSession(req);
  if (session) deleteAdminSession.run(session.id);

  clearSessionCookie(res);
  res.set("Cache-Control", "no-store").json({
    success: true,
    message: "Signed out successfully."
  });
});

const allowedTypes = ["Roads", "Waste", "Water", "Lighting", "Other"];
const allowedSeverities = ["Low", "Medium", "High", "Critical"];
const allowedStatuses = [
  "Submitted",
  "Under Review",
  "In Progress",
  "Resolved",
  "Rejected"
];

app.post("/api/reports", (req, res) => {
  const { issueType, location, description, severity } = req.body || {};

  if (
    typeof issueType !== "string" ||
    !allowedTypes.includes(issueType) ||
    typeof location !== "string" ||
    !location.trim() ||
    typeof description !== "string" ||
    !description.trim() ||
    !allowedSeverities.includes(severity)
  ) {
    return res.status(400).json({
      success: false,
      message: "Please provide valid complaint details."
    });
  }

  let trackingId = "";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate =
      "CF-" + crypto.randomBytes(4).toString("hex").toUpperCase();

    if (!findReportAcrossStores(candidate)) {
      trackingId = candidate;
      break;
    }
  }

  if (!trackingId) {
    return res.status(503).json({
      success: false,
      message: "Could not create a unique tracking ID. Please try again."
    });
  }

  const createdAt = new Date().toISOString();

  createReport.run(
    trackingId,
    issueType,
    location.trim(),
    description.trim(),
    severity,
    createdAt
  );

  res.status(201).json({
    success: true,
    message: "Complaint submitted successfully.",
    report: findReport.get(trackingId)
  });
});

app.get("/api/reports", requireAdmin, (req, res) => {
  res.set("Cache-Control", "no-store").json({
    success: true,
    reports: getAllReports()
  });
});

app.get("/api/reports/:trackingId", (req, res) => {
  const report = findReportAcrossStores(req.params.trackingId);

  if (!report) {
    return res.status(404).json({
      success: false,
      message: "Complaint not found."
    });
  }

  res.json({ success: true, report });
});

app.patch("/api/reports/:trackingId", requireAdmin, (req, res) => {
  const { status } = req.body || {};

  if (typeof status !== "string" || !allowedStatuses.includes(status)) {
    return res.status(400).json({
      success: false,
      message: "Invalid complaint status."
    });
  }

  const existingReport = findReportAcrossStores(req.params.trackingId);

  if (!existingReport) {
    return res.status(404).json({
      success: false,
      message: "Complaint not found."
    });
  }

  for (const store of reportStores) {
    store.updateReport.run(status, req.params.trackingId);
  }

  res.json({
    success: true,
    message: "Complaint status updated."
  });
});

app.listen(PORT, () => {
  console.log("CivicFix API running on port " + PORT);
  console.log("Admin API allows frontend origin " + allowedFrontendOrigin);
  console.log(
    "Using " +
      reportStores.length +
      " CivicFix report database" +
      (reportStores.length === 1 ? "." : "s.")
  );
});