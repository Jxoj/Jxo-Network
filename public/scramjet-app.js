import { mountBrowserApp } from "./browser.js";

const root = document.querySelector("#app");

function showError(message) {
  root.replaceChildren();
  const section = document.createElement("section");
  section.className = "browser-start";
  const title = document.createElement("h1");
  title.textContent = "Scramjet Browser unavailable";
  const text = document.createElement("p");
  text.textContent = message;
  section.append(title, text);
  root.append(section);
}

async function getServiceWorker() {
  await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  if (navigator.serviceWorker.controller) return navigator.serviceWorker.controller;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      reject(new Error("The browser service worker did not activate. Reload this page and try again."));
    }, 10000);
    function onControllerChange() {
      if (!navigator.serviceWorker.controller) return;
      clearTimeout(timer);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      resolve(navigator.serviceWorker.controller);
    }
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    onControllerChange();
  });
}

async function start() {
  if (!window.isSecureContext || !("serviceWorker" in navigator)) {
    throw new Error("Scramjet requires HTTPS, or localhost, so its isolated service worker can run.");
  }
  const sessionResponse = await fetch("/session", { credentials: "same-origin", cache: "no-store" });
  if (!sessionResponse.ok) {
    throw new Error("Sign in to Jnet and launch Scramjet Browser again.");
  }
  const { userId, wispStatus } = await sessionResponse.json();
  const serviceworker = await getServiceWorker();
  const transport = new LibcurlTransport.LibcurlClient({
    wisp: `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/wisp/`,
  });
  const controller = new $scramjetController.Controller({ serviceworker, transport });
  await controller.wait();
  mountBrowserApp(root, {
    mode: "wisp-browser",
    userId,
    wispStatus,
    scramjetController: controller,
    onError: (message) => {
      const status = root.querySelector("#browser-status");
      if (status) status.textContent = message;
    },
  });
}

start().catch((error) => showError(error.message));
