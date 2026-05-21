import express from "express";
import cors from "cors";
import session from "express-session";
import cookieParser from "cookie-parser";
import { execFileSync } from "child_process";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import dotenv from "dotenv";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import { googleTools, executeGoogleTool, agentHasGoogle, getConnectedAccounts, saveTokens as saveGoogleTokens } from "./src/google.js";
import { AGENTS, DEFAULT_MODEL, estimateCost, getContextWindow } from "./src/agents.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const BEADS_DIR = path.resolve(process.env.BEADS_PROJECT_DIR || "./beads-project");
const DB_PATH = path.resolve(process.env.DB_PATH || "./data/hub.db");
const IS_PROD = process.env.NODE_ENV === "production";

/* ═══════════════════════════════════════════
   MIDDLEWARE
   ═══════════════════════════════════════════ */
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: IS_PROD && process.env.USE_HTTPS === "true",
      httpOnly: true,
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      sameSite: "lax",
    },
  })
);

/* ═══════════════════════════════════════════
   DATABASE SETUP — multi-user ready
   ═══════════════════════════════════════════ */
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    tool_calls TEXT DEFAULT '[]',
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_conv_user_agent ON conversations(user_id, agent_id);
  CREATE INDEX IF NOT EXISTS idx_conv_time ON conversations(created_at);

  CREATE TABLE IF NOT EXISTS user_agent_context (
    user_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    context_json TEXT DEFAULT '{}',
    PRIMARY KEY (user_id, agent_id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS usage_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    estimated_cost_usd REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_usage_time ON usage_log(created_at);
  CREATE INDEX IF NOT EXISTS idx_usage_user ON usage_log(user_id);
`);

/* ── Prepared statements ── */
const stmts = {
  insertUser: db.prepare("INSERT INTO users (id, username, display_name, password_hash) VALUES (?, ?, ?, ?)"),
  getUser: db.prepare("SELECT * FROM users WHERE username = ?"),
  getUserById: db.prepare("SELECT id, username, display_name FROM users WHERE id = ?"),
  listUsers: db.prepare("SELECT id, username, display_name, created_at FROM users"),
  insertMsg: db.prepare("INSERT INTO conversations (user_id, agent_id, role, content, tool_calls, input_tokens, output_tokens) VALUES (?, ?, ?, ?, ?, ?, ?)"),
  getConvo: db.prepare("SELECT role, content, tool_calls, input_tokens, output_tokens, created_at FROM conversations WHERE user_id = ? AND agent_id = ? ORDER BY created_at ASC"),
  clearConvo: db.prepare("DELETE FROM conversations WHERE user_id = ? AND agent_id = ?"),
  getContext: db.prepare("SELECT context_json FROM user_agent_context WHERE user_id = ? AND agent_id = ?"),
  upsertContext: db.prepare("INSERT INTO user_agent_context (user_id, agent_id, context_json) VALUES (?, ?, ?) ON CONFLICT(user_id, agent_id) DO UPDATE SET context_json = excluded.context_json"),
  insertUsage: db.prepare("INSERT INTO usage_log (user_id, agent_id, model, input_tokens, output_tokens, estimated_cost_usd) VALUES (?, ?, ?, ?, ?, ?)"),
  getConvoTokens: db.prepare("SELECT COALESCE(SUM(input_tokens),0) as total_input, COALESCE(SUM(output_tokens),0) as total_output FROM conversations WHERE user_id = ? AND agent_id = ?"),
  getUsageToday: db.prepare("SELECT COALESCE(SUM(input_tokens),0) as input, COALESCE(SUM(output_tokens),0) as output, COALESCE(SUM(estimated_cost_usd),0) as cost FROM usage_log WHERE user_id = ? AND created_at >= date('now')"),
  getUsageMonth: db.prepare("SELECT COALESCE(SUM(input_tokens),0) as input, COALESCE(SUM(output_tokens),0) as output, COALESCE(SUM(estimated_cost_usd),0) as cost FROM usage_log WHERE user_id = ? AND created_at >= date('now', 'start of month')"),
  getUsageByAgent: db.prepare("SELECT agent_id, COALESCE(SUM(input_tokens),0) as input, COALESCE(SUM(output_tokens),0) as output, COALESCE(SUM(estimated_cost_usd),0) as cost FROM usage_log WHERE user_id = ? AND created_at >= date('now', 'start of month') GROUP BY agent_id"),
};

/* ── Password hashing ── */
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(pw, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(pw, stored) {
  const [salt, hash] = stored.split(":");
  const check = crypto.scryptSync(pw, salt, 64).toString("hex");
  return check === hash;
}

/* ── Create default user if none exist ── */
const userCount = db.prepare("SELECT COUNT(*) as c FROM users").get().c;
if (userCount === 0) {
  const defaultPw = process.env.DEFAULT_PASSWORD || "changeme";
  stmts.insertUser.run(uuidv4(), "admin", "Admin", hashPassword(defaultPw));
  console.log(`Default user created — username: admin, password: ${defaultPw}`);
  console.log("Change this immediately via the UI or by setting DEFAULT_PASSWORD in .env");
}

/* ═══════════════════════════════════════════
   AUTH MIDDLEWARE
   ═══════════════════════════════════════════ */
function requireAuth(req, res, next) {
  if (req.session?.userId) return next();
  res.status(401).json({ error: "Not authenticated" });
}

/* ═══════════════════════════════════════════
   BEADS CLI WRAPPER
   Invokes `bd` with argv directly — no shell interpretation. Every
   element of `args` is passed as a single literal argument to bd, so
   shell metacharacters in user input or model output cannot escape.
   ═══════════════════════════════════════════ */
function bd(args) {
  if (!Array.isArray(args)) throw new TypeError("bd() expects an argv array");
  try {
    const result = execFileSync("bd", args, {
      cwd: BEADS_DIR,
      encoding: "utf8",
      timeout: 15000,
      shell: false,
    });
    try { return { ok: true, data: JSON.parse(result) }; }
    catch { return { ok: true, data: result.trim() }; }
  } catch (err) {
    return { ok: false, error: err.stderr?.trim() || err.message };
  }
}

/* ── Input validators for values that reach the bd CLI ── */
const BEAD_ID_RE = /^[A-Za-z0-9_-]+$/;
const LABEL_RE = /^[A-Za-z0-9._,-]+$/;
const STATUS_VALUES = new Set(["open", "in_progress", "closed", "blocked"]);
const KNOWN_AGENT_IDS = new Set(AGENTS.map(a => a.id));

const isValidBeadId = v => typeof v === "string" && BEAD_ID_RE.test(v);
const isValidLabel = v => typeof v === "string" && LABEL_RE.test(v);
const isValidPriority = v => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 4;
};

function ensureBeadsInit() {
  fs.mkdirSync(BEADS_DIR, { recursive: true });
  if (!fs.existsSync(path.join(BEADS_DIR, ".beads"))) {
    const r = bd(["init"]);
    if (!r.ok) { console.error("Beads init failed:", r.error); return false; }
    console.log("Beads initialized in", BEADS_DIR);
  }
  return true;
}

/* ═══════════════════════════════════════════
   GOOGLE OAUTH — multi-account
   Use /auth/google?account=personal or /auth/google?account=georgetown
   ═══════════════════════════════════════════ */
app.get("/auth/google", (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return res.status(400).json({ error: "GOOGLE_CLIENT_ID not configured" });
  const account = req.query.account || "personal";
  if (!["personal", "georgetown"].includes(account)) return res.status(400).json({ error: "Invalid account. Use 'personal' or 'georgetown'." });

  // Store account name in session so callback knows where to save tokens
  req.session.oauthAccount = account;

  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `http://localhost:${PORT}/auth/google/callback`;
  const scopes = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.compose",
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/calendar.events",
  ].join(" ");
  // login_hint helps Google pre-select the right account
  const hint = account === "georgetown" ? "&hd=georgetown.edu" : "";
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scopes)}&access_type=offline&prompt=consent${hint}`);
});

app.get("/auth/google/callback", async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send("No authorization code received");
  const account = req.session?.oauthAccount || "personal";

  try {
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code, client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: process.env.GOOGLE_REDIRECT_URI || `http://localhost:${PORT}/auth/google/callback`,
        grant_type: "authorization_code",
      }),
    });
    const tokens = await r.json();
    tokens.obtained_at = Date.now();
    saveGoogleTokens(account, tokens);
    const label = account === "georgetown" ? "Georgetown" : "Personal";
    res.send(`<html><body style='background:#0c0e14;color:#e4e6ed;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh'><div style='text-align:center'><h2 style='color:#2dd4a8'>${label} Google connected</h2><p>Account: ${account}</p><p>You can close this window.</p></div></body></html>`);
  } catch (err) {
    res.status(500).send("OAuth error: " + err.message);
  }
});

