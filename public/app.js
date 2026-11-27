import { mountAuth } from "./auth.js";
import { mountBrowserApp } from "./browser.js";

const app = document.querySelector("#app");
const toast = document.querySelector("#toast");
let state = null;
let currentPage = "overview";
let browserAppView;
let browserAppMode = null;
let browserAppUserId = null;
let moduleSettingsOpen = false;
let chatModuleSettingsOpen = false;
let domainCreationMode = "domain";
let editingUserId = "";
let usersData = { users: [], roles: [] };
let domainsData = { tlds: [], domains: [] };
let hostingData = { hosts: [], domains: [] };
let sitesData = { sites: [], hosts: [], domains: [] };
let siteEditorData = { site: null, files: [], selected: "", content: "" };
let storageData = { files: [], folder: "", selected: "", content: "" };
let connectData = { friends: [], requests: [], files: [] };
let chatData = { users: [], conversations: [], messages: [], selected: "" };
let toastTimer;
let authError = "";
let moduleStatusStream;
let userPreviewMode = false;
const storedTheme = localStorage.getItem("jnet-theme");
let darkMode = storedTheme ? storedTheme === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
document.documentElement.dataset.theme = darkMode ? "dark" : "light";

function updateThemeMetadata() {
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.content = darkMode ? "#201a2b" : "#f6f1ff";
}

updateThemeMetadata();

window.addEventListener("storage", (event) => {
  if (event.key !== "jnet-theme" || !["light", "dark"].includes(event.newValue)) return;
  darkMode = event.newValue === "dark";
  document.documentElement.dataset.theme = event.newValue;
  updateThemeMetadata();
  const toggle = app.querySelector("#theme-toggle");
  if (toggle) {
    toggle.setAttribute("aria-label", `Switch to ${darkMode ? "light" : "dark"} theme`);
    toggle.title = `Switch to ${darkMode ? "light" : "dark"} theme`;
    toggle.querySelector("span").textContent = `${darkMode ? "Light" : "Dark"} mode`;
  }
});

const icons = {
  overview: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  apps: '<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/>',
  browser: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/>',
  scramjet: '<path d="m13 2-3 9h7L9 22l2-9H5l8-11Z"/>',
  chat: '<path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H6l-3 2v-6a7.5 7.5 0 1 1 17-3.5Z"/><path d="M8 11h.01M12 11h.01M16 11h.01"/>',
  modules: '<path d="M12 3v3m0 12v3M3 12h3m12 0h3"/><circle cx="12" cy="12" r="6"/><path d="m10 10 4 2-4 2z"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  domains: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/>',
  hosting: '<path d="M4 20V5l8-2 8 2v15"/><path d="M9 20v-6h6v6M8 8h1m6 0h1"/>',
  announcement: '<path d="m3 11 18-5-5 15-4-7-7-3Z"/><path d="m12 14-3 6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.7a8 8 0 0 1-1.7 1l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.7-1l-1.7.7-1.4-2.4L7.3 15a8 8 0 0 1 0-2l-1.4-1.1 1.4-2.4 1.7.7a8 8 0 0 1 1.7-1L11 7.4h2.8l.3 1.8a8 8 0 0 1 1.7 1l1.7-.7 1.4 2.4-1.4 1.1a8 8 0 0 1-.1 2Z"/>',
  signout: '<path d="M10 17l5-5-5-5M15 12H3"/><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"/>',
  close: '<path d="m18 6-12 12M6 6l12 12"/>',
  theme: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/>',
  storage: '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M3 10h18"/>',
  connect: '<circle cx="6" cy="12" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><path d="m9 11 6-4m-6 6 6 4"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M3 10h18"/>',
  file: '<path d="M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10Z"/><path d="M13 3v7h7M8 15h8m-8 3h8"/>',
  code: '<path d="m8 8-4 4 4 4m8-8 4 4-4 4m-3-10-2 12"/>',
  upload: '<path d="M12 16V4m-4 4 4-4 4 4"/><path d="M4 16v4h16v-4"/>',
  download: '<path d="M12 4v12m-4-4 4 4 4-4"/><path d="M4 16v4h16v-4"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
  plus: '<path d="M12 5v14m-7-7h14"/>',
  trash: '<path d="M3 6h18m-2 0-.9 14H5.9L5 6m4 0V4h6v2m-5 4v6m4-6v6"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.6 9a7 7 0 0 1 11.6-2L20 12M4 12l2.8 5a7 7 0 0 0 11.6-2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  external: '<path d="M14 4h6v6m-11 5L20 4"/><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 1 1 8 0v3m-4 5v2"/>',
  pin: '<path d="m16 3 5 5-4 1-4 4 1 4-2 2-3-6-6-3 2-2 4 1 4-4 1-4Z"/>',
  power: '<path d="M12 2v10"/><path d="M18.4 5.6a8 8 0 1 1-12.8 0"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
  sliders: '<path d="M4 21v-7m0-4V3m8 18v-9m0-4V3m8 18v-5m0-4V3"/><path d="M2 14h4m4-6h4m4 8h4"/>',
};

