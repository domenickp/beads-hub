async function req(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...opts.headers },
    credentials: "include",
    ...opts,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export const api = {
  // Auth
  login: (username, password) => req("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  logout: () => req("/api/auth/logout", { method: "POST" }),
  me: () => req("/api/auth/me"),
  register: (username, displayName, password) => req("/api/auth/register", { method: "POST", body: JSON.stringify({ username, displayName, password }) }),
  changePassword: (currentPassword, newPassword) => req("/api/auth/change-password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) }),

  // Health / Status
  health: () => req("/api/health"),
  status: () => req("/api/status"),

  // Chat
  send: (agentId, message, systemPrompt) => req("/api/chat", { method: "POST", body: JSON.stringify({ agentId, message, systemPrompt }) }),
  getConvo: (agentId) => req(`/api/conversations/${agentId}`),
  clearConvo: (agentId) => req(`/api/conversations/${agentId}`, { method: "DELETE" }),

  // Beads
  listBeads: () => req("/api/beads"),
  readyBeads: () => req("/api/beads/ready"),
  createBead: (title, priority) => req("/api/beads", { method: "POST", body: JSON.stringify({ title, priority }) }),
  updateBead: (id, updates) => req(`/api/beads/${id}`, { method: "PATCH", body: JSON.stringify(updates) }),
  addDep: (id, dependsOn) => req(`/api/beads/${id}/dep`, { method: "POST", body: JSON.stringify({ dependsOn }) }),
  removeDep: (id, depId) => req(`/api/beads/${id}/dep/${depId}`, { method: "DELETE" }),
  addLabel: (id, label) => req(`/api/beads/${id}/label`, { method: "POST", body: JSON.stringify({ label }) }),
  removeLabel: (id, label) => req(`/api/beads/${id}/label/${label}`, { method: "DELETE" }),

  // Context
  getContext: (agentId) => req(`/api/context/${agentId}`),
  setContext: (agentId, ctx) => req(`/api/context/${agentId}`, { method: "PUT", body: JSON.stringify(ctx) }),

  // Usage & cost
  getUsage: () => req("/api/usage"),

  // Google accounts
  googleStatus: () => req("/auth/google/status"),
};
