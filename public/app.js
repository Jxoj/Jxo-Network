const app = document.querySelector("#app");
const toast = document.querySelector("#toast");
let state = null;
let currentPage = "overview";
let toastTimer;

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

function renderLogin(error = "") {
  app.innerHTML = `
    <div class="login-wrap">
      <section class="login-card">
        <div class="brand-mark" aria-hidden="true">JN</div>
        <p class="eyebrow">Jxo Network</p>
        <h1>Welcome to JNet</h1>
        <p class="subtle">${state?.initialized ? "Sign in with your admin key to manage this server." : "Use the one-time setup key to create your admin credential."}</p>
        <form id="login-form">
          <div class="field">
            <label for="admin-key">Admin key</label>
            <input id="admin-key" name="key" type="password" autocomplete="current-password" required minlength="20" autofocus>
          </div>
          <p id="login-error" class="error-text" role="alert">${escapeHtml(error)}</p>
          <button class="button button-primary button-full" type="submit">Sign in</button>
        </form>
        ${state?.initialized ? "" : '<p class="login-footer"><button id="open-key" class="link-button" type="button">Open the one-time key page</button></p>'}
      </section>
    </div>`;
  document.querySelector("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const key = new FormData(event.currentTarget).get("key");
    const button = event.currentTarget.querySelector("button");
    button.disabled = true;
    try {
      await request("/api/login", { method: "POST", body: JSON.stringify({ key }) });
      await refresh();
      notify("Signed in successfully.");
    } catch (err) {
      document.querySelector("#login-error").textContent = err.message;
      button.disabled = false;
    }
  });
  document.querySelector("#open-key")?.addEventListener("click", () => window.open("/key", "_blank", "noopener"));
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
    actions = '<button class="button button-primary button-small" data-action="enable">Enable module</button>';
  } else if (!module.installed) {
    actions = '<button class="button button-primary button-small" data-action="download" data-confirm="Download the pinned Wisp server package from npm?">Download Wisp</button><button class="button button-small" data-action="disable">Disable</button>';
  } else if (running) {
    actions = '<button class="button button-small" data-action="stop">Stop</button><button class="button button-small" data-action="restart">Restart</button><button class="button button-small" data-action="disable">Disable</button>';
  } else {
    actions = '<button class="button button-primary button-small" data-action="start">Start</button><button class="button button-small" data-action="restart">Restart</button><button class="button button-small" data-action="disable">Disable</button>';
  }
  return `
    <section class="card module-card">
      <div class="module-header">
        <div class="module-title">
          <div class="module-icon" aria-hidden="true">W</div>
          <div><h3>Wisp Server</h3><p>Local WebSocket proxy module</p></div>
        </div>
        ${statusBadge(module.status)}
      </div>
      <div class="module-details">
        <div><div class="detail-label">Module path</div><div class="detail-value" title="${escapeHtml(state.settings.path)}">${escapeHtml(state.settings.path)}</div></div>
        <div><div class="detail-label">Listener</div><div class="detail-value">127.0.0.1:${state.settings.port}</div></div>
        <div><div class="detail-label">Package</div><div class="detail-value">${module.installed ? "Installed · 0.5.3" : "Not installed"}</div></div>
      </div>
      <div class="module-actions">${actions}</div>
      ${module.error ? `<p class="module-status-note">${escapeHtml(module.error)}</p>` : ""}
      ${module.output ? `<pre class="log-box">${escapeHtml(module.output)}</pre>` : ""}
      ${busy ? '<p class="module-status-note">The module operation is in progress. This page refreshes automatically.</p>' : ""}
    </section>`;
}

function overviewPage() {
  return `
    <div class="page-heading"><div><h1>Overview</h1><p>Your local network services, at a glance.</p></div></div>
    <div class="grid grid-overview">
      <section class="card"><div class="metric-label">JNet admin</div><div class="metric-value">Online</div><div class="metric-foot">Listening on port ${state.serverPort}</div></section>
      <section class="card"><div class="metric-label">Wisp module</div><div class="metric-value">${state.module.status === "running" ? "Running" : state.module.status === "failed" ? "Attention" : state.module.status === "disabled" ? "Disabled" : "Stopped"}</div><div class="metric-foot">${state.module.installed ? "Module package is installed" : "Ready to download"}</div></section>
      <section class="card"><div class="metric-label">Admin access</div><div class="metric-value">Protected</div><div class="metric-foot">One-time key is not stored in plain text</div></section>
    </div>
    <p class="section-label">Managed modules</p>
    ${moduleCard()}
    <p class="footer-note">JNet runs locally. Wisp binds to loopback by default and is managed as a separate process.</p>`;
}

function modulesPage() {
  return `
    <div class="page-heading"><div><h1>Modules</h1><p>Download and manage the network services running on this server.</p></div></div>
    ${moduleCard()}
    <div class="notice notice-spaced"><strong>About Wisp.</strong> The Wisp server is a network proxy, not an offline content cache. It listens on the local machine by default. Downloading the module requires an internet connection; installed modules can be started offline.</div>`;
}

