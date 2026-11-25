import { spawn } from "node:child_process";
import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { access, chmod, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scrypt = promisify(scryptCallback);
const root = path.dirname(fileURLToPath(import.meta.url));
const assets = new Map([
  ["/admin", ["index.html", "text/html; charset=utf-8"]],
  ["/assets/app.css", ["app.css", "text/css; charset=utf-8"]],
  ["/assets/app.js", ["app.js", "text/javascript; charset=utf-8"]],
]);
const WISP_PACKAGE = "@mercuryworkshop/wisp-js@0.5.3";
const MAX_BODY_BYTES = 8 * 1024;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function json(res, status, value, headers = {}) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(body);
}

function safeEqual(a, b) {
  const left = createHash("sha256").update(String(a)).digest();
  const right = createHash("sha256").update(String(b)).digest();
  return timingSafeEqual(left, right);
}

function isLoopback(req) {
  const address = req.socket.remoteAddress || "";
  return address === "::1" || address === "127.0.0.1" || address.startsWith("::ffff:127.");
}

function validateModulePath(value) {
  if (
    typeof value !== "string" ||
    value.length > 160 ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.split("/").some((part) => !part || part === "." || part === "..") ||
    !/^[a-zA-Z0-9._/-]+$/.test(value)
  ) {
    throw Object.assign(new Error("Choose a relative path using letters, numbers, dots, dashes, and slashes."), { status: 400 });
  }
  return value;
}

function validatePort(value) {
  if (!Number.isInteger(value) || value < 1024 || value > 65535) {
    throw Object.assign(new Error("Port must be a whole number between 1024 and 65535."), { status: 400 });
  }
  return value;
}

async function hashKey(key, salt = randomBytes(16).toString("hex")) {
  const hash = await scrypt(key, salt, 64);
  return { salt, hash: Buffer.from(hash).toString("hex") };
}

