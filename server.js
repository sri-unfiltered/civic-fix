
const express = require("express");
const cors = require("cors");
const Database = require("better-sqlite3");
const crypto = require("crypto");

const app = express();
const db = new Database("civicfix.db");
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "2mb" }));

// Create the reports table automatically.
db.exec(`
  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trackingId TEXT UNIQUE NOT NULL,
    issueType TEXT NOT NULL,
    location TEXT NOT NULL,
    description TEXT NOT NULL,
    severity TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Submitted',
    createdAt TEXT NOT NULL
  )
`);

const createReport = db.prepare(`
  INSERT INTO reports
  (trackingId, issueType, location, description,
   severity, status, createdAt)
  VALUES (?, ?, ?, ?, ?, 'Submitted', ?)
`);

const findAllReports = db.prepare(`
  SELECT * FROM reports ORDER BY id DESC
`);

const findReport = db.prepare(`
  SELECT * FROM reports WHERE trackingId = ?
`);

const updateReport = db.prepare(`
  UPDATE reports SET status = ? WHERE trackingId = ?
`);

const allowedTypes = [
  "Roads", "Waste", "Water", "Lighting", "Other"
];

const allowedSeverities = [
  "Low", "Medium", "High", "Critical"
];

const allowedStatuses = [
  "Submitted",
  "Under Review",
  "In Progress",
  "Resolved",
  "Rejected"
];

// Basic health check.
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "CivicFix API is running"
  });
});

// Submit a complaint.
app.post("/api/reports", (req, res) => {
  const {
    issueType,
    location,
    description,
    severity
  } = req.body;

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

  const trackingId =
    "CF-" + crypto.randomBytes(4).toString("hex").toUpperCase();

  const createdAt = new Date().toISOString();

  createReport.run(
    trackingId,
    issueType,
    location.trim(),
    description.trim(),
    severity,
    createdAt
  );

  const report = findReport.get(trackingId);

  res.status(201).json({
    success: true,
    message: "Complaint submitted successfully.",
    report
  });
});

// List complaints for the dashboard.
app.get("/api/reports", (req, res) => {
  res.json({
    success: true,
    reports: findAllReports.all()
  });
});

// Track a specific complaint.
app.get("/api/reports/:trackingId", (req, res) => {
  const report = findReport.get(req.params.trackingId);

  if (!report) {
    return res.status(404).json({
      success: false,
      message: "Complaint not found."
    });
  }

  res.json({ success: true, report });
});

// Update complaint status.
// IMPORTANT: Add real admin authentication before public deployment.
app.patch("/api/reports/:trackingId", (req, res) => {
  const { status } = req.body;

  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({
      success: false,
      message: "Invalid complaint status."
    });
  }

  const result = updateReport.run(
    status,
    req.params.trackingId
  );

  if (result.changes === 0) {
    return res.status(404).json({
      success: false,
      message: "Complaint not found."
    });
  }

  res.json({
    success: true,
    message: "Complaint status updated."
  });
});

app.listen(PORT, () => {
  console.log(`CivicFix API running on port ${PORT}`);
});