function icon(name) {
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.apps}</svg>`;
}

function quickSwitcherShortcut() {
  const platform = navigator.userAgentData?.platform || navigator.platform || "";
  return /mac/i.test(platform) ? "⌘ K" : "Ctrl K";
}

function appIconName(id) {
  return ({
    browser: "browser",
    "wisp-browser": "scramjet",
    chat: "chat",
    storage: "storage",
    connect: "connect",
  })[id] || "apps";
}

function moduleAction(action, label, { moduleId = "", primary = false, confirm = "" } = {}) {
  const actionIcon = action === "download" ? "download"
    : action === "restart" ? "refresh"
      : action === "disable" ? "power"
        : action === "stop" ? "stop"
          : action === "start" ? "plus"
            : "plus";
  return `<button class="button ${primary ? "button-primary" : ""} button-small" data-action="${action}" ${moduleId ? `data-module="${escapeHtml(moduleId)}"` : ""} ${confirm ? `data-confirm="${escapeHtml(confirm)}"` : ""}>${icon(actionIcon)}${label}</button>`;
}

function quickSwitcherEntries() {
  const pages = [
    { id: "overview", label: "Overview", detail: "Your Jnet dashboard", permission: "apps:view" },
    { id: "launch", label: "Launch apps", detail: "Browse your available apps", permission: "apps:view" },
    { id: "users", label: "Users", detail: "Accounts and permissions", permission: "users:manage" },
    { id: "apps", label: "App settings", detail: "Choose which apps are available", permission: "apps:manage" },
    { id: "modules", label: "Modules", detail: "Manage background services", permission: "modules:manage" },
    { id: "domains", label: "Domains", detail: "Manage Jnet domains", permission: "domains:manage" },
    { id: "hosting", label: "Sites", detail: "Manage hosted websites", permission: "hosting:manage" },
    { id: "announcements", label: "Announcements", detail: "Update the homepage banner", permission: "announcements:manage" },
    { id: "settings", label: "Settings", detail: "Server and account settings", permission: "*" },
  ]
    .filter((page) => can(page.permission))
    .map((page) => ({ ...page, kind: "page" }));
  const apps = state.apps
    .filter((item) => item.enabled)
    .filter((item) => !userPreviewMode || item.public)
    .filter((item) => item.id !== "chat" || can("chat:use"))
    .filter((item) => item.id !== "storage" || can("storage:use"))
    .filter((item) => item.id !== "connect" || can("connect:use"))
    .map((item) => ({ id: item.id, label: item.name, detail: item.description, kind: "app" }));
  return [...pages, ...apps];
}

function quickSwitcherDialog() {
  const entries = quickSwitcherEntries();
  return `<dialog class="quick-switcher" id="quick-switcher" aria-label="Quick switcher">
    <div class="quick-switcher-head"><span class="quick-search-mark">${icon("apps")}</span><input id="quick-switcher-input" type="search" placeholder="Jump to a page or app…" aria-label="Search pages and apps" autocomplete="off"><kbd>ESC</kbd><button class="quick-switcher-close" type="button" data-close-quick-switcher aria-label="Close quick switcher">×</button></div>
    <div class="quick-switcher-list" role="listbox" aria-label="Pages and apps">${entries.map((entry) => `<button class="quick-switcher-item" role="option" data-quick-kind="${entry.kind}" data-quick-id="${escapeHtml(entry.id)}" data-search="${escapeHtml(`${entry.label} ${entry.detail}`.toLowerCase())}"><span class="quick-item-icon">${icon(entry.kind === "app" ? appIconName(entry.id) : entry.id === "settings" ? "settings" : entry.id === "users" ? "users" : entry.id === "modules" ? "modules" : entry.id === "domains" || entry.id === "hosting" ? "domains" : entry.id === "announcements" ? "announcement" : "overview")}</span><span class="quick-item-copy"><strong>${escapeHtml(entry.label)}</strong><small>${escapeHtml(entry.detail)}</small></span><span class="quick-item-kind">${entry.kind === "app" ? "APP" : "PAGE"}</span></button>`).join("")}<p class="quick-switcher-empty" hidden>No matching pages or apps.</p></div>
    <footer><span><kbd>↑</kbd><kbd>↓</kbd> to navigate</span><span><kbd>↵</kbd> to open</span></footer>
  </dialog>`;
}

function can(permission) {
  const normalRole = usersData.roles.find((role) => role.id === "normal");
  const permissions = userPreviewMode
    ? normalRole?.permissions || ["apps:view", "chat:use", "connect:use", "domains:view", "storage:use"]
    : state?.permissions || [];
  return Boolean(permissions.includes("*") || permissions.includes(permission));
}

function configuredChatUrl() {
  const settings = state?.chatSettings;
  return settings?.domain ? `/domain/${encodeURIComponent(settings.domain)}${settings.path}` : "";
}

function appRouteId() {
  const match = window.location.pathname.match(/^\/app\/([a-z0-9-]+)$/);
  return match?.[1] || "";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function notify(message, error = false) {
  toast.textContent = message;
  toast.classList.toggle("toast-error", error);
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
}

async function request(url, options = {}) {
  const headers = { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers };
  if (options.method && options.method !== "GET" && state?.csrfToken) {
    headers["X-JNet-CSRF"] = state.csrfToken;
  }
  const response = await fetch(url, { credentials: "same-origin", ...options, headers });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
  return result;
}

function renderLogin(error = authError) {
  userPreviewMode = false;
  document.body.classList.remove("standalone-browser");
  destroyBrowserApp();
  document.title = "Jnet — Sign in";
  mountAuth({
    root: app,
    state,
    icon,
    isAdminPortal: window.location.pathname === "/admin",
    error,
    onSubmit: handleAuthSubmit,
    onModeChange: () => {
      authError = "";
      renderLogin();
    },
  });
}

function destroyBrowserApp() {
  browserAppView?.destroy();
  browserAppView = null;
  browserAppMode = null;
  browserAppUserId = null;
}

async function handleAuthSubmit(event, mode) {
  event.preventDefault();
  authError = "";
  const button = event.currentTarget.querySelector("button[type=submit]");
  button.disabled = true;
  const form = new FormData(event.currentTarget);
  const credentials = { username: form.get("username"), password: form.get("password") };
  try {
    if (mode === "setup") {
      state = await request("/api/setup", {
        method: "POST",
        body: JSON.stringify({ ...credentials, key: form.get("key") }),
      });
    } else if (mode === "signup") {
      state = await request("/api/signup", { method: "POST", body: JSON.stringify(credentials) });
    } else {
      await request("/api/login", { method: "POST", body: JSON.stringify(credentials) });
    }
    const accepted = await refresh();
    connectModuleStatusEvents();
    if (accepted) notify(mode === "setup" ? "Administrator account created." : mode === "signup" ? "Account created." : "Signed in successfully.");
  } catch (error) {
    authError = error.message;
    app.querySelector("#login-error").textContent = authError;
    button.disabled = false;
  }
}

function statusBadge(status) {
  const labels = {
    running: "Running",
    starting: "Starting",
    stopping: "Stopping",
    stopped: "Stopped",
    installing: "Downloading",
    disabled: "Disabled",
    failed: "Needs attention",
  };
  const style = status === "running" ? "running" : status === "failed" ? "failed" : status === "disabled" ? "disabled" : "";
  return `<span class="badge ${style}"><span class="dot ${status === "running" ? "online" : ""}"></span>${labels[status] || "Stopped"}</span>`;
}

function moduleCard() {
  const module = state.module;
  const running = module.status === "running" || module.status === "starting" || module.status === "stopping";
  const busy = module.operation || module.status === "installing";
  let actions;
  if (!state.settings.enabled) {
    actions = moduleAction("enable", "Enable module", { primary: true });
  } else if (!module.installed) {
    actions = `${moduleAction("download", "Download Wisp", { primary: true, confirm: "Download the pinned Wisp server package from npm?" })}${moduleAction("disable", "Disable")}`;
  } else if (running) {
    actions = `${moduleAction("stop", "Stop")}${moduleAction("restart", "Restart")}${moduleAction("disable", "Disable")}`;
  } else {
    actions = `${moduleAction("start", "Start", { primary: true })}${moduleAction("restart", "Restart")}${moduleAction("disable", "Disable")}`;
  }
  return `
    <section class="card module-card">
      <div class="module-header">
        <div class="module-title">
          <div class="module-icon module-icon-wisp" aria-hidden="true">${icon("modules")}</div>
          <div><h3>Wisp Server</h3><p>Local WebSocket proxy module</p></div>
        </div>
        ${statusBadge(module.status)}
      </div>
      <div class="module-details">
        <div><div class="detail-label">WebSocket path</div><div class="detail-value" title="${escapeHtml(state.settings.path)}">${escapeHtml(state.settings.path)}</div></div>
        <div><div class="detail-label">Listener</div><div class="detail-value">127.0.0.1:${state.settings.port}</div></div>
        <div><div class="detail-label">Module entry point</div><div class="detail-value">modules/wisp/main.js</div></div>
      </div>
      <div class="module-actions">${actions}<button class="button button-small" data-toggle-module-settings ${running || busy ? "disabled" : ""}>${icon("sliders")}${moduleSettingsOpen ? "Close module settings" : "Module settings"}</button></div>
      ${moduleSettingsOpen ? `
        <section class="module-settings">
          <form id="module-settings-form">
            <div class="field"><label for="module-path">WebSocket path</label><input id="module-path" name="path" value="${escapeHtml(state.settings.path)}" maxlength="160" required autocomplete="off"><p class="help">Wisp accepts WebSocket connections at this URL path.</p></div>
            <div class="field"><label for="module-port">Listener port</label><input id="module-port" name="port" type="number" min="1024" max="65535" value="${state.settings.port}" required><p class="help">The module binds to 127.0.0.1 on this port.</p></div>
            <button class="button button-primary button-small" type="submit">Save module settings</button>
          </form>
        </section>` : ""}
      ${module.error ? `<p class="module-status-note">${escapeHtml(module.error)}</p>` : ""}
      ${module.output ? `<pre class="log-box">${escapeHtml(module.output)}</pre>` : ""}
      ${busy ? '<p class="module-status-note">The module operation is in progress. This page refreshes automatically.</p>' : ""}
    </section>`;
}

function chatBackendCard() {
  const module = state.chatBackendModule || {};
  const running = module.status === "running" || module.status === "starting";
  const busy = Boolean(module.operation);
  let actions;
  if (!module.enabled) {
    actions = moduleAction("enable", "Enable module", { moduleId: "chat-backend", primary: true });
  } else if (!module.installed) {
    actions = `${moduleAction("download", "Install Chat backend", { moduleId: "chat-backend", primary: true })}${moduleAction("disable", "Disable", { moduleId: "chat-backend" })}`;
  } else if (running) {
    actions = `${moduleAction("stop", "Stop", { moduleId: "chat-backend" })}${moduleAction("restart", "Restart", { moduleId: "chat-backend" })}${moduleAction("disable", "Disable", { moduleId: "chat-backend" })}`;
  } else {
    actions = `${moduleAction("start", "Start", { moduleId: "chat-backend", primary: true })}${moduleAction("disable", "Disable", { moduleId: "chat-backend" })}`;
  }
  return `<section class="card module-card">
    <div class="module-header"><div class="module-title"><div class="module-icon module-icon-chat" aria-hidden="true">${icon("chat")}</div><div><h3>Chat backend</h3><p>Private direct and group messaging service</p></div></div>${statusBadge(module.status || "stopped")}</div>
    <div class="module-details">
      <div><div class="detail-label">Backend path</div><div class="detail-value">${escapeHtml(module.path || "/api/chat")}</div></div>
      <div><div class="detail-label">Listener</div><div class="detail-value">127.0.0.1:${Number(module.port) || 8091}</div></div>
      <div><div class="detail-label">Module entry point</div><div class="detail-value">modules/chat-backend/main.js</div></div>
    </div>
    <div class="module-actions">${actions}<button class="button button-small" data-toggle-chat-module-settings ${running || busy ? "disabled" : ""}>${icon("sliders")}${chatModuleSettingsOpen ? "Close module settings" : "Module settings"}</button></div>
    ${chatModuleSettingsOpen ? `<section class="module-settings"><form id="chat-module-settings-form">
      <div class="field"><label for="chat-module-path">Backend path</label><input id="chat-module-path" name="path" value="${escapeHtml(module.path || "/api/chat")}" maxlength="160" required><p class="help">The app backend is proxied through Jnet at this path.</p></div>
      <div class="field"><label for="chat-module-port">Listener port</label><input id="chat-module-port" name="port" type="number" min="1024" max="65535" value="${Number(module.port) || 8091}" required><p class="help">The module binds to loopback only.</p></div>
      <button class="button button-primary button-small" type="submit">Save module settings</button>
    </form></section>` : ""}
    ${module.error ? `<p class="module-status-note">${escapeHtml(module.error)}</p>` : ""}
    ${module.output ? `<pre class="log-box">${escapeHtml(module.output)}</pre>` : ""}
    ${busy ? '<p class="module-status-note">The module operation is in progress.</p>' : ""}
  </section>`;
}

function managedModuleCard(moduleId, title, description, entry, module) {
  const enabled = module?.enabled === true;
  const action = enabled ? "disable" : "enable";
  const moduleIcon = moduleId === "storage-backend" ? "storage" : "connect";
  const actionButton = moduleAction(action, `${enabled ? "Disable" : "Enable"} module`, { moduleId, primary: !enabled });
  return `<section class="card module-card"><div class="module-header"><div class="module-title"><div class="module-icon module-icon-${escapeHtml(moduleId)}" aria-hidden="true">${icon(moduleIcon)}</div><div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(description)}</p></div></div>${statusBadge(module?.status || "disabled")}</div>
    <div class="module-details"><div><div class="detail-label">Module entry point</div><div class="detail-value">${escapeHtml(entry)}</div></div>${moduleId === "connect" ? `<div><div class="detail-label">Public API</div><div class="detail-value">${module.apiEnabled ? "Enabled" : "Disabled"}</div></div>` : ""}</div>
    <div class="module-actions">${actionButton}</div>
  </section>`;
}

function announcementBanner() {
  const item = state?.announcement;
  if (!item?.enabled) return "";
  return `<section id="announcement-banner" class="announcement-banner">${item.image ? `<img src="${item.image}" alt="">` : ""}<p>${escapeHtml(item.text)}</p></section>`;
}

function syncAnnouncementStyle() {
  const stylesheet = document.getElementById("announcement-style");
  const color = state?.announcement?.color;
  if (stylesheet && color && stylesheet.dataset.color !== color) {
    stylesheet.href = `/announcement.css?v=${encodeURIComponent(color)}`;
    stylesheet.dataset.color = color;
  }
}

function overviewPage() {
  if (userPreviewMode) {
    return `
      <div class="workspace-hero">
        <div><p class="eyebrow">YOUR WORKSPACE</p><h1>Good to see you.</h1><p>Everything your administrator shared with you, in one place.</p></div>
        <button class="button button-primary hero-action" data-page="launch">${icon("apps")} Explore apps</button>
      </div>
      ${announcementBanner()}
      <div class="section-heading"><div><h2>Made for you</h2><p>Apps shared with your account</p></div><span class="section-count">${state.apps.filter((item) => item.enabled && item.public).length} available</span></div>
      ${appsGrid()}`;
  }
  return `
    <div class="workspace-hero">
      <div><p class="eyebrow">JNET WORKSPACE</p><h1>Your network, in one place.</h1><p>Launch tools, manage services, and keep your workspace in sync.</p></div>
      <button class="button button-primary hero-action" data-page="launch">${icon("apps")} Explore apps</button>
    </div>
    ${announcementBanner()}
    <div class="workspace-stats">
      <section class="workspace-stat"><span class="stat-indicator is-online"></span><div><span class="stat-label">Jnet server</span><strong>Online</strong><small>Listening on :${state.serverPort}</small></div></section>
      <section class="workspace-stat"><span class="stat-icon">${icon("users")}</span><div><span class="stat-label">Signed in as</span><strong>${escapeHtml(state.user.username)}</strong><small>${escapeHtml(state.role?.name || "Account")} access</small></div></section>
      <section class="workspace-stat"><span class="stat-icon">${icon("apps")}</span><div><span class="stat-label">Your workspace</span><strong>${state.apps.filter((item) => item.enabled).length} apps</strong><small>Ready when you are</small></div></section>
    </div>
    <div class="section-heading"><div><h2>Pick up where you left off</h2><p>Your apps open in their own tab.</p></div><button class="link-button section-link" data-page="launch">All apps <span aria-hidden="true">→</span></button></div>
    ${appsGrid()}`;
}

function modulesPage() {
  if (!can("modules:manage")) return noPermission();
  return `
    <div class="page-heading"><div><h1>Modules</h1><p>Manage network services and their server processes.</p></div></div>
    ${moduleCard()}
    ${chatBackendCard()}
    ${managedModuleCard("storage-backend", "Storage backend", "Per-user private file storage", "modules/storage-backend/main.js", state.storageBackendModule)}
    ${managedModuleCard("connect", "Connect", "Friend requests and secure file transfer", "Built-in module", state.connectModule)}
    <div class="notice notice-spaced"><strong>About Wisp.</strong> Wisp is a proxy transport, not an offline content cache. It listens on loopback by default.</div>`;
}

function appsGrid() {
  const normalPermissions = userPreviewMode
    ? usersData.roles.find((role) => role.id === "normal")?.permissions || ["apps:view", "chat:use", "connect:use", "domains:view", "storage:use"]
    : [];
  const apps = state.apps.filter((item) =>
    item.enabled &&
    (!userPreviewMode || (
      item.public &&
      (item.id !== "chat" || normalPermissions.includes("*") || normalPermissions.includes("chat:use")) &&
      (item.id !== "storage" || normalPermissions.includes("*") || normalPermissions.includes("storage:use")) &&
      (item.id !== "connect" || normalPermissions.includes("*") || normalPermissions.includes("connect:use"))
    )));
  if (!apps.length) return '<div class="empty-state">No apps are available for this account.</div>';
  return `<div class="app-grid">${apps.map((item) => `
    <button class="app-tile" data-app="${escapeHtml(item.id)}" data-launch-app="${escapeHtml(item.id)}" aria-label="Open ${escapeHtml(item.name)} in a new tab">
      <span class="app-tile-top"><span class="app-tile-icon">${icon(appIconName(item.id))}</span><span class="app-tile-open" aria-hidden="true">↗</span></span>
      <span class="app-tile-name">${escapeHtml(item.name)}</span><span class="app-tile-description">${escapeHtml(item.description)}</span>
    </button>`).join("")}</div>`;
}

function launcherPage() {
  return `<div class="page-heading"><div><h1>Launch</h1><p>Open an app available to your account.</p></div></div>${announcementBanner()}${appsGrid()}`;
}

function appPage() {
  if (currentPage === "app-storage") return storageAppPage();
  if (currentPage === "app-connect") return connectAppPage();
  if (!state.apps.some((item) => item.id === "chat" && item.enabled)) return noPermission();
  const selected = chatData.conversations.find((item) => item.id === chatData.selected);
  const membersById = new Map(chatData.users.map((user) => [user.id, user]));
  const currentUserId = state.user.id === "admin-key" ? "admin-key" : state.user.id;
  const conversationName = (conversation) => conversation.type === "group"
    ? conversation.title
    : membersById.get(conversation.members.find((member) => member !== currentUserId))?.displayName || "Direct message";
  return `<div class="page-heading"><div><h1>Chat</h1><p>Private direct and group messaging. Conversations are visible only to their members.</p></div></div>${announcementBanner()}
    <div class="chat-layout"><aside class="card chat-sidebar"><h3>Conversations</h3>
      ${chatData.conversations.map((conversation) => `<button class="chat-conversation ${conversation.id === chatData.selected ? "active" : ""}" data-chat-select="${escapeHtml(conversation.id)}"><strong>${escapeHtml(conversationName(conversation))}</strong><span>${escapeHtml(conversation.lastMessage?.text || "No messages yet")}</span></button>`).join("") || '<p class="subtle">Start a conversation below.</p>'}
      <details class="new-chat"><summary class="button button-small">${icon("users")} New conversation</summary><form id="new-chat-form"><fieldset class="field member-picker"><legend>Choose members</legend>${chatData.users.filter((user) => user.id !== currentUserId).map((user) => `<label class="member-option"><input type="checkbox" name="members" value="${escapeHtml(user.id)}"><span><strong>${escapeHtml(user.displayName)}</strong><small>@${escapeHtml(user.username)}</small></span></label>`).join("") || '<p class="subtle">No other users are available yet.</p>'}</fieldset><div class="field group-title-field" hidden><label>Group name</label><input name="title" maxlength="64" placeholder="Give this group a name"></div><button class="button button-primary button-small" type="submit">Start conversation</button></form></details>
    </aside><section class="card chat-main">${selected ? `<h3>${escapeHtml(conversationName(selected))}</h3><div class="chat-messages" id="chat-messages">${chatData.messages.map((message) => `<article class="chat-message"><div><strong>${escapeHtml(membersById.get(message.senderId)?.displayName || (message.senderId === "admin-key" ? "Administrator" : "Former user"))}</strong><time>${escapeHtml(new Date(message.createdAt).toLocaleString())}</time></div><p>${escapeHtml(message.text)}</p></article>`).join("") || '<p class="subtle">No messages yet.</p>'}</div><form id="send-chat-form"><div class="field"><label for="chat-message">Message</label><textarea id="chat-message" name="text" rows="3" maxlength="2000" required></textarea><p class="help">In a direct message with a friend, use <code>/connect send path/to/file</code> to transfer from Storage.</p></div><button class="button button-primary button-small" type="submit">Send message</button></form>` : '<div class="empty-state">Choose a conversation or create a new one.</div>'}</section></div>`;
}

function storageAppPage() {
  if (!state.apps.some((item) => item.id === "storage" && item.enabled)) return noPermission();
  const prefix = storageData.folder ? `${storageData.folder}/` : "";
  const items = storageData.files.filter((item) => {
    if (!item.path.startsWith(prefix)) return false;
    return !item.path.slice(prefix.length).includes("/");
  });
  const files = items.map((item) => `<div class="storage-row">
    <button class="storage-item" data-storage-open="${escapeHtml(item.path)}"><span class="storage-item-icon ${item.type === "folder" ? "is-folder" : ""}">${icon(item.type === "folder" ? "folder" : "file")}</span><span>${escapeHtml(item.path.slice(prefix.length))}</span></button>
    ${item.type === "file" ? `<a class="button button-small storage-action" href="/api/storage/download?path=${encodeURIComponent(item.path)}" aria-label="Download ${escapeHtml(item.path)}" title="Download">${icon("download")}</a>` : ""}
    <button class="button button-small button-danger storage-action" data-storage-delete="${escapeHtml(item.path)}" aria-label="Delete ${escapeHtml(item.path)}" title="Delete">${icon("trash")}</button>
  </div>`).join("");
  const selectedIsHtml = /\.html?$/i.test(storageData.selected);
  const previewHtml = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'">${storageData.content}`;
  return `<div class="page-heading"><div><h1>Storage</h1><p>Your private files and documents. HTML previews do not execute scripts.</p></div></div>
    <div class="storage-layout">
      <section class="card storage-browser"><div class="storage-toolbar"><strong>${storageData.folder ? escapeHtml(storageData.folder) : "My files"}</strong><button class="button button-small" id="storage-up" ${storageData.folder ? "" : "disabled"}>Up</button></div>
        <form id="storage-upload-form" class="inline-upload"><label class="button button-small storage-upload-label">${icon("upload")} Add files<input name="file" type="file" hidden required></label><button class="button button-small" type="submit">Upload</button></form>
        <form id="storage-folder-form"><div class="field"><label>New folder</label><input name="name" required maxlength="80"></div><button class="button button-small" type="submit">${icon("plus")} Create folder</button></form>
        <form id="storage-new-file-form"><div class="field"><label>New document</label><input name="name" placeholder="notes.md" required maxlength="120"></div><button class="button button-small" type="submit">${icon("plus")} Create file</button></form>
        <div class="storage-list">${files || '<p class="subtle">This folder is empty.</p>'}</div>
      </section>
      <section class="card storage-editor"><div class="storage-toolbar"><strong>${escapeHtml(storageData.selected || "Select a file")}</strong><div class="button-row"><button class="button button-small" id="storage-rename" ${storageData.selected ? "" : "disabled"}>Rename</button><button class="button button-primary button-small" id="storage-save" ${storageData.selected ? "" : "disabled"}>Save</button></div></div>
        ${storageData.selected ? `<textarea id="storage-content" class="code-editor" aria-label="File contents" spellcheck="false">${escapeHtml(storageData.content)}</textarea>
        ${selectedIsHtml ? `<details class="storage-html-viewer"><summary>HTML preview (scripts disabled)</summary><iframe title="Safe HTML viewer" sandbox srcdoc="${escapeHtml(previewHtml)}"></iframe></details>` : ""}` : '<p class="subtle">Choose a text file to view or edit it. Binary files can be downloaded.</p>'}
      </section>
    </div>`;
}

