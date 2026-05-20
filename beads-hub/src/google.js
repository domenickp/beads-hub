import fs from "fs";
import path from "path";

const DATA_DIR = path.resolve("./data");
const GOOGLE_API = "https://www.googleapis.com";

/* ═══════════════════════════════════════════
   AGENT → ACCOUNT ROUTING
   ═══════════════════════════════════════════ */
const AGENT_ACCOUNTS = {
  bridge: ["personal", "georgetown"],
  hearth: ["personal"],
  ledger: ["personal"],
  keeper: ["personal"],
  scholar: ["georgetown"],
  forge: [],
};

/* ═══════════════════════════════════════════
   TOKEN MANAGEMENT — per-account
   ═══════════════════════════════════════════ */
function tokenPath(account) {
  return path.join(DATA_DIR, `google-tokens-${account}.json`);
}

function loadTokens(account) {
  try {
    const p = tokenPath(account);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch { return null; }
}

export function saveTokens(account, tokens) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(tokenPath(account), JSON.stringify(tokens, null, 2));
}

async function getAccessToken(account) {
  const tokens = loadTokens(account);
  if (!tokens) return null;

  const expiresAt = (tokens.obtained_at || 0) + (tokens.expires_in || 3600) * 1000;
  if (Date.now() > expiresAt - 300000 && tokens.refresh_token) {
    try {
      const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          refresh_token: tokens.refresh_token,
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          grant_type: "refresh_token",
        }),
      });
      const refreshed = await res.json();
      if (refreshed.access_token) {
        const updated = { ...tokens, access_token: refreshed.access_token, expires_in: refreshed.expires_in || 3600, obtained_at: Date.now() };
        saveTokens(account, updated);
        return updated.access_token;
      }
    } catch (err) {
      console.error(`Token refresh failed for ${account}:`, err.message);
    }
  }
  return tokens.access_token || null;
}

async function gfetch(url, token) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) { const err = await res.text(); throw new Error(`Google API ${res.status}: ${err}`); }
  return res.json();
}

/* ═══════════════════════════════════════════
   ACCOUNT STATUS
   ═══════════════════════════════════════════ */
export function getConnectedAccounts() {
  const out = {};
  for (const name of ["personal", "georgetown"]) out[name] = !!loadTokens(name)?.access_token;
  return out;
}

export function isAccountConnected(account) { return !!loadTokens(account)?.access_token; }
export function getAgentAccounts(agentId) { return AGENT_ACCOUNTS[agentId] || []; }

export function agentHasGoogle(agentId) {
  return (AGENT_ACCOUNTS[agentId] || []).some(a => isAccountConnected(a));
}

/* ═══════════════════════════════════════════
   GMAIL
   ═══════════════════════════════════════════ */
async function searchEmailsSingle(account, query, maxResults) {
  const token = await getAccessToken(account);
  if (!token) return { account, error: `Account "${account}" not authenticated. Visit /auth/google?account=${account}` };

  try {
    const list = await gfetch(`${GOOGLE_API}/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`, token);
    if (!list.messages?.length) return { account, results: [], message: `No emails found for: ${query}` };

    const emails = await Promise.all(list.messages.slice(0, maxResults).map(async (msg) => {
      const d = await gfetch(`${GOOGLE_API}/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`, token);
      const h = {};
      for (const hdr of d.payload?.headers || []) h[hdr.name.toLowerCase()] = hdr.value;
      return { id: msg.id, threadId: msg.threadId, account, from: h.from || "Unknown", to: h.to || "", subject: h.subject || "(no subject)", date: h.date || "", snippet: d.snippet || "", labels: d.labelIds || [] };
    }));
    return { account, results: emails };
  } catch (err) {
    return { account, error: `Gmail search failed: ${err.message}` };
  }
}

async function readEmailSingle(account, messageId) {
  const token = await getAccessToken(account);
  if (!token) return { error: `Account "${account}" not authenticated.` };

  try {
    const d = await gfetch(`${GOOGLE_API}/gmail/v1/users/me/messages/${messageId}?format=full`, token);
    const h = {};
    for (const hdr of d.payload?.headers || []) h[hdr.name.toLowerCase()] = hdr.value;

    let body = "";
    function extract(part) {
      if (part.mimeType === "text/plain" && part.body?.data) body += Buffer.from(part.body.data, "base64url").toString("utf8");
      if (part.parts) part.parts.forEach(extract);
    }
    extract(d.payload);
    if (body.length > 3000) body = body.slice(0, 3000) + "\n...(truncated)";

    return { account, from: h.from || "Unknown", to: h.to || "", subject: h.subject || "(no subject)", date: h.date || "", body: body || d.snippet || "(no readable content)" };
  } catch (err) {
    return { error: `Failed to read email: ${err.message}` };
  }
}

/* ═══════════════════════════════════════════
   CALENDAR
   ═══════════════════════════════════════════ */
async function listEventsSingle(account, timeMin, timeMax, maxResults) {
  const token = await getAccessToken(account);
  if (!token) return { account, error: `Account "${account}" not authenticated.` };

  if (!timeMin) timeMin = new Date().toISOString();
  if (!timeMax) { const d = new Date(); d.setDate(d.getDate() + 7); timeMax = d.toISOString(); }

  try {
    const calList = await gfetch(`${GOOGLE_API}/calendar/v3/users/me/calendarList`, token);
    const allEvents = [];

    for (const cal of calList.items || []) {
      try {
        const url = `${GOOGLE_API}/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&maxResults=${maxResults}&singleEvents=true&orderBy=startTime`;
        const evData = await gfetch(url, token);
        for (const ev of evData.items || []) {
          allEvents.push({
            id: ev.id, account, calendarName: cal.summary || cal.id,
            title: ev.summary || "(no title)", description: ev.description ? ev.description.slice(0, 200) : "",
            start: ev.start?.dateTime || ev.start?.date || "", end: ev.end?.dateTime || ev.end?.date || "",
            location: ev.location || "", attendees: (ev.attendees || []).map(a => a.email).slice(0, 5),
          });
        }
      } catch { /* skip erroring calendars */ }
    }
    allEvents.sort((a, b) => new Date(a.start) - new Date(b.start));
    return { account, events: allEvents.slice(0, maxResults * 2) };
  } catch (err) {
    return { account, error: `Calendar query failed: ${err.message}` };
  }
}

