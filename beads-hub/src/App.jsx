import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { api } from "./api";
import { AGENTS, PRI, STAT, STAT_COLOR } from "./agents";

const T = {
  bg0: "#0c0e14", bg1: "#12151e", bg2: "#1a1e2a", bg3: "#242836", bg4: "#2e3344",
  border: "rgba(255,255,255,0.06)", borderHover: "rgba(255,255,255,0.12)", borderActive: "rgba(255,255,255,0.18)",
  text: "#e4e6ed", textMuted: "#8b90a0", textDim: "#585e72", textInverse: "#0c0e14",
  radius: 10, mono: "'JetBrains Mono','Fira Code','SF Mono',monospace", sans: "'DM Sans','Helvetica Neue',system-ui,sans-serif",
};

function stripBeads(t) { return t.replace(/\[BEAD:\s*.+?\s*\|\s*priority:\s*P[0-3]\s*\|\s*status:\s*\w+\]/gi, "").trim(); }
function formatCost(c) { return c < 0.01 ? `$${(c * 100).toFixed(2)}c` : `$${c.toFixed(4)}`; }
function formatTokens(n) { return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n); }

/* ═══ SVG Icons ═══ */
const I = {
  send: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>,
  plus: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  trash: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>,
  link: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>,
  chat: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>,
  beads: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><circle cx="5" cy="6" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="5" cy="18" r="2"/><circle cx="19" cy="18" r="2"/><line x1="7" y1="7" x2="10" y2="10"/><line x1="17" y1="7" x2="14" y2="10"/><line x1="7" y1="17" x2="10" y2="14"/><line x1="17" y1="17" x2="14" y2="14"/></svg>,
  menu: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>,
  x: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  logout: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
  user: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  refresh: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>,
  tool: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>,
};

/* ═══ Context bar component ═══ */
function ContextBar({ utilization, totalTokens, contextWindow, cost }) {
  const pct = Math.min(utilization * 100, 100);
  const barColor = pct > 80 ? "#ef4444" : pct > 50 ? "#f0a030" : "#2dd4a8";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 10, color: T.textDim, padding: "4px 0" }}>
      <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 6 }}>
        <span>Context</span>
        <div style={{ flex: 1, height: 3, background: T.bg4, borderRadius: 2, maxWidth: 120 }}>
          <div style={{ width: `${pct}%`, height: "100%", background: barColor, borderRadius: 2, transition: "width 0.3s" }} />
        </div>
        <span>{formatTokens(totalTokens)} / {formatTokens(contextWindow)} ({pct.toFixed(1)}%)</span>
      </div>
      {cost > 0 && <span style={{ color: T.textMuted }}>~{formatCost(cost)}</span>}
    </div>
  );
}

