let currentMode = "signin";
let setupRequested = false;

export function mountAuth({ root, state, icon, isAdminPortal, error, onSubmit, onModeChange }) {
  const setupMode = !state?.initialized || (state?.setupAvailable && setupRequested);
  const canSignUp = Boolean(state?.selfSignup && !isAdminPortal);
  const mode = setupMode ? "setup" : canSignUp ? currentMode : "signin";
  const appIcons = { browser: "browser", "wisp-browser": "scramjet", chat: "chat", storage: "storage", connect: "connect" };
  const publicApps = canSignUp && state.apps?.length
    ? `<div class="public-apps"><strong>Available apps</strong><div>${state.apps.map((app) => `<span>${icon(appIcons[app.id] || "apps")} ${escapeHtml(app.name)}</span>`).join("")}</div></div>`
    : "";
  const heading = mode === "setup" ? "Create your administrator account" : mode === "signup" ? "Create your account" : isAdminPortal ? "Admin sign in" : "Welcome back";
  const description = mode === "setup"
    ? "Secure your Jnet workspace with a personal administrator account."
    : mode === "signup"
      ? "Create an account to access the apps shared by your administrator."
      : isAdminPortal
        ? "Sign in with your Elevated account to manage Jnet."
        : "Sign in to continue to your Jnet workspace.";
  const fields = mode === "setup"
    ? `<div class="field"><label for="setup-key">One-time setup key</label><input id="setup-key" name="key" type="password" autocomplete="one-time-code" minlength="20" maxlength="256" required></div>${accountFields("setup", "new-password")}`
    : accountFields(mode === "signup" ? "signup" : "login", mode === "signup" ? "new-password" : "current-password");
  const submitLabel = mode === "setup" ? "Create administrator account" : mode === "signup" ? "Create account" : "Sign in";
  const switchLabel = mode === "signup" ? "Already have an account? Sign in" : "New to Jnet? Create an account";

  root.innerHTML = `
    <div class="login-wrap">
      <div class="auth-shell">
        <aside class="auth-showcase">
          <div class="auth-showcase-top"><div class="auth-brand"><div class="brand-mark" aria-hidden="true">JN</div><span>Jnet</span></div><span class="auth-instance"><span></span> YOUR PRIVATE NETWORK</span></div>
          <div class="auth-showcase-copy"><p class="eyebrow">A PLACE FOR YOUR DIGITAL LIFE</p><h2>Everything connected.<br><span>Nothing in the way.</span></h2><p>Bring your apps, services, and people together in a workspace you control.</p></div>
          <div class="auth-network-art" aria-hidden="true">
            <svg class="auth-network-lines" viewBox="0 0 520 340" fill="none"><path d="M259 168 115 83m144 85 145-86m-145 86 13 113M115 83l-42 173m333-259 42 173m-302-87 158-67m-189 167 201 46m132-232L271 281"/></svg>
            <div class="network-node node-core"><span class="node-core-mark">JN</span><strong>your space</strong></div>
            <div class="network-node node-apps"><span>${icon("apps")}</span><strong>Apps</strong></div>
            <div class="network-node node-services"><span>${icon("modules")}</span><strong>Services</strong></div>
            <div class="network-node node-people"><span>${icon("users")}</span><strong>People</strong></div>
            <div class="network-node node-sites"><span>${icon("browser")}</span><strong>Your sites</strong></div>
            <div class="network-glow"></div>
          </div>
          <div class="auth-showcase-foot"><span>YOUR NETWORK. YOUR RULES.</span><span>JNET / 01</span></div>
        </aside>
        <section class="auth-form-panel">
          <section class="login-card">
            <div class="auth-form-heading"><p class="eyebrow">${mode === "setup" ? "SECURE SETUP" : isAdminPortal ? "ADMIN CONSOLE" : "WELCOME TO JNET"}</p><h1>${heading}</h1><p class="subtle">${description}</p></div>
            ${state?.announcement?.enabled ? `<section class="announcement-banner">${state.announcement.image ? `<img src="${state.announcement.image}" alt="">` : ""}<p>${escapeHtml(state.announcement.text)}</p></section>` : ""}
            ${publicApps}
            <form id="auth-form">
              ${fields}
              <button class="button button-primary button-full auth-submit" type="submit">${submitLabel}<span aria-hidden="true">→</span></button>
            </form>
            ${mode === "setup" ? '<p class="setup-key-note">Enter the one-time key from the server filesystem: <code>JNET_DATA_DIR/key</code> (default <code>~/.jnet/key</code>).</p>' : ""}
            ${canSignUp && !setupMode ? `<button class="auth-switch" id="auth-switch" type="button">${switchLabel}</button>` : ""}
            ${state?.setupAvailable && state?.initialized && !setupMode ? '<button class="auth-recovery" id="auth-recovery" type="button">Create a replacement administrator account</button>' : ""}
            ${setupMode && state?.initialized ? '<button class="auth-switch" id="auth-return" type="button">Back to sign in</button>' : ""}
            <p class="auth-security"><span class="security-check" aria-hidden="true">✓</span>${mode === "setup" ? "Your setup key is used once and never becomes your password." : "Your session is protected with secure, same-origin sign-in."}</p>
            <p id="login-error" class="error-text" role="alert">${escapeHtml(error || "")}</p>
          </section>
          <footer class="auth-mobile-brand"><span class="brand-mark" aria-hidden="true">JN</span><strong>Jnet</strong><span>YOUR PRIVATE NETWORK</span></footer>
        </section>
      </div>
    </div>`;

  root.querySelector("#auth-form").addEventListener("submit", (event) => onSubmit(event, mode));
  root.querySelector("#auth-switch")?.addEventListener("click", () => {
    currentMode = mode === "signup" ? "signin" : "signup";
    onModeChange();
  });
  root.querySelector("#auth-recovery")?.addEventListener("click", () => {
    setupRequested = true;
    onModeChange();
  });
  root.querySelector("#auth-return")?.addEventListener("click", () => {
    setupRequested = false;
    currentMode = "signin";
    onModeChange();
  });
}

function accountFields(prefix, autocomplete) {
  return `<div class="field"><label for="${prefix}-username">Username</label><input id="${prefix}-username" name="username" autocomplete="username" required minlength="3" maxlength="32" pattern="[A-Za-z0-9][A-Za-z0-9._\\-]{2,31}"></div>
    <div class="field"><label for="${prefix}-password">Password</label><input id="${prefix}-password" name="password" type="password" autocomplete="${autocomplete}" required minlength="8" maxlength="128"><p class="help">Use at least 8 characters.</p></div>`;
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