function connectAppPage() {
  if (!state.apps.some((item) => item.id === "connect" && item.enabled)) return noPermission();
  const incoming = connectData.requests.filter((item) => item.direction === "incoming");
  const outgoing = connectData.requests.filter((item) => item.direction === "outgoing");
  const files = connectData.files.filter((item) => item.type === "file");
  return `<div class="page-heading"><div><h1>Connect</h1><p>Find Jnet users, manage friend requests, and transfer files securely.</p></div></div>
    <section class="card settings-card"><h3>Add a friend</h3><form id="connect-friend-form" class="form-grid"><div class="field"><label>Username</label><input name="username" required minlength="3" maxlength="32"></div><button class="button button-primary button-small" type="submit">Send friend request</button></form></section>
    <section class="card"><h3>Incoming requests</h3>${incoming.map((item) => `<div class="role-row"><div><strong>${escapeHtml(item.user.displayName)}</strong><span>@${escapeHtml(item.user.username)}</span></div><div class="button-row"><button class="button button-primary button-small" data-friend-accept="${escapeHtml(item.id)}">Accept</button><button class="button button-small" data-friend-decline="${escapeHtml(item.id)}">Decline</button></div></div>`).join("") || '<p class="subtle">No incoming requests.</p>'}</section>
    ${outgoing.length ? `<section class="card"><h3>Outgoing requests</h3>${outgoing.map((item) => `<div class="role-row"><div><strong>${escapeHtml(item.user.displayName)}</strong><span>Waiting for a response</span></div><button class="button button-small" data-friend-remove="${escapeHtml(item.id)}">Cancel</button></div>`).join("")}</section>` : ""}
    <section class="card"><h3>Friends</h3>${connectData.friends.map((item) => `<div class="role-row"><div><strong>${escapeHtml(item.user.displayName)}</strong><span>@${escapeHtml(item.user.username)}</span></div><button class="button button-small" data-friend-remove="${escapeHtml(item.id)}">Remove</button></div>`).join("") || '<p class="subtle">Add a friend to start sharing.</p>'}</section>
    <section class="card settings-card"><h3>Send a file</h3>${state.apps.some((item) => item.id === "storage" && item.enabled)
      ? `<form id="connect-send-form"><div class="field"><label>Friend</label><select name="toUserId" required>${connectData.friends.map((item) => `<option value="${escapeHtml(item.user.id)}">${escapeHtml(item.user.displayName)} (@${escapeHtml(item.user.username)})</option>`).join("")}</select></div><div class="field"><label>Storage file</label><select name="path" required>${files.map((item) => `<option value="${escapeHtml(item.path)}">${escapeHtml(item.path)}</option>`).join("")}</select></div><button class="button button-primary button-small" type="submit" ${files.length && connectData.friends.length ? "" : "disabled"}>Send to friend</button></form>${files.length ? "" : '<p class="help">No files found. Upload a file in Storage first.</p>'}`
      : '<p class="subtle">Enable the Storage app to send files from your private files.</p>'}</section>`;
}