app.get("/auth/google/status", (req, res) => {
  res.json({ accounts: getConnectedAccounts(), hasClientId: !!process.env.GOOGLE_CLIENT_ID });
});

/* ═══════════════════════════════════════════
   AUTH ROUTES
   ═══════════════════════════════════════════ */
app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Username and password required" });
  const user = stmts.getUser.get(username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  req.session.userId = user.id;
  res.json({ id: user.id, username: user.username, displayName: user.display_name });
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

app.get("/api/auth/me", (req, res) => {
  if (!req.session?.userId) return res.json({ user: null });
  const u = stmts.getUserById.get(req.session.userId);
  res.json({ user: u ? { id: u.id, username: u.username, displayName: u.display_name } : null });
});

app.post("/api/auth/register", requireAuth, (req, res) => {
  const { username, displayName, password } = req.body;
  if (!username || !password || !displayName) return res.status(400).json({ error: "All fields required" });
  try {
    const id = uuidv4();
    stmts.insertUser.run(id, username, displayName, hashPassword(password));
    res.json({ id, username, displayName });
  } catch (err) {
    res.status(409).json({ error: "Username already taken" });
  }
});

app.post("/api/auth/change-password", requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = stmts.getUserById.get(req.session.userId);
  if (!user) return res.status(404).json({ error: "User not found" });
  const fullUser = db.prepare("SELECT * FROM users WHERE id = ?").get(req.session.userId);
  if (!verifyPassword(currentPassword, fullUser.password_hash)) {
    return res.status(401).json({ error: "Current password incorrect" });
  }
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(newPassword), req.session.userId);
  res.json({ ok: true });
});

