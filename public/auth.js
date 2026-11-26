let currentMode = "signin";
let setupRequested = false;

export function mountAuth({ root, state, icon, isAdminPortal, error, onSubmit, onModeChange }) {
  const setupMode = !state?.initialized || (state?.setupAvailable && setupRequested);
  const canSignUp = Boolean(state?.selfSignup && !isAdminPortal);
  const mode = setupMode ? "setup" : canSignUp ? currentMode : "signin";
  const appIcons = { browser: "domains", chat: "users" };
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
      <section class="login-card">
        <div class="auth-brand"><div class="brand-mark" aria-hidden="true">JN</div><span>Jnet</span></div>
        <p class="eyebrow">${mode === "setup" ? "Secure setup" : "Jxo Network"}</p>
        <h1>${heading}</h1>
        <p class="subtle">${description}</p>
        ${state?.announcement?.enabled ? `<section class="announcement-banner">${state.announcement.image ? `<img src="${state.announcement.image}" alt="">` : ""}<p>${escapeHtml(state.announcement.text)}</p></section>` : ""}
        ${publicApps}
        <form id="auth-form">
          ${fields}
          <button class="button button-primary button-full auth-submit" type="submit">${submitLabel}</button>
        </form>
        ${mode === "setup" ? '<p class="setup-key-note">Enter the one-time key from the server filesystem: <code>JNET_DATA_DIR/key</code> (default <code>~/.jnet/key</code>).</p>' : ""}
        ${canSignUp && !setupMode ? `<button class="auth-switch" id="auth-switch" type="button">${switchLabel}</button>` : ""}
        ${state?.setupAvailable && state?.initialized && !setupMode ? '<button class="auth-recovery" id="auth-recovery" type="button">Create a replacement administrator account</button>' : ""}
        ${setupMode && state?.initialized ? '<button class="auth-switch" id="auth-return" type="button">Back to sign in</button>' : ""}
        <p class="auth-security">${mode === "setup" ? "Your setup key is used once and never becomes your password." : "Your session is protected with secure, same-origin sign-in."}</p>
        <p id="login-error" class="error-text" role="alert">${escapeHtml(error || "")}</p>
      </section>
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