function usersPage() {
  if (!can("users:manage")) return noPermission();
  const assignableRoles = usersData.roles.filter((role) =>
    can("*") || (!role.permissions.includes("*") && role.permissions.every((permission) => state.permissions.includes(permission))));
  const roleChoices = assignableRoles.map((role, index) => `<label class="role-choice"><input type="radio" name="roleId" value="${escapeHtml(role.id)}" ${index === 0 ? "checked" : ""}><span><strong>${escapeHtml(role.name)}</strong><small>${role.permissions.includes("*") ? "Full administrative access" : role.permissions.length ? `${role.permissions.length} permissions` : "No permissions"}</small></span></label>`).join("");
  return `<div class="page-heading"><div><h1>Users</h1><p>Create accounts, assign access, and define permission levels.</p></div><button class="button button-tonal" type="button" data-preview-user-view>${icon("overview")} Preview Normal user</button></div>
    <section class="card settings-card"><h3>Create user</h3><form id="create-user-form" class="form-grid">
      <div class="field"><label>Username</label><input name="username" required minlength="3" maxlength="32" pattern="[A-Za-z0-9][A-Za-z0-9._\\-]{2,31}"></div>
      <div class="field"><label>Temporary password</label><input name="password" type="password" required minlength="8" maxlength="128" autocomplete="new-password"></div>
      <fieldset class="field role-choice-field"><legend>Permission level</legend><div class="role-choice-list">${roleChoices || '<p class="subtle">No roles can be assigned with your current permissions.</p>'}</div></fieldset>
      <button class="button button-primary button-small" type="submit" ${assignableRoles.length ? "" : "disabled"}>Create user</button></form></section>
    <section class="card settings-card"><h3>Permission levels</h3><div class="role-list">${usersData.roles.map((role) => `<div class="role-row"><div><strong>${escapeHtml(role.name)}</strong><span>${role.permissions.includes("*") ? "Full access" : role.permissions.map(escapeHtml).join(", ") || "No permissions"}</span></div>${!["normal","elevated"].includes(role.id) ? `<button class="button button-small" data-delete-role="${escapeHtml(role.id)}">Delete</button>` : ""}</div>`).join("")}</div>
      ${can("*") ? `<details class="role-create"><summary>Create custom permission level</summary><form id="create-role-form"><div class="field"><label>Name</label><input name="name" required minlength="2" maxlength="32"></div><fieldset class="permission-grid"><legend>Permissions</legend>${["apps:view","apps:manage","chat:use","connect:use","storage:use","modules:manage","users:manage","domains:view","domains:manage","hosting:manage","announcements:manage"].map((item) => `<label><input type="checkbox" name="permissions" value="${item}"> ${item}</label>`).join("")}</fieldset><button class="button button-small" type="submit">Create permission level</button></form></details>` : ""}</section>
    <section class="card"><h3>Accounts</h3><div class="table-wrap"><table><thead><tr><th>Username</th><th>Access</th><th>Created</th><th>Actions</th></tr></thead><tbody>${usersData.users.map((user) => `<tr><td><strong>${escapeHtml(user.username)}</strong></td><td><span class="access-badge">${escapeHtml(usersData.roles.find((role) => role.id === user.roleId)?.name || "Unknown")}</span></td><td>${escapeHtml(new Date(user.createdAt).toLocaleDateString())}</td><td><div class="button-row">${assignableRoles.length ? `<button class="button button-small" data-edit-user-access="${escapeHtml(user.id)}">Change access</button>` : ""}<button class="button button-small button-danger" data-delete-user="${escapeHtml(user.id)}">Delete</button></div></td></tr>`).join("") || '<tr><td colspan="4">No accounts created yet.</td></tr>'}</tbody></table></div>
      <dialog class="access-dialog" id="user-access-dialog"><form id="user-access-form"><div class="dialog-heading"><div><span class="eyebrow">Account access</span><h2>Change permission level</h2><p id="user-access-description" class="subtle"></p></div><button class="icon-button" type="button" aria-label="Close dialog" data-close-access>${icon("close")}</button></div><div class="role-choice-list">${assignableRoles.map((role) => `<label class="role-choice"><input type="radio" name="roleId" value="${escapeHtml(role.id)}"><span><strong>${escapeHtml(role.name)}</strong><small>${role.permissions.includes("*") ? "Full administrative access" : role.permissions.length ? `${role.permissions.length} permissions` : "No permissions"}</small></span></label>`).join("")}</div><div class="dialog-actions"><button class="button" type="button" data-close-access>Cancel</button><button class="button button-primary" type="submit">Save access</button></div></form></dialog></section>`;
}

function appsAdminPage() {
  if (!can("apps:manage")) return noPermission();
  const chatDomainOptions = `<option value="">Not configured</option>${domainsData.domains.map((domain) => `<option value="${escapeHtml(domain.id)}" ${domain.id === state.chatSettings?.domainId ? "selected" : ""}>${escapeHtml(domainLabel(domain))}</option>`).join("")}`;
  return `<div class="page-heading"><div><h1>Apps</h1><p>Choose which apps are enabled and shown on the public homepage.</p></div></div>
    <form id="apps-form" class="card app-settings">
      <div class="app-settings-heading"><div><h2>App access</h2><p>Give each app a clear audience. Private apps stay in your admin Launch page.</p></div><span class="settings-count">${state.apps.filter((item) => item.enabled).length} enabled</span></div>
      ${state.apps.map((item) => `<div class="app-setting-row" data-app="${escapeHtml(item.id)}"><div class="app-setting-identity"><span class="app-setting-icon">${icon(appIconName(item.id))}</span><div><strong>${escapeHtml(item.name)}</strong><p>${escapeHtml(item.description)}</p></div></div><label class="setting-switch"><span>Enabled</span><input type="checkbox" name="${escapeHtml(item.id)}-enabled" ${item.enabled ? "checked" : ""}><span class="switch-track" aria-hidden="true"></span></label><label class="setting-switch"><span>Public</span><input type="checkbox" name="${escapeHtml(item.id)}-public" ${item.public ? "checked" : ""}><span class="switch-track" aria-hidden="true"></span></label></div>`).join("")}
      <section class="app-route-settings">
        <div><h3>Chat app location</h3><p class="help">Choose where users open Chat. Configure the backend path separately in Modules.</p></div>
        <div class="app-route-fields">
        <div class="field"><label>Domain</label><select name="chat-domain">${chatDomainOptions}</select></div>
        <div class="field"><label>Chat app path</label><input name="chat-path" value="${escapeHtml(state.chatSettings?.path || "/chat")}" required maxlength="160"></div>
        </div>
        ${configuredChatUrl() ? `<p class="help">Current app URL: <a href="${escapeHtml(configuredChatUrl())}">${escapeHtml(configuredChatUrl())}</a></p>` : ""}
      </section>
      <div class="app-settings-footer"><p class="help">Changes apply to the next page load.</p><button class="button button-primary" type="submit">Save app settings</button></div>
    </form>`;
}

function domainsPage() {
  if (!can("domains:manage")) return noPermission();
  const tldOptions = domainsData.tlds.map((tld) => `<option value="${escapeHtml(tld)}">${escapeHtml(tld)}</option>`).join("");
  const domainOptions = domainsData.domains.map((domain) => `<option value="${escapeHtml(domain.id)}">${escapeHtml(domainLabel(domain))}</option>`).join("");
  const createPanel = domainCreationMode === "tld"
    ? `<form id="tld-form"><div class="field"><label>Top-level domain suffix</label><div class="input-affix"><span>.</span><input name="name" placeholder="jnet" required maxlength="63"></div><p class="help">Create a private suffix for your Jnet domains.</p></div><button class="button button-primary" type="submit">Create TLD</button></form>`
    : domainCreationMode === "subdomain"
      ? `<form id="subdomain-form"><div class="field"><label>Subdomain name</label><input name="name" placeholder="chat" required maxlength="63"></div><div class="field"><label>Parent domain</label><select name="parentId" required>${domainOptions}</select></div><button class="button button-primary" type="submit">Create subdomain</button></form>`
      : `<form id="domain-form"><div class="field"><label>Domain name</label><input name="name" placeholder="example" required maxlength="63"></div><div class="field"><label>Top-level domain</label><select name="tld" required>${tldOptions}</select></div><button class="button button-primary" type="submit">Create domain</button></form>`;
  return `<div class="page-heading"><div><h1>Domains</h1><p>Create private Jnet TLDs, domains, and subdomains.</p></div></div>
    <section class="card domain-create-card"><div class="domain-create-heading"><div><h3>Create a domain</h3><p class="subtle">Choose what you want to add.</p></div><div class="segmented-control" role="tablist" aria-label="Domain type">${[["domain","Domain"],["subdomain","Subdomain"],["tld","TLD"]].map(([mode,label]) => `<button type="button" role="tab" aria-selected="${domainCreationMode === mode}" class="${domainCreationMode === mode ? "active" : ""}" data-domain-mode="${mode}">${label}</button>`).join("")}</div></div><div class="domain-create-form">${createPanel}</div></section>
    <section class="card"><h3>Your domains</h3><div class="table-wrap"><table><thead><tr><th>Domain</th><th>Type</th><th>Parent</th><th></th></tr></thead><tbody>${domainsData.domains.map((domain) => `<tr><td>${escapeHtml(domainLabel(domain))}</td><td>${domain.parentId ? "Subdomain" : "Domain"}</td><td>${escapeHtml(domain.parentId ? domainLabel(domainsData.domains.find((item) => item.id === domain.parentId)) : domain.tld)}</td><td><button class="button button-small" data-delete-domain="${escapeHtml(domain.id)}">Delete</button></td></tr>`).join("") || '<tr><td colspan="4">No domains yet.</td></tr>'}</tbody></table></div></section>
    <section class="card"><h3>Custom TLDs</h3><div class="role-list">${domainsData.tlds.map((tld) => `<div class="role-row"><strong>.${escapeHtml(tld)}</strong><button class="button button-small" data-delete-tld="${escapeHtml(tld)}">Delete</button></div>`).join("") || '<p class="subtle">No TLDs configured.</p>'}</div></section>`;
}

function domainLabel(domain) {
  if (!domain) return "";
  const parent = domain.parentId ? domainsData.domains.find((item) => item.id === domain.parentId) : null;
  return `${domain.name}${parent ? `.${domainLabel(parent)}` : `.${domain.tld}`}`;
}

function sitesPage() {
  if (!can("hosting:manage")) return noPermission();
  const domainOptions = sitesData.domains.map((domain) => `<option value="${escapeHtml(domain.id)}">${escapeHtml(domainLabel(domain))}</option>`).join("");
  return `<div class="page-heading"><div><h1>Sites</h1><p>Upload and edit sites hosted on your Jnet domains.</p></div></div>
    <div class="notice">Site JavaScript is never executed by Jnet. Previews run in a sandboxed frame with a restrictive content policy.</div>
    <section class="card settings-card"><h3>Upload a site</h3><form id="site-upload-form">
      <div class="field"><label>Domain</label><select name="domainId" required>${domainOptions}</select></div>
      <div class="field"><label>Site name</label><input name="title" required maxlength="80"></div>
      <div class="field"><label>ZIP archive</label><input name="archive" type="file" accept=".zip,application/zip" required><p class="help">ZIP only, up to 8 MB compressed and 20 MB unpacked. Include index.html at the archive root.</p></div>
      <button class="button button-primary button-small" type="submit">Upload site</button></form></section>
    <section class="card"><h3>Hosted sites</h3>${sitesData.sites.map((site) => `<div class="role-row"><div><strong>${escapeHtml(site.title)}</strong><span>${escapeHtml(domainLabel(sitesData.domains.find((domain) => domain.id === site.domainId)))} · ${site.files.length} files</span></div><div class="button-row"><button class="button button-small" data-edit-site="${escapeHtml(site.id)}">Open editor</button><button class="button button-small" data-delete-site="${escapeHtml(site.id)}">Delete</button></div></div>`).join("") || '<p class="subtle">No uploaded sites yet.</p>'}</section>
    ${sitesData.hosts.length ? `<section class="card"><h3>Legacy text pages</h3>${sitesData.hosts.map((host) => `<div class="role-row"><div><strong>${escapeHtml(host.title)}</strong><span>${escapeHtml(domainLabel(sitesData.domains.find((domain) => domain.id === host.domainId)))}</span></div><button class="button button-small" data-delete-host="${escapeHtml(host.id)}">Delete</button></div>`).join("")}</section>` : ""}`;
}

