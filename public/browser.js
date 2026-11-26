const MAX_TABS = 12;
const MAX_BOOKMARKS = 100;
const MAX_HISTORY = 40;
const MAX_URL_LENGTH = 2048;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function isPrivateHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".lan") ||
    host.endsWith(".home") ||
    host.endsWith(".home.arpa") ||
    host.endsWith(".intranet") ||
    host.endsWith(".corp") ||
    host.endsWith(".internal") ||
    host.endsWith(".test") ||
    host === "jnet" ||
    host.endsWith(".jnet") ||
    !host.includes(".")
  ) return true;

  const ipv4 = host.split(".");
  if (ipv4.length === 4 && ipv4.every((part) => /^\d+$/.test(part))) {
    const [first, second, third] = ipv4.map(Number);
    return first === 0 || first === 10 || first === 127 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && (second === 168 || (second === 0 && (third === 0 || third === 2)) || (second === 88 && third === 99))) ||
      (first === 198 && (second === 18 || second === 19 || (second === 51 && third === 100))) ||
      (first === 203 && second === 0 && third === 113) || first >= 224;
  }
  return host.includes(":");
}

export function normalizeBrowserUrl(value, appOrigin) {
  const input = String(value || "").trim();
  if (!input || input.length > MAX_URL_LENGTH || /[\u0000-\u0020\\]/.test(input)) {
    throw new Error("Enter a valid public web address.");
  }
  const candidate = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("Enter a valid public web address.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    url.origin === appOrigin ||
    isPrivateHost(url.hostname)
  ) throw new Error("Only public HTTP or HTTPS websites can be opened.");
  return url.href;
}

