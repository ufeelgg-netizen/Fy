require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const { nanoid } = require("nanoid");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const SESSION_SECRET = process.env.SESSION_SECRET || "CHANGE_ME";
const isProduction = process.env.NODE_ENV === "production";

if (isProduction && SESSION_SECRET === "CHANGE_ME") {
  console.warn("WARNING: Set SESSION_SECRET in production.");
}

const dataDir = path.join(__dirname, "data");
const fs = require("fs");
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, "app.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'USER' CHECK(role IN ('USER','HELPER','ADMIN')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','SUSPENDED')),
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS helper_profiles (
  user_id INTEGER PRIMARY KEY,
  bio TEXT NOT NULL DEFAULT '',
  categories TEXT NOT NULL DEFAULT '',
  experience TEXT NOT NULL DEFAULT '',
  verification TEXT NOT NULL DEFAULT 'PENDING' CHECK(verification IN ('PENDING','APPROVED','REJECTED')),
  available INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requester_id INTEGER NOT NULL,
  helper_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','ENDED')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at TEXT,
  FOREIGN KEY(requester_id) REFERENCES users(id),
  FOREIGN KEY(helper_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  sender_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY(sender_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id INTEGER NOT NULL,
  reported_user_id INTEGER NOT NULL,
  conversation_id INTEGER,
  message_id INTEGER,
  reason TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','REVIEWING','CLOSED')),
  priority TEXT NOT NULL DEFAULT 'NORMAL' CHECK(priority IN ('LOW','NORMAL','HIGH')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  resolved_by INTEGER,
  FOREIGN KEY(reporter_id) REFERENCES users(id),
  FOREIGN KEY(reported_user_id) REFERENCES users(id),
  FOREIGN KEY(conversation_id) REFERENCES conversations(id),
  FOREIGN KEY(message_id) REFERENCES messages(id),
  FOREIGN KEY(resolved_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id INTEGER,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(actor_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, id);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, created_at);
`);

function now() {
  return Math.floor(Date.now() / 1000);
}

function audit(actorId, action, targetType, targetId, metadata = {}) {
  db.prepare(`
    INSERT INTO audit_logs(actor_id, action, target_type, target_id, metadata)
    VALUES (?, ?, ?, ?, ?)
  `).run(actorId || null, action, targetType, targetId || null, JSON.stringify(metadata));
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status: row.status,
    displayName: row.display_name
  };
}

function createSession(userId, res) {
  const token = nanoid(48);
  db.prepare("INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)")
    .run(token, userId, now() + 60 * 60 * 24 * 14);

  res.cookie("sid", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    maxAge: 1000 * 60 * 60 * 24 * 14,
    path: "/"
  });
}

function auth(req, res, next) {
  const token = req.cookies.sid;
  if (!token) return res.status(401).json({ error: "AUTH_REQUIRED" });

  const row = db.prepare(`
    SELECT u.*
    FROM sessions s
    JOIN users u ON u.id=s.user_id
    WHERE s.token=? AND s.expires_at>? AND u.status='ACTIVE'
  `).get(token, now());

  if (!row) return res.status(401).json({ error: "SESSION_INVALID" });
  req.user = row;
  next();
}

function adminOnly(req, res, next) {
  if (req.user.role !== "ADMIN") return res.status(403).json({ error: "ADMIN_REQUIRED" });
  next();
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false
});

app.use(helmet({ crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: "32kb" }));
app.use(cookieParser());
app.use("/api/auth", authLimiter);
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.post("/api/auth/register", (req, res) => {
  const { email, password, displayName, mode } = req.body || {};
  if (!email || !password || !displayName) {
    return res.status(400).json({ error: "MISSING_FIELDS" });
  }
  if (password.length < 8) return res.status(400).json({ error: "PASSWORD_TOO_SHORT" });

  const normalized = String(email).trim().toLowerCase();
  const role = mode === "HELPER" ? "HELPER" : "USER";
  const hash = bcrypt.hashSync(password, 12);

  try {
    const result = db.prepare(`
      INSERT INTO users(email,password_hash,role,display_name)
      VALUES(?,?,?,?)
    `).run(normalized, hash, role, String(displayName).trim().slice(0, 40));

    if (role === "HELPER") {
      db.prepare("INSERT INTO helper_profiles(user_id) VALUES(?)").run(result.lastInsertRowid);
    }

    audit(result.lastInsertRowid, "REGISTER", "USER", result.lastInsertRowid);
    createSession(result.lastInsertRowid, res);
    res.json({ ok: true });
  } catch {
    res.status(409).json({ error: "EMAIL_ALREADY_USED" });
  }
});

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare("SELECT * FROM users WHERE email=?").get(String(email || "").trim().toLowerCase());

  if (!user || !bcrypt.compareSync(String(password || ""), user.password_hash)) {
    return res.status(401).json({ error: "INVALID_CREDENTIALS" });
  }
  if (user.status !== "ACTIVE") return res.status(403).json({ error: "ACCOUNT_SUSPENDED" });

  db.prepare("UPDATE users SET last_login_at=CURRENT_TIMESTAMP WHERE id=?").run(user.id);
  audit(user.id, "LOGIN", "USER", user.id);
  createSession(user.id, res);
  res.json({ ok: true, user: publicUser(user) });
});

app.post("/api/auth/logout", (req, res) => {
  const token = req.cookies.sid;
  if (token) db.prepare("DELETE FROM sessions WHERE token=?").run(token);
  res.clearCookie("sid");
  res.json({ ok: true });
});

app.get("/api/me", auth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.get("/api/helpers", auth, (req, res) => {
  const rows = db.prepare(`
    SELECT u.id,u.display_name,h.bio,h.categories,h.experience,h.available
    FROM users u JOIN helper_profiles h ON h.user_id=u.id
    WHERE u.role='HELPER' AND u.status='ACTIVE'
      AND h.verification='APPROVED' AND h.available=1
    ORDER BY u.id DESC
  `).all();

  res.json({
    helpers: rows.map(x => ({
      id: x.id,
      displayName: x.display_name,
      bio: x.bio,
      categories: x.categories.split(",").map(s => s.trim()).filter(Boolean),
      experience: x.experience
    }))
  });
});

app.post("/api/helpers/apply", auth, (req, res) => {
  const { bio = "", categories = "", experience = "" } = req.body || {};
  db.prepare(`
    INSERT INTO helper_profiles(user_id,bio,categories,experience,verification)
    VALUES(?,?,?,?, 'PENDING')
    ON CONFLICT(user_id) DO UPDATE SET
      bio=excluded.bio,
      categories=excluded.categories,
      experience=excluded.experience,
      verification='PENDING'
  `).run(req.user.id, String(bio).slice(0, 1000), String(categories).slice(0, 300), String(experience).slice(0, 700));

  db.prepare("UPDATE users SET role='HELPER' WHERE id=?").run(req.user.id);
  audit(req.user.id, "HELPER_APPLY", "USER", req.user.id);
  res.json({ ok: true });
});

app.patch("/api/helpers/availability", auth, (req, res) => {
  const available = req.body?.available ? 1 : 0;
  db.prepare("UPDATE helper_profiles SET available=? WHERE user_id=?").run(available, req.user.id);
  res.json({ ok: true });
});

function getConversationForUser(id, userId) {
  return db.prepare(`
    SELECT c.*,
      ru.display_name requester_name,
      hu.display_name helper_name
    FROM conversations c
    JOIN users ru ON ru.id=c.requester_id
    JOIN users hu ON hu.id=c.helper_id
    WHERE c.id=? AND (c.requester_id=? OR c.helper_id=?)
  `).get(id, userId, userId);
}

app.post("/api/conversations", auth, (req, res) => {
  const helperId = Number(req.body?.helperId);
  if (!helperId || helperId === req.user.id) return res.status(400).json({ error: "INVALID_HELPER" });

  const helper = db.prepare(`
    SELECT u.id FROM users u JOIN helper_profiles h ON h.user_id=u.id
    WHERE u.id=? AND u.role='HELPER' AND u.status='ACTIVE'
      AND h.verification='APPROVED' AND h.available=1
  `).get(helperId);

  if (!helper) return res.status(404).json({ error: "HELPER_NOT_AVAILABLE" });

  const existing = db.prepare(`
    SELECT * FROM conversations
    WHERE requester_id=? AND helper_id=? AND status='OPEN'
    ORDER BY id DESC LIMIT 1
  `).get(req.user.id, helperId);

  if (existing) return res.json({ conversation: existing });

  const result = db.prepare(`
    INSERT INTO conversations(requester_id,helper_id) VALUES(?,?)
  `).run(req.user.id, helperId);

  audit(req.user.id, "CONVERSATION_CREATE", "CONVERSATION", result.lastInsertRowid);
  res.json({ conversation: getConversationForUser(result.lastInsertRowid, req.user.id) });
});

app.get("/api/conversations", auth, (req, res) => {
  const rows = db.prepare(`
    SELECT c.*,
      ru.display_name requester_name,
      hu.display_name helper_name
    FROM conversations c
    JOIN users ru ON ru.id=c.requester_id
    JOIN users hu ON hu.id=c.helper_id
    WHERE c.requester_id=? OR c.helper_id=?
    ORDER BY c.id DESC
  `).all(req.user.id, req.user.id);

  res.json({ conversations: rows });
});

app.get("/api/conversations/:id/messages", auth, (req, res) => {
  const c = getConversationForUser(Number(req.params.id), req.user.id);
  if (!c) return res.status(404).json({ error: "NOT_FOUND" });

  const messages = db.prepare(`
    SELECT m.id,m.content,m.created_at,m.sender_id,u.display_name sender_name
    FROM messages m JOIN users u ON u.id=m.sender_id
    WHERE m.conversation_id=? ORDER BY m.id ASC
  `).all(c.id);

  res.json({ conversation: c, messages });
});

app.post("/api/conversations/:id/messages", auth, (req, res) => {
  const c = getConversationForUser(Number(req.params.id), req.user.id);
  if (!c) return res.status(404).json({ error: "NOT_FOUND" });
  if (c.status !== "OPEN") return res.status(400).json({ error: "CONVERSATION_ENDED" });

  const content = String(req.body?.content || "").trim();
  if (!content) return res.status(400).json({ error: "EMPTY_MESSAGE" });
  if (content.length > 2000) return res.status(400).json({ error: "MESSAGE_TOO_LONG" });

  const result = db.prepare(`
    INSERT INTO messages(conversation_id,sender_id,content) VALUES(?,?,?)
  `).run(c.id, req.user.id, content);

  res.json({
    ok: true,
    message: db.prepare(`
      SELECT m.id,m.content,m.created_at,m.sender_id,u.display_name sender_name
      FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.id=?
    `).get(result.lastInsertRowid)
  });
});

app.post("/api/conversations/:id/end", auth, (req, res) => {
  const c = getConversationForUser(Number(req.params.id), req.user.id);
  if (!c) return res.status(404).json({ error: "NOT_FOUND" });

  db.prepare(`
    UPDATE conversations SET status='ENDED', ended_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(c.id);
  audit(req.user.id, "CONVERSATION_END", "CONVERSATION", c.id);
  res.json({ ok: true });
});

app.post("/api/reports", auth, (req, res) => {
  const conversationId = Number(req.body?.conversationId);
  const messageId = req.body?.messageId ? Number(req.body.messageId) : null;
  const reason = String(req.body?.reason || "").trim();
  const description = String(req.body?.description || "").trim();

  if (!conversationId || !reason) return res.status(400).json({ error: "MISSING_REPORT_FIELDS" });

  const c = getConversationForUser(conversationId, req.user.id);
  if (!c) return res.status(403).json({ error: "NOT_ALLOWED" });

  const reportedUserId = c.requester_id === req.user.id ? c.helper_id : c.requester_id;

  if (messageId) {
    const message = db.prepare("SELECT * FROM messages WHERE id=? AND conversation_id=?")
      .get(messageId, conversationId);
    if (!message) return res.status(400).json({ error: "INVALID_MESSAGE" });
  }

  const result = db.prepare(`
    INSERT INTO reports(reporter_id,reported_user_id,conversation_id,message_id,reason,description)
    VALUES(?,?,?,?,?,?)
  `).run(req.user.id, reportedUserId, conversationId, messageId, reason, description.slice(0, 1500));

  audit(req.user.id, "REPORT_CREATE", "REPORT", result.lastInsertRowid);
  res.json({ ok: true });
});

app.get("/api/admin/stats", auth, adminOnly, (req, res) => {
  const count = table => db.prepare(`SELECT COUNT(*) c FROM ${table}`).get().c;
  res.json({
    users: count("users"),
    helpers: db.prepare("SELECT COUNT(*) c FROM helper_profiles").get().c,
    pendingHelpers: db.prepare("SELECT COUNT(*) c FROM helper_profiles WHERE verification='PENDING'").get().c,
    openReports: db.prepare("SELECT COUNT(*) c FROM reports WHERE status!='CLOSED'").get().c,
    conversations: count("conversations")
  });
});

app.get("/api/admin/helpers", auth, adminOnly, (req, res) => {
  res.json({
    helpers: db.prepare(`
      SELECT u.id,u.email,u.display_name,h.bio,h.categories,h.experience,h.verification,h.available,h.created_at
      FROM users u JOIN helper_profiles h ON h.user_id=u.id
      ORDER BY h.verification='PENDING' DESC,h.created_at DESC
    `).all()
  });
});

app.patch("/api/admin/helpers/:id", auth, adminOnly, (req, res) => {
  const id = Number(req.params.id);
  const verification = String(req.body?.verification || "");
  if (!["APPROVED","REJECTED","PENDING"].includes(verification)) return res.status(400).json({ error: "INVALID_STATUS" });

  db.prepare("UPDATE helper_profiles SET verification=? WHERE user_id=?").run(verification, id);
  audit(req.user.id, "HELPER_REVIEW", "USER", id, { verification });
  res.json({ ok: true });
});

app.get("/api/admin/reports", auth, adminOnly, (req, res) => {
  res.json({
    reports: db.prepare(`
      SELECT r.*, reporter.display_name reporter_name, reported.display_name reported_name
      FROM reports r
      JOIN users reporter ON reporter.id=r.reporter_id
      JOIN users reported ON reported.id=r.reported_user_id
      ORDER BY r.status='OPEN' DESC,r.created_at DESC
    `).all()
  });
});

app.patch("/api/admin/reports/:id", auth, adminOnly, (req, res) => {
  const id = Number(req.params.id);
  const status = String(req.body?.status || "");
  if (!["OPEN","REVIEWING","CLOSED"].includes(status)) return res.status(400).json({ error: "INVALID_STATUS" });

  db.prepare(`
    UPDATE reports SET status=?, resolved_at=CASE WHEN ?='CLOSED' THEN CURRENT_TIMESTAMP ELSE NULL END,
    resolved_by=CASE WHEN ?='CLOSED' THEN ? ELSE NULL END
    WHERE id=?
  `).run(status, status, status, req.user.id, id);

  audit(req.user.id, "REPORT_REVIEW", "REPORT", id, { status });
  res.json({ ok: true });
});

app.get("/api/admin/audit", auth, adminOnly, (req, res) => {
  res.json({
    logs: db.prepare(`
      SELECT a.*,u.display_name actor_name
      FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id
      ORDER BY a.id DESC LIMIT 200
    `).all()
  });
});

function ensureAdmin() {
  const email = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || "");
  if (!email || !password) return;

  const exists = db.prepare("SELECT id FROM users WHERE email=?").get(email);
  if (exists) return;

  const hash = bcrypt.hashSync(password, 12);
  db.prepare(`
    INSERT INTO users(email,password_hash,role,status,display_name)
    VALUES(?,?, 'ADMIN','ACTIVE','Administrator')
  `).run(email, hash);
  console.log(`Initial admin created: ${email}`);
}

ensureAdmin();

app.get("*splat", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Support platform running on port ${PORT}`);
});
