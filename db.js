const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./civicfix.db');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    category TEXT,
    description TEXT,
    location TEXT,
    priority TEXT,
    status TEXT DEFAULT 'Pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    photo_path TEXT
  )`);
});

module.exports = db;