export async function createJNetServer({
  dataDir = process.env.JNET_DATA_DIR || path.join(homedir(), ".jnet"),
  host = process.env.JNET_HOST || "127.0.0.1",
  port = Number(process.env.PORT || 5060),
  secureCookies = process.env.JNET_SECURE_COOKIES === "1",
} = {}) {
  let dataRoot = path.resolve(dataDir);
  await mkdir(dataRoot, { recursive: true, mode: 0o700 });
  dataRoot = await realpath(dataRoot);
  if (dataRoot === path.parse(dataRoot).root || dataRoot === path.resolve(homedir())) {
    throw new Error("JNet data must use a dedicated directory, not a filesystem root or home directory.");
  }
  await chmod(dataRoot, 0o700);
  const keyFile = path.join(dataRoot, "key");
  const configFile = path.join(dataRoot, "config.json");
  const modulesRoot = path.join(dataRoot, "modules");
  await mkdir(modulesRoot, { recursive: true, mode: 0o700 });
  await chmod(modulesRoot, 0o700);
  try {
    await access(configFile, constants.F_OK);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeConfig({
      admin: null,
      wisp: { enabled: true, path: "wisp", port: 5001 },
    });
  }

  async function readConfig() {
    const config = JSON.parse(await readFile(configFile, "utf8"));
    if (
      !config ||
      typeof config !== "object" ||
      !("admin" in config) ||
      !config.wisp ||
      typeof config.wisp.enabled !== "boolean"
    ) {
      throw new Error("The JNet configuration is invalid.");
    }
    config.wisp.path = validateModulePath(config.wisp.path);
    config.wisp.port = validatePort(config.wisp.port);
    if (
      config.admin !== null &&
      (typeof config.admin?.salt !== "string" || typeof config.admin?.hash !== "string")
    ) {
      throw new Error("The JNet admin credential configuration is invalid.");
    }
    return config;
  }

  async function writeConfig(config) {
    const temporary = `${configFile}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(temporary, configFile);
    await chmod(configFile, 0o600);
  }

  let config = await readConfig();
  if (config.admin === null) {
    try {
      await access(keyFile, constants.F_OK);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await writeFile(keyFile, `${randomBytes(32).toString("base64url")}\n`, {
        mode: 0o600,
        flag: "wx",
      });
    }
  } else {
    await rm(keyFile, { force: true });
  }

  const sessions = new Map();
  const loginAttempts = new Map();
  const moduleState = {
    child: null,
    operation: null,
    status: "stopped",
    error: "",
    output: "",
    stopping: false,
  };

  function moduleDirectory() {
    return path.resolve(modulesRoot, config.wisp.path);
  }

  function cookieOptions(req, maxAge) {
    return [
      `Path=/`,
      `HttpOnly`,
      `SameSite=Strict`,
      `Max-Age=${maxAge}`,
      ...(req.socket.encrypted || secureCookies ? ["Secure"] : []),
    ].join("; ");
  }

  function sessionFor(req) {
    const cookie = req.headers.cookie || "";
    const match = cookie.match(/(?:^|;\s*)jnet_session=([a-f0-9]{64})(?:;|$)/);
    if (!match) return null;
    const session = sessions.get(match[1]);
    if (!session || session.expiresAt <= Date.now()) {
      sessions.delete(match[1]);
      return null;
    }
    session.expiresAt = Date.now() + SESSION_TTL_MS;
    return { token: match[1], ...session };
  }

  function checkOrigin(req) {
    const origin = req.headers.origin;
    if (!origin || !req.headers.host) return false;
    try {
      return new URL(origin).host === req.headers.host;
    } catch {
      return false;
    }
  }

  async function readBody(req) {
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
      } else {
        chunks.push(chunk);
      }
    }
    if (tooLarge) throw Object.assign(new Error("Request body is too large."), { status: 413 });
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
      return body;
    } catch {
      throw Object.assign(new Error("Send a valid JSON object."), { status: 400 });
    }
  }

  async function isInstalled() {
    try {
      await access(path.join(moduleDirectory(), "node_modules", "@mercuryworkshop", "wisp-js", "src", "bin", "server_cli.mjs"));
      return true;
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw error;
    }
  }

  async function getStatus(session) {
    if (!session) return { authenticated: false, initialized: config.admin !== null, serverPort: port };
    return {
      authenticated: true,
      csrfToken: session.csrfToken,
      serverPort: port,
      settings: { ...config.wisp },
      module: {
        status: config.wisp.enabled ? moduleState.status : "disabled",
        installed: await isInstalled(),
        error: moduleState.error,
        output: moduleState.output,
        operation: moduleState.operation,
      },
    };
  }

  function appendOutput(chunk) {
    moduleState.output = `${moduleState.output}${chunk}`.slice(-1600);
  }

  async function stopModule() {
    const child = moduleState.child;
    if (!child) {
      moduleState.status = "stopped";
      return;
    }
    moduleState.stopping = true;
    moduleState.status = "stopping";
    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
      }, 4000);
      const fallbackTimer = setTimeout(finish, 6000);
      const finishOnce = () => {
        clearTimeout(fallbackTimer);
        finish();
      };
      child.once("exit", finishOnce);
      child.kill("SIGTERM");
    });
    if (moduleState.child === child) moduleState.child = null;
    moduleState.stopping = false;
    moduleState.status = "stopped";
  }

  async function startModule() {
    if (!config.wisp.enabled) throw new Error("Enable the Wisp module before starting it.");
    if (moduleState.child) throw new Error("The Wisp module is already running.");
    const installed = await isInstalled();
    if (!installed) throw new Error("Download the Wisp module before starting it.");
    moduleState.error = "";
    moduleState.output = "";
    const entry = path.join(moduleDirectory(), "node_modules", "@mercuryworkshop", "wisp-js", "src", "bin", "server_cli.mjs");
    const child = spawn(
      process.execPath,
      [entry, "--host", "127.0.0.1", "--port", String(config.wisp.port), "--logging", "INFO"],
      { cwd: moduleDirectory(), stdio: ["ignore", "pipe", "pipe"], shell: false },
    );
    moduleState.child = child;
    moduleState.status = "starting";
    child.stdout.on("data", appendOutput);
    child.stderr.on("data", appendOutput);
    child.once("spawn", () => {
      if (moduleState.child === child) moduleState.status = "running";
    });
    child.once("error", (error) => {
      moduleState.error = `Could not start Wisp: ${error.message}`;
      moduleState.status = "failed";
      if (moduleState.child === child) moduleState.child = null;
    });
    child.once("exit", (code, signal) => {
      if (moduleState.child !== child) return;
      moduleState.child = null;
      if (moduleState.stopping) return;
      moduleState.status = code === 0 ? "stopped" : "failed";
      if (code !== 0) {
        moduleState.error = `Wisp exited ${signal ? `after ${signal}` : `with code ${code}`}.`;
      }
    });
  }

  async function installModule() {
    if (moduleState.child) throw new Error("Stop the Wisp module before installing it.");
    const directory = moduleDirectory();
    await mkdir(directory, { recursive: true, mode: 0o700 });
    moduleState.status = "installing";
    moduleState.error = "";
    moduleState.output = "";
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    try {
      await new Promise((resolve, reject) => {
        const installer = spawn(
          npm,
          ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--save-exact", WISP_PACKAGE],
          {
            cwd: directory,
            shell: false,
            windowsHide: true,
            env: { ...process.env, npm_config_ignore_scripts: "true", npm_config_audit: "false" },
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        let timedOut = false;
        let settled = false;
        let forceKillTimer;
        const finish = (callback, value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          clearTimeout(forceKillTimer);
          callback(value);
        };
        const timeout = setTimeout(() => {
          timedOut = true;
          installer.kill("SIGTERM");
          forceKillTimer = setTimeout(() => installer.kill("SIGKILL"), 2000);
        }, 5 * 60 * 1000);
        installer.stdout.on("data", appendOutput);
        installer.stderr.on("data", appendOutput);
        installer.once("error", (error) => {
          finish(reject, new Error(`Could not run npm: ${error.message}`));
        });
        installer.once("exit", (code) => {
          if (timedOut) {
            finish(reject, new Error("Wisp download timed out after 5 minutes."));
          } else if (code === 0) {
            finish(resolve);
          } else {
            finish(reject, new Error(`Wisp download failed${moduleState.output ? `: ${moduleState.output.trim().slice(-600)}` : "."}`));
          }
        });
      });
      moduleState.status = "stopped";
    } catch (error) {
      moduleState.status = "failed";
      moduleState.error = error.message;
      throw error;
    }
  }

  async function handleApi(req, res, url) {
    const session = sessionFor(req);
    if (url.pathname === "/api/status" && req.method === "GET") {
      return json(res, 200, await getStatus(session));
    }
    if (url.pathname === "/api/login" && req.method === "POST") {
      if (!checkOrigin(req)) return json(res, 403, { error: "Request origin was not accepted." });
      const ip = req.socket.remoteAddress || "unknown";
      const attempts = loginAttempts.get(ip);
      if (attempts && attempts.until > Date.now() && attempts.count >= 5) {
        return json(res, 429, { error: "Too many sign-in attempts. Try again in 15 minutes." });
      }
      const body = await readBody(req);
      if (typeof body.key !== "string" || body.key.length < 20 || body.key.length > 256) {
        return json(res, 401, { error: "The admin key is not valid." });
      }
      let valid = false;
      if (config.admin === null) {
        try {
          const firstKey = (await readFile(keyFile, "utf8")).trim();
          valid = safeEqual(body.key, firstKey);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
          valid = false;
        }
      } else {
        const candidate = Buffer.from(await scrypt(body.key, config.admin.salt, 64));
        const expected = Buffer.from(config.admin.hash, "hex");
        valid = candidate.length === expected.length && timingSafeEqual(candidate, expected);
      }
      if (!valid) {
        const next = attempts && attempts.until > Date.now()
          ? { count: attempts.count + 1, until: attempts.until }
          : { count: 1, until: Date.now() + 15 * 60 * 1000 };
        loginAttempts.set(ip, next);
        return json(res, 401, { error: "The admin key is not valid." });
      }
      loginAttempts.delete(ip);
      if (config.admin === null) {
        const nextConfig = { ...config, admin: await hashKey(body.key) };
        await writeConfig(nextConfig);
        config = nextConfig;
        await rm(keyFile, { force: true });
      }
      const token = randomBytes(32).toString("hex");
      const csrfToken = randomBytes(32).toString("hex");
      sessions.set(token, { csrfToken, expiresAt: Date.now() + SESSION_TTL_MS });
      return json(res, 200, { ok: true }, { "Set-Cookie": `jnet_session=${token}; ${cookieOptions(req, SESSION_TTL_MS / 1000)}` });
    }
    if (!session) return json(res, 401, { error: "Sign in to continue." });
    if (req.method !== "GET") {
      if (!checkOrigin(req) || req.headers["x-jnet-csrf"] !== session.csrfToken) {
        return json(res, 403, { error: "Request verification failed. Refresh and try again." });
      }
    }
    if (url.pathname === "/api/logout" && req.method === "POST") {
      sessions.delete(session.token);
      return json(res, 200, { ok: true }, { "Set-Cookie": `jnet_session=; ${cookieOptions(req, 0)}` });
    }
    if (url.pathname === "/api/key" && req.method === "POST") {
      const body = await readBody(req);
      const key = typeof body.key === "string" && body.key.length >= 32 && body.key.length <= 256
        ? body.key
        : randomBytes(32).toString("base64url");
      const nextConfig = { ...config, admin: await hashKey(key) };
      await writeConfig(nextConfig);
      config = nextConfig;
      sessions.clear();
      return json(res, 200, { key }, { "Set-Cookie": `jnet_session=; ${cookieOptions(req, 0)}` });
    }
    if (url.pathname === "/api/settings" && req.method === "POST") {
      if (moduleState.child || moduleState.operation) {
        return json(res, 409, { error: "Stop the Wisp module before changing its path or port." });
      }
      const body = await readBody(req);
      const nextConfig = { ...config, wisp: { ...config.wisp } };
      if (body.path !== undefined) nextConfig.wisp.path = validateModulePath(body.path);
      if (body.port !== undefined) nextConfig.wisp.port = validatePort(body.port);
      await writeConfig(nextConfig);
      config = nextConfig;
      return json(res, 200, { settings: { ...config.wisp } });
    }
    if (url.pathname === "/api/modules/wisp" && req.method === "POST") {
      const body = await readBody(req);
      const actions = ["download", "start", "stop", "restart", "enable", "disable"];
      if (!actions.includes(body.action)) return json(res, 400, { error: "Unknown Wisp module action." });
      if (moduleState.operation) return json(res, 409, { error: "A module operation is already in progress." });
      moduleState.operation = body.action;
      try {
        if (body.action === "download") {
          await installModule();
        } else if (body.action === "start") {
          await startModule();
        } else if (body.action === "stop") {
          await stopModule();
        } else if (body.action === "restart") {
          await stopModule();
          await startModule();
        } else if (body.action === "enable") {
          const nextConfig = { ...config, wisp: { ...config.wisp, enabled: true } };
          await writeConfig(nextConfig);
          config = nextConfig;
        } else if (body.action === "disable") {
          await stopModule();
          const nextConfig = { ...config, wisp: { ...config.wisp, enabled: false } };
          await writeConfig(nextConfig);
          config = nextConfig;
        }
      } catch (error) {
        return json(res, 400, { error: error.message });
      } finally {
        moduleState.operation = null;
      }
      return json(res, 200, await getStatus(session));
    }
    return json(res, 404, { error: "Not found." });
  }

  const server = createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      if (url.pathname === "/") {
        res.writeHead(302, { Location: "/admin", "Cache-Control": "no-store" });
        return res.end();
      }
      if (url.pathname === "/key" && req.method === "GET") {
        if (!isLoopback(req)) return json(res, 403, { error: "The bootstrap key is available only from this machine." });
        if (config.admin !== null) return json(res, 410, { error: "The bootstrap key has been removed. Sign in at /admin." });
        try {
          const key = (await readFile(keyFile, "utf8")).trim();
          return json(res, 200, { key });
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
          return json(res, 410, { error: "The bootstrap key is no longer available." });
        }
      }
      if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
      const asset = assets.get(url.pathname);
      if (asset && req.method === "GET") {
        const body = await readFile(path.join(root, "public", asset[0]));
        res.writeHead(200, {
          "Content-Type": asset[1],
          "Content-Length": body.length,
          "Cache-Control": "no-cache",
        });
        return res.end(body);
      }
      return json(res, 404, { error: "Not found." });
    } catch (error) {
      if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : "The request could not be completed." });
      else res.destroy();
    }
  });

  server.on("close", () => {
    void stopModule();
  });

  return { server, host, port, dataDir: dataRoot };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const app = await createJNetServer();
  app.server.listen(app.port, app.host, () => {
    console.log(`JNet admin is listening at http://${app.host}:${app.port}/admin`);
    console.log(`Private application data: ${app.dataDir}`);
  });
  const shutdown = () => app.server.close();
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