function createTab() {
  return { id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`, history: [], index: -1 };
}

function loadBrowserData(key, appOrigin) {
  try {
    const data = JSON.parse(localStorage.getItem(key) || "{}");
    const tabs = Array.isArray(data.tabs) ? data.tabs.slice(0, MAX_TABS).flatMap((tab) => {
      if (!tab || typeof tab.id !== "string" || !Array.isArray(tab.history)) return [];
      const history = tab.history.slice(-MAX_HISTORY).flatMap((item) => {
        try {
          return [normalizeBrowserUrl(item, appOrigin)];
        } catch {
          return [];
        }
      });
      const requestedIndex = Number.isInteger(tab.index) ? tab.index : -1;
      const index = Math.max(-1, Math.min(history.length - 1, requestedIndex));
      return [{ id: tab.id.slice(0, 80), history, index }];
    }) : [];
    const bookmarks = Array.isArray(data.bookmarks) ? data.bookmarks.slice(0, MAX_BOOKMARKS).flatMap((item) => {
      if (!item || typeof item.title !== "string") return [];
      try {
        return [{ title: item.title.slice(0, 100), url: normalizeBrowserUrl(item.url, appOrigin) }];
      } catch {
        return [];
      }
    }) : [];
    const activeTab = tabs.find((tab) => tab.id === data.activeTabId);
    return { tabs: tabs.length ? tabs : [createTab()], activeTabId: activeTab?.id || tabs[0]?.id || "", bookmarks };
  } catch {
    return { tabs: [createTab()], activeTabId: "", bookmarks: [] };
  }
}

export function mountBrowserApp(root, {
  mode,
  userId,
  wispStatus = "disabled",
  onError = () => {},
  scramjetController = null,
}) {
  const appOrigin = window.location.origin;
  const key = `jnet-browser:${encodeURIComponent(userId)}:${mode}`;
  const data = loadBrowserData(key, appOrigin);
  let statusMessage = "";
  let showBookmarks = true;
  const frames = new Map();
  const controllerFrames = new Map();
  const isWisp = mode === "wisp-browser";
  let destroyed = false;
  if (!data.activeTabId) data.activeTabId = data.tabs[0].id;

  function activeTab() {
    return data.tabs.find((tab) => tab.id === data.activeTabId) || data.tabs[0];
  }

  function currentUrl(tab = activeTab()) {
    return tab?.history[tab.index] || "";
  }

  function save() {
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch {
      onError("Browser changes could not be saved in this browser.");
    }
  }

  root.innerHTML = `<section class="standalone-browser ${isWisp ? "wisp-browser" : "web-browser"}">
    <header class="browser-app-header">
      <div class="browser-brand"><span class="browser-brand-mark">${isWisp ? "SJ" : "B"}</span><span>${isWisp ? "Scramjet Browser" : "Browser"}</span></div>
      <div class="browser-tabs" id="browser-tabs" role="tablist" aria-label="Browser tabs"></div>
      <button class="browser-control" type="button" data-browser-action="new-tab" aria-label="New tab" title="New tab">+</button>
    </header>
    <form class="browser-toolbar" id="browser-nav-form">
      <button class="browser-control" type="button" data-browser-action="back" aria-label="Back" title="Back">‹</button>
      <button class="browser-control" type="button" data-browser-action="forward" aria-label="Forward" title="Forward">›</button>
      <button class="browser-control" type="button" data-browser-action="reload" aria-label="Reload" title="Reload">↻</button>
      <label class="sr-only" for="browser-address-input">Website address</label>
      <input id="browser-address-input" name="url" type="text" inputmode="url" autocomplete="url" spellcheck="false" placeholder="https://example.com" required>
      <button class="browser-control browser-bookmark-toggle" type="button" data-browser-action="bookmark" aria-label="Bookmark page" title="Bookmark page">★</button>
      <button class="button button-primary browser-go" type="submit">Go</button>
      <button class="browser-control" type="button" data-browser-action="open-external" title="Open in a new browser tab" aria-label="Open in a new browser tab">↗</button>
    </form>
    <nav class="browser-bookmarks" id="browser-bookmarks" aria-label="Bookmarks"></nav>
    <main class="browser-stage" id="browser-stage">
      <section class="browser-start" id="browser-start"><div class="browser-start-mark">${isWisp ? "SJ" : "B"}</div><h1>${isWisp ? "Scramjet Browser" : "Browser"}</h1><p>Enter a public website address or choose a bookmark.</p>${isWisp ? `<p class="wisp-status" data-wisp-status><span class="status-pip ${wispStatus === "running" ? "online" : ""}"></span>Wisp module ${escapeHtml(wispStatus)}</p>` : ""}</section>
    </main>
    <footer class="browser-footer"><span id="browser-status" ${isWisp ? 'data-wisp-status' : ""}></span><button type="button" data-browser-action="toggle-bookmarks">Hide bookmarks</button></footer>
  </section>`;

  function render() {
    const current = activeTab();
    const url = currentUrl(current);
    const tabsNode = root.querySelector("#browser-tabs");
    const bookmarksNode = root.querySelector("#browser-bookmarks");
    const stage = root.querySelector("#browser-stage");
    const start = root.querySelector("#browser-start");
    const address = root.querySelector("#browser-address-input");
    const back = root.querySelector('[data-browser-action="back"]');
    const forward = root.querySelector('[data-browser-action="forward"]');
    const bookmarkButton = root.querySelector('[data-browser-action="bookmark"]');
    const externalButton = root.querySelector('[data-browser-action="open-external"]');

    tabsNode.innerHTML = data.tabs.map((tab) => {
      const tabUrl = currentUrl(tab);
      const title = tabUrl ? new URL(tabUrl).hostname : "New tab";
      return `<div class="browser-tab ${tab.id === current.id ? "active" : ""}"><button type="button" role="tab" aria-selected="${tab.id === current.id}" data-browser-tab="${escapeHtml(tab.id)}">${escapeHtml(title)}</button><button type="button" aria-label="Close ${escapeHtml(title)} tab" data-close-browser-tab="${escapeHtml(tab.id)}">×</button></div>`;
    }).join("");
    bookmarksNode.innerHTML = data.bookmarks.length
      ? data.bookmarks.map((item, index) => `<span class="browser-bookmark"><button type="button" data-open-bookmark="${index}" title="${escapeHtml(item.url)}">${escapeHtml(item.title)}</button><button type="button" data-remove-bookmark="${index}" aria-label="Remove ${escapeHtml(item.title)} bookmark">×</button></span>`).join("")
      : '<span class="browser-bookmarks-empty">Bookmarks you add will appear here.</span>';
    bookmarksNode.classList.toggle("collapsed", !showBookmarks);
    address.value = url;
    back.disabled = current.index <= 0;
    forward.disabled = current.index >= current.history.length - 1;
    externalButton.disabled = !url;
    bookmarkButton.classList.toggle("saved", Boolean(url && data.bookmarks.some((item) => item.url === url)));
    root.querySelector(".browser-footer > button").textContent = showBookmarks ? "Hide bookmarks" : "Show bookmarks";
    root.querySelector("#browser-status").textContent = statusMessage ||
      (isWisp
        ? scramjetController
          ? `Wisp module: ${wispStatus}. Page traffic is routed through Scramjet and Wisp.`
          : `Wisp module: ${wispStatus}. Page traffic is direct; Scramjet is not connected.`
        : "JavaScript is enabled in isolated frames.");

    for (const [tabId, frame] of frames) {
      if (!data.tabs.some((tab) => tab.id === tabId)) {
        frame.remove();
        frames.delete(tabId);
        controllerFrames.delete(tabId);
      }
    }
    for (const tab of data.tabs) {
      const tabUrl = currentUrl(tab);
      if (!tabUrl) continue;
      let frame = frames.get(tab.id);
      if (!frame) {
        if (tab.id !== current.id) continue;
        frame = document.createElement("iframe");
        frame.className = "browser-page-frame";
        frame.title = new URL(tabUrl).hostname;
        if (!scramjetController) frame.setAttribute("sandbox", "allow-scripts allow-forms");
        frame.setAttribute("referrerpolicy", "no-referrer");
        frame.addEventListener("load", () => {
          const status = root.querySelector("#browser-status");
          if (!destroyed && status && data.activeTabId === tab.id && currentUrl(tab) === frame.dataset.url) {
            statusMessage = scramjetController
              ? "Page loaded through the Scramjet proxy."
              : "Page loaded in an isolated frame; some websites disallow embedding.";
            status.textContent = statusMessage;
          }
        });
        frames.set(tab.id, frame);
        if (scramjetController) controllerFrames.set(tab.id, scramjetController.createFrame(frame));
        stage.append(frame);
      }
      if (frame.dataset.url !== tabUrl) {
        frame.dataset.url = tabUrl;
        frame.title = new URL(tabUrl).hostname;
        const controllerFrame = controllerFrames.get(tab.id);
        if (controllerFrame) controllerFrame.go(tabUrl);
        else frame.src = tabUrl;
      }
      frame.hidden = tab.id !== current.id || !tabUrl;
    }
    start.hidden = Boolean(url);
  }

  root.onclick = (event) => {
    const target = event.target.closest?.("button");
    if (!target) return;
    if (target.dataset.browserTab) {
      data.activeTabId = target.dataset.browserTab;
      statusMessage = "";
      save();
      render();
    } else if (target.dataset.closeBrowserTab) {
      closeTab(target.dataset.closeBrowserTab);
    } else if (target.dataset.browserAction) {
      action(target.dataset.browserAction);
    } else if (target.dataset.openBookmark !== undefined) {
      const bookmark = data.bookmarks[Number(target.dataset.openBookmark)];
      if (bookmark) navigateTo(bookmark.url);
    } else if (target.dataset.removeBookmark !== undefined) {
      data.bookmarks.splice(Number(target.dataset.removeBookmark), 1);
      save();
      render();
    }
  };
  root.onsubmit = navigate;

  function navigate(event) {
    event.preventDefault();
    try {
      navigateTo(normalizeBrowserUrl(new FormData(event.target).get("url"), appOrigin));
    } catch (error) {
      onError(error.message);
    }
  }

  function navigateTo(url) {
    const tab = activeTab();
    tab.history = tab.history.slice(0, tab.index + 1);
    tab.history.push(normalizeBrowserUrl(url, appOrigin));
    if (tab.history.length > MAX_HISTORY) tab.history.shift();
    tab.index = tab.history.length - 1;
    statusMessage = "";
    save();
    render();
  }

  function closeTab(id) {
    if (data.tabs.length === 1) {
      data.tabs[0] = createTab();
      data.activeTabId = data.tabs[0].id;
    } else {
      const index = data.tabs.findIndex((tab) => tab.id === id);
      data.tabs = data.tabs.filter((tab) => tab.id !== id);
      if (data.activeTabId === id) data.activeTabId = data.tabs[Math.max(0, index - 1)].id;
    }
    save();
    render();
  }

  function action(name) {
    const tab = activeTab();
    const url = currentUrl(tab);
    if (name === "new-tab") {
      if (data.tabs.length >= MAX_TABS) return onError(`A maximum of ${MAX_TABS} tabs is allowed.`);
      const next = createTab();
      data.tabs.push(next);
      data.activeTabId = next.id;
    } else if (name === "back" && tab.index > 0) {
      tab.index -= 1;
      statusMessage = "";
    } else if (name === "forward" && tab.index < tab.history.length - 1) {
      tab.index += 1;
      statusMessage = "";
    } else if (name === "reload" && url) {
      statusMessage = "Reloading...";
      const frame = frames.get(tab.id);
      if (frame) {
        const controllerFrame = controllerFrames.get(tab.id);
        if (controllerFrame) controllerFrame.reload();
        else frame.src = url;
      }
      save();
      render();
      return;
    } else if (name === "bookmark" && url) {
      const existing = data.bookmarks.findIndex((item) => item.url === url);
      if (existing >= 0) data.bookmarks.splice(existing, 1);
      else if (data.bookmarks.length < MAX_BOOKMARKS) data.bookmarks.push({ title: new URL(url).hostname, url });
      else return onError(`A maximum of ${MAX_BOOKMARKS} bookmarks is allowed.`);
    } else if (name === "open-external" && url) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    } else if (name === "toggle-bookmarks") {
      showBookmarks = !showBookmarks;
    }
    save();
    render();
  }

  function updateWispStatus(status) {
    wispStatus = status;
    root.querySelectorAll("[data-wisp-status]").forEach((element) => {
      if (element.classList.contains("wisp-status")) {
        element.querySelector(".status-pip")?.classList.toggle("online", status === "running");
        element.lastChild.textContent = `Wisp module ${status}`;
      } else {
        element.textContent = scramjetController
          ? `Wisp module: ${status}. Page traffic is routed through Scramjet and Wisp.`
          : `Wisp module: ${status}. Page traffic is direct; Scramjet is not connected.`;
      }
    });
  }

  function destroy() {
    destroyed = true;
    root.onclick = null;
    root.onsubmit = null;
    for (const frame of frames.values()) frame.remove();
    frames.clear();
    controllerFrames.clear();
  }

  render();
  return { updateWispStatus, destroy };
}