/* ═══ Login Screen ═══ */
function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!username || !password) return;
    setLoading(true); setError("");
    try { onLogin(await api.login(username, password)); } catch (err) { setError(err.message); }
    setLoading(false);
  };

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: T.bg0, fontFamily: T.sans, padding: 20 }}>
      <form onSubmit={submit} style={{ width: "100%", maxWidth: 360, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ textAlign: "center", marginBottom: 12 }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: "linear-gradient(135deg, #2dd4a844, #2dd4a8)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 700, color: "#fff", marginBottom: 12 }}>B</div>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: T.text, margin: 0 }}>Beads Agent Hub</h1>
          <p style={{ fontSize: 13, color: T.textDim, marginTop: 6 }}>Sign in to continue</p>
        </div>
        {error && <div style={{ padding: "8px 12px", borderRadius: 8, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", fontSize: 13, color: "#ef4444" }}>{error}</div>}
        <input value={username} onChange={e => setUsername(e.target.value)} placeholder="Username" autoComplete="username" style={{ padding: "12px 14px", borderRadius: 10, border: `1px solid ${T.border}`, background: T.bg2, color: T.text, fontSize: 14, fontFamily: T.sans, outline: "none" }} />
        <input value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" type="password" autoComplete="current-password" style={{ padding: "12px 14px", borderRadius: 10, border: `1px solid ${T.border}`, background: T.bg2, color: T.text, fontSize: 14, fontFamily: T.sans, outline: "none" }} />
        <button type="submit" disabled={loading} style={{ padding: "12px", borderRadius: 10, border: "none", background: "#2dd4a8", color: T.textInverse, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: T.sans, opacity: loading ? 0.6 : 1 }}>{loading ? "Signing in..." : "Sign in"}</button>
      </form>
    </div>
  );
}

/* ═══════════════════════════════════════════
   MAIN APP
   ═══════════════════════════════════════════ */
export default function App() {
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [agent, setAgent] = useState(AGENTS[0]);
  const [convos, setConvos] = useState(Object.fromEntries(AGENTS.map(a => [a.id, []])));
  const [convoContext, setConvoContext] = useState(Object.fromEntries(AGENTS.map(a => [a.id, { totalTokens: 0, contextWindow: 200000, utilization: 0 }])));
  const [beads, setBeads] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState("chat");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [beadFilter, setBeadFilter] = useState("all");
  const [editId, setEditId] = useState(null);
  const [googleAccounts, setGoogleAccounts] = useState({ personal: false, georgetown: false });
  const [hasGoogleClientId, setHasGoogleClientId] = useState(false);
  const [usage, setUsage] = useState({ today: { estimatedCost: 0 }, month: { estimatedCost: 0 }, byAgent: [] });
  const [lastMsgCost, setLastMsgCost] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const endRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => { const c = () => setIsMobile(window.innerWidth < 768); c(); window.addEventListener("resize", c); return () => window.removeEventListener("resize", c); }, []);
  useEffect(() => { api.me().then(d => { if (d.user) setUser(d.user); setAuthChecked(true); }).catch(() => setAuthChecked(true)); }, []);

  // Load data after auth
  useEffect(() => {
    if (!user) return;
    (async () => {
      const cd = {}; const cc = {};
      for (const a of AGENTS) {
        try {
          const data = await api.getConvo(a.id);
          cd[a.id] = data.messages || data || [];
          cc[a.id] = data.context || { totalTokens: 0, contextWindow: 200000, utilization: 0 };
        } catch { cd[a.id] = []; cc[a.id] = { totalTokens: 0, contextWindow: 200000, utilization: 0 }; }
      }
      setConvos(cd); setConvoContext(cc);
      try { const { beads: b } = await api.listBeads(); if (Array.isArray(b)) setBeads(b); } catch {}
      try { const gs = await api.googleStatus(); setGoogleAccounts(gs.accounts || {}); setHasGoogleClientId(gs.hasClientId || false); } catch {}
      try { const u = await api.getUsage(); setUsage(u); } catch {}
    })();
  }, [user]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [convos, loading]);
  useEffect(() => { if (!isMobile) textareaRef.current?.focus(); }, [agent, view]);

  const chat = convos[agent.id] || [];
  const ctx = convoContext[agent.id] || { totalTokens: 0, contextWindow: 200000, utilization: 0 };

  const handleInput = (e) => { setInput(e.target.value); e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px"; };

  const send = useCallback(async () => {
    const txt = input.trim();
    if (!txt || loading) return;
    setInput(""); setLastMsgCost(0);
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    setConvos(p => ({ ...p, [agent.id]: [...p[agent.id], { role: "user", content: txt }] }));
    setLoading(true);
    try {
      const data = await api.send(agent.id, txt, agent.systemPrompt);
      setConvos(p => ({ ...p, [agent.id]: [...p[agent.id], { role: "assistant", content: data.text, toolCalls: data.toolCalls || [] }] }));
      // Update context and cost
      if (data.usage) {
        setConvoContext(p => ({ ...p, [agent.id]: { totalTokens: data.usage.conversationTokens, contextWindow: data.usage.contextWindow, utilization: data.usage.contextUtilization } }));
        setLastMsgCost(data.usage.estimatedCost || 0);
      }
      if (data.beadsCreated?.length) { try { const { beads: b } = await api.listBeads(); if (Array.isArray(b)) setBeads(b); } catch {} }
      // Refresh usage totals
      try { setUsage(await api.getUsage()); } catch {}
    } catch (err) {
      setConvos(p => ({ ...p, [agent.id]: [...p[agent.id], { role: "assistant", content: `Error: ${err.message}` }] }));
    }
    setLoading(false);
  }, [input, loading, agent]);

  const clearChat = async () => { try { await api.clearConvo(agent.id); } catch {} setConvos(p => ({ ...p, [agent.id]: [] })); setConvoContext(p => ({ ...p, [agent.id]: { totalTokens: 0, contextWindow: 200000, utilization: 0 } })); };
  const refreshBeads = async () => { try { const { beads: b } = await api.listBeads(); if (Array.isArray(b)) setBeads(b); } catch {} };
  const createBead = async () => { try { await api.createBead("New task", 2); await refreshBeads(); } catch {} };
  const updateBead = async (id, u) => { try { await api.updateBead(id, u); await refreshBeads(); } catch {} setEditId(null); };
  const addLabel = async (id, label) => { try { await api.addLabel(id, label); await refreshBeads(); } catch {} };
  const removeLabel = async (id, label) => { try { await api.removeLabel(id, label); await refreshBeads(); } catch {} };
  const switchAgent = (a) => { setAgent(a); setView("chat"); setSidebarOpen(false); };

  const [labelFilter, setLabelFilter] = useState(null);
  const [addingLabelTo, setAddingLabelTo] = useState(null);
  const [newLabelText, setNewLabelText] = useState("");

  // Collect all unique labels across beads
  const allLabels = useMemo(() => {
    const set = new Set();
    beads.forEach(b => { (b.labels || []).forEach(l => set.add(l)); });
    return [...set].sort();
  }, [beads]);

  // Agent label color mapping
  const labelColor = (label) => {
    const ag = AGENTS.find(a => a.id === label);
    return ag ? ag.color : "#8b90a0";
  };

  const filtered = useMemo(() => {
    let list = beadFilter === "all" ? beads : beads.filter(b => (b.status || "open") === beadFilter);
    if (labelFilter) list = list.filter(b => (b.labels || []).includes(labelFilter));
    return list;
  }, [beads, beadFilter, labelFilter]);

  const counts = useMemo(() => ({
    all: beads.length, open: beads.filter(b => (b.status || "open") === "open").length,
    in_progress: beads.filter(b => b.status === "in_progress").length,
    closed: beads.filter(b => b.status === "closed").length, blocked: beads.filter(b => b.status === "blocked").length,
  }), [beads]);

  if (!authChecked) return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: T.bg0, color: T.textDim, fontFamily: T.sans }}>Loading...</div>;
  if (!user) return <LoginScreen onLogin={setUser} />;

  /* ═══ Sidebar content ═══ */
  const sidebar = (
    <>
      <div style={{ fontSize: 10, fontWeight: 600, color: T.textDim, padding: "14px 16px 6px", textTransform: "uppercase", letterSpacing: "0.08em" }}>Agents</div>
      {AGENTS.map(a => {
        const active = agent.id === a.id;
        const mc = (convos[a.id] || []).filter(m => m.role === "assistant").length;
        return (
          <button key={a.id} onClick={() => switchAgent(a)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", margin: "1px 6px", borderRadius: 8, border: "none", background: active ? a.bgSolid : "transparent", cursor: "pointer", textAlign: "left", width: "calc(100% - 12px)", fontFamily: T.sans }}>
            <div style={{ width: 34, height: 34, borderRadius: 8, background: active ? a.color : `${a.color}55`, display: "flex", alignItems: "center", justifyContent: "center", color: active ? T.textInverse : a.color, fontSize: 14, fontWeight: 700, flexShrink: 0, fontFamily: T.sans }}>{a.name[0]}</div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: active ? 600 : 400, color: active ? T.text : T.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</div>
              <div style={{ fontSize: 11, color: T.textDim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.role}</div>
            </div>
            {mc > 0 && <span style={{ fontSize: 10, color: T.textDim, background: T.bg3, padding: "2px 7px", borderRadius: 10, flexShrink: 0 }}>{mc}</span>}
          </button>
        );
      })}

      {/* Google accounts */}
      <div style={{ fontSize: 10, fontWeight: 600, color: T.textDim, padding: "16px 16px 6px", textTransform: "uppercase", letterSpacing: "0.08em" }}>Google accounts</div>
      {[
        { id: "personal", label: "Personal", color: "#a78bfa" },
        { id: "georgetown", label: "Georgetown", color: "#60a5fa" },
      ].map(acc => {
        const connected = googleAccounts[acc.id];
        return (
          <div key={acc.id} style={{ padding: "5px 16px", display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: connected ? "#2dd4a8" : T.textDim, flexShrink: 0 }} />
            <span style={{ color: connected ? T.text : T.textDim, flex: 1 }}>{acc.label}</span>
            {!connected && hasGoogleClientId && (
              <a href={`/auth/google?account=${acc.id}`} style={{ fontSize: 10, color: acc.color, textDecoration: "none" }}>Connect</a>
            )}
          </div>
        );
      })}

      {/* Cost summary */}
      <div style={{ fontSize: 10, fontWeight: 600, color: T.textDim, padding: "16px 16px 6px", textTransform: "uppercase", letterSpacing: "0.08em" }}>Estimated cost</div>
      <div style={{ padding: "2px 16px 8px", fontSize: 11, color: T.textMuted }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}><span>Today</span><span style={{ color: T.text }}>{formatCost(usage.today?.estimatedCost || 0)}</span></div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}><span>This month</span><span style={{ color: T.text }}>{formatCost(usage.month?.estimatedCost || 0)}</span></div>
      </div>

      {/* User */}
      <div style={{ marginTop: "auto", padding: "12px 16px", borderTop: `1px solid ${T.border}` }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ color: T.textMuted }}>{I.user}</span><span style={{ fontSize: 12, fontWeight: 500, color: T.text }}>{user.displayName}</span></div>
          <button onClick={async () => { await api.logout(); setUser(null); }} style={{ background: "none", border: "none", color: T.textDim, cursor: "pointer", padding: 4, display: "flex" }}>{I.logout}</button>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
          {Object.entries(counts).filter(([k]) => k !== "all").map(([s, n]) => (
            <span key={s} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: T.textMuted }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: STAT_COLOR[s] }} />{n}
            </span>
          ))}
        </div>
      </div>
    </>
  );

  /* ═══ RENDER ═══ */
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: T.bg0, color: T.text, fontFamily: T.sans, fontSize: 14, overflow: "hidden" }}>

      {/* Top bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px", height: 50, background: T.bg1, borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {isMobile && <button onClick={() => setSidebarOpen(!sidebarOpen)} style={{ background: "none", border: "none", color: T.text, cursor: "pointer", padding: 4, display: "flex" }}>{sidebarOpen ? I.x : I.menu}</button>}
          <div style={{ width: 28, height: 28, borderRadius: 7, background: `linear-gradient(135deg, ${agent.color}44, ${agent.color})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#fff" }}>{agent.name[0]}</div>
          <span style={{ fontWeight: 600, fontSize: isMobile ? 14 : 15 }}>{isMobile ? agent.name : "Beads Agent Hub"}</span>
          {!isMobile && <span style={{ fontSize: 11, color: T.textDim }}>{AGENTS.length} agents | {beads.length} beads</span>}
        </div>
        {!isMobile && (
          <div style={{ display: "flex", gap: 4 }}>
            {[["chat", "Chat"], ["beads", "Beads"]].map(([v, l]) => (
              <button key={v} onClick={() => setView(v)} style={{ padding: "5px 14px", fontSize: 12, borderRadius: 6, fontFamily: T.sans, border: `1px solid ${view === v ? T.borderActive : T.border}`, background: view === v ? T.bg3 : "transparent", color: view === v ? T.text : T.textMuted, cursor: "pointer", fontWeight: view === v ? 500 : 400, position: "relative" }}>
                {l}
                {v === "beads" && counts.open > 0 && <span style={{ position: "absolute", top: -5, right: -5, background: "#ef4444", color: "#fff", fontSize: 9, fontWeight: 600, width: 15, height: 15, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>{counts.open}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "flex", flex: 1, overflow: "hidden", position: "relative" }}>
        {/* Mobile overlay */}
        {isMobile && sidebarOpen && <div onClick={() => setSidebarOpen(false)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 10 }} />}

        {/* Sidebar */}
        <div style={{
          width: isMobile ? 280 : 240, flexShrink: 0, background: T.bg1, borderRight: `1px solid ${T.border}`, display: "flex", flexDirection: "column", overflowY: "auto",
          ...(isMobile ? { position: "absolute", top: 0, left: 0, bottom: 0, zIndex: 11, transform: sidebarOpen ? "translateX(0)" : "translateX(-100%)", transition: "transform 0.2s ease" } : {}),
        }}>
          {sidebar}
        </div>

        {/* Main */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {view === "chat" ? (
            <>
              <div style={{ flex: 1, overflowY: "auto", padding: isMobile ? "16px" : "20px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
                {chat.length === 0 && (
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 20 }}>
                    <div style={{ width: 52, height: 52, borderRadius: 14, background: agent.bgSolid, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 700, color: agent.color }}>{agent.name[0]}</div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: T.textMuted }}>{agent.name}</div>
                    <div style={{ fontSize: 12, color: T.textDim, textAlign: "center", maxWidth: 380, lineHeight: 1.6 }}>{agent.desc}</div>
                    {agent.googleAccounts?.length > 0 && (
                      <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                        {agent.googleAccounts.map(a => (
                          <span key={a} style={{ fontSize: 10, padding: "3px 8px", borderRadius: 5, background: googleAccounts[a] ? "rgba(45,212,168,0.1)" : "rgba(255,255,255,0.04)", color: googleAccounts[a] ? "#2dd4a8" : T.textDim, border: `1px solid ${googleAccounts[a] ? "rgba(45,212,168,0.2)" : T.border}` }}>{a} {googleAccounts[a] ? "connected" : "not connected"}</span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {chat.map((msg, i) => {
                  const isUser = msg.role === "user";
                  const clean = isUser ? msg.content : stripBeads(msg.content);
                  const tools = (msg.toolCalls || []).filter(tc => tc.type === "call");
                  return (
                    <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", flexDirection: isUser ? "row-reverse" : "row" }}>
                      {!isUser && <div style={{ width: 28, height: 28, borderRadius: 7, background: agent.color, display: "flex", alignItems: "center", justifyContent: "center", color: T.textInverse, fontSize: 12, fontWeight: 700, flexShrink: 0, marginTop: 2 }}>{agent.name[0]}</div>}
                      <div style={{ maxWidth: isMobile ? "85%" : "78%", minWidth: 0 }}>
                        {tools.length > 0 && (
                          <div style={{ display: "flex", gap: 4, marginBottom: 6, flexWrap: "wrap" }}>
                            {tools.map((tc, ti) => (
                              <span key={ti} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, padding: "2px 8px", borderRadius: 4, background: "rgba(45,212,168,0.08)", border: "1px solid rgba(45,212,168,0.15)", color: "#2dd4a8" }}>{I.tool} {(tc.name || "").replace(/_/g, " ")}</span>
                            ))}
                          </div>
                        )}
                        <div style={{ padding: "10px 14px", borderRadius: 12, fontSize: 13.5, lineHeight: 1.65, whiteSpace: "pre-wrap", background: isUser ? agent.bgSolid : T.bg2, color: T.text, border: isUser ? `1px solid ${agent.color}33` : `1px solid ${T.border}` }}>{clean}</div>
                      </div>
                    </div>
                  );
                })}

                {loading && (
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <div style={{ width: 28, height: 28, borderRadius: 7, background: agent.color, display: "flex", alignItems: "center", justifyContent: "center", color: T.textInverse, fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{agent.name[0]}</div>
                    <div style={{ padding: "12px 16px", borderRadius: 12, background: T.bg2, border: `1px solid ${T.border}`, display: "flex", gap: 4 }}>
                      {[0, 1, 2].map(d => <span key={d} style={{ width: 5, height: 5, borderRadius: "50%", background: agent.color, animation: `bp 1.2s ease-in-out ${d * 0.15}s infinite` }} />)}
                    </div>
                  </div>
                )}
                <div ref={endRef} />
              </div>

              {/* Input + context bar */}
              <div style={{ padding: isMobile ? "8px 12px 12px" : "10px 20px 14px", borderTop: `1px solid ${T.border}`, background: T.bg1 }}>
                {/* Context window meter */}
                {chat.length > 0 && <ContextBar utilization={ctx.utilization} totalTokens={ctx.totalTokens} contextWindow={ctx.contextWindow} cost={usage.today?.estimatedCost || 0} />}
                <div style={{ display: "flex", gap: 6, alignItems: "flex-end", background: T.bg2, borderRadius: 12, padding: "4px 4px 4px 14px", border: `1px solid ${T.border}` }}>
                  <textarea ref={textareaRef} value={input} onChange={handleInput} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder={`Message ${agent.name}...`} rows={1} style={{ flex: 1, resize: "none", border: "none", outline: "none", background: "transparent", fontSize: 15, lineHeight: 1.5, padding: "8px 0", color: T.text, fontFamily: T.sans }} />
                  <button onClick={send} disabled={!input.trim() || loading} style={{ padding: "9px 14px", borderRadius: 8, border: "none", background: input.trim() && !loading ? agent.color : T.bg3, color: input.trim() && !loading ? T.textInverse : T.textDim, fontSize: 14, fontWeight: 600, cursor: input.trim() && !loading ? "pointer" : "default", opacity: input.trim() && !loading ? 1 : 0.5, flexShrink: 0, display: "flex", fontFamily: T.sans }}>{I.send}</button>
                </div>
                {!isMobile && chat.length > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, alignItems: "center" }}>
                    {lastMsgCost > 0 && <span style={{ fontSize: 10, color: T.textDim }}>Last message: ~{formatCost(lastMsgCost)}</span>}
                    <button onClick={clearChat} style={{ fontSize: 10, color: T.textDim, background: "none", border: "none", cursor: "pointer", fontFamily: T.sans, marginLeft: "auto" }}>Clear chat</button>
                  </div>
                )}
              </div>
            </>
          ) : (
            /* ═══ Beads Panel ═══ */
            <div style={{ flex: 1, overflowY: "auto", padding: isMobile ? "16px" : "20px 24px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <h2 style={{ fontSize: 17, fontWeight: 600, margin: 0 }}>Task beads</h2>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={refreshBeads} style={{ padding: "7px 10px", borderRadius: 7, border: `1px solid ${T.borderHover}`, background: T.bg2, color: T.text, cursor: "pointer", fontFamily: T.sans, display: "flex" }}>{I.refresh}</button>
                  <button onClick={createBead} style={{ padding: "7px 12px", borderRadius: 7, border: `1px solid ${T.borderHover}`, background: T.bg2, color: T.text, fontSize: 12, cursor: "pointer", fontWeight: 500, display: "flex", alignItems: "center", gap: 4, fontFamily: T.sans }}>{I.plus} New</button>
                </div>
              </div>
              <div style={{ display: "flex", gap: 2, marginBottom: 8, overflowX: "auto", paddingBottom: 6 }}>
                {["all", "open", "in_progress", "closed", "blocked"].map(f => (
                  <button key={f} onClick={() => setBeadFilter(f)} style={{ padding: "5px 10px", borderRadius: 6, border: "none", fontFamily: T.sans, whiteSpace: "nowrap", background: beadFilter === f ? T.bg3 : "transparent", color: beadFilter === f ? T.text : T.textDim, fontSize: 11, fontWeight: beadFilter === f ? 500 : 400, cursor: "pointer" }}>{f === "all" ? "All" : STAT[f]} ({counts[f] || 0})</button>
                ))}
              </div>
              {/* Label filter row */}
              {allLabels.length > 0 && (
                <div style={{ display: "flex", gap: 3, marginBottom: 14, overflowX: "auto", paddingBottom: 10, borderBottom: `1px solid ${T.border}`, alignItems: "center" }}>
                  <span style={{ fontSize: 10, color: T.textDim, flexShrink: 0 }}>Labels:</span>
                  <button onClick={() => setLabelFilter(null)} style={{ padding: "3px 8px", borderRadius: 4, border: "none", fontFamily: T.sans, whiteSpace: "nowrap", background: !labelFilter ? T.bg3 : "transparent", color: !labelFilter ? T.text : T.textDim, fontSize: 10, cursor: "pointer" }}>All</button>
                  {allLabels.map(l => (
                    <button key={l} onClick={() => setLabelFilter(labelFilter === l ? null : l)} style={{
                      padding: "3px 8px", borderRadius: 4, border: labelFilter === l ? `1px solid ${labelColor(l)}55` : "none", fontFamily: T.sans, whiteSpace: "nowrap",
                      background: labelFilter === l ? `${labelColor(l)}22` : "transparent",
                      color: labelFilter === l ? labelColor(l) : T.textDim, fontSize: 10, cursor: "pointer",
                    }}>{l}</button>
                  ))}
                </div>
              )}
              {allLabels.length === 0 && <div style={{ borderBottom: `1px solid ${T.border}`, marginBottom: 14 }} />}
              {filtered.length === 0 ? (
                <div style={{ textAlign: "center", padding: "50px 20px", color: T.textDim }}>
                  <div style={{ fontSize: 14, marginBottom: 8 }}>No beads{beadFilter !== "all" || labelFilter ? " matching filters" : " yet"}</div>
                  <div style={{ fontSize: 12, lineHeight: 1.5 }}>Chat with an agent to create tasks, or tap "New".</div>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {filtered.map(bead => {
                    const ag = AGENTS.find(a => a.id === bead.agent);
                    const bid = bead.id || bead.ID || "?";
                    const bt = bead.title || bead.Title || "Untitled";
                    const bs = bead.status || bead.Status || "open";
                    const bp = bead.priority != null ? `P${bead.priority}` : (bead.Priority || "P2");
                    const bLabels = bead.labels || [];
                    const isAddingLabel = addingLabelTo === bid;
                    return (
                      <div key={bid} style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: "12px 14px" }}>
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                          <span style={{ width: 8, height: 8, borderRadius: "50%", background: PRI[bp] || PRI.P2, flexShrink: 0, marginTop: 5 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 4, flexWrap: "wrap" }}>
                              <span style={{ fontFamily: T.mono, fontSize: 10, color: T.textDim }}>{bid}</span>
                              {ag && <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 4, background: ag.bgSolid, color: ag.color, fontWeight: 600 }}>{ag.name}</span>}
                              <span style={{ marginLeft: "auto", fontSize: 9, padding: "1px 5px", borderRadius: 4, background: `${STAT_COLOR[bs] || STAT_COLOR.open}22`, color: STAT_COLOR[bs] || STAT_COLOR.open, fontWeight: 600 }}>{STAT[bs] || bs}</span>
                            </div>
                            {editId === bid ? (
                              <input autoFocus defaultValue={bt} onBlur={e => updateBead(bid, { title: e.target.value })} onKeyDown={e => { if (e.key === "Enter") updateBead(bid, { title: e.target.value }); if (e.key === "Escape") setEditId(null); }} style={{ width: "100%", fontSize: 13, fontWeight: 500, border: `1px solid ${T.borderActive}`, borderRadius: 6, padding: "6px 8px", background: T.bg3, color: T.text, fontFamily: T.sans, outline: "none" }} />
                            ) : (
                              <div onClick={() => setEditId(bid)} style={{ fontSize: 13, fontWeight: 500, cursor: "pointer", lineHeight: 1.4 }}>{bt}</div>
                            )}
                            {/* Labels row */}
                            <div style={{ display: "flex", gap: 3, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
                              {bLabels.map(l => {
                                const lc = labelColor(l);
                                return (
                                  <span key={l} style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 9, padding: "2px 6px", borderRadius: 4, background: `${lc}18`, color: lc, fontWeight: 500 }}>
                                    {l}
                                    <button onClick={() => removeLabel(bid, l)} style={{ background: "none", border: "none", color: lc, cursor: "pointer", padding: 0, fontSize: 9, lineHeight: 1, opacity: 0.6 }}>x</button>
                                  </span>
                                );
                              })}
                              {isAddingLabel ? (
                                <input autoFocus value={newLabelText} onChange={e => setNewLabelText(e.target.value)}
                                  onKeyDown={e => { if (e.key === "Enter" && newLabelText.trim()) { addLabel(bid, newLabelText.trim()); setNewLabelText(""); setAddingLabelTo(null); } if (e.key === "Escape") { setAddingLabelTo(null); setNewLabelText(""); } }}
                                  onBlur={() => { setAddingLabelTo(null); setNewLabelText(""); }}
                                  placeholder="label" style={{ width: 60, fontSize: 9, padding: "2px 4px", borderRadius: 3, border: `1px solid ${T.borderActive}`, background: T.bg3, color: T.text, fontFamily: T.sans, outline: "none" }} />
                              ) : (
                                <button onClick={() => setAddingLabelTo(bid)} style={{ fontSize: 9, padding: "2px 5px", borderRadius: 3, border: `1px dashed ${T.border}`, background: "transparent", color: T.textDim, cursor: "pointer", fontFamily: T.sans }}>+ label</button>
                              )}
                            </div>
                            {/* Priority + status controls */}
                            <div style={{ display: "flex", gap: 3, marginTop: 8, flexWrap: "wrap" }}>
                              {["P0", "P1", "P2", "P3"].map(p => (
                                <button key={p} onClick={() => updateBead(bid, { priority: parseInt(p[1]) })} style={{ padding: isMobile ? "4px 10px" : "2px 7px", borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: "pointer", fontFamily: T.sans, border: bp === p ? `1.5px solid ${PRI[p]}` : `1px solid ${T.border}`, background: bp === p ? `${PRI[p]}22` : "transparent", color: bp === p ? PRI[p] : T.textDim }}>{p}</button>
                              ))}
                              <span style={{ width: 1, height: 16, background: T.border, margin: "0 1px" }} />
                              {Object.keys(STAT).map(s => (
                                <button key={s} onClick={() => updateBead(bid, { status: s })} style={{ padding: isMobile ? "4px 8px" : "2px 7px", borderRadius: 4, fontSize: 10, fontWeight: 500, cursor: "pointer", fontFamily: T.sans, border: bs === s ? `1.5px solid ${STAT_COLOR[s]}` : `1px solid ${T.border}`, background: bs === s ? `${STAT_COLOR[s]}22` : "transparent", color: bs === s ? STAT_COLOR[s] : T.textDim }}>{STAT[s]}</button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Mobile bottom nav */}
      {isMobile && (
        <div style={{ display: "flex", background: T.bg1, borderTop: `1px solid ${T.border}`, flexShrink: 0 }}>
          {[{ id: "chat", icon: I.chat, label: "Chat" }, { id: "beads", icon: I.beads, label: `Beads${counts.open ? ` (${counts.open})` : ""}` }].map(tab => (
            <button key={tab.id} onClick={() => setView(tab.id)} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "10px 0 8px", border: "none", background: "transparent", cursor: "pointer", color: view === tab.id ? agent.color : T.textDim, fontFamily: T.sans, fontSize: 10, fontWeight: 500 }}>
              {tab.icon}{tab.label}
            </button>
          ))}
        </div>
      )}

      <style>{`
        @keyframes bp{0%,100%{opacity:.25;transform:scale(.75)}50%{opacity:1;transform:scale(1.1)}}
        *{box-sizing:border-box;margin:0}
        ::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:${T.bg4};border-radius:3px}
        textarea::placeholder,input::placeholder{color:${T.textDim}}
        button{transition:filter .1s,transform .1s}button:hover{filter:brightness(1.1)}button:active{transform:scale(.98)}
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');
      `}</style>
    </div>
  );
}