function siteEditorPage() {
  if (!can("hosting:manage") || !siteEditorData.site) return noPermission();
  const editableFiles = siteEditorData.files.filter((item) => item.editable);
  const previewPath = siteEditorData.selected || "index.html";
  return `<div class="page-heading"><div><h1>${escapeHtml(siteEditorData.site.title)}</h1><p>${escapeHtml(siteEditorData.site.domain)} · editor</p></div><a class="button button-small" href="/site/${encodeURIComponent(siteEditorData.site.id)}/index.html" target="_blank" rel="noopener noreferrer">Open site</a></div>
    <div class="site-editor-layout">
      <section class="card site-editor-files"><h3><span>${icon("folder")} Files</span><small>${editableFiles.length}</small></h3>${editableFiles.map((file) => `<button class="site-file ${file.path === siteEditorData.selected ? "active" : ""}" data-site-file="${escapeHtml(file.path)}"><span class="site-file-icon">${icon(/\.(html?|svg)$/i.test(file.path) ? "code" : "file")}</span><span>${escapeHtml(file.path)}</span></button>`).join("")}
        <form id="site-new-file-form"><div class="field"><label>New text file</label><input name="path" placeholder="assets/styles.css" required maxlength="240"></div><button class="button button-small" type="submit">${icon("plus")} Create file</button></form>
      </section>
      <section class="card site-editor-code"><div class="site-editor-toolbar"><strong><span class="editor-file-icon">${icon("code")}</span>${escapeHtml(siteEditorData.selected || "Select a file")}</strong><button class="button button-primary button-small" id="save-site-file" ${siteEditorData.selected ? "" : "disabled"}>${icon("save")} Save changes</button></div>
        <div class="code-editor-shell"><pre id="site-code-highlight" aria-hidden="true"><code></code></pre><textarea id="site-file-content" class="code-editor" aria-label="Site file contents" spellcheck="false">${escapeHtml(siteEditorData.content)}</textarea></div>
        <p class="help">UTF-8 text editor · maximum 2 MB per file. Script execution is disabled in hosted pages.</p></section>
      <section class="card site-editor-preview"><div class="site-editor-toolbar"><strong><span class="preview-live-dot"></span>Live preview</strong><button class="button button-small" id="reload-site-preview">${icon("refresh")} Refresh</button></div><iframe title="Sandboxed site preview" sandbox src="/site/${encodeURIComponent(siteEditorData.site.id)}/${previewPath.split("/").map(encodeURIComponent).join("/")}?preview=${Date.now()}"></iframe></section>
    </div>`;
}

function announcementsPage() {
  if (!can("announcements:manage")) return noPermission();
  return `<div class="page-heading"><div><h1>Announcements</h1><p>Post a realtime banner on user homepages.</p></div></div>
    <form id="announcement-form" class="card settings-card"><label class="inline-check"><input name="enabled" type="checkbox" ${state.announcement.enabled ? "checked" : ""}> Show announcement</label>
      <div class="field"><label>Message</label><textarea name="text" maxlength="500" rows="3">${escapeHtml(state.announcement.text)}</textarea></div>
      <div class="field"><label>Banner color</label><input name="color" type="color" value="${escapeHtml(state.announcement.color)}"></div>
      <div class="field"><label>Image (PNG, JPEG, WebP)</label><input name="image" type="file" accept="image/png,image/jpeg,image/webp"><p class="help">Image is embedded locally; uploads are limited to 130 KB.</p>${state.announcement.image ? '<button class="button button-small" type="button" data-clear-announcement-image>Remove current image</button>' : ""}</div>
      <button class="button button-primary button-small" type="submit">Save announcement</button></form>`;
}

function settingsPage() {
  return `<div class="page-heading"><div><h1>Settings</h1><p>Configure account access and administrator recovery.</p></div></div>
    <section class="card settings-card"><h3>Jnet server port</h3><p class="subtle">The admin server uses port 8080 by default. Managed services use separate ports (Wisp 8090, Chat 8091, Scramjet 8092). Port changes take effect after restarting Jnet.</p>
      ${state.serverPortFromEnvironment ? '<p class="help">The PORT environment variable overrides this setting. Remove or update it before restarting to use the saved port.</p>' : ""}
      <form id="server-settings-form" class="inline-upload"><div class="field"><label for="server-port">Admin listener port</label><input id="server-port" name="port" type="number" min="1024" max="65535" value="${state.configuredServerPort || state.serverPort}" required></div><button class="button button-primary button-small" type="submit">Save server port</button></form></section>
    <section class="card settings-card"><h3>Scramjet isolation port</h3><p class="subtle">Scramjet Browser runs on a separate origin and serves no Jnet APIs. For remote use, this port must be reachable over HTTPS (or localhost during development). Changes take effect after restarting Jnet.</p>
      <form id="scramjet-settings-form" class="inline-upload"><div class="field"><label for="scramjet-port">Scramjet listener port</label><input id="scramjet-port" name="port" type="number" min="1024" max="65535" value="${state.configuredScramjetPort || state.scramjetPort}" required></div><button class="button button-primary button-small" type="submit">Save Scramjet port</button></form></section>
    <section class="card settings-card"><h3>Self-signup</h3><p class="subtle">When enabled, visitors can create Normal accounts from the homepage.</p>
      <label class="inline-check"><input id="self-signup" type="checkbox" ${state.selfSignup ? "checked" : ""}> Allow public account signup</label></section>
    <section class="card settings-card"><h3>Reset administrator key</h3><p class="subtle">Generate a new one-time setup key on the server and sign out all active sessions. The key is never sent to this browser; find it in <code>JNET_DATA_DIR/key</code> (default <code>~/.jnet/key</code>).</p>
      <button class="button button-danger button-small" id="rotate-key">Reset and write a new key file</button></section>`;
}

function noPermission() {
  return '<section class="card"><h2>Access restricted</h2><p class="subtle">Your permission level does not allow access to this section.</p></section>';
}

function navButton(page, label, iconName, allowed = true) {
  if (!allowed) return "";
  return `<button class="nav-item ${currentPage === page ? "active" : ""}" data-page="${page}" aria-label="${label}" title="${label}" ${currentPage === page ? 'aria-current="page"' : ""}><span class="nav-icon">${icon(iconName)}</span><span class="nav-text">${label}</span></button>`;
}