/* ═══════════════════════════════════════════
   API ROUTES
   ═══════════════════════════════════════════ */
app.get("/api/health", (req, res) => {
  const beadsOk = ensureBeadsInit();
  res.json({ status: "ok", beads: beadsOk, database: true, google: getConnectedAccounts(), beadsDir: BEADS_DIR });
});

app.get("/api/status", requireAuth, (req, res) => {
  res.json({
    google: { accounts: getConnectedAccounts(), hasClientId: !!process.env.GOOGLE_CLIENT_ID },
    beads: ensureBeadsInit(),
    users: stmts.listUsers.all().length,
  });
});

/* ── Chat with tool-use loop, multi-account Google, token tracking ── */
app.post("/api/chat", requireAuth, async (req, res) => {
  const { agentId, message, systemPrompt } = req.body;
  const userId = req.session.userId;
  if (!agentId || !message) return res.status(400).json({ error: "agentId and message required" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });

  stmts.insertMsg.run(userId, agentId, "user", message, "[]", 0, 0);

  const history = stmts.getConvo.all(userId, agentId).map(r => ({ role: r.role, content: r.content }));

  // Inject per-user context
  const ctxRow = stmts.getContext.get(userId, agentId);
  const userCtx = ctxRow ? JSON.parse(ctxRow.context_json) : {};
  const user = stmts.getUserById.get(userId);
  let fullSystem = systemPrompt || "";
  if (user) fullSystem += `\n\nYou are speaking with ${user.display_name}.`;
  if (userCtx.notes) fullSystem += `\nUser context: ${userCtx.notes}`;

  // Agent-specific Google tools
  const googleEnabled = agentHasGoogle(agentId);
  const tools = googleEnabled ? googleTools : [];
  const model = process.env.CLAUDE_MODEL || DEFAULT_MODEL;

  try {
    let messages = [...history];
    const allToolCalls = [];
    let finalText = "";
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let iterations = 0;
    const MAX_ITERATIONS = 5;

    while (iterations < MAX_ITERATIONS) {
      iterations++;

      const requestBody = { model, max_tokens: 4096, system: fullSystem, messages };
      if (tools.length > 0) requestBody.tools = tools;

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify(requestBody),
      });

      const data = await response.json();
      if (data.error) return res.status(response.status).json({ error: data.error.message });

      // Accumulate token usage from each API call
      if (data.usage) {
        totalInputTokens += data.usage.input_tokens || 0;
        totalOutputTokens += data.usage.output_tokens || 0;
      }

      const textParts = [];
      const toolUseBlocks = [];
      for (const block of data.content || []) {
        if (block.type === "text") textParts.push(block.text);
        else if (block.type === "tool_use") toolUseBlocks.push(block);
      }

      if (toolUseBlocks.length === 0 || data.stop_reason !== "tool_use") {
        finalText = textParts.join("\n") || "No response received.";
        break;
      }

      // Execute tool calls — routed to correct Google account(s) based on agentId
      const toolResults = [];
      for (const toolBlock of toolUseBlocks) {
        console.log(`[tool:${agentId}] ${toolBlock.name}(${JSON.stringify(toolBlock.input)})`);
        allToolCalls.push({ type: "call", name: toolBlock.name, input: toolBlock.input });

        const result = await executeGoogleTool(toolBlock.name, toolBlock.input, agentId);
        allToolCalls.push({ type: "result", name: toolBlock.name, data: result });

        toolResults.push({ type: "tool_result", tool_use_id: toolBlock.id, content: JSON.stringify(result) });
      }

      messages.push({ role: "assistant", content: data.content });
      messages.push({ role: "user", content: toolResults });

      if (textParts.length > 0) finalText = textParts.join("\n") + "\n";
    }

    // Save message with token counts
    stmts.insertMsg.run(userId, agentId, "assistant", finalText, JSON.stringify(allToolCalls), totalInputTokens, totalOutputTokens);

    // Log usage for cost tracking
    const cost = estimateCost(model, totalInputTokens, totalOutputTokens);
    stmts.insertUsage.run(userId, agentId, model, totalInputTokens, totalOutputTokens, cost.totalCost);

    // Get cumulative context for this conversation
    const convoTokens = stmts.getConvoTokens.get(userId, agentId);
    const contextWindow = getContextWindow(model);

    // Auto-create beads with agent label.
    // Title is extracted from model output that may have ingested untrusted
    // email/calendar content — it must never be interpreted by a shell.
    // The agentId is also pinned to a known agent before reaching the CLI.
    const beadsCreated = [];
    const beadLabel = KNOWN_AGENT_IDS.has(agentId) ? agentId : null;
    const beadRe = /\[BEAD:\s*(.+?)\s*\|\s*priority:\s*(P[0-3])\s*\|\s*status:\s*(\w+)\]/gi;
    let m;
    while ((m = beadRe.exec(finalText)) !== null) {
      const title = m[1].trim();
      const pri = parseInt(m[2][1]);
      const args = ["create", title, "-p", String(pri)];
      if (beadLabel) args.push("-l", beadLabel);
      const r = bd(args);
      beadsCreated.push({ title, priority: m[2], status: m[3], bdResult: r.ok ? r.data : null });
    }

    res.json({
      text: finalText,
      toolCalls: allToolCalls,
      beadsCreated,
      usage: {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        totalTokens: totalInputTokens + totalOutputTokens,
        estimatedCost: cost.totalCost,
        conversationTokens: (convoTokens.total_input || 0) + (convoTokens.total_output || 0),
        contextWindow,
        contextUtilization: ((convoTokens.total_input || 0) + (convoTokens.total_output || 0)) / contextWindow,
      },
    });
  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ── Conversations ── */
app.get("/api/conversations/:agentId", requireAuth, (req, res) => {
  const rows = stmts.getConvo.all(req.session.userId, req.params.agentId);
  const convoTokens = stmts.getConvoTokens.get(req.session.userId, req.params.agentId);
  const model = process.env.CLAUDE_MODEL || DEFAULT_MODEL;
  const contextWindow = getContextWindow(model);
  const totalTokens = (convoTokens.total_input || 0) + (convoTokens.total_output || 0);
  res.json({
    messages: rows.map(r => ({ role: r.role, content: r.content, toolCalls: JSON.parse(r.tool_calls || "[]"), inputTokens: r.input_tokens, outputTokens: r.output_tokens, createdAt: r.created_at })),
    context: { totalTokens, contextWindow, utilization: totalTokens / contextWindow },
  });
});

app.delete("/api/conversations/:agentId", requireAuth, (req, res) => {
  stmts.clearConvo.run(req.session.userId, req.params.agentId);
  res.json({ ok: true });
});

/* ── User agent context ── */
app.get("/api/context/:agentId", requireAuth, (req, res) => {
  const row = stmts.getContext.get(req.session.userId, req.params.agentId);
  res.json(row ? JSON.parse(row.context_json) : {});
});

app.put("/api/context/:agentId", requireAuth, (req, res) => {
  stmts.upsertContext.run(req.session.userId, req.params.agentId, JSON.stringify(req.body));
  res.json({ ok: true });
});

/* ── Usage & cost tracking ── */
app.get("/api/usage", requireAuth, (req, res) => {
  const userId = req.session.userId;
  const today = stmts.getUsageToday.get(userId);
  const month = stmts.getUsageMonth.get(userId);
  const byAgent = stmts.getUsageByAgent.all(userId);
  res.json({
    today: { inputTokens: today.input, outputTokens: today.output, estimatedCost: Math.round(today.cost * 10000) / 10000 },
    month: { inputTokens: month.input, outputTokens: month.output, estimatedCost: Math.round(month.cost * 10000) / 10000 },
    byAgent: byAgent.map(r => ({ agentId: r.agent_id, inputTokens: r.input, outputTokens: r.output, estimatedCost: Math.round(r.cost * 10000) / 10000 })),
    model: process.env.CLAUDE_MODEL || DEFAULT_MODEL,
  });
});

/* ── Beads ── */
app.get("/api/beads", requireAuth, (req, res) => {
  let r = bd(["list", "--all", "--json"]);
  if (!r.ok) r = bd(["list", "--all"]);
  if (!r.ok) return res.json({ beads: [], error: r.error });
  let beads = [];
  if (Array.isArray(r.data)) beads = r.data;
  else if (typeof r.data === "string") { try { beads = JSON.parse(r.data); } catch {} }
  res.json({ beads });
});

app.get("/api/beads/ready", requireAuth, (req, res) => {
  let r = bd(["ready", "--json"]);
  if (!r.ok) r = bd(["ready"]);
  res.json(r.ok ? { beads: Array.isArray(r.data) ? r.data : [] } : { beads: [] });
});

app.post("/api/beads", requireAuth, (req, res) => {
  const { title, priority, labels } = req.body;
  if (typeof title !== "string" || !title.trim()) return res.status(400).json({ error: "title required" });
  if (priority !== undefined && !isValidPriority(priority)) return res.status(400).json({ error: "priority must be an integer 0-4" });
  if (labels !== undefined && !isValidLabel(labels)) return res.status(400).json({ error: "labels may only contain letters, digits, '.', '_', ',', '-'" });

  const args = ["create", title];
  if (priority !== undefined) args.push("-p", String(priority));
  if (labels) args.push("-l", labels);
  const r = bd(args);
  res.json(r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error });
});