async function searchCalendarSingle(account, query, daysAhead) {
  const token = await getAccessToken(account);
  if (!token) return { account, error: `Account "${account}" not authenticated.` };

  const timeMin = new Date().toISOString();
  const d = new Date(); d.setDate(d.getDate() + daysAhead);

  try {
    const url = `${GOOGLE_API}/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(d.toISOString())}&q=${encodeURIComponent(query)}&singleEvents=true&orderBy=startTime&maxResults=10`;
    const data = await gfetch(url, token);
    const events = (data.items || []).map(ev => ({
      id: ev.id, account, title: ev.summary || "(no title)",
      start: ev.start?.dateTime || ev.start?.date || "", end: ev.end?.dateTime || ev.end?.date || "",
      location: ev.location || "",
    }));
    return { account, events };
  } catch (err) {
    return { account, error: `Calendar search failed: ${err.message}` };
  }
}

/* ═══════════════════════════════════════════
   MULTI-ACCOUNT EXECUTION
   Agents with multiple accounts get merged results
   ═══════════════════════════════════════════ */
async function multiAccountSearch(accounts, query, maxResults) {
  const results = await Promise.all(accounts.map(a => searchEmailsSingle(a, query, maxResults)));
  const merged = [];
  for (const r of results) {
    if (r.results) merged.push(...r.results);
    else if (r.error) merged.push({ account: r.account, error: r.error });
  }
  return { results: merged };
}

async function multiAccountCalendar(accounts, timeMin, timeMax, maxResults) {
  const results = await Promise.all(accounts.map(a => listEventsSingle(a, timeMin, timeMax, maxResults)));
  const merged = [];
  for (const r of results) {
    if (r.events) merged.push(...r.events);
    else if (r.error) merged.push({ account: r.account, error: r.error });
  }
  merged.sort((a, b) => new Date(a.start) - new Date(b.start));
  return { events: merged };
}

/* ═══════════════════════════════════════════
   TOOL DEFINITIONS
   ═══════════════════════════════════════════ */
export const googleTools = [
  {
    name: "search_emails",
    description: "Search Gmail inbox. Use Gmail search syntax (e.g., 'from:jane', 'subject:invoice', 'is:unread', 'after:2025/01/01'). For agents with multiple accounts, searches all connected accounts and labels results by account.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Gmail search query" },
        max_results: { type: "integer", description: "Max emails to return (1-10, default 5)" },
      },
      required: ["query"],
    },
  },
  {
    name: "read_email",
    description: "Read the full content of a specific email by message ID and account. Use after search_emails.",
    input_schema: {
      type: "object",
      properties: {
        message_id: { type: "string", description: "Gmail message ID from search_emails results" },
        account: { type: "string", description: "Account the email belongs to (from search_emails results)" },
      },
      required: ["message_id", "account"],
    },
  },
  {
    name: "list_calendar_events",
    description: "List upcoming calendar events. For agents with multiple accounts, merges events from all connected calendars. Defaults to next 7 days.",
    input_schema: {
      type: "object",
      properties: {
        time_min: { type: "string", description: "Start (ISO 8601). Defaults to now." },
        time_max: { type: "string", description: "End (ISO 8601). Defaults to 7 days from now." },
        max_results: { type: "integer", description: "Max events per calendar (default 10)" },
      },
    },
  },
  {
    name: "search_calendar",
    description: "Search calendar events by keyword within the next N days.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search keyword (e.g., 'dentist', 'midterm')" },
        days_ahead: { type: "integer", description: "Days ahead to search (default 30)" },
      },
      required: ["query"],
    },
  },
];

/* ═══════════════════════════════════════════
   TOOL EXECUTOR — routes to correct account(s)
   ═══════════════════════════════════════════ */
export async function executeGoogleTool(toolName, toolInput, agentId) {
  const accounts = (AGENT_ACCOUNTS[agentId] || []).filter(a => isAccountConnected(a));
  if (accounts.length === 0) return { error: "No Google accounts connected for this agent." };

  switch (toolName) {
    case "search_emails":
      if (accounts.length > 1) return await multiAccountSearch(accounts, toolInput.query, toolInput.max_results || 5);
      return await searchEmailsSingle(accounts[0], toolInput.query, toolInput.max_results || 5);

    case "read_email": {
      const acct = toolInput.account || accounts[0];
      return await readEmailSingle(acct, toolInput.message_id);
    }

    case "list_calendar_events":
      if (accounts.length > 1) return await multiAccountCalendar(accounts, toolInput.time_min, toolInput.time_max, toolInput.max_results || 10);
      return await listEventsSingle(accounts[0], toolInput.time_min, toolInput.time_max, toolInput.max_results || 10);

    case "search_calendar":
      if (accounts.length > 1) {
        const results = await Promise.all(accounts.map(a => searchCalendarSingle(a, toolInput.query, toolInput.days_ahead || 30)));
        const merged = [];
        for (const r of results) { if (r.events) merged.push(...r.events); }
        merged.sort((a, b) => new Date(a.start) - new Date(b.start));
        return { events: merged };
      }
      return await searchCalendarSingle(accounts[0], toolInput.query, toolInput.days_ahead || 30);

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}