function render() {
  if (!state?.authenticated) return renderLogin();
  const pages = {
    overview: overviewPage,
    launch: launcherPage,
    modules: modulesPage,
    users: usersPage,
    apps: appsAdminPage,
    domains: domainsPage,
    hosting: sitesPage,
    "site-editor": siteEditorPage,
    announcements: announcementsPage,
    settings: settingsPage,
    "app-browser": appPage,
    "app-wisp-browser": appPage,
    "app-chat": appPage,
    "app-storage": appPage,
    "app-connect": appPage,
  };
  const titles = {
    overview: "Overview", launch: "Launch", modules: "Modules", users: "Users", apps: "Apps",
    domains: "Domains", hosting: "Sites", "site-editor": "Site editor", announcements: "Announcements", settings: "Settings",
    "app-browser": "Browser", "app-wisp-browser": "Scramjet Browser", "app-chat": "Chat",
    "app-storage": "Storage", "app-connect": "Connect",
  };
  if (!pages[currentPage]) currentPage = "overview";
  const standaloneBrowser = currentPage === "app-browser" || currentPage === "app-wisp-browser";
  document.body.classList.toggle("standalone-browser", standaloneBrowser);
  if (standaloneBrowser) {
    const mode = currentPage === "app-wisp-browser" ? "wisp-browser" : "browser";
    document.title = mode === "wisp-browser" ? "Scramjet Browser" : "Browser";
    if (!browserAppView || browserAppMode !== mode || browserAppUserId !== state.user.id) {
      destroyBrowserApp();
      browserAppView = mountBrowserApp(app, {
        mode,
        userId: state.user.id,
        wispStatus: state.module?.status || "disabled",
        onError: (message) => notify(message, true),
      });
      browserAppMode = mode;
      browserAppUserId = state.user.id;
    } else {
      browserAppView.updateWispStatus(state.module?.status || "disabled");
    }
  } else {
    document.title = `Jnet — ${titles[currentPage]}`;
    destroyBrowserApp();
    app.innerHTML = `
    <div class="layout">
      <aside class="sidebar">
        <div class="sidebar-brand"><div class="brand-mark" aria-hidden="true">JN</div><div class="brand-copy"><div class="brand-name">Jnet</div><div class="brand-caption">Jxo Network</div></div></div>
        <nav class="nav-list" aria-label="Main navigation">
          <div class="nav-group"><div class="nav-label">Workspace</div>${navButton("overview", "Overview", "overview")}${navButton("launch", "Apps", "apps", true)}</div>
          ${can("users:manage") || can("apps:manage") || can("modules:manage") ? `<div class="nav-group"><div class="nav-label">Manage</div>${navButton("users", "Users", "users", can("users:manage"))}${navButton("apps", "App settings", "apps", can("apps:manage"))}${navButton("modules", "Modules", "modules", can("modules:manage"))}</div>` : ""}
          ${can("domains:manage") || can("hosting:manage") || can("announcements:manage") || can("*") ? `<div class="nav-group"><div class="nav-label">Network</div>${navButton("domains", "Domains", "domains", can("domains:manage"))}${navButton("hosting", "Sites", "hosting", can("hosting:manage"))}${navButton("announcements", "Announcements", "announcement", can("announcements:manage"))}${navButton("settings", "Settings", "settings", can("*"))}</div>` : ""}
        </nav>
        <div class="sidebar-bottom"><div class="server-mini"><span class="dot online"></span><span>Jnet server online</span></div></div>
      </aside>
      <div class="main">
        <header class="topbar"><div class="breadcrumbs">Jnet <span aria-hidden="true">/</span> <strong>${userPreviewMode ? "Normal user preview" : titles[currentPage]}</strong></div><div class="topbar-right"><button class="quick-search-button" type="button" data-open-quick-switcher aria-label="Quick switcher (${quickSwitcherShortcut()})" title="Quick switcher (${quickSwitcherShortcut()})"><span>Jump to…</span><kbd>${quickSwitcherShortcut()}</kbd></button><span class="local-label">${userPreviewMode ? "Preview mode" : escapeHtml(state.user.username)}</span>${userPreviewMode ? `<button class="button button-tonal preview-exit" type="button" data-exit-user-preview>Exit preview</button>` : ""}<button class="link-button theme-toggle" id="theme-toggle" aria-label="Switch to ${darkMode ? "light" : "dark"} theme" title="Switch theme">${icon("theme")}<span>${darkMode ? "Light" : "Dark"} mode</span></button><button class="link-button" id="logout">${icon("signout")}<span>Sign out</span></button></div></header>
        <div class="content">${userPreviewMode ? `<aside class="user-preview-banner"><span class="preview-symbol">${icon("overview")}</span><div><strong>Previewing the Normal user experience</strong><p>This is a visual preview only. Your administrator permissions and session remain unchanged.</p></div><button class="button button-tonal" type="button" data-exit-user-preview>Return to Users</button></aside>` : ""}${pages[currentPage]()}</div>
      </div>
    </div>${quickSwitcherDialog()}`;
  }
  app.querySelectorAll("[data-page]").forEach((button) => button.addEventListener("click", () => {
    currentPage = button.dataset.page;
    render();
  }));
  app.querySelector("[data-open-quick-switcher]")?.addEventListener("click", () => {
    const dialog = app.querySelector("#quick-switcher");
    dialog?.showModal();
    dialog?.querySelector("#quick-switcher-input")?.focus();
  });
  app.querySelector("#quick-switcher")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) event.currentTarget.close();
  });
  app.querySelector("#quick-switcher")?.addEventListener("cancel", (event) => {
    event.preventDefault();
    event.currentTarget.close();
  });
  app.querySelector("[data-close-quick-switcher]")?.addEventListener("click", () => {
    app.querySelector("#quick-switcher")?.close();
  });
  app.querySelector("#quick-switcher-input")?.addEventListener("input", (event) => {
    const query = event.currentTarget.value.trim().toLowerCase();
    const items = [...app.querySelectorAll(".quick-switcher-item")];
    let visibleCount = 0;
    for (const item of items) {
      const visible = item.dataset.search.includes(query);
      item.hidden = !visible;
      if (visible) visibleCount++;
    }
    const empty = app.querySelector(".quick-switcher-empty");
    if (empty) empty.hidden = visibleCount > 0;
  });
  app.querySelectorAll(".quick-switcher-item").forEach((button) => button.addEventListener("click", () => {
    const { quickKind, quickId } = button.dataset;
    if (quickKind === "page") {
      currentPage = quickId;
      app.querySelector("#quick-switcher")?.close();
      render();
    } else {
      app.querySelector("#quick-switcher")?.close();
      if (quickId === "chat" && configuredChatUrl()) {
        window.open(configuredChatUrl(), "_blank", "noopener,noreferrer");
      } else if (quickId === "wisp-browser") {
        const proxyUrl = new URL("/", window.location.href);
        proxyUrl.port = String(state.scramjetPort);
        proxyUrl.searchParams.set("theme", darkMode ? "dark" : "light");
        window.open(proxyUrl.href, "_blank", "noopener,noreferrer");
      } else {
        window.open(`/app/${encodeURIComponent(quickId)}`, "_blank", "noopener,noreferrer");
      }
    }
  }));
  app.querySelector("#quick-switcher")?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.currentTarget.close();
      return;
    }
    if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
    const visibleItems = [...app.querySelectorAll(".quick-switcher-item:not([hidden])")];
    const currentIndex = visibleItems.indexOf(document.activeElement);
    const nextIndex = event.key === "ArrowDown"
      ? (currentIndex + 1) % visibleItems.length
      : (currentIndex <= 0 ? visibleItems.length - 1 : currentIndex - 1);
    if (visibleItems.length) {
      event.preventDefault();
      visibleItems[nextIndex].focus();
    }
  });
  app.querySelectorAll("[data-launch-app]").forEach((button) => button.addEventListener("click", () => {
    if (button.dataset.launchApp === "chat" && configuredChatUrl()) {
      window.open(configuredChatUrl(), "_blank", "noopener,noreferrer");
      return;
    }
    if (button.dataset.launchApp === "wisp-browser") {
      const proxyUrl = new URL("/", window.location.href);
      proxyUrl.port = String(state.scramjetPort);
      proxyUrl.searchParams.set("theme", darkMode ? "dark" : "light");
      window.open(proxyUrl.href, "_blank", "noopener,noreferrer");
      return;
    }
    window.open(`/app/${encodeURIComponent(button.dataset.launchApp)}`, "_blank", "noopener,noreferrer");
  }));
  app.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => runModuleAction(button)));
  app.querySelector("[data-toggle-module-settings]")?.addEventListener("click", () => {
    moduleSettingsOpen = !moduleSettingsOpen;
    render();
  });
  app.querySelector("#logout")?.addEventListener("click", logout);
  app.querySelector("#theme-toggle")?.addEventListener("click", () => {
    darkMode = !darkMode;
    localStorage.setItem("jnet-theme", darkMode ? "dark" : "light");
    document.documentElement.dataset.theme = darkMode ? "dark" : "light";
    updateThemeMetadata();
    render();
  });
  app.querySelectorAll("[data-preview-user-view]").forEach((button) => button.addEventListener("click", () => {
    userPreviewMode = true;
    currentPage = "overview";
    render();
  }));
  app.querySelectorAll("[data-exit-user-preview]").forEach((button) => button.addEventListener("click", () => {
    userPreviewMode = false;
    currentPage = "users";
    render();
  }));
  app.querySelector("#module-settings-form")?.addEventListener("submit", saveSettings);
  app.querySelector("#server-settings-form")?.addEventListener("submit", saveServerSettings);
  app.querySelector("#scramjet-settings-form")?.addEventListener("submit", saveScramjetSettings);
  app.querySelector("#chat-module-settings-form")?.addEventListener("submit", saveChatModuleSettings);
  app.querySelector("[data-toggle-chat-module-settings]")?.addEventListener("click", () => {
    chatModuleSettingsOpen = !chatModuleSettingsOpen;
    render();
  });
  app.querySelector("#create-user-form")?.addEventListener("submit", createUser);
  app.querySelector("#create-role-form")?.addEventListener("submit", createRole);
  app.querySelector("#apps-form")?.addEventListener("submit", saveApps);
  app.querySelector("#tld-form")?.addEventListener("submit", (event) => createDomainItem(event, "tld"));
  app.querySelector("#domain-form")?.addEventListener("submit", (event) => createDomainItem(event, "domain"));
  app.querySelector("#subdomain-form")?.addEventListener("submit", (event) => createDomainItem(event, "subdomain"));
  app.querySelector("#host-form")?.addEventListener("submit", createHost);
  app.querySelector("#site-upload-form")?.addEventListener("submit", uploadSite);
  app.querySelectorAll("[data-edit-site]").forEach((button) => button.addEventListener("click", () => {
    window.open(`/site-editor/${encodeURIComponent(button.dataset.editSite)}`, "_blank", "noopener,noreferrer");
  }));
  app.querySelectorAll("[data-delete-site]").forEach((button) => button.addEventListener("click", () => deleteSite(button.dataset.deleteSite)));
  app.querySelectorAll("[data-site-file]").forEach((button) => button.addEventListener("click", () => loadSiteFile(button.dataset.siteFile)));
  app.querySelector("#save-site-file")?.addEventListener("click", saveSiteFile);
  app.querySelector("#site-file-content")?.addEventListener("input", updateSiteCodeHighlight);
  app.querySelector("#site-file-content")?.addEventListener("scroll", syncSiteCodeScroll);
  app.querySelector("#site-new-file-form")?.addEventListener("submit", createSiteFile);
  app.querySelector("#reload-site-preview")?.addEventListener("click", () => refreshSitePreview());
  app.querySelector("#announcement-form")?.addEventListener("submit", saveAnnouncement);
  app.querySelector("#new-chat-form")?.addEventListener("submit", createConversation);
  app.querySelector("#send-chat-form")?.addEventListener("submit", sendChatMessage);
  app.querySelector("#storage-up")?.addEventListener("click", () => {
    storageData.folder = storageData.folder.split("/").slice(0, -1).join("/");
    render();
  });
  app.querySelectorAll("[data-storage-open]").forEach((button) => button.addEventListener("click", () => {
    const item = storageData.files.find((entry) => entry.path === button.dataset.storageOpen);
    if (item?.type === "folder") {
      storageData.folder = item.path;
      storageData.selected = "";
      render();
    } else {
      void loadStorageFile(item.path);
    }
  }));
  app.querySelectorAll("[data-storage-delete]").forEach((button) => button.addEventListener("click", () => deleteStorageItem(button.dataset.storageDelete)));
  app.querySelector("#storage-upload-form")?.addEventListener("submit", uploadStorageFile);
  app.querySelector("#storage-folder-form")?.addEventListener("submit", createStorageFolder);
  app.querySelector("#storage-new-file-form")?.addEventListener("submit", createStorageFile);
  app.querySelector("#storage-save")?.addEventListener("click", saveStorageFile);
  app.querySelector("#storage-rename")?.addEventListener("click", renameStorageItem);
  app.querySelector("#connect-friend-form")?.addEventListener("submit", sendFriendRequest);
  app.querySelector("#connect-send-form")?.addEventListener("submit", sendConnectFile);
  app.querySelectorAll("[data-friend-accept]").forEach((button) => button.addEventListener("click", () => updateFriendRequest(button.dataset.friendAccept, true)));
  app.querySelectorAll("[data-friend-decline]").forEach((button) => button.addEventListener("click", () => updateFriendRequest(button.dataset.friendDecline, false)));
  app.querySelectorAll("[data-friend-remove]").forEach((button) => button.addEventListener("click", () => removeFriend(button.dataset.friendRemove)));
  app.querySelectorAll(".member-picker input").forEach((input) => input.addEventListener("change", () => {
    const count = app.querySelectorAll(".member-picker input:checked").length;
    app.querySelector(".group-title-field").hidden = count < 2;
  }));
  app.querySelectorAll("[data-domain-mode]").forEach((button) => button.addEventListener("click", () => {
    domainCreationMode = button.dataset.domainMode;
    render();
  }));
  app.querySelectorAll("[data-chat-select]").forEach((button) => button.addEventListener("click", () => {
    void (async () => {
      chatData.selected = button.dataset.chatSelect;
      await loadChat();
      render();
    })();
  }));
  app.querySelector("#self-signup")?.addEventListener("change", toggleSignup);
  app.querySelector("#rotate-key")?.addEventListener("click", rotateKey);
  app.querySelector("[data-clear-announcement-image]")?.addEventListener("click", () => saveAnnouncement(null, ""));
  app.querySelectorAll("[data-delete-user]").forEach((button) => button.addEventListener("click", () => deleteUser(button.dataset.deleteUser)));
  app.querySelectorAll("[data-edit-user-access]").forEach((button) => button.addEventListener("click", () => {
    const user = usersData.users.find((item) => item.id === button.dataset.editUserAccess);
    const dialog = app.querySelector("#user-access-dialog");
    if (!user || !dialog) return;
    editingUserId = user.id;
    app.querySelector("#user-access-description").textContent = `Choose access for ${user.username}.`;
    dialog.querySelectorAll('input[name="roleId"]').forEach((input) => { input.checked = input.value === user.roleId; });
    dialog.showModal();
  }));
  app.querySelectorAll("[data-close-access]").forEach((button) => button.addEventListener("click", () => {
    app.querySelector("#user-access-dialog")?.close();
    editingUserId = "";
  }));
  app.querySelector("#user-access-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const roleId = new FormData(event.currentTarget).get("roleId");
    if (editingUserId && roleId) void updateUser(editingUserId, roleId);
  });
  app.querySelectorAll("[data-delete-role]").forEach((button) => button.addEventListener("click", () => deleteRole(button.dataset.deleteRole)));
  app.querySelectorAll("[data-delete-domain]").forEach((button) => button.addEventListener("click", () => deleteDomain(button.dataset.deleteDomain)));
  app.querySelectorAll("[data-delete-tld]").forEach((button) => button.addEventListener("click", () => deleteTld(button.dataset.deleteTld)));
  app.querySelectorAll("[data-delete-host]").forEach((button) => button.addEventListener("click", () => deleteHost(button.dataset.deleteHost)));
  if (currentPage === "site-editor") updateSiteCodeHighlight();
}

async function loadChat() {
  const chatBase = state.chatSettings?.backendPath || "/api/chat";
  const [users, conversations] = await Promise.all([
    request(`${chatBase}/users`),
    request(`${chatBase}/conversations`),
  ]);
  chatData.users = users.users;
  chatData.conversations = conversations.conversations;
  if (!chatData.conversations.some((item) => item.id === chatData.selected)) {
    chatData.selected = chatData.conversations[0]?.id || "";
  }
  chatData.messages = chatData.selected
    ? (await request(`${chatBase}/messages?conversation=${encodeURIComponent(chatData.selected)}`)).messages
    : [];
}

async function loadStorage() {
  const result = await request("/api/storage/files");
  storageData.files = result.files;
  if (storageData.selected && !storageData.files.some((item) => item.path === storageData.selected)) {
    storageData.selected = "";
    storageData.content = "";
  }
}

async function loadStorageFile(filename, shouldRender = true) {
  try {
    const result = await request(`/api/storage/file?path=${encodeURIComponent(filename)}`);
    storageData.selected = result.path;
    storageData.content = result.content;
    if (shouldRender) render();
  } catch (error) {
    notify(error.message, true);
  }
}

async function loadConnect() {
  const result = await request("/api/connect/friends");
  connectData.friends = result.friends;
  connectData.requests = result.requests;
  connectData.files = [];
  if (state.apps.some((item) => item.id === "storage" && item.enabled)) {
    try {
      const storage = await request("/api/storage/files");
      connectData.files = storage.files;
    } catch (error) {
      notify(error.message, true);
    }
  }
}

document.addEventListener("keydown", (event) => {
  if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k" || !state?.authenticated) return;
  if (document.body.classList.contains("standalone-browser")) return;
  event.preventDefault();
  const dialog = app.querySelector("#quick-switcher");
  if (!dialog?.open) {
    dialog?.showModal();
    dialog?.querySelector("#quick-switcher-input")?.focus();
  }
});