function settingsPage() {
  return `
    <div class="page-heading"><div><h1>Settings</h1><p>Configure this JNet instance and its admin access.</p></div></div>
    <div class="settings-grid">
      <section class="card settings-card">
        <h3>Wisp server</h3>
        <p class="subtle">The module listens on loopback so it is not exposed to the network by default.</p>
        <form id="settings-form">
          <div class="field"><label for="module-path">Module path</label><input id="module-path" name="path" value="${escapeHtml(state.settings.path)}" autocomplete="off"><p class="help">Relative to JNet's private data directory. Keep the module stopped to change its path.</p></div>
          <div class="field"><label for="module-port">Listener port</label><input id="module-port" name="port" type="number" min="1024" max="65535" value="${state.settings.port}"><p class="help">The Wisp process binds to 127.0.0.1 on this port.</p></div>
          <button class="button button-primary button-small" type="submit">Save module settings</button>
        </form>
      </section>
      <section class="card settings-card">
        <h3>Admin key</h3>
        <p class="subtle">Replace your current key with a new one. The new key is shown once; copy it to a password manager.</p>
        <form id="key-form">
          <div class="field"><label for="new-key">New key <span class="subtle">(optional)</span></label><input id="new-key" name="key" type="password" minlength="32" maxlength="256" autocomplete="new-password" placeholder="Leave blank to generate securely"><p class="help">Custom keys must be at least 32 characters. Leave blank for a random key.</p></div>
          <button class="button button-danger button-small" type="submit">Rotate admin key</button>
        </form>
        <div class="notice notice-spaced"><strong>Stored securely.</strong> JNet stores only a salted key hash after setup. Rotating the key signs out all active sessions.</div>
      </section>
    </div>`;
}

function render() {
  if (!state?.authenticated) return renderLogin();
  const pages = { overview: overviewPage, modules: modulesPage, settings: settingsPage };
  const titles = { overview: "Overview", modules: "Modules", settings: "Settings" };
  app.innerHTML = `
    <div class="layout">
      <aside class="sidebar">
        <div class="sidebar-brand"><div class="brand-mark" aria-hidden="true">JN</div><div class="brand-copy"><div class="brand-name">JNet</div><div class="brand-caption">Jxo Network</div></div></div>
        <div class="nav-label">Workspace</div>
        <nav class="nav-list" aria-label="Main navigation">
          <button class="nav-item ${currentPage === "overview" ? "active" : ""}" data-page="overview"><span class="nav-icon" aria-hidden="true">▦</span><span class="nav-text">Overview</span></button>
          <button class="nav-item ${currentPage === "modules" ? "active" : ""}" data-page="modules"><span class="nav-icon" aria-hidden="true">◇</span><span class="nav-text">Modules</span></button>
          <button class="nav-item ${currentPage === "settings" ? "active" : ""}" data-page="settings"><span class="nav-icon" aria-hidden="true">⚙</span><span class="nav-text">Settings</span></button>
        </nav>
        <div class="sidebar-bottom"><div class="server-mini"><span class="dot online"></span>JNet server online</div></div>
      </aside>
      <div class="main">
        <header class="topbar"><div class="breadcrumbs">JNet <span aria-hidden="true">/</span> <strong>${titles[currentPage]}</strong></div><div class="topbar-right"><span class="local-label">Local server · :${state.serverPort}</span><span class="avatar" title="Administrator">AD</span><button class="link-button" id="logout">Sign out</button></div></header>
        <div class="content">${pages[currentPage]()}</div>
      </div>
    </div>`;
  app.querySelectorAll("[data-page]").forEach((button) => button.addEventListener("click", () => {
    currentPage = button.dataset.page;
    render();
  }));
  app.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => runModuleAction(button)));
  document.querySelector("#logout").addEventListener("click", logout);
  document.querySelector("#settings-form")?.addEventListener("submit", saveSettings);
  document.querySelector("#key-form")?.addEventListener("submit", rotateKey);
}

async function refresh() {
  state = await request("/api/status");
  render();
}

async function runModuleAction(button) {
  if (button.dataset.confirm && !window.confirm(button.dataset.confirm)) return;
  const action = button.dataset.action;
  button.disabled = true;
  try {
    const result = await request("/api/modules/wisp", { method: "POST", body: JSON.stringify({ action }) });
    state = result;
    render();
    notify(action === "download" ? "Wisp package downloaded." : `Wisp module ${action} request completed.`);
  } catch (error) {
    notify(error.message, true);
    await refresh();
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

async function rotateKey(event) {
  event.preventDefault();
  if (!window.confirm("Rotate the admin key? All active sessions will be signed out.")) return;
  const form = new FormData(event.currentTarget);
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  try {
    const result = await request("/api/key", { method: "POST", body: JSON.stringify({ key: form.get("key") }) });
    state = { authenticated: false, initialized: true };
    renderLogin();
    const keyField = document.querySelector("#admin-key");
    keyField.value = result.key;
    keyField.type = "text";
    document.querySelector("#login-error").textContent = "Your new key is shown here once. Copy and save it, then sign in again.";
    notify("Admin key rotated. Copy it before signing in.");
  } catch (error) {
    notify(error.message, true);
    button.disabled = false;
  }
}

async function logout() {
  try {
    await request("/api/logout", { method: "POST", body: "{}" });
  } finally {
    state = { authenticated: false, initialized: true };
    render();
  }
}

async function boot() {
  try {
    await refresh();
    if (state.authenticated) {
      setInterval(async () => {
        try {
          const updatedState = await request("/api/status");
          if (updatedState.authenticated) {
            state = updatedState;
            if (currentPage !== "settings") render();
          }
        } catch {
          notify("Connection to JNet was lost.", true);
        }
      }, 5000);
    }
  } catch (error) {
    app.innerHTML = `<section class="loading-panel"><h2>JNet is unavailable</h2><p class="subtle">${escapeHtml(error.message)}</p></section>`;
  }
}

boot();