app.patch("/api/beads/:id", requireAuth, (req, res) => {
  if (!isValidBeadId(req.params.id)) return res.status(400).json({ error: "invalid bead id" });
  const { status, priority, title, claim, notes } = req.body;
  if (status !== undefined && !STATUS_VALUES.has(status)) return res.status(400).json({ error: "invalid status" });
  if (priority !== undefined && !isValidPriority(priority)) return res.status(400).json({ error: "priority must be an integer 0-4" });
  if (title !== undefined && typeof title !== "string") return res.status(400).json({ error: "title must be a string" });
  if (notes !== undefined && typeof notes !== "string") return res.status(400).json({ error: "notes must be a string" });

  const args = ["update", req.params.id];
  if (status) args.push("--status", status);
  if (priority !== undefined) args.push("-p", String(priority));
  if (title) args.push("--title", title);
  if (claim) args.push("--claim");
  if (notes) args.push("--notes", notes);
  const r = bd(args);
  res.json(r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error });
});

app.post("/api/beads/:id/label", requireAuth, (req, res) => {
  if (!isValidBeadId(req.params.id)) return res.status(400).json({ error: "invalid bead id" });
  const { label } = req.body;
  if (!isValidLabel(label)) return res.status(400).json({ error: "label may only contain letters, digits, '.', '_', ',', '-'" });
  const r = bd(["label", "add", req.params.id, label]);
  res.json(r.ok ? { ok: true } : { ok: false, error: r.error });
});