async function refresh() {
  state = await request("/api/status");
  syncAnnouncementStyle();
  if (!state.authenticated) {
    if (window.location.pathname === "/" && !state.initialized) {
      window.location.replace("/admin");
      return false;
    }
    render();
    return true;
  }
  if (window.location.pathname === "/admin" && !state.permissions.includes("*")) {
    await request("/api/logout", { method: "POST", body: "{}" });
    state = await request("/api/status");
    authError = "This account does not have administrator access. Sign in from the homepage instead.";
    renderLogin();
    return false;
  }
  const routedApp = appRouteId();
  if (routedApp) {
    if (!state.apps.some((item) => item.id === routedApp)) {
      window.location.replace("/");
      return false;
    }
    if (routedApp === "wisp-browser") {
      const proxyUrl = new URL("/", window.location.href);
      proxyUrl.port = String(state.scramjetPort);
      proxyUrl.searchParams.set("theme", darkMode ? "dark" : "light");
      window.location.replace(proxyUrl.href);
      return false;
    }
    currentPage = `app-${routedApp}`;
    if (routedApp === "chat") {
      await loadChat();
    } else if (routedApp === "storage") {
      await loadStorage();
    } else if (routedApp === "connect") {
      await loadConnect();
    }
  }
  const reads = [];
  if (can("users:manage")) reads.push(request("/api/users").then((value) => { usersData = value; }));
  if (can("domains:view") || can("apps:manage")) reads.push(request("/api/domains").then((value) => { domainsData = value; }));
  if (can("hosting:manage")) reads.push(request("/api/sites").then((value) => {
    sitesData = value;
    domainsData = { ...domainsData, domains: value.domains };
    hostingData = { hosts: value.hosts, domains: value.domains };
  }));
  const editorMatch = window.location.pathname.match(/^\/site-editor\/([a-f0-9]{32})$/);
  if (editorMatch) {
    if (!can("hosting:manage")) {
      window.location.replace("/");
      return false;
    }
    const listing = await request(`/api/sites/${editorMatch[1]}/files`);
    siteEditorData.site = listing.site;
    siteEditorData.files = listing.files;
    const requested = new URLSearchParams(window.location.search).get("file");
    const selected = listing.files.find((file) => file.path === requested && file.editable) ||
      listing.files.find((file) => file.path === "index.html");
    await loadSiteFile(selected.path, false);
    currentPage = "site-editor";
  }
  await Promise.all(reads);
  if (
    configuredChatUrl() &&
    window.location.pathname === configuredChatUrl() &&
    state.apps.some((item) => item.id === "chat" && item.enabled)
  ) {
    currentPage = "app-chat";
    await loadChat();
  }
  render();
  return true;
}

async function runModuleAction(button) {
  if (button.dataset.confirm && !window.confirm(button.dataset.confirm)) return;
  const action = button.dataset.action;
  button.disabled = true;
  try {
    const moduleId = button.dataset.module || "wisp";
    const result = await request(`/api/modules/${moduleId}`, { method: "POST", body: JSON.stringify({ action }) });
    state = result;
    render();
    const moduleName = ({
      wisp: "Wisp",
      "chat-backend": "Chat backend",
      "storage-backend": "Storage backend",
      connect: "Connect",
    })[moduleId];
    notify(action === "download" ? `${moduleName} module installed.` : `${moduleName} module ${action} request completed.`);
  } catch (error) {
    notify(error.message, true);
    await refresh();
  }
}

async function saveChatModuleSettings(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  try {
    state = await request("/api/modules/chat-backend", {
      method: "POST",
      body: JSON.stringify({ action: "configure", path: form.get("path"), port: Number(form.get("port")) }),
    });
    render();
    notify("Chat backend settings saved.");
  } catch (error) {
    notify(error.message, true);
    button.disabled = false;
  }
}

async function saveSettings(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  try {
    await request("/api/settings", {
      method: "POST",
      body: JSON.stringify({ path: form.get("path"), port: Number(form.get("port")) }),
    });
    await refresh();
    notify("Module settings saved.");
  } catch (error) {
    notify(error.message, true);
    button.disabled = false;
  }
}

async function saveServerSettings(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  try {
    const result = await request("/api/server-settings", {
      method: "POST",
      body: JSON.stringify({ port: Number(form.get("port")) }),
    });
    await refresh();
    notify(result.settings.restartRequired
      ? result.settings.environmentOverride
        ? "Server port saved, but PORT currently overrides it. Update or remove PORT, then restart Jnet."
        : "Server port saved. Restart Jnet to apply it."
      : "Server port saved.");
  } catch (error) {
    notify(error.message, true);
    button.disabled = false;
  }
}

async function saveScramjetSettings(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  try {
    const result = await request("/api/scramjet-settings", {
      method: "POST",
      body: JSON.stringify({ port: Number(form.get("port")) }),
    });
    await refresh();
    notify(result.settings.restartRequired
      ? "Scramjet port saved. Restart Jnet to apply it."
      : "Scramjet port saved.");
  } catch (error) {
    notify(error.message, true);
    button.disabled = false;
  }
}

async function createUser(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    await request("/api/users", { method: "POST", body: JSON.stringify({
      username: form.get("username"), password: form.get("password"), roleId: form.get("roleId"),
    }) });
    await refresh();
    notify("User created.");
  } catch (error) {
    notify(error.message, true);
  }
}

async function createRole(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    await request("/api/roles", { method: "POST", body: JSON.stringify({
      name: form.get("name"), permissions: form.getAll("permissions"),
    }) });
    await refresh();
    notify("Permission level created.");
  } catch (error) {
    notify(error.message, true);
  }
}

async function deleteUser(id) {
  if (!window.confirm("Delete this user? Their active sessions will be revoked.")) return;
  try {
    await request(`/api/users/${encodeURIComponent(id)}`, { method: "DELETE", body: "{}" });
    await refresh();
    notify("User deleted.");
  } catch (error) {
    notify(error.message, true);
  }
}

async function updateUser(id, roleId) {
  try {
    app.querySelector("#user-access-dialog")?.close();
    editingUserId = "";
    await request(`/api/users/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ roleId }) });
    await refresh();
    notify("User permissions updated.");
  } catch (error) {
    notify(error.message, true);
    await refresh();
  }
}

async function deleteRole(id) {
  if (!window.confirm("Delete this permission level?")) return;
  try {
    await request(`/api/roles/${encodeURIComponent(id)}`, { method: "DELETE", body: "{}" });
    await refresh();
    notify("Permission level deleted.");
  } catch (error) {
    notify(error.message, true);
  }
}

async function saveApps(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const apps = state.apps.map((item) => ({
    id: item.id,
    enabled: form.has(`${item.id}-enabled`),
    public: form.has(`${item.id}-public`),
  }));
  const chatSettings = {
    domainId: form.get("chat-domain") || null,
    path: form.get("chat-path"),
  };
  try {
    await request("/api/apps", { method: "PATCH", body: JSON.stringify({ apps, chatSettings }) });
    await refresh();
    notify("App settings saved.");
  } catch (error) {
    notify(error.message, true);
  }
}

async function createDomainItem(event, type) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const body = { type, name: form.get("name") };
  if (type === "domain") body.tld = form.get("tld");
  if (type === "subdomain") body.parentId = form.get("parentId");
  try {
    await request("/api/domains", { method: "POST", body: JSON.stringify(body) });
    await refresh();
    notify(`${type === "tld" ? "TLD" : type === "domain" ? "Domain" : "Subdomain"} created.`);
  } catch (error) {
    notify(error.message, true);
  }
}

async function deleteDomain(id) {
  if (!window.confirm("Delete this domain and its child domains? Hosted pages attached to it will also be deleted.")) return;
  try {
    await request("/api/domains", { method: "DELETE", body: JSON.stringify({ id }) });
    await refresh();
    notify("Domain deleted.");
  } catch (error) {
    notify(error.message, true);
  }
}

async function deleteTld(tld) {
  if (!window.confirm(`Delete the .${tld} TLD? It must not contain domains.`)) return;
  try {
    await request("/api/domains", { method: "DELETE", body: JSON.stringify({ tld }) });
    await refresh();
    notify("TLD deleted.");
  } catch (error) {
    notify(error.message, true);
  }
}

async function createHost(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    await request("/api/hosting", { method: "POST", body: JSON.stringify({
      domainId: form.get("domainId"), title: form.get("title"), content: form.get("content"),
    }) });
    await refresh();
    notify("Page published.");
  } catch (error) {
    notify(error.message, true);
  }
}

async function uploadSite(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const file = form.get("archive");
  if (!(file instanceof File) || !file.size) {
    notify("Choose a ZIP archive to upload.", true);
    return;
  }
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  const query = new URLSearchParams({
    domainId: String(form.get("domainId")),
    title: String(form.get("title")),
  });
  try {
    await request(`/api/sites/upload?${query}`, {
      method: "POST",
      body: file,
      headers: { "Content-Type": "application/zip" },
    });
    await refresh();
    notify("Site uploaded. Open its editor to make changes.");
  } catch (error) {
    notify(error.message, true);
    button.disabled = false;
  }
}

async function deleteSite(id) {
  if (!window.confirm("Delete this site and all of its uploaded files?")) return;
  try {
    await request(`/api/sites/${encodeURIComponent(id)}`, { method: "DELETE", body: "{}" });
    await refresh();
    notify("Site deleted.");
  } catch (error) {
    notify(error.message, true);
  }
}

async function loadSiteFile(filename, shouldRender = true) {
  if (!siteEditorData.site || !filename) return;
  try {
    const result = await request(`/api/sites/${siteEditorData.site.id}/file?path=${encodeURIComponent(filename)}`);
    siteEditorData.selected = result.path;
    siteEditorData.content = result.content;
    if (shouldRender) render();
    updateSiteCodeHighlight();
  } catch (error) {
    notify(error.message, true);
  }
}

function updateSiteCodeHighlight() {
  const editor = app.querySelector("#site-file-content");
  const output = app.querySelector("#site-code-highlight code");
  if (!editor || !output) return;
  const tokens = /<!--[\s\S]*?-->|\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|<\/?[A-Za-z][^>]*>|\b(?:const|let|var|function|return|if|else|for|while|class|new|import|export|async|await|true|false|null|undefined|color|display|margin|padding|font|background|width|height)\b|\b\d+(?:\.\d+)?\b/g;
  let html = "";
  let previous = 0;
  for (const match of editor.value.matchAll(tokens)) {
    html += escapeHtml(editor.value.slice(previous, match.index));
    const token = match[0];
    const kind = /^(?:<!--|\/\*|\/\/)/.test(token)
      ? "comment"
      : /^(?:"|'|`)/.test(token)
        ? "string"
        : token.startsWith("<")
          ? "tag"
          : /^\d/.test(token)
            ? "number"
            : "keyword";
    html += `<span class="code-token-${kind}">${escapeHtml(token)}</span>`;
    previous = match.index + token.length;
  }
  output.innerHTML = `${html}${escapeHtml(editor.value.slice(previous))}\n`;
  syncSiteCodeScroll();
}

function syncSiteCodeScroll() {
  const editor = app.querySelector("#site-file-content");
  const highlight = app.querySelector("#site-code-highlight");
  if (editor && highlight) {
    highlight.scrollTop = editor.scrollTop;
    highlight.scrollLeft = editor.scrollLeft;
  }
}

async function saveSiteFile() {
  const editor = app.querySelector("#site-file-content");
  if (!siteEditorData.site || !editor || !siteEditorData.selected) return;
  try {
    await request(`/api/sites/${siteEditorData.site.id}/file?path=${encodeURIComponent(siteEditorData.selected)}`, {
      method: "PUT",
      body: JSON.stringify({ content: editor.value }),
    });
    siteEditorData.content = editor.value;
    refreshSitePreview();
    notify("Site file saved.");
  } catch (error) {
    notify(error.message, true);
  }
}

async function createSiteFile(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const filename = String(form.get("path") || "").trim();
  if (!siteEditorData.site) return;
  try {
    await request(`/api/sites/${siteEditorData.site.id}/file?path=${encodeURIComponent(filename)}`, {
      method: "PUT",
      body: JSON.stringify({ content: "" }),
    });
    const listing = await request(`/api/sites/${siteEditorData.site.id}/files`);
    siteEditorData.files = listing.files;
    await loadSiteFile(filename);
    notify("Site file created.");
  } catch (error) {
    notify(error.message, true);
  }
}

function storagePath(name) {
  return [storageData.folder, name].filter(Boolean).join("/");
}

async function uploadStorageFile(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) {
    notify("Choose a non-empty file to upload.", true);
    return;
  }
  try {
    const target = storagePath(file.name);
    await request(`/api/storage/upload?path=${encodeURIComponent(target)}`, {
      method: "POST",
      body: file,
      headers: { "Content-Type": "application/octet-stream" },
    });
    await loadStorage();
    notify("File uploaded.");
    render();
  } catch (error) {
    notify(error.message, true);
  }
}

async function createStorageFolder(event) {
  event.preventDefault();
  const name = String(new FormData(event.currentTarget).get("name") || "").trim();
  try {
    await request("/api/storage/folder", {
      method: "POST",
      body: JSON.stringify({ path: storagePath(name) }),
    });
    await loadStorage();
    render();
    notify("Folder created.");
  } catch (error) {
    notify(error.message, true);
  }
}

async function createStorageFile(event) {
  event.preventDefault();
  const name = String(new FormData(event.currentTarget).get("name") || "").trim();
  const filename = storagePath(name);
  try {
    await request(`/api/storage/file?path=${encodeURIComponent(filename)}`, {
      method: "PUT",
      body: JSON.stringify({ content: "" }),
    });
    await loadStorage();
    await loadStorageFile(filename);
    notify("File created.");
  } catch (error) {
    notify(error.message, true);
  }
}

async function saveStorageFile() {
  const editor = app.querySelector("#storage-content");
  if (!editor || !storageData.selected) return;
  try {
    await request(`/api/storage/file?path=${encodeURIComponent(storageData.selected)}`, {
      method: "PUT",
      body: JSON.stringify({ content: editor.value }),
    });
    storageData.content = editor.value;
    await loadStorage();
    render();
    notify("File saved.");
  } catch (error) {
    notify(error.message, true);
  }
}

async function deleteStorageItem(filename) {
  if (!window.confirm(`Delete "${filename}" and its contents?`)) return;
  try {
    await request(`/api/storage/item?path=${encodeURIComponent(filename)}`, { method: "DELETE", body: "{}" });
    if (storageData.selected === filename) {
      storageData.selected = "";
      storageData.content = "";
    }
    await loadStorage();
    render();
    notify("Storage item deleted.");
  } catch (error) {
    notify(error.message, true);
  }
}

async function renameStorageItem() {
  if (!storageData.selected) return;
  const oldName = storageData.selected.split("/").at(-1);
  const newName = window.prompt("Enter the new name, including any extension:", oldName);
  if (!newName || newName === oldName) return;
  const parent = storageData.selected.split("/").slice(0, -1).join("/");
  const destination = [parent, newName.trim()].filter(Boolean).join("/");
  try {
    await request("/api/storage/rename", {
      method: "POST",
      body: JSON.stringify({ from: storageData.selected, to: destination }),
    });
    storageData.selected = destination;
    await loadStorage();
    await loadStorageFile(destination);
    notify("Storage item renamed.");
  } catch (error) {
    notify(error.message, true);
  }
}

async function sendFriendRequest(event) {
  event.preventDefault();
  const username = new FormData(event.currentTarget).get("username");
  try {
    await request("/api/connect/friends", { method: "POST", body: JSON.stringify({ username }) });
    await loadConnect();
    render();
    notify("Friend request sent.");
  } catch (error) {
    notify(error.message, true);
  }
}

async function updateFriendRequest(id, accept) {
  try {
    await request(`/api/connect/friends/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ accept }),
    });
    await loadConnect();
    render();
    notify(accept ? "Friend request accepted." : "Friend request declined.");
  } catch (error) {
    notify(error.message, true);
  }
}

async function removeFriend(id) {
  if (!window.confirm("Remove this friend connection?")) return;
  try {
    await request(`/api/connect/friends/${encodeURIComponent(id)}`, { method: "DELETE", body: "{}" });
    await loadConnect();
    render();
    notify("Friend connection removed.");
  } catch (error) {
    notify(error.message, true);
  }
}

async function sendConnectFile(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    await request("/api/connect/send", {
      method: "POST",
      body: JSON.stringify({ toUserId: form.get("toUserId"), path: form.get("path") }),
    });
    notify("File sent to your friend’s Connect folder.");
  } catch (error) {
    notify(error.message, true);
  }
}

function refreshSitePreview() {
  const frame = app.querySelector(".site-editor-preview iframe");
  if (frame && siteEditorData.site) {
    const url = new URL(frame.src);
    url.searchParams.set("preview", String(Date.now()));
    frame.src = url.toString();
  }
}

async function createConversation(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    const chatBase = state.chatSettings?.backendPath || "/api/chat";
    const result = await request(`${chatBase}/conversations`, {
      method: "POST",
      body: JSON.stringify({ members: form.getAll("members"), title: form.get("title") }),
    });
    chatData.selected = result.conversation.id;
    await loadChat();
    render();
  } catch (error) {
    notify(error.message, true);
  }
}

async function sendChatMessage(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    const chatBase = state.chatSettings?.backendPath || "/api/chat";
    let text = String(form.get("text") || "");
    const connectCommand = text.match(/^\/connect send\s+(.+)$/);
    if (connectCommand) {
      const conversation = chatData.conversations.find((item) => item.id === chatData.selected);
      if (!conversation || conversation.type !== "direct") {
        throw new Error("Use /connect send in a direct message with an accepted friend.");
      }
      const recipientId = conversation.members.find((member) => member !== state.user.id);
      const transfer = await request("/api/connect/send", {
        method: "POST",
        body: JSON.stringify({ toUserId: recipientId, path: connectCommand[1].trim() }),
      });
      text = `Sent ${transfer.path.split("/").at(-1)} to your friend via Connect.`;
    }
    await request(`${chatBase}/messages`, {
      method: "POST",
      body: JSON.stringify({ conversationId: chatData.selected, text }),
    });
    await loadChat();
    render();
  } catch (error) {
    notify(error.message, true);
  }
}

async function deleteHost(id) {
  try {
    await request("/api/hosting", { method: "DELETE", body: JSON.stringify({ id }) });
    await refresh();
    notify("Hosted page removed.");
  } catch (error) {
    notify(error.message, true);
  }
}

async function saveAnnouncement(event, imageOverride) {
  event?.preventDefault();
  const form = event ? new FormData(event.currentTarget) : null;
  let image = imageOverride;
  if (image === undefined) {
    const file = form.get("image");
    image = file?.size ? await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Could not read the selected image."));
      reader.readAsDataURL(file);
    }) : state.announcement.image;
  }
  if (image && image.length > 180_000) {
    notify("Choose an image smaller than 130 KB.", true);
    return;
  }
  try {
    await request("/api/announcement", { method: "PUT", body: JSON.stringify({
      enabled: form ? form.has("enabled") : state.announcement.enabled,
      text: form ? form.get("text") : state.announcement.text,
      color: form ? form.get("color") : state.announcement.color,
      image,
    }) });
    await refresh();
    notify("Announcement updated.");
  } catch (error) {
    notify(error.message, true);
  }
}

async function toggleSignup(event) {
  try {
    await request("/api/platform", { method: "PATCH", body: JSON.stringify({ selfSignup: event.currentTarget.checked }) });
    await refresh();
    notify("Signup setting updated.");
  } catch (error) {
    notify(error.message, true);
    event.currentTarget.checked = !event.currentTarget.checked;
  }
}

async function rotateKey() {
  if (!window.confirm("Reset the administrator key? A new setup key will be written to the server filesystem and all active sessions will be signed out.")) return;
  try {
    await request("/api/key", { method: "POST", body: "{}" });
    state = await request("/api/status");
    currentPage = "overview";
    render();
    notify("New setup key written to the server filesystem.");
  } catch (error) {
    notify(error.message, true);
  }
}

async function logout() {
  moduleStatusStream?.close();
  moduleStatusStream = null;
  try {
    await request("/api/logout", { method: "POST", body: "{}" });
  } finally {
    state = await request("/api/status");
    render();
  }
}

function connectModuleStatusEvents() {
  moduleStatusStream?.close();
  moduleStatusStream = null;
  if (!state?.authenticated || !can("modules:manage")) return;
  const stream = new EventSource("/api/modules/events");
  moduleStatusStream = stream;
  stream.addEventListener("module-status", (event) => {
    const updatedModules = JSON.parse(event.data);
    const changed = Object.entries(updatedModules).some(([key, value]) =>
      Object.entries(value).some(([property, item]) => state[key]?.[property] !== item));
    state = {
      ...state,
      ...Object.fromEntries(Object.entries(updatedModules).map(([key, value]) => [
        key,
        { ...state[key], ...value },
      ])),
    };
    if (changed && currentPage === "app-wisp-browser") {
      browserAppView?.updateWispStatus(state.module?.status || "disabled");
    } else if (changed && ["overview", "modules"].includes(currentPage)) {
      render();
    }
  });
  stream.addEventListener("auth-required", () => {
    stream.close();
    if (moduleStatusStream === stream) moduleStatusStream = null;
  });
}

async function boot() {
  try {
    await refresh();
    connectModuleStatusEvents();
    setInterval(async () => {
      try {
        const updatedState = await request("/api/status");
        if (state.authenticated && updatedState.authenticated) {
          const roleChanged = state.role?.id !== updatedState.role?.id ||
            state.permissions.join(",") !== updatedState.permissions.join(",");
          const wispStatusChanged = state.module?.status !== updatedState.module?.status;
          state = { ...state, ...updatedState };
          syncAnnouncementStyle();
          if (wispStatusChanged && currentPage === "app-wisp-browser") {
            browserAppView?.updateWispStatus(state.module?.status || "disabled");
          }
          if (currentPage === "site-editor" && !can("hosting:manage")) {
            window.location.replace("/");
            return;
          }
          if (roleChanged && !["users","apps","domains","hosting","site-editor","announcements","settings"].includes(currentPage)) {
            const activeApp = currentPage.startsWith("app-") ? currentPage.slice(4) : "";
            if (activeApp && !state.apps.some((item) => item.id === activeApp && item.enabled)) currentPage = "launch";
            render();
          }
          const currentBanner = app.querySelector("#announcement-banner");
          if (currentBanner) currentBanner.outerHTML = announcementBanner();
          else if (updatedState.announcement?.enabled && !["users","apps","domains","hosting","site-editor","announcements","settings","app-browser","app-wisp-browser"].includes(currentPage)) render();
          if (currentPage === "app-chat" && !app.querySelector("#send-chat-form textarea")?.matches(":focus")) {
            await loadChat();
            render();
          }
        } else if (!state.authenticated && !updatedState.authenticated) {
          state = { ...state, ...updatedState };
          syncAnnouncementStyle();
          const currentBanner = app.querySelector("#announcement-banner");
          if (currentBanner) currentBanner.outerHTML = announcementBanner();
          else if (updatedState.announcement?.enabled) renderLogin();
        } else if (state.authenticated && !updatedState.authenticated) {
          state = updatedState;
          currentPage = "overview";
          render();
        }
      } catch {
        if (state?.authenticated) notify("Connection to Jnet was lost.", true);
      }
    }, 5000);
  } catch (error) {
    app.innerHTML = `<section class="loading-panel"><h2>Jnet is unavailable</h2><p class="subtle">${escapeHtml(error.message)}</p></section>`;
  }
}

boot();