app.delete("/api/beads/:id/label/:label", requireAuth, (req, res) => {
  if (!isValidBeadId(req.params.id)) return res.status(400).json({ error: "invalid bead id" });
  if (!isValidLabel(req.params.label)) return res.status(400).json({ error: "invalid label" });
  const r = bd(["label", "remove", req.params.id, req.params.label]);
  res.json(r.ok ? { ok: true } : { ok: false, error: r.error });
});

app.post("/api/beads/:id/dep", requireAuth, (req, res) => {
  if (!isValidBeadId(req.params.id)) return res.status(400).json({ error: "invalid bead id" });
  const { dependsOn } = req.body;
  if (!isValidBeadId(dependsOn)) return res.status(400).json({ error: "dependsOn must be a valid bead id" });
  const r = bd(["dep", "add", req.params.id, dependsOn]);
  res.json(r.ok ? { ok: true } : { ok: false, error: r.error });
});

app.delete("/api/beads/:id/dep/:depId", requireAuth, (req, res) => {
  if (!isValidBeadId(req.params.id) || !isValidBeadId(req.params.depId)) return res.status(400).json({ error: "invalid bead id" });
  const r = bd(["dep", "remove", req.params.id, req.params.depId]);
  res.json(r.ok ? { ok: true } : { ok: false, error: r.error });
});

/* ── Serve frontend ── */
if (IS_PROD) {
  const dist = path.join(__dirname, "dist");
  app.use(express.static(dist));
  app.get("*", (req, res) => res.sendFile(path.join(dist, "index.html")));
}

/* ═══════════════════════════════════════════
   START
   ═══════════════════════════════════════════ */
const beadsReady = ensureBeadsInit();

app.listen(PORT, HOST, () => {
  const gAccts = getConnectedAccounts();
  const gStatus = [gAccts.personal ? "Personal" : null, gAccts.georgetown ? "Georgetown" : null].filter(Boolean).join(", ") || "Not configured";
  console.log(`
  ┌──────────────────────────────────────────┐
  │         Beads Agent Hub v2.0             │
  ├──────────────────────────────────────────┤
  │  URL:       http://${HOST}:${PORT}             │
  │  Beads:     ${(beadsReady ? "Ready" : "Not found — install bd").padEnd(28)}│
  │  Database:  ${path.basename(DB_PATH).padEnd(28)}│
  │  Google:    ${gStatus.padEnd(28)}│
  │  Mode:      ${(IS_PROD ? "Production" : "Development").padEnd(28)}│
  └──────────────────────────────────────────┘
  `);
});
