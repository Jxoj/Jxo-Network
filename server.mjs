import { spawn } from "node:child_process";
import {
  createHmac,
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { createServer, request as createHttpRequest } from "node:http";
import { inflateRawSync } from "node:zlib";
import { access, chmod, copyFile, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createStorageBackend } from "./modules/storage-backend/main.js";
const scrypt = promisify(scryptCallback);
const root = path.dirname(fileURLToPath(import.meta.url));
const assets = new Map([
  ["/admin", ["index.html", "text/html; charset=utf-8"]],
  ["/assets/app.css", ["app.css", "text/css; charset=utf-8"]],
  ["/assets/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/assets/auth.js", ["auth.js", "text/javascript; charset=utf-8"]],
  ["/assets/browser.js", ["browser.js", "text/javascript; charset=utf-8"]],
]);
const WISP_PACKAGE = "@mercuryworkshop/wisp-js@0.5.3";
const DEFAULT_WISP_PATH = "/wisp/v1/connection";
const DEFAULT_SERVER_PORT = 8080;
const DEFAULT_WISP_PORT = 8090;
const DEFAULT_CHAT_BACKEND_PORT = 8091;
const DEFAULT_SCRAMJET_PORT = 8092;
const MAX_BODY_BYTES = 200 * 1024;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_USERS = 500;
const MAX_DOMAINS = 500;
const MAX_HOSTS = 500;
const MAX_SITES = 500;
const MAX_FRIENDSHIPS = 5000;
const MAX_SITE_ARCHIVE_BYTES = 8 * 1024 * 1024;
const MAX_SITE_FILE_BYTES = 2 * 1024 * 1024;
const MAX_SITE_TOTAL_BYTES = 20 * 1024 * 1024;
const MAX_SITE_FILES = 200;
const MAX_TLDS = 100;
const MAX_APPS = 32;
const PERMISSIONS = [
  "apps:manage",
  "apps:view",
  "announcements:manage",
  "chat:use",
  "connect:use",
  "domains:manage",
  "domains:view",
  "hosting:manage",
  "modules:manage",
  "storage:use",
  "users:manage",
];
const DEFAULT_ROLES = [
  { id: "normal", name: "Normal", permissions: ["apps:view", "chat:use", "connect:use", "domains:view", "storage:use"] },
  { id: "elevated", name: "Elevated", permissions: ["*"] },
];
const DEFAULT_APPS = [
  { id: "browser", name: "Browser", description: "Browse content hosted on Jnet domains.", enabled: true, public: true },
  { id: "wisp-browser", name: "Scramjet Browser", description: "Standalone web browsing powered by the managed Wisp transport.", enabled: true, public: true },
  { id: "chat", name: "Chat", description: "Private direct and group messaging.", enabled: true, public: false },
  { id: "storage", name: "Storage", description: "Manage your private files and documents.", enabled: false, public: true },
  { id: "connect", name: "Connect", description: "Share files securely with Jnet friends.", enabled: true, public: true },
];

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

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function domainName(domain, domains, tlds) {
  const parent = domain.parentId ? domains.find((item) => item.id === domain.parentId) : null;
  return parent
    ? `${domain.name}.${domainName(parent, domains, tlds)}`
    : `${domain.name}.${domain.tld}`;
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
    value.includes("\\") ||
    !value.startsWith("/") ||
    !/^\/[a-zA-Z0-9._~/-]+$/.test(value) ||
    value.split("/").some((part) => part === "." || part === "..")
  ) {
    throw Object.assign(new Error("Choose an absolute URL path using letters, numbers, dots, dashes, underscores, tildes, and slashes."), { status: 400 });
  }
  return value;
}

function validateChatPath(value) {
  const result = validateModulePath(value);
  if (
    ["/", "/admin", "/api", "/assets", "/site", "/domain"].includes(result) ||
    ["/api/", "/assets/", "/site/", "/domain/"].some((prefix) => result.startsWith(prefix))
  ) {
    throw Object.assign(new Error("Choose a Chat app path that does not overlap Jnet system routes."), { status: 400 });
  }
  return result;
}

function validateChatBackendPath(value) {
  const result = validateModulePath(value);
  if (!result.startsWith("/api/chat")) {
    throw Object.assign(new Error("The Chat backend path must start with /api/chat."), { status: 400 });
  }
  return result;
}

function validatePort(value) {
  if (!Number.isInteger(value) || value < 1024 || value > 65535) {
    throw Object.assign(new Error("Port must be a whole number between 1024 and 65535."), { status: 400 });
  }
  return value;
}

function validateSitePath(value) {
  if (
    typeof value !== "string" ||
    !value.length ||
    value.length > 240 ||
    value.includes("\\") ||
    value.includes("\0") ||
    value.startsWith("/") ||
    /^[a-zA-Z]:/.test(value)
  ) {
    throw Object.assign(new Error("Site files must use safe relative paths."), { status: 400 });
  }
  const segments = value.split("/");
  if (segments.some((part) =>
    !part ||
    part === "." ||
    part === ".." ||
    !/^[\p{L}\p{N}._ -]+$/u.test(part) ||
    part.endsWith(".") ||
    part.endsWith(" "))) {
    throw Object.assign(new Error("Site files must use safe relative paths."), { status: 400 });
  }
  return segments.join("/");
}

function siteMimeType(filename) {
  const extension = path.extname(filename).toLowerCase();
  return ({
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
  })[extension] || "application/octet-stream";
}

function isEditableSiteFile(filename) {
  return /\.(?:html?|css|js|json|txt|md)$/i.test(filename);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function extractSiteZip(buffer) {
  const fail = (message) => { throw Object.assign(new Error(message), { status: 400 }); };
  if (!Buffer.isBuffer(buffer) || buffer.length < 22 || buffer.length > MAX_SITE_ARCHIVE_BYTES) {
    fail("Upload a ZIP archive smaller than 8 MB.");
  }
  const eocdMin = Math.max(0, buffer.length - 65_557);
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= eocdMin; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0 || eocd + 22 > buffer.length) fail("The ZIP archive directory is invalid.");
  const disk = buffer.readUInt16LE(eocd + 4);
  const directoryDisk = buffer.readUInt16LE(eocd + 6);
  const diskEntries = buffer.readUInt16LE(eocd + 8);
  const entryCount = buffer.readUInt16LE(eocd + 10);
  const directorySize = buffer.readUInt32LE(eocd + 12);
  const directoryOffset = buffer.readUInt32LE(eocd + 16);
  const commentLength = buffer.readUInt16LE(eocd + 20);
  if (
    disk !== 0 ||
    directoryDisk !== 0 ||
    diskEntries !== entryCount ||
    entryCount > MAX_SITE_FILES ||
    directorySize === 0xffffffff ||
    directoryOffset === 0xffffffff ||
    eocd + 22 + commentLength !== buffer.length ||
    directoryOffset + directorySize > eocd
  ) fail("The ZIP archive uses unsupported or invalid directory features.");
  const files = new Map();
  let cursor = directoryOffset;
  let total = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > directoryOffset + directorySize || buffer.readUInt32LE(cursor) !== 0x02014b50) {
      fail("The ZIP archive directory is invalid.");
    }
    const madeBy = buffer.readUInt16LE(cursor + 4) >>> 8;
    const flags = buffer.readUInt16LE(cursor + 8);
    const compression = buffer.readUInt16LE(cursor + 10);
    const expectedCrc = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const fileCommentLength = buffer.readUInt16LE(cursor + 32);
    const entryDisk = buffer.readUInt16LE(cursor + 34);
    const externalAttributes = buffer.readUInt32LE(cursor + 38);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const end = cursor + 46 + nameLength + extraLength + fileCommentLength;
    if (
      end > directoryOffset + directorySize ||
      entryDisk !== 0 ||
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localOffset === 0xffffffff ||
      (flags & 1) !== 0 ||
      (flags & 0x40) !== 0 ||
      ![0, 8].includes(compression)
    ) fail("The ZIP archive contains unsupported entries.");
    let rawName;
    try {
      rawName = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(cursor + 46, cursor + 46 + nameLength));
    } catch {
      fail("The ZIP archive contains an invalid filename.");
    }
    const isDirectory = rawName.endsWith("/");
    const filename = isDirectory ? rawName.slice(0, -1) : rawName;
    const safeName = validateSitePath(filename);
    const unixMode = externalAttributes >>> 16;
    if (madeBy === 3 && (unixMode & 0xf000) === 0xa000) {
      fail("Symbolic links are not allowed in site archives.");
    }
    if (!isDirectory) {
      if (files.has(safeName) || uncompressedSize > MAX_SITE_FILE_BYTES) {
        fail("The archive has duplicate filenames or an oversized file.");
      }
      total += uncompressedSize;
      if (total > MAX_SITE_TOTAL_BYTES) fail("The uncompressed site exceeds the 20 MB limit.");
      if (localOffset + 30 > directoryOffset || buffer.readUInt32LE(localOffset) !== 0x04034b50) {
        fail("The ZIP archive contains an invalid file header.");
      }
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const localFlags = buffer.readUInt16LE(localOffset + 6);
      const localCompression = buffer.readUInt16LE(localOffset + 8);
      const localName = buffer.subarray(localOffset + 30, localOffset + 30 + localNameLength);
      if (
        localOffset + 30 + localNameLength + localExtraLength > directoryOffset ||
        localFlags !== flags ||
        localCompression !== compression ||
        !localName.equals(buffer.subarray(cursor + 46, cursor + 46 + nameLength))
      ) fail("The ZIP archive file header does not match its directory.");
      const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
      const dataEnd = dataOffset + compressedSize;
      if (dataEnd > directoryOffset) fail("The ZIP archive contains truncated file data.");
      let content;
      try {
        const compressed = buffer.subarray(dataOffset, dataEnd);
        content = compression === 0
          ? Buffer.from(compressed)
          : inflateRawSync(compressed, { maxOutputLength: MAX_SITE_FILE_BYTES });
      } catch {
        fail("A file in the ZIP archive could not be safely decompressed.");
      }
      if (content.length !== uncompressedSize || crc32(content) !== expectedCrc) {
        fail("A file in the ZIP archive failed its integrity check.");
      }
      files.set(safeName, content);
    }
    cursor = end;
  }
  if (cursor !== directoryOffset + directorySize || !files.size) {
    fail("The ZIP archive directory is invalid or contains no files.");
  }
  if (!files.has("index.html")) {
    const firstSegment = files.keys().next().value?.split("/")[0];
    if (
      !firstSegment ||
      !files.has(`${firstSegment}/index.html`) ||
      [...files.keys()].some((name) => !name.startsWith(`${firstSegment}/`))
    ) fail("The ZIP must contain a root index.html file.");
    const normalized = new Map();
    for (const [name, content] of files) normalized.set(name.slice(firstSegment.length + 1), content);
    files.clear();
    for (const [name, content] of normalized) files.set(name, content);
  }
  if (!files.has("index.html")) {
    fail("The ZIP must contain a root index.html file and a valid directory.");
  }
  return files;
}

async function hashKey(key, salt = randomBytes(16).toString("hex")) {
  const hash = await scrypt(key, salt, 64);
  return { salt, hash: Buffer.from(hash).toString("hex") };
}

function validateUsername(value) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,31}$/.test(value)) {
    throw Object.assign(new Error("Usernames must be 3 to 32 letters, numbers, dots, dashes, or underscores."), { status: 400 });
  }
  return value.toLowerCase();
}

function validatePassword(value) {
  if (typeof value !== "string" || value.length < 8 || value.length > 128) {
    throw Object.assign(new Error("Passwords must be between 8 and 128 characters."), { status: 400 });
  }
  return value;
}

function validateDomainLabel(value) {
  if (typeof value !== "string" || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(value)) {
    throw Object.assign(new Error("Use a valid domain label containing letters, numbers, or internal dashes."), { status: 400 });
  }
  return value.toLowerCase();
}

export async function createJNetServer({
  dataDir = process.env.JNET_DATA_DIR || path.join(homedir(), ".jnet"),
  host = process.env.JNET_HOST || "127.0.0.1",
  port: requestedPort,
  scramjetPort: requestedScramjetPort,
  secureCookies = process.env.JNET_SECURE_COOKIES === "1",
} = {}) {
  const requestedDefaultPort = requestedPort && requestedPort !== 0 ? requestedPort : DEFAULT_SERVER_PORT;
  const defaultServerPort = Number(process.env.PORT || requestedDefaultPort);
  let port = requestedPort ?? defaultServerPort;
  let dataRoot = path.resolve(dataDir);
  await mkdir(dataRoot, { recursive: true, mode: 0o700 });
  dataRoot = await realpath(dataRoot);
  if (dataRoot === path.parse(dataRoot).root || dataRoot === path.resolve(homedir())) {
    throw new Error("Jnet data must use a dedicated directory, not a filesystem root or home directory.");
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
      serverPort: defaultServerPort,
      scramjetPort: DEFAULT_SCRAMJET_PORT,
      wisp: { enabled: true, path: DEFAULT_WISP_PATH, port: DEFAULT_WISP_PORT },
      chatBackend: { enabled: true, port: DEFAULT_CHAT_BACKEND_PORT },
      users: [],
      roles: DEFAULT_ROLES,
      selfSignup: false,
      apps: DEFAULT_APPS,
      tlds: ["jnet"],
      domains: [],
      hosts: [],
      sites: [],
      friendships: [],
      chatSettings: { domainId: null, path: "/chat", backendPath: "/api/chat" },
      storageBackend: { enabled: false },
      connect: { enabled: true, apiEnabled: false },
      announcement: { enabled: false, text: "", color: "#304b68", image: "" },
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
      throw new Error("The Jnet configuration is invalid.");
    }
    const hadServerPort = Number.isInteger(config.serverPort);
    const hadScramjetPort = Number.isInteger(config.scramjetPort);
    let migrated = false;
    for (const [key, value] of Object.entries({
      serverPort: defaultServerPort,
      scramjetPort: DEFAULT_SCRAMJET_PORT,
      users: [],
      roles: DEFAULT_ROLES,
      selfSignup: false,
      apps: DEFAULT_APPS,
      tlds: ["jnet"],
      domains: [],
      hosts: [],
      sites: [],
      friendships: [],
      chatSettings: { domainId: null, path: "/chat", backendPath: "/api/chat" },
      chatBackend: { enabled: true, port: DEFAULT_CHAT_BACKEND_PORT },
      storageBackend: { enabled: false },
      connect: { enabled: true, apiEnabled: false },
      announcement: { enabled: false, text: "", color: "#304b68", image: "" },
    })) {
      if (config[key] === undefined) {
        config[key] = structuredClone(value);
        migrated = true;
      }
    }
    if (!hadServerPort) {
      if (config.wisp.port === 8080) config.wisp.port = DEFAULT_WISP_PORT;
      if (config.chatBackend?.port === 8081) config.chatBackend.port = DEFAULT_CHAT_BACKEND_PORT;
      migrated = true;
    }
    if (requestedPort === undefined && process.env.PORT === undefined) port = config.serverPort;
    config.serverPort = validatePort(config.serverPort);
    if (!hadScramjetPort) {
      config.scramjetPort = DEFAULT_SCRAMJET_PORT;
      while (
        [config.serverPort, config.wisp.port, config.chatBackend?.port].includes(config.scramjetPort) &&
        config.scramjetPort < 65535
      ) config.scramjetPort++;
      migrated = true;
    }
    config.scramjetPort = validatePort(config.scramjetPort);
    if (Array.isArray(config.apps)) {
      const previousApps = config.apps;
      const upgradedApps = DEFAULT_APPS.map((app) => {
        const previous = previousApps.find((item) => item?.id === app.id);
        return {
          ...app,
          enabled: typeof previous?.enabled === "boolean" ? previous.enabled : app.enabled,
          public: typeof previous?.public === "boolean" ? previous.public : app.public,
        };
      });
      if (JSON.stringify(previousApps) !== JSON.stringify(upgradedApps)) migrated = true;
      config.apps = upgradedApps;
    }
    const normalRole = Array.isArray(config.roles) && config.roles.find((role) => role?.id === "normal");
    if (normalRole && Array.isArray(normalRole.permissions)) {
      for (const permission of ["connect:use", "storage:use"]) {
        if (!normalRole.permissions.includes(permission)) {
          normalRole.permissions.push(permission);
          migrated = true;
        }
      }
    }
    if (
      config.admin !== null &&
      (
        typeof config.admin?.salt !== "string" ||
        !/^[a-f0-9]{32}$/.test(config.admin.salt) ||
        typeof config.admin?.hash !== "string" ||
        !/^[a-f0-9]{128}$/.test(config.admin.hash)
      )
    ) {
      throw new Error("The Jnet admin credential configuration is invalid.");
    }
    if (config.wisp.port === 5001) {
      config.wisp.port = DEFAULT_WISP_PORT;
      migrated = true;
    }
    if (typeof config.wisp.path === "string" && !config.wisp.path.startsWith("/")) {
      config.wisp.path = DEFAULT_WISP_PATH;
      await writeConfig(config);
    }
    config.wisp.path = validateModulePath(config.wisp.path);
    config.wisp.port = validatePort(config.wisp.port);
    if (!config.chatBackend || typeof config.chatBackend.enabled !== "boolean") {
      throw new Error("The Chat backend module configuration is invalid.");
    }
    config.chatBackend.port = validatePort(config.chatBackend.port);
    if (
      config.wisp.port === config.chatBackend.port ||
      config.wisp.port === config.serverPort ||
      config.wisp.port === config.scramjetPort ||
      config.chatBackend.port === config.serverPort ||
      config.chatBackend.port === config.scramjetPort ||
      config.serverPort === config.scramjetPort ||
      (port > 0 && [config.wisp.port, config.chatBackend.port, config.scramjetPort].includes(port))
    ) {
      throw new Error("Jnet, Wisp, Chat, and Scramjet must use different ports.");
    }
    if (
      !Array.isArray(config.users) ||
      config.users.length > MAX_USERS ||
      !Array.isArray(config.roles) ||
      config.roles.length > 24 ||
      !Array.isArray(config.apps) ||
      config.apps.length > MAX_APPS ||
      !Array.isArray(config.tlds) ||
      config.tlds.length > MAX_TLDS ||
      !Array.isArray(config.domains) ||
      config.domains.length > MAX_DOMAINS ||
      !Array.isArray(config.hosts) ||
      config.hosts.length > MAX_HOSTS ||
      !Array.isArray(config.sites) ||
      config.sites.length > MAX_SITES ||
      !Array.isArray(config.friendships) ||
      config.friendships.length > MAX_FRIENDSHIPS ||
      !config.chatSettings ||
      !config.storageBackend ||
      !config.connect ||
      !config.announcement ||
      typeof config.selfSignup !== "boolean"
    ) {
      throw new Error("The Jnet platform configuration is invalid.");
    }
    const roleIds = new Set();
    const roleNames = new Set();
    for (const role of config.roles) {
      if (
        !role ||
        typeof role.id !== "string" ||
        !/^(?:normal|elevated|[a-f0-9]{24})$/.test(role.id) ||
        typeof role.name !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9 _-]{1,31}$/.test(role.name) ||
        !Array.isArray(role.permissions) ||
        role.permissions.some((permission) => permission !== "*" && !PERMISSIONS.includes(permission)) ||
        (role.permissions.includes("*") && role.id !== "elevated") ||
        roleIds.has(role.id) ||
        roleNames.has(role.name.toLowerCase())
      ) {
        throw new Error("The Jnet permission-level configuration is invalid.");
      }
      roleIds.add(role.id);
      roleNames.add(role.name.toLowerCase());
    }
    if (!roleIds.has("normal") || !roleIds.has("elevated")) {
      throw new Error("The built-in permission levels are missing.");
    }
    const usernames = new Set();
    for (const user of config.users) {
      if (
        !user ||
        typeof user.id !== "string" ||
        !/^[a-f0-9]{32}$/.test(user.id) ||
        validateUsername(user.username) !== user.username ||
        usernames.has(user.username) ||
        typeof user.salt !== "string" ||
        !/^[a-f0-9]{32}$/.test(user.salt) ||
        typeof user.hash !== "string" ||
        !/^[a-f0-9]{128}$/.test(user.hash) ||
        !roleIds.has(user.roleId) ||
        typeof user.displayName !== "string" ||
        user.displayName.length > 64 ||
        typeof user.createdAt !== "string"
      ) {
        throw new Error("The Jnet user configuration is invalid.");
      }
      usernames.add(user.username);
    }
    if (
      typeof config.storageBackend.enabled !== "boolean" ||
      typeof config.connect.enabled !== "boolean" ||
      typeof config.connect.apiEnabled !== "boolean"
    ) throw new Error("The Jnet module configuration is invalid.");
    const friendshipIds = new Set();
    const userIds = new Set(config.users.map((user) => user.id));
    for (const friendship of config.friendships) {
      if (
        !friendship ||
        typeof friendship.id !== "string" ||
        !/^[a-f0-9]{32}$/.test(friendship.id) ||
        friendshipIds.has(friendship.id) ||
        !userIds.has(friendship.requesterId) ||
        !userIds.has(friendship.recipientId) ||
        friendship.requesterId === friendship.recipientId ||
        !["pending", "accepted"].includes(friendship.status) ||
        typeof friendship.createdAt !== "string"
      ) throw new Error("The Jnet friend configuration is invalid.");
      friendshipIds.add(friendship.id);
    }
    if (config.apps.length !== DEFAULT_APPS.length) {
      throw new Error("The Jnet app configuration is invalid.");
    }
    for (const app of DEFAULT_APPS) {
      const configured = config.apps.find((item) => item?.id === app.id);
      if (!configured || typeof configured.enabled !== "boolean" || typeof configured.public !== "boolean") {
        throw new Error("The Jnet app configuration is invalid.");
      }
    }
    const tldSet = new Set(config.tlds.map((item) => validateDomainLabel(item)));
    if (tldSet.size !== config.tlds.length) throw new Error("The Jnet TLD configuration contains duplicates.");
    const domainIds = new Set();
    for (const domain of config.domains) {
      if (
        !domain ||
        typeof domain.id !== "string" ||
        !/^[a-f0-9]{24}$/.test(domain.id) ||
        domainIds.has(domain.id) ||
        validateDomainLabel(domain.name) !== domain.name ||
        !tldSet.has(domain.tld) ||
        (domain.parentId !== null && typeof domain.parentId !== "string")
      ) {
        throw new Error("The Jnet domain configuration is invalid.");
      }
      domainIds.add(domain.id);
    }
    if (
      (config.chatSettings.domainId !== null && !domainIds.has(config.chatSettings.domainId)) ||
      typeof config.chatSettings.path !== "string" ||
      typeof config.chatSettings.backendPath !== "string"
    ) {
      throw new Error("The Jnet Chat app configuration is invalid.");
    }
    config.chatSettings.path = validateChatPath(config.chatSettings.path);
    config.chatSettings.backendPath = validateChatBackendPath(config.chatSettings.backendPath);
    const domainNames = new Set();
    for (const domain of config.domains) {
      const visited = new Set([domain.id]);
      let parentId = domain.parentId;
      while (parentId) {
        if (visited.has(parentId)) throw new Error("The Jnet domain hierarchy contains a cycle.");
        visited.add(parentId);
        const parent = config.domains.find((item) => item.id === parentId);
        if (!parent || parent.tld !== domain.tld) throw new Error("The Jnet domain hierarchy is invalid.");
        parentId = parent.parentId;
      }
      const name = domainName(domain, config.domains, config.tlds);
      if (domainNames.has(name)) throw new Error("The Jnet domain configuration contains duplicates.");
      domainNames.add(name);
    }
    const hostIds = new Set();
    for (const host of config.hosts) {
      if (
        !host ||
        typeof host.id !== "string" ||
        !/^[a-f0-9]{32}$/.test(host.id) ||
        hostIds.has(host.id) ||
        !domainIds.has(host.domainId) ||
        typeof host.title !== "string" ||
        !host.title.length ||
        host.title.length > 80 ||
        typeof host.content !== "string" ||
        host.content.length > 8000
      ) {
        throw new Error("The Jnet hosting configuration is invalid.");
      }
      hostIds.add(host.id);
    }
    const siteIds = new Set();
    for (const site of config.sites) {
      if (
        !site ||
        typeof site.id !== "string" ||
        !/^[a-f0-9]{32}$/.test(site.id) ||
        siteIds.has(site.id) ||
        !domainIds.has(site.domainId) ||
        typeof site.title !== "string" ||
        !site.title.length ||
        site.title.length > 80 ||
        !Array.isArray(site.files) ||
        !site.files.length ||
        site.files.length > MAX_SITE_FILES
      ) {
        throw new Error("The Jnet Sites configuration is invalid.");
      }
      const filePaths = site.files.map(validateSitePath);
      if (new Set(filePaths).size !== filePaths.length || !filePaths.includes("index.html")) {
        throw new Error("The Jnet site file list is invalid.");
      }
      siteIds.add(site.id);
    }
    if (
      typeof config.announcement.enabled !== "boolean" ||
      typeof config.announcement.text !== "string" ||
      config.announcement.text.length > 500 ||
      typeof config.announcement.color !== "string" ||
      !/^#[0-9a-f]{6}$/i.test(config.announcement.color) ||
      typeof config.announcement.image !== "string" ||
      config.announcement.image.length > 180_000 ||
      (config.announcement.image && !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(config.announcement.image))
    ) {
      throw new Error("The Jnet announcement configuration is invalid.");
    }
    if (migrated) await writeConfig(config);
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
  const scramjetPort = requestedScramjetPort ?? config.scramjetPort;
  if (scramjetPort !== 0) validatePort(scramjetPort);
  if (
    scramjetPort !== 0 &&
    [port, config.serverPort, config.wisp.port, config.chatBackend.port].includes(scramjetPort)
  ) {
    throw new Error("Scramjet must use a port not used by Jnet, Wisp, or Chat.");
  }
  const sitesRoot = path.join(dataRoot, "sites");
  await mkdir(sitesRoot, { recursive: true, mode: 0o700 });
  await chmod(sitesRoot, 0o700);
  const storageBackend = await createStorageBackend(path.join(dataRoot, "storage"));
  function siteDirectory(site) {
    const domain = config.domains.find((item) => item.id === site.domainId);
    if (!domain) throw new Error("The site's domain is no longer available.");
    return path.join(sitesRoot, domainName(domain, config.domains, config.tlds), site.id);
  }
  function siteFilePath(site, relativePath) {
    const safePath = validateSitePath(relativePath);
    const directory = siteDirectory(site);
    const filename = path.resolve(directory, ...safePath.split("/"));
    if (!filename.startsWith(`${directory}${path.sep}`)) {
      throw Object.assign(new Error("The site file path is invalid."), { status: 400 });
    }
    return filename;
  }
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
  const scramjetSockets = new Map();
  function closeScramjetSession(token) {
    const sockets = scramjetSockets.get(token);
    if (!sockets) return;
    for (const socket of sockets) socket.destroy();
    scramjetSockets.delete(token);
  }
  function closeAllScramjetSessions() {
    for (const token of scramjetSockets.keys()) closeScramjetSession(token);
  }
  const loginAttempts = new Map();
  const signupAttempts = new Map();
  const chatMessageAttempts = new Map();
  function consumeLimit(map, key, limit, windowMs) {
    const now = Date.now();
    if (map.size > 10_000) {
      for (const [entry, state] of map) if (state.until <= now) map.delete(entry);
    }
    const current = map.get(key);
    if (current && current.until > now && current.count >= limit) return false;
    map.set(key, current && current.until > now
      ? { count: current.count + 1, until: current.until }
      : { count: 1, until: now + windowMs });
    return true;
  }
  const moduleState = {
    child: null,
    operation: null,
    status: "stopped",
    error: "",
    output: "",
    stopping: false,
  };
  const chatModuleState = {
    child: null,
    operation: null,
    status: "stopped",
    error: "",
    output: "",
    stopping: false,
    token: "",
  };

  function moduleDirectory() {
    return path.join(modulesRoot, "wisp");
  }

  function chatModuleDirectory() {
    return path.join(modulesRoot, "chat-backend");
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
      closeScramjetSession(match[1]);
      return null;
    }
    session.expiresAt = Date.now() + SESSION_TTL_MS;
    if (session.userId && !config.users.some((user) => user.id === session.userId)) {
      sessions.delete(match[1]);
      closeScramjetSession(match[1]);
      return null;
    }
    return { token: match[1], ...session };
  }

  function roleFor(session) {
    const user = config.users.find((item) => item.id === session.userId);
    return user ? config.roles.find((role) => role.id === user.roleId) || null : null;
  }

  function hasPermission(session, permission) {
    const role = roleFor(session);
    if (!role) return false;
    if (role.permissions.includes("*") || role.permissions.includes(permission)) return true;
    return permission.endsWith(":view") && role.permissions.includes(`${permission.slice(0, -4)}manage`);
  }

  function canGrantRole(session, targetRole) {
    const actorRole = roleFor(session);
    if (!actorRole) return false;
    if (actorRole.permissions.includes("*")) return true;
    return !targetRole.permissions.includes("*") &&
      targetRole.permissions.every((permission) => actorRole.permissions.includes(permission));
  }

  function requirePermission(session, res, permission) {
    if (hasPermission(session, permission)) return true;
    json(res, 403, { error: "Your account does not have permission to perform this action." });
    return false;
  }

  function createSession(userId) {
    const token = randomBytes(32).toString("hex");
    const csrfToken = randomBytes(32).toString("hex");
    const session = { csrfToken, expiresAt: Date.now() + SESSION_TTL_MS, userId };
    sessions.set(token, session);
    return { token, ...session };
  }

  function sessionCookie(req, session) {
    return `jnet_session=${session.token}; ${cookieOptions(req, SESSION_TTL_MS / 1000)}`;
  }

  function publicState() {
    return {
      selfSignup: config.selfSignup,
      apps: config.apps.filter((app) => app.enabled && app.public).map(({ id, name, description }) => ({ id, name, description })),
      announcement: config.announcement,
    };
  }

  function chatIdentity(session) {
    const user = config.users.find((item) => item.id === session.userId);
    return user ? { id: user.id, username: user.username, displayName: user.displayName } : null;
  }

  function canUseChat(session) {
    const app = config.apps.find((item) => item.id === "chat");
    const role = roleFor(session);
    return Boolean(
      app?.enabled &&
      (app.public || role?.permissions.includes("*")) &&
      hasPermission(session, "chat:use"),
    );
  }

  function canUseStorage(session) {
    const app = config.apps.find((item) => item.id === "storage");
    return Boolean(
      config.storageBackend.enabled &&
      app?.enabled &&
      (app.public || hasPermission(session, "apps:manage")) &&
      hasPermission(session, "storage:use"),
    );
  }

  function canUseConnect(session) {
    const app = config.apps.find((item) => item.id === "connect");
    return Boolean(
      config.connect.enabled &&
      app?.enabled &&
      (app.public || hasPermission(session, "apps:manage")) &&
      hasPermission(session, "connect:use"),
    );
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

  function checkScramjetOrigin(req) {
    if (!checkOrigin(req)) return false;
    try {
      const expectedProtocol = req.socket.encrypted || secureCookies ? "https:" : "http:";
      return new URL(req.headers.origin).protocol === expectedProtocol;
    } catch {
      return false;
    }
  }

  async function readBody(req, maximum = MAX_BODY_BYTES) {
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > maximum) {
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

  async function readBinaryBody(req, maximum) {
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > maximum) tooLarge = true;
      else if (!tooLarge) chunks.push(chunk);
    }
    if (tooLarge) throw Object.assign(new Error("Uploaded file exceeds the allowed size."), { status: 413 });
    return Buffer.concat(chunks, size);
  }

  async function isInstalled() {
    try {
      await Promise.all([
        access(path.join(moduleDirectory(), "main.js")),
        access(path.join(moduleDirectory(), "node_modules", "@mercuryworkshop", "wisp-js", "package.json")),
      ]);
      return true;
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw error;
    }
  }

  async function getStatus(session) {
    if (!session) return {
      authenticated: false,
      initialized: config.admin !== null || config.users.length > 0,
      setupAvailable: config.admin === null,
      serverPort: port,
      ...publicState(),
    };
    const role = roleFor(session);
    const visibleApps = hasPermission(session, "apps:manage")
      ? config.apps
      : config.apps.filter((item) =>
        item.enabled &&
        item.public &&
        (item.id !== "chat" || hasPermission(session, "chat:use")) &&
        (item.id !== "storage" || hasPermission(session, "storage:use")) &&
        (item.id !== "connect" || hasPermission(session, "connect:use")));
    return {
      authenticated: true,
      csrfToken: session.csrfToken,
      user: (() => {
        const user = config.users.find((item) => item.id === session.userId);
        return { id: user.id, username: user.username, displayName: user.displayName };
      })(),
      role: role ? { id: role.id, name: role.name } : null,
      permissions: role?.permissions || [],
      serverPort: port,
      configuredServerPort: config.serverPort,
      scramjetPort,
      configuredScramjetPort: config.scramjetPort,
      serverPortFromEnvironment: Boolean(process.env.PORT),
      settings: hasPermission(session, "modules:manage") ? { ...config.wisp } : null,
      selfSignup: config.selfSignup,
      apps: visibleApps,
      ...(hasPermission(session, "domains:view") ? {
        tlds: config.tlds,
        domains: config.domains,
      } : {}),
      ...(hasPermission(session, "hosting:manage") ? {
        hosts: config.hosts.map(({ id, domainId, title }) => ({ id, domainId, title })),
      } : {}),
      announcement: config.announcement,
      chatSettings: {
        ...config.chatSettings,
        domain: config.chatSettings.domainId
          ? domainName(config.domains.find((item) => item.id === config.chatSettings.domainId), config.domains, config.tlds)
          : "",
      },
      module: {
        status: config.wisp.enabled ? moduleState.status : "disabled",
        installed: await isInstalled(),
        error: moduleState.error,
        output: moduleState.output,
        operation: moduleState.operation,
      },
      ...(hasPermission(session, "modules:manage") ? { chatBackendModule: {
        enabled: config.chatBackend.enabled,
        port: config.chatBackend.port,
        path: config.chatSettings.backendPath,
        status: config.chatBackend.enabled ? chatModuleState.status : "disabled",
        installed: await isChatModuleInstalled(),
        error: chatModuleState.error,
        output: chatModuleState.output,
        operation: chatModuleState.operation,
      } } : {}),
      ...(hasPermission(session, "modules:manage") ? {
        storageBackendModule: {
          enabled: config.storageBackend.enabled,
          status: config.storageBackend.enabled ? "running" : "disabled",
          entry: "modules/storage-backend/main.js",
        },
        connectModule: {
          enabled: config.connect.enabled,
          apiEnabled: config.connect.apiEnabled,
          status: config.connect.enabled ? "running" : "disabled",
        },
      } : {}),
    };
  }

  function moduleStatusSnapshot() {
    return {
      module: {
        status: config.wisp.enabled ? moduleState.status : "disabled",
        operation: moduleState.operation,
        error: moduleState.error,
      },
      chatBackendModule: {
        enabled: config.chatBackend.enabled,
        status: config.chatBackend.enabled ? chatModuleState.status : "disabled",
        operation: chatModuleState.operation,
        error: chatModuleState.error,
      },
      storageBackendModule: {
        enabled: config.storageBackend.enabled,
        status: config.storageBackend.enabled ? "running" : "disabled",
      },
      connectModule: {
        enabled: config.connect.enabled,
        apiEnabled: config.connect.apiEnabled,
        status: config.connect.enabled ? "running" : "disabled",
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
    const entry = path.join(moduleDirectory(), "main.js");
    const child = spawn(
      process.execPath,
      [entry, "--host", "127.0.0.1", "--port", String(config.wisp.port), "--path", config.wisp.path, "--logging", "INFO"],
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
      const entry = path.join(directory, "main.js");
      await copyFile(path.join(root, "modules", "wisp", "main.js"), entry);
      await chmod(entry, 0o600);
      moduleState.status = "stopped";
    } catch (error) {
      moduleState.status = "failed";
      moduleState.error = error.message;
      throw error;
    }
  }

  async function isChatModuleInstalled() {
    try {
      await access(path.join(chatModuleDirectory(), "main.js"));
      return true;
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw error;
    }
  }

  function appendChatOutput(chunk) {
    chatModuleState.output = `${chatModuleState.output}${chunk}`.slice(-1600);
  }

  async function installChatModule() {
    if (chatModuleState.child) throw new Error("Stop the Chat backend before installing it.");
    const directory = chatModuleDirectory();
    await mkdir(directory, { recursive: true, mode: 0o700 });
    chatModuleState.status = "installing";
    chatModuleState.error = "";
    chatModuleState.output = "";
    try {
      const entry = path.join(directory, "main.js");
      await copyFile(path.join(root, "modules", "chat-backend", "main.js"), entry);
      await chmod(entry, 0o600);
      chatModuleState.status = "stopped";
    } catch (error) {
      chatModuleState.status = "failed";
      chatModuleState.error = `Could not install Chat backend: ${error.message}`;
      throw error;
    }
  }

  async function stopChatModule() {
    const child = chatModuleState.child;
    if (!child) {
      chatModuleState.status = "stopped";
      chatModuleState.token = "";
      return;
    }
    chatModuleState.stopping = true;
    chatModuleState.status = "stopping";
    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => child.kill("SIGKILL"), 4000);
      const fallbackTimer = setTimeout(() => {
        clearTimeout(fallbackTimer);
        finish();
      }, 6000);
      child.once("exit", () => {
        clearTimeout(fallbackTimer);
        finish();
      });
      child.kill("SIGTERM");
    });
    if (chatModuleState.child === child) chatModuleState.child = null;
    chatModuleState.stopping = false;
    chatModuleState.status = "stopped";
    chatModuleState.token = "";
  }

  async function startChatModule() {
    if (!config.chatBackend.enabled) throw new Error("Enable the Chat backend module before starting it.");
    if (chatModuleState.child) throw new Error("The Chat backend module is already running.");
    if (!await isChatModuleInstalled()) throw new Error("Download the Chat backend module before starting it.");
    chatModuleState.error = "";
    chatModuleState.output = "";
    chatModuleState.token = randomBytes(32).toString("hex");
    const directory = chatModuleDirectory();
    const child = spawn(
      process.execPath,
      [
        path.join(directory, "main.js"),
        "--host", "127.0.0.1",
        "--port", String(config.chatBackend.port),
        "--path", config.chatSettings.backendPath,
      ],
      {
        cwd: directory,
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
        env: {
          ...process.env,
          JNET_MODULE_DATA_DIR: directory,
          JNET_MODULE_TOKEN: chatModuleState.token,
        },
      },
    );
    chatModuleState.child = child;
    chatModuleState.status = "starting";
    child.stdout.on("data", appendChatOutput);
    child.stderr.on("data", appendChatOutput);
    child.once("spawn", () => {
      if (chatModuleState.child === child) chatModuleState.status = "running";
    });
    child.once("error", (error) => {
      chatModuleState.error = `Could not start Chat backend: ${error.message}`;
      chatModuleState.status = "failed";
      if (chatModuleState.child === child) chatModuleState.child = null;
    });
    child.once("exit", (code, signal) => {
      if (chatModuleState.child !== child) return;
      chatModuleState.child = null;
      if (chatModuleState.stopping) return;
      chatModuleState.status = code === 0 ? "stopped" : "failed";
      if (code !== 0) {
        chatModuleState.error = `Chat backend exited ${signal ? `after ${signal}` : `with code ${code}`}.`;
      }
      chatModuleState.token = "";
    });
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (chatModuleState.child !== child) {
        throw new Error(chatModuleState.error || "The Chat backend stopped during startup.");
      }
      try {
        const response = await fetch(
          `http://127.0.0.1:${config.chatBackend.port}${config.chatSettings.backendPath}/health`,
          { signal: AbortSignal.timeout(500) },
        );
        if (response.ok) return;
      } catch {
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await stopChatModule();
    throw new Error("The Chat backend did not become ready within 5 seconds.");
  }

  async function handleApi(req, res, url) {
    const session = sessionFor(req);
    const chatBase = config.chatSettings.backendPath;
    if (url.pathname === "/api/modules/events" && req.method === "GET") {
      if (!session || !hasPermission(session, "modules:manage")) {
        return json(res, session ? 403 : 401, { error: "Module status is unavailable for this account." });
      }
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders();
      const sessionToken = session.token;
      let previous = "";
      let lastHeartbeat = Date.now();
      const sendStatus = () => {
        const storedSession = sessions.get(sessionToken);
        if (!storedSession || storedSession.expiresAt <= Date.now()) {
          res.write("event: auth-required\ndata: {}\n\n");
          res.end();
          return false;
        }
        const activeSession = { token: sessionToken, ...storedSession };
        if (!hasPermission(activeSession, "modules:manage")) {
          res.write("event: auth-required\ndata: {}\n\n");
          res.end();
          return false;
        }
        const snapshot = JSON.stringify(moduleStatusSnapshot());
        if (snapshot !== previous) {
          res.write(`event: module-status\ndata: ${snapshot}\n\n`);
          previous = snapshot;
          lastHeartbeat = Date.now();
        } else if (Date.now() - lastHeartbeat >= 20_000) {
          res.write(": keepalive\n\n");
          lastHeartbeat = Date.now();
        }
        return true;
      };
      if (!sendStatus()) return;
      const interval = setInterval(() => {
        if (!sendStatus()) clearInterval(interval);
      }, 1000);
      res.on("close", () => clearInterval(interval));
      return;
    }
    if (url.pathname === "/api/public" && req.method === "GET") {
      return json(res, 200, publicState());
    }
    if (url.pathname === "/api/status" && req.method === "GET") {
      return json(res, 200, await getStatus(session));
    }
    if (url.pathname === "/api/server-settings" && req.method === "POST") {
      if (!requirePermission(session, res, "modules:manage")) return;
      const body = await readBody(req);
      let serverPort;
      try {
        serverPort = validatePort(body.port);
      } catch (error) {
        return json(res, error.status || 400, { error: error.message });
      }
      if ([config.wisp.port, config.chatBackend.port, config.scramjetPort, scramjetPort].includes(serverPort)) {
        return json(res, 400, { error: "Jnet must use a port not used by Wisp, Chat, or Scramjet." });
      }
      const nextConfig = { ...config, serverPort };
      await writeConfig(nextConfig);
      config = nextConfig;
      return json(res, 200, {
        settings: {
          serverPort,
          restartRequired: serverPort !== port,
          environmentOverride: Boolean(process.env.PORT),
        },
      });
    }
    if (url.pathname === "/api/scramjet-settings" && req.method === "POST") {
      if (!requirePermission(session, res, "modules:manage")) return;
      const body = await readBody(req);
      let scramjetPort;
      try {
        scramjetPort = validatePort(body.port);
      } catch (error) {
        return json(res, error.status || 400, { error: error.message });
      }
      if (
        [config.serverPort, config.wisp.port, config.chatBackend.port, port].includes(scramjetPort)
      ) {
        return json(res, 400, { error: "Scramjet must use a port not used by Jnet, Wisp, or Chat." });
      }
      const restartRequired = scramjetPort !== (requestedScramjetPort ?? config.scramjetPort);
      const nextConfig = { ...config, scramjetPort };
      await writeConfig(nextConfig);
      config = nextConfig;
      return json(res, 200, {
        settings: {
          scramjetPort,
          restartRequired,
        },
      });
    }
    if (url.pathname === "/api/setup" && req.method === "POST") {
      if (!checkOrigin(req)) return json(res, 403, { error: "Request origin was not accepted." });
      if (!isLoopback(req)) return json(res, 403, { error: "Initial setup is available only from this machine." });
      if (config.admin !== null) return json(res, 409, { error: "Jnet setup has already been completed." });
      const ip = req.socket.remoteAddress || "unknown";
      const attempts = loginAttempts.get(ip);
      if (attempts && attempts.until > Date.now() && attempts.count >= 5) {
        return json(res, 429, { error: "Too many setup attempts. Try again in 15 minutes." });
      }
      const body = await readBody(req);
      const key = typeof body.key === "string" ? body.key : "";
      let validKey = false;
      if (key.length >= 20 && key.length <= 256) {
        try {
          validKey = safeEqual(key, (await readFile(keyFile, "utf8")).trim());
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
      if (!validKey) {
        const next = attempts && attempts.until > Date.now()
          ? { count: attempts.count + 1, until: attempts.until }
          : { count: 1, until: Date.now() + 15 * 60 * 1000 };
        loginAttempts.set(ip, next);
        return json(res, 401, { error: "The one-time setup key is not valid." });
      }
      const username = validateUsername(body.username);
      const password = validatePassword(body.password);
      if (config.users.some((user) => user.username === username)) {
        return json(res, 409, { error: "That username is already in use." });
      }
      if (config.users.length >= MAX_USERS) return json(res, 409, { error: "The user limit has been reached." });
      if (!config.roles.some((role) => role.id === "elevated")) {
        throw new Error("The Elevated permission level is missing from configuration.");
      }
      const user = {
        id: randomBytes(16).toString("hex"),
        username,
        displayName: username,
        ...(await hashKey(password)),
        roleId: "elevated",
        createdAt: new Date().toISOString(),
      };
      const nextConfig = {
        ...config,
        admin: await hashKey(key),
        users: [...config.users, user],
      };
      await writeConfig(nextConfig);
      config = nextConfig;
      await rm(keyFile, { force: true });
      loginAttempts.delete(ip);
      const setupSession = createSession(user.id);
      return json(res, 201, await getStatus(setupSession), {
        "Set-Cookie": sessionCookie(req, setupSession),
      });
    }
    if (url.pathname === "/api/signup" && req.method === "POST") {
      if (!checkOrigin(req)) return json(res, 403, { error: "Request origin was not accepted." });
      if (!config.selfSignup) return json(res, 403, { error: "Self-signup is disabled." });
      if (!consumeLimit(signupAttempts, req.socket.remoteAddress || "unknown", 3, 60 * 60 * 1000)) {
        return json(res, 429, { error: "Too many account creation attempts. Try again later." });
      }
      if (config.users.length >= MAX_USERS) return json(res, 409, { error: "The user limit has been reached." });
      const body = await readBody(req);
      const username = validateUsername(body.username);
      const password = validatePassword(body.password);
      if (config.users.some((user) => user.username === username)) {
        return json(res, 409, { error: "That username is already in use." });
      }
      const credential = await hashKey(password);
      const user = {
        id: randomBytes(16).toString("hex"),
        username,
        displayName: username,
        ...credential,
        roleId: "normal",
        createdAt: new Date().toISOString(),
      };
      const nextConfig = { ...config, users: [...config.users, user] };
      await writeConfig(nextConfig);
      config = nextConfig;
      const newSession = createSession(user.id);
      return json(res, 201, await getStatus(newSession), {
        "Set-Cookie": sessionCookie(req, newSession),
      });
    }
    if (url.pathname === "/api/login" && req.method === "POST") {
      if (!checkOrigin(req)) return json(res, 403, { error: "Request origin was not accepted." });
      const ip = req.socket.remoteAddress || "unknown";
      const attempts = loginAttempts.get(ip);
      if (attempts && attempts.until > Date.now() && attempts.count >= 5) {
        return json(res, 429, { error: "Too many sign-in attempts. Try again in 15 minutes." });
      }
      const body = await readBody(req);
      let valid = false;
      let loginSession;
      if (typeof body.username === "string" && typeof body.password === "string") {
        const username = body.username.toLowerCase();
        const user = config.users.find((item) => item.username === username);
        if (user && body.password.length <= 128) {
          const candidate = Buffer.from(await scrypt(body.password, user.salt, 64));
          const expected = Buffer.from(user.hash, "hex");
          valid = candidate.length === expected.length && timingSafeEqual(candidate, expected);
          if (valid) loginSession = createSession(user.id);
        }
      }
      if (!valid) {
        const next = attempts && attempts.until > Date.now()
          ? { count: attempts.count + 1, until: attempts.until }
          : { count: 1, until: Date.now() + 15 * 60 * 1000 };
        loginAttempts.set(ip, next);
        return json(res, 401, { error: "The username or password is not valid." });
      }
      loginAttempts.delete(ip);
      return json(res, 200, { ok: true }, { "Set-Cookie": sessionCookie(req, loginSession) });
    }
    if (!session) return json(res, 401, { error: "Sign in to continue." });
    if (req.method !== "GET") {
      if (!checkOrigin(req) || req.headers["x-jnet-csrf"] !== session.csrfToken) {
        return json(res, 403, { error: "Request verification failed. Refresh and try again." });
      }
    }
    if (url.pathname === "/api/logout" && req.method === "POST") {
      sessions.delete(session.token);
      closeScramjetSession(session.token);
      return json(res, 200, { ok: true }, { "Set-Cookie": `jnet_session=; ${cookieOptions(req, 0)}` });
    }
    if (url.pathname === "/api/key" && req.method === "POST") {
      if (!roleFor(session)?.permissions.includes("*")) {
        return json(res, 403, { error: "Only an Elevated administrator can reset the admin key." });
      }
      const key = `${randomBytes(32).toString("base64url")}\n`;
      await rm(keyFile, { force: true });
      await writeFile(keyFile, key, { mode: 0o600, flag: "wx" });
      const nextConfig = { ...config, admin: null };
      await writeConfig(nextConfig);
      config = nextConfig;
      sessions.clear();
      closeAllScramjetSessions();
      return json(res, 200, {
        ok: true,
        message: "A new setup key was written to the private server data directory.",
      }, { "Set-Cookie": `jnet_session=; ${cookieOptions(req, 0)}` });
    }
    if (url.pathname === "/api/settings" && req.method === "POST") {
      if (!requirePermission(session, res, "modules:manage")) return;
      if (moduleState.child || moduleState.operation) {
        return json(res, 409, { error: "Stop the Wisp module before changing its path or port." });
      }
      const body = await readBody(req);
      const nextConfig = { ...config, wisp: { ...config.wisp } };
      if (body.path !== undefined) nextConfig.wisp.path = validateModulePath(body.path);
      if (body.port !== undefined) nextConfig.wisp.port = validatePort(body.port);
      if (
        nextConfig.wisp.port === config.chatBackend.port ||
        nextConfig.wisp.port === config.serverPort ||
        nextConfig.wisp.port === config.scramjetPort ||
        nextConfig.wisp.port === scramjetPort ||
        (port > 0 && nextConfig.wisp.port === port)
      ) {
        return json(res, 400, { error: "The Wisp module must use a port not used by Jnet, Chat, or Scramjet." });
      }
      await writeConfig(nextConfig);
      config = nextConfig;
      return json(res, 200, { settings: { ...config.wisp } });
    }
    if (url.pathname === "/api/modules/wisp" && req.method === "POST") {
      if (!requirePermission(session, res, "modules:manage")) return;
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
    if (url.pathname === "/api/modules/chat-backend" && req.method === "POST") {
      if (!requirePermission(session, res, "modules:manage")) return;
      const body = await readBody(req);
      const actions = ["download", "start", "stop", "restart", "enable", "disable", "configure"];
      if (!actions.includes(body.action)) return json(res, 400, { error: "Unknown Chat backend action." });
      if (chatModuleState.operation) return json(res, 409, { error: "A module operation is already in progress." });
      chatModuleState.operation = body.action;
      try {
        if (body.action === "download") {
          await installChatModule();
        } else if (body.action === "start") {
          await startChatModule();
        } else if (body.action === "stop") {
          await stopChatModule();
        } else if (body.action === "restart") {
          await stopChatModule();
          await startChatModule();
        } else if (body.action === "enable") {
          const nextConfig = { ...config, chatBackend: { ...config.chatBackend, enabled: true } };
          await writeConfig(nextConfig);
          config = nextConfig;
        } else if (body.action === "disable") {
          await stopChatModule();
          const nextConfig = { ...config, chatBackend: { ...config.chatBackend, enabled: false } };
          await writeConfig(nextConfig);
          config = nextConfig;
        } else {
          if (chatModuleState.child) {
            return json(res, 409, { error: "Stop the Chat backend before changing its path or port." });
          }
          const nextConfig = {
            ...config,
            chatBackend: {
              ...config.chatBackend,
              port: body.port === undefined ? config.chatBackend.port : validatePort(body.port),
            },
            chatSettings: {
              ...config.chatSettings,
              backendPath: body.path === undefined
                ? config.chatSettings.backendPath
                : validateChatBackendPath(body.path),
            },
          };
          if (
            nextConfig.chatBackend.port === config.wisp.port ||
            nextConfig.chatBackend.port === config.serverPort ||
            nextConfig.chatBackend.port === config.scramjetPort ||
            nextConfig.chatBackend.port === scramjetPort ||
            (port > 0 && nextConfig.chatBackend.port === port)
          ) {
            return json(res, 400, { error: "The Chat backend must use a port not used by Jnet, Wisp, or Scramjet." });
          }
          await writeConfig(nextConfig);
          config = nextConfig;
        }
      } catch (error) {
        return json(res, error.status || 400, { error: error.message });
      } finally {
        chatModuleState.operation = null;
      }
      return json(res, 200, await getStatus(session));
    }
    if (url.pathname === "/api/modules/storage-backend" && req.method === "POST") {
      if (!requirePermission(session, res, "modules:manage")) return;
      const body = await readBody(req);
      if (!["enable", "disable"].includes(body.action)) {
        return json(res, 400, { error: "Unknown Storage backend action." });
      }
      const enabled = body.action === "enable";
      const nextConfig = {
        ...config,
        storageBackend: { ...config.storageBackend, enabled },
        apps: config.apps.map((app) => app.id === "storage" ? { ...app, enabled } : app),
      };
      await writeConfig(nextConfig);
      config = nextConfig;
      return json(res, 200, await getStatus(session));
    }
    if (url.pathname === "/api/modules/connect" && req.method === "POST") {
      if (!requirePermission(session, res, "modules:manage")) return;
      const body = await readBody(req);
      if (!["enable", "disable"].includes(body.action)) {
        return json(res, 400, { error: "Unknown Connect module action." });
      }
      const enabled = body.action === "enable";
      const nextConfig = {
        ...config,
        connect: { ...config.connect, enabled },
        apps: config.apps.map((app) => app.id === "connect" ? { ...app, enabled } : app),
      };
      await writeConfig(nextConfig);
      config = nextConfig;
      return json(res, 200, await getStatus(session));
    }
    if (url.pathname === "/api/users" && req.method === "GET") {
      if (!requirePermission(session, res, "users:manage")) return;
      return json(res, 200, {
        users: config.users.map(({ id, username, displayName, roleId, createdAt }) => ({
          id, username, displayName, roleId, createdAt,
        })),
        roles: config.roles.map(({ id, name, permissions }) => ({ id, name, permissions })),
      });
    }
    if (url.pathname === "/api/users" && req.method === "POST") {
      if (!requirePermission(session, res, "users:manage")) return;
      if (config.users.length >= MAX_USERS) return json(res, 409, { error: "The user limit has been reached." });
      const body = await readBody(req);
      const username = validateUsername(body.username);
      const password = validatePassword(body.password);
      const role = config.roles.find((item) => item.id === body.roleId);
      if (!role) return json(res, 400, { error: "Choose an existing permission level." });
      if (!canGrantRole(session, role)) {
        return json(res, 403, { error: "You cannot assign a permission level with greater access than your own." });
      }
      if (config.users.some((user) => user.username === username)) {
        return json(res, 409, { error: "That username is already in use." });
      }
      const credential = await hashKey(password);
      const user = {
        id: randomBytes(16).toString("hex"),
        username,
        displayName: typeof body.displayName === "string" && body.displayName.trim()
          ? body.displayName.trim().slice(0, 64)
          : username,
        ...credential,
        roleId: role.id,
        createdAt: new Date().toISOString(),
      };
      const nextConfig = { ...config, users: [...config.users, user] };
      await writeConfig(nextConfig);
      config = nextConfig;
      return json(res, 201, { user: { id: user.id, username, displayName: user.displayName, roleId: user.roleId } });
    }
    const userRoute = url.pathname.match(/^\/api\/users\/([a-f0-9]{32})$/);
    if (userRoute && req.method === "PATCH") {
      if (!requirePermission(session, res, "users:manage")) return;
      const body = await readBody(req);
      const current = config.users.find((item) => item.id === userRoute[1]);
      if (!current) return json(res, 404, { error: "User not found." });
      const nextUsers = config.users.map((user) => user.id === current.id
        ? { ...user, ...(body.roleId !== undefined ? { roleId: body.roleId } : {}) }
        : user);
      if (body.roleId !== undefined) {
        const role = config.roles.find((item) => item.id === body.roleId);
        if (!role) return json(res, 400, { error: "Choose an existing permission level." });
        if (!canGrantRole(session, role)) {
          return json(res, 403, { error: "You cannot assign a permission level with greater access than your own." });
        }
      }
      if (typeof body.password === "string" && body.password.length) {
        const credential = await hashKey(validatePassword(body.password));
        Object.assign(nextUsers.find((item) => item.id === current.id), credential);
      }
      const nextConfig = { ...config, users: nextUsers };
      await writeConfig(nextConfig);
      config = nextConfig;
      return json(res, 200, { ok: true });
    }
    if (userRoute && req.method === "DELETE") {
      if (!requirePermission(session, res, "users:manage")) return;
      const users = config.users.filter((user) => user.id !== userRoute[1]);
      if (users.length === config.users.length) return json(res, 404, { error: "User not found." });
      const nextConfig = {
        ...config,
        users,
        friendships: config.friendships.filter((item) =>
          item.requesterId !== userRoute[1] && item.recipientId !== userRoute[1]),
      };
      await writeConfig(nextConfig);
      config = nextConfig;
      for (const [token, active] of sessions) {
        if (active.userId === userRoute[1]) {
          sessions.delete(token);
          closeScramjetSession(token);
        }
      }
      await storageBackend.deleteUser(userRoute[1]);
      return json(res, 200, { ok: true });
    }
    if (url.pathname === "/api/roles" && req.method === "POST") {
      if (!requirePermission(session, res, "users:manage")) return;
      if (!roleFor(session)?.permissions.includes("*")) {
        return json(res, 403, { error: "Only an Elevated administrator can create permission levels." });
      }
      const body = await readBody(req);
      if (config.roles.length >= 24) return json(res, 409, { error: "The permission-level limit has been reached." });
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!/^[A-Za-z0-9][A-Za-z0-9 _-]{1,31}$/.test(name)) {
        return json(res, 400, { error: "Permission level names must be 2 to 32 simple characters." });
      }
      if (config.roles.some((role) => role.name.toLowerCase() === name.toLowerCase())) {
        return json(res, 409, { error: "That permission level already exists." });
      }
      if (!Array.isArray(body.permissions) || body.permissions.some((item) => !PERMISSIONS.includes(item))) {
        return json(res, 400, { error: "Choose permissions from the available list." });
      }
      const role = {
        id: randomBytes(12).toString("hex"),
        name,
        permissions: [...new Set(body.permissions)],
      };
      const nextConfig = { ...config, roles: [...config.roles, role] };
      await writeConfig(nextConfig);
      config = nextConfig;
      return json(res, 201, { role });
    }
    if (url.pathname.startsWith("/api/roles/") && req.method === "DELETE") {
      if (!requirePermission(session, res, "users:manage")) return;
      if (!roleFor(session)?.permissions.includes("*")) {
        return json(res, 403, { error: "Only an Elevated administrator can delete permission levels." });
      }
      const roleId = url.pathname.slice("/api/roles/".length);
      if (["normal", "elevated"].includes(roleId)) return json(res, 400, { error: "Built-in permission levels cannot be deleted." });
      if (config.users.some((user) => user.roleId === roleId)) {
        return json(res, 409, { error: "Move users to another permission level before deleting this one." });
      }
      const roles = config.roles.filter((role) => role.id !== roleId);
      if (roles.length === config.roles.length) return json(res, 404, { error: "Permission level not found." });
      const nextConfig = { ...config, roles };
      await writeConfig(nextConfig);
      config = nextConfig;
      return json(res, 200, { ok: true });
    }
    if (url.pathname === "/api/apps" && req.method === "PATCH") {
      if (!requirePermission(session, res, "apps:manage")) return;
      const body = await readBody(req);
      if (!Array.isArray(body.apps) || body.apps.length !== DEFAULT_APPS.length) {
        return json(res, 400, { error: "Provide settings for each built-in app." });
      }
      const apps = DEFAULT_APPS.map((app) => {
        const submitted = body.apps.find((item) => item.id === app.id);
        if (!submitted || typeof submitted.enabled !== "boolean" || typeof submitted.public !== "boolean") {
          throw Object.assign(new Error("Each app requires enabled and public settings."), { status: 400 });
        }
        return { ...app, enabled: submitted.enabled, public: submitted.public };
      });
      let chatSettings = config.chatSettings;
      if (body.chatSettings !== undefined) {
        if (!body.chatSettings || typeof body.chatSettings !== "object") {
          return json(res, 400, { error: "Chat settings are invalid." });
        }
        const { domainId } = body.chatSettings;
        if (domainId !== null && !config.domains.some((domain) => domain.id === domainId)) {
          return json(res, 400, { error: "Choose an existing Chat domain." });
        }
        const chatPath = validateChatPath(body.chatSettings.path);
        const backendPath = body.chatSettings.backendPath === undefined
          ? config.chatSettings.backendPath
          : validateChatBackendPath(body.chatSettings.backendPath);
        if (chatModuleState.child && backendPath !== config.chatSettings.backendPath) {
          return json(res, 409, { error: "Stop the Chat backend before changing its path." });
        }
        chatSettings = { domainId, path: chatPath, backendPath };
      }
      const nextConfig = {
        ...config,
        apps,
        chatSettings,
        storageBackend: {
          ...config.storageBackend,
          enabled: apps.find((item) => item.id === "storage")?.enabled || false,
        },
        connect: {
          ...config.connect,
          enabled: apps.find((item) => item.id === "connect")?.enabled || false,
        },
      };
      await writeConfig(nextConfig);
      config = nextConfig;
      return json(res, 200, { apps, chatSettings });
    }
    if (url.pathname === "/api/apps" && req.method === "GET") {
      if (!requirePermission(session, res, "apps:view")) return;
      return json(res, 200, {
        apps: hasPermission(session, "apps:manage")
          ? config.apps
          : config.apps.filter((app) =>
            app.enabled &&
            app.public &&
            (app.id !== "chat" || hasPermission(session, "chat:use")) &&
            (app.id !== "storage" || hasPermission(session, "storage:use")) &&
            (app.id !== "connect" || hasPermission(session, "connect:use"))),
      });
    }
    if (url.pathname === "/api/platform" && req.method === "PATCH") {
      if (!roleFor(session)?.permissions.includes("*")) {
        return json(res, 403, { error: "Only an Elevated administrator can change platform settings." });
      }
      const body = await readBody(req);
      if (typeof body.selfSignup !== "boolean") {
        return json(res, 400, { error: "Self-signup must be enabled or disabled." });
      }
      const nextConfig = { ...config, selfSignup: body.selfSignup };
      await writeConfig(nextConfig);
      config = nextConfig;
      return json(res, 200, { selfSignup: config.selfSignup });
    }
    if (url.pathname === "/api/domains" && req.method === "GET") {
      if (!hasPermission(session, "domains:view") && !hasPermission(session, "apps:manage")) {
        return json(res, 403, { error: "Your account does not have permission to view domains." });
      }
      return json(res, 200, { tlds: config.tlds, domains: config.domains });
    }
    if (url.pathname === "/api/domains" && req.method === "POST") {
      if (!requirePermission(session, res, "domains:manage")) return;
      const body = await readBody(req);
      const tlds = [...config.tlds];
      const domains = [...config.domains];
      if (body.type === "tld") {
        if (tlds.length >= MAX_TLDS) return json(res, 409, { error: "The TLD limit has been reached." });
        const tld = validateDomainLabel(body.name);
        if (tlds.includes(tld)) return json(res, 409, { error: "That TLD already exists." });
        tlds.push(tld);
      } else if (body.type === "domain") {
        if (domains.length >= MAX_DOMAINS) return json(res, 409, { error: "The domain limit has been reached." });
        const label = validateDomainLabel(body.name);
        if (!tlds.includes(body.tld)) return json(res, 400, { error: "Choose an existing TLD." });
        if (domains.some((item) => item.name === label && item.parentId === null && item.tld === body.tld)) {
          return json(res, 409, { error: "That domain already exists." });
        }
        domains.push({ id: randomBytes(12).toString("hex"), name: label, tld: body.tld, parentId: null });
      } else if (body.type === "subdomain") {
        if (domains.length >= MAX_DOMAINS) return json(res, 409, { error: "The domain limit has been reached." });
        const parent = domains.find((item) => item.id === body.parentId);
        if (!parent) return json(res, 400, { error: "Choose an existing parent domain." });
        const label = validateDomainLabel(body.name);
        if (domains.some((item) => item.name === label && item.parentId === parent.id)) {
          return json(res, 409, { error: "That subdomain already exists." });
        }
        domains.push({ id: randomBytes(12).toString("hex"), name: label, tld: parent.tld, parentId: parent.id });
      } else {
        return json(res, 400, { error: "Choose whether to add a TLD, domain, or subdomain." });
      }
      const nextConfig = { ...config, tlds, domains };
      await writeConfig(nextConfig);
      config = nextConfig;
      return json(res, 201, { tlds, domains });
    }
    if (url.pathname === "/api/domains" && req.method === "DELETE") {
      if (!requirePermission(session, res, "domains:manage")) return;
      const body = await readBody(req);
      if (typeof body.tld === "string") {
        if (!config.tlds.includes(body.tld)) return json(res, 404, { error: "TLD not found." });
        if (config.domains.some((domain) => domain.tld === body.tld)) {
          return json(res, 409, { error: "Delete the domains using this TLD before removing it." });
        }
        const nextConfig = { ...config, tlds: config.tlds.filter((item) => item !== body.tld) };
        await writeConfig(nextConfig);
        config = nextConfig;
        return json(res, 200, { ok: true });
      }
      const removed = new Set([body.id]);
      let found = config.domains.some((domain) => domain.id === body.id);
      while (found) {
        found = false;
        for (const domain of config.domains) {
          if (domain.parentId && removed.has(domain.parentId) && !removed.has(domain.id)) {
            removed.add(domain.id);
            found = true;
          }
        }
      }
      if (!config.domains.some((domain) => removed.has(domain.id))) {
        return json(res, 404, { error: "Domain not found." });
      }
      const domains = config.domains.filter((domain) => !removed.has(domain.id));
      const hosts = config.hosts.filter((host) => !removed.has(host.domainId));
      const removedSites = config.sites.filter((site) => removed.has(site.domainId));
      const siteDirectories = removedSites.map(siteDirectory);
      const nextConfig = {
        ...config,
        domains,
        hosts,
        sites: config.sites.filter((site) => !removed.has(site.domainId)),
        chatSettings: removed.has(config.chatSettings.domainId)
          ? { ...config.chatSettings, domainId: null }
          : config.chatSettings,
      };
      await writeConfig(nextConfig);
      config = nextConfig;
      await Promise.all(siteDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
      return json(res, 200, { ok: true });
    }
    if (url.pathname.startsWith("/api/storage/")) {
      if (!canUseStorage(session)) return json(res, 403, { error: "Storage is disabled or unavailable for this account." });
      if (url.pathname === "/api/storage/files" && req.method === "GET") {
        return json(res, 200, { files: await storageBackend.list(session.userId) });
      }
      if (url.pathname === "/api/storage/file" && req.method === "GET") {
        const filename = url.searchParams.get("path");
        const bytes = await storageBackend.read(session.userId, filename);
        let content;
        try {
          content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        } catch {
          return json(res, 415, { error: "This file is binary. Download it to view it." });
        }
        return json(res, 200, { path: filename, content });
      }
      if (url.pathname === "/api/storage/download" && req.method === "GET") {
        const filename = url.searchParams.get("path");
        const bytes = await storageBackend.read(session.userId, filename);
        const safeFilename = encodeURIComponent(path.basename(filename)).replace(/['()]/g, (char) =>
          `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
        res.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Length": bytes.length,
          "Cache-Control": "no-store",
          "Content-Disposition": `attachment; filename*=UTF-8''${safeFilename}`,
          "X-Content-Type-Options": "nosniff",
        });
        return res.end(bytes);
      }
      if (url.pathname === "/api/storage/file" && req.method === "PUT") {
        const body = await readBody(req, 10 * 1024 * 1024 + 16_384);
        if (typeof body.content !== "string") return json(res, 400, { error: "File content must be text." });
        await storageBackend.write(session.userId, url.searchParams.get("path"), body.content);
        return json(res, 200, { ok: true });
      }
      if (url.pathname === "/api/storage/upload" && req.method === "POST") {
        const filename = url.searchParams.get("path");
        const bytes = await readBinaryBody(req, 10 * 1024 * 1024);
        await storageBackend.write(session.userId, filename, bytes);
        return json(res, 201, { ok: true, path: filename, size: bytes.length });
      }
      if (url.pathname === "/api/storage/folder" && req.method === "POST") {
        const body = await readBody(req);
        await storageBackend.createFolder(session.userId, body.path);
        return json(res, 201, { ok: true });
      }
      if (url.pathname === "/api/storage/item" && req.method === "DELETE") {
        await storageBackend.remove(session.userId, url.searchParams.get("path"));
        return json(res, 200, { ok: true });
      }
      if (url.pathname === "/api/storage/rename" && req.method === "POST") {
        const body = await readBody(req);
        await storageBackend.renameItem(session.userId, body.from, body.to);
        return json(res, 200, { ok: true });
      }
      return json(res, 404, { error: "Storage operation not found." });
    }
    if (url.pathname === "/api/connect/friends" && req.method === "GET") {
      if (!canUseConnect(session)) return json(res, 403, { error: "Connect is unavailable for this account." });
      const userById = new Map(config.users.map((user) => [user.id, user]));
      const visible = config.friendships.filter((friendship) =>
        friendship.requesterId === session.userId || friendship.recipientId === session.userId);
      const shape = (friendship) => {
        const otherId = friendship.requesterId === session.userId
          ? friendship.recipientId
          : friendship.requesterId;
        const user = userById.get(otherId);
        return {
          id: friendship.id,
          status: friendship.status,
          direction: friendship.requesterId === session.userId ? "outgoing" : "incoming",
          user: { id: user.id, username: user.username, displayName: user.displayName },
        };
      };
      return json(res, 200, {
        friends: visible.filter((item) => item.status === "accepted").map(shape),
        requests: visible.filter((item) => item.status === "pending").map(shape),
      });
    }
    if (url.pathname === "/api/connect/friends" && req.method === "POST") {
      if (!canUseConnect(session)) return json(res, 403, { error: "Connect is unavailable for this account." });
      const body = await readBody(req);
      const username = validateUsername(body.username);
      const recipient = config.users.find((user) => user.username === username);
      if (!recipient || recipient.id === session.userId) {
        return json(res, 404, { error: "That Jnet user is not available to add." });
      }
      const prior = config.friendships.find((item) =>
        (item.requesterId === session.userId && item.recipientId === recipient.id) ||
        (item.requesterId === recipient.id && item.recipientId === session.userId));
      if (prior?.status === "accepted") return json(res, 409, { error: "You are already friends." });
      if (prior?.recipientId === session.userId) {
        const friendship = { ...prior, status: "accepted" };
        const nextConfig = {
          ...config,
          friendships: config.friendships.map((item) => item.id === prior.id ? friendship : item),
        };
        await writeConfig(nextConfig);
        config = nextConfig;
        return json(res, 200, { friendship });
      }
      if (prior) return json(res, 409, { error: "A friend request is already pending." });
      if (config.friendships.length >= MAX_FRIENDSHIPS) {
        return json(res, 409, { error: "The Jnet friend request limit has been reached." });
      }
      const friendship = {
        id: randomBytes(16).toString("hex"),
        requesterId: session.userId,
        recipientId: recipient.id,
        status: "pending",
        createdAt: new Date().toISOString(),
      };
      const nextConfig = { ...config, friendships: [...config.friendships, friendship] };
      await writeConfig(nextConfig);
      config = nextConfig;
      return json(res, 201, { friendship: { id: friendship.id, status: friendship.status } });
    }
    const friendshipRoute = url.pathname.match(/^\/api\/connect\/friends\/([a-f0-9]{32})$/);
    if (friendshipRoute && req.method === "PATCH") {
      if (!canUseConnect(session)) return json(res, 403, { error: "Connect is unavailable for this account." });
      const body = await readBody(req);
      if (typeof body.accept !== "boolean") return json(res, 400, { error: "Choose whether to accept the friend request." });
      const friendship = config.friendships.find((item) => item.id === friendshipRoute[1]);
      if (!friendship || friendship.recipientId !== session.userId || friendship.status !== "pending") {
        return json(res, 404, { error: "Incoming friend request not found." });
      }
      const friendships = body.accept
        ? config.friendships.map((item) => item.id === friendship.id ? { ...item, status: "accepted" } : item)
        : config.friendships.filter((item) => item.id !== friendship.id);
      const nextConfig = { ...config, friendships };
      await writeConfig(nextConfig);
      config = nextConfig;
      return json(res, 200, { ok: true });
    }
    if (friendshipRoute && req.method === "DELETE") {
      if (!canUseConnect(session)) return json(res, 403, { error: "Connect is unavailable for this account." });
      const friendship = config.friendships.find((item) => item.id === friendshipRoute[1]);
      if (
        !friendship ||
        ![friendship.requesterId, friendship.recipientId].includes(session.userId)
      ) return json(res, 404, { error: "Friend connection not found." });
      const nextConfig = { ...config, friendships: config.friendships.filter((item) => item.id !== friendship.id) };
      await writeConfig(nextConfig);
      config = nextConfig;
      return json(res, 200, { ok: true });
    }
    if (url.pathname === "/api/connect/send" && req.method === "POST") {
      if (!canUseConnect(session)) return json(res, 403, { error: "Connect is unavailable for this account." });
      const body = await readBody(req);
      const recipient = config.users.find((user) => user.id === body.toUserId);
      const friendship = recipient && config.friendships.find((item) =>
        item.status === "accepted" &&
        ((item.requesterId === session.userId && item.recipientId === recipient.id) ||
          (item.requesterId === recipient.id && item.recipientId === session.userId)));
      if (!recipient || !friendship) return json(res, 403, { error: "Files can only be sent to an accepted Jnet friend." });
      const sourcePath = body.path;
      const content = await storageBackend.read(session.userId, sourcePath);
      const base = path.basename(sourcePath).slice(-100);
      const targetPath = `Connect/${config.users.find((user) => user.id === session.userId).username}/${randomBytes(4).toString("hex")}-${base}`;
      await storageBackend.write(recipient.id, targetPath, content);
      return json(res, 201, { ok: true, path: targetPath, size: content.length });
    }
    if (url.pathname === "/api/sites" && req.method === "GET") {
      if (!requirePermission(session, res, "hosting:manage")) return;
      return json(res, 200, { sites: config.sites, hosts: config.hosts, domains: config.domains });
    }
    if (url.pathname === "/api/sites/upload" && req.method === "POST") {
      if (!requirePermission(session, res, "hosting:manage")) return;
      if (config.sites.length >= MAX_SITES) return json(res, 409, { error: "The site limit has been reached." });
      if (!/^application\/(?:zip|x-zip-compressed)$/i.test(req.headers["content-type"] || "")) {
        return json(res, 415, { error: "Upload a ZIP archive." });
      }
      const domainId = url.searchParams.get("domainId");
      const domain = config.domains.find((item) => item.id === domainId);
      if (!domain) return json(res, 400, { error: "Choose an existing domain." });
      const title = String(url.searchParams.get("title") || "").trim();
      if (!title || title.length > 80 || /[\u0000-\u001f\u007f]/.test(title)) {
        return json(res, 400, { error: "Site titles must be 1 to 80 printable characters." });
      }
      const archive = await readBinaryBody(req, MAX_SITE_ARCHIVE_BYTES);
      const files = extractSiteZip(archive);
      const site = {
        id: randomBytes(16).toString("hex"),
        domainId: domain.id,
        title,
        files: [...files.keys()],
      };
      const directory = siteDirectory(site);
      const parentDirectory = path.dirname(directory);
      const temporaryDirectory = path.join(parentDirectory, `.${site.id}.upload`);
      await mkdir(parentDirectory, { recursive: true, mode: 0o700 });
      await mkdir(temporaryDirectory, { mode: 0o700 });
      try {
        for (const [filename, content] of files) {
          const target = path.resolve(temporaryDirectory, ...filename.split("/"));
          if (!target.startsWith(`${temporaryDirectory}${path.sep}`)) {
            throw new Error("The site archive contains an unsafe path.");
          }
          await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
          await writeFile(target, content, { flag: "wx", mode: 0o600 });
        }
        await rename(temporaryDirectory, directory);
        const nextConfig = { ...config, sites: [...config.sites, site] };
        try {
          await writeConfig(nextConfig);
        } catch (error) {
          await rm(directory, { recursive: true, force: true });
          throw error;
        }
        config = nextConfig;
      } catch (error) {
        await rm(temporaryDirectory, { recursive: true, force: true });
        throw error;
      }
      return json(res, 201, { site });
    }
    const siteRoute = url.pathname.match(/^\/api\/sites\/([a-f0-9]{32})(?:\/(files|file))?$/);
    if (siteRoute && siteRoute[2] === "files" && req.method === "GET") {
      if (!requirePermission(session, res, "hosting:manage")) return;
      const site = config.sites.find((item) => item.id === siteRoute[1]);
      if (!site) return json(res, 404, { error: "Site not found." });
      return json(res, 200, {
        site: {
          id: site.id,
          title: site.title,
          domainId: site.domainId,
          domain: domainName(config.domains.find((item) => item.id === site.domainId), config.domains, config.tlds),
        },
        files: site.files.map((filename) => ({ path: filename, editable: isEditableSiteFile(filename) })),
      });
    }
    if (siteRoute && siteRoute[2] === "file") {
      if (!requirePermission(session, res, "hosting:manage")) return;
      const site = config.sites.find((item) => item.id === siteRoute[1]);
      if (!site) return json(res, 404, { error: "Site not found." });
      const filename = validateSitePath(url.searchParams.get("path"));
      if (req.method === "GET") {
        if (!site.files.includes(filename) || !isEditableSiteFile(filename)) {
          return json(res, 404, { error: "Editable site file not found." });
        }
        const bytes = await readFile(siteFilePath(site, filename));
        let content;
        try {
          content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        } catch {
          return json(res, 415, { error: "This file is not valid UTF-8 text and cannot be edited." });
        }
        return json(res, 200, { path: filename, content });
      }
      if (req.method === "PUT") {
        if (!isEditableSiteFile(filename)) return json(res, 415, { error: "Only text site files can be edited." });
        const body = await readBody(req, MAX_SITE_FILE_BYTES + 16_384);
        if (
          typeof body.content !== "string" ||
          Buffer.byteLength(body.content, "utf8") > MAX_SITE_FILE_BYTES
        ) return json(res, 400, { error: "Site files are limited to 2 MB of UTF-8 text." });
        const exists = site.files.includes(filename);
        if (!exists && site.files.length >= MAX_SITE_FILES) {
          return json(res, 409, { error: "The site file limit has been reached." });
        }
        const target = siteFilePath(site, filename);
        await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
        const temporary = `${target}.${randomBytes(6).toString("hex")}.tmp`;
        await writeFile(temporary, body.content, { flag: "wx", mode: 0o600 });
        try {
          await rename(temporary, target);
          if (!exists) {
            const nextConfig = {
              ...config,
              sites: config.sites.map((item) => item.id === site.id
                ? { ...item, files: [...item.files, filename] }
                : item),
            };
            await writeConfig(nextConfig);
            config = nextConfig;
          }
        } catch (error) {
          await rm(temporary, { force: true });
          if (!exists) await rm(target, { force: true });
          throw error;
        }
        return json(res, 200, { ok: true, path: filename });
      }
      if (req.method === "DELETE") {
        if (filename === "index.html") return json(res, 400, { error: "A site must keep its index.html entry point." });
        if (!site.files.includes(filename)) return json(res, 404, { error: "Site file not found." });
        const nextConfig = {
          ...config,
          sites: config.sites.map((item) => item.id === site.id
            ? { ...item, files: item.files.filter((file) => file !== filename) }
            : item),
        };
        await writeConfig(nextConfig);
        config = nextConfig;
        await rm(siteFilePath(site, filename), { force: true });
        return json(res, 200, { ok: true });
      }
    }
    const deleteSiteRoute = url.pathname.match(/^\/api\/sites\/([a-f0-9]{32})$/);
    if (deleteSiteRoute && req.method === "DELETE") {
      if (!requirePermission(session, res, "hosting:manage")) return;
      const site = config.sites.find((item) => item.id === deleteSiteRoute[1]);
      if (!site) return json(res, 404, { error: "Site not found." });
      const nextConfig = { ...config, sites: config.sites.filter((item) => item.id !== site.id) };
      await writeConfig(nextConfig);
      config = nextConfig;
      await rm(siteDirectory(site), { recursive: true, force: true });
      return json(res, 200, { ok: true });
    }
    if (url.pathname === "/api/hosting" && req.method === "GET") {
      if (!requirePermission(session, res, "hosting:manage")) return;
      return json(res, 200, { hosts: config.hosts, domains: config.domains });
    }
    if (url.pathname === "/api/hosting" && req.method === "POST") {
      if (!requirePermission(session, res, "hosting:manage")) return;
      if (config.hosts.length >= MAX_HOSTS) return json(res, 409, { error: "The hosting limit has been reached." });
      const body = await readBody(req);
      const domain = config.domains.find((item) => item.id === body.domainId);
      if (!domain) return json(res, 400, { error: "Choose an existing domain." });
      const title = typeof body.title === "string" ? body.title.trim().slice(0, 80) : "";
      const content = typeof body.content === "string" ? body.content.slice(0, 8000) : "";
      if (!title || !content) return json(res, 400, { error: "A title and text content are required." });
      const host = { id: randomBytes(16).toString("hex"), domainId: domain.id, title, content };
      const nextConfig = { ...config, hosts: [...config.hosts, host] };
      await writeConfig(nextConfig);
      config = nextConfig;
      return json(res, 201, { host: { id: host.id, domainId: host.domainId, title: host.title } });
    }
    if (url.pathname === "/api/hosting" && req.method === "DELETE") {
      if (!requirePermission(session, res, "hosting:manage")) return;
      const body = await readBody(req);
      const hosts = config.hosts.filter((host) => host.id !== body.id);
      if (hosts.length === config.hosts.length) return json(res, 404, { error: "Hosted item not found." });
      const nextConfig = { ...config, hosts };
      await writeConfig(nextConfig);
      config = nextConfig;
      return json(res, 200, { ok: true });
    }
    if (url.pathname === "/api/hosted" && req.method === "GET") {
      if (!requirePermission(session, res, "domains:view")) return;
      const hosts = [...config.hosts, ...config.sites].map((host) => {
        const domain = config.domains.find((item) => item.id === host.domainId);
        return {
          id: host.id,
          title: host.title,
          domain: domain ? domainName(domain, config.domains, config.tlds) : "",
        };
      });
      return json(res, 200, { hosts });
    }
    if (url.pathname.startsWith(`${chatBase}/`)) {
      const action = url.pathname.slice(chatBase.length + 1);
      if (!["users", "conversations", "messages"].includes(action)) {
        return json(res, 404, { error: "Not found." });
      }
      if (!canUseChat(session)) return json(res, 403, { error: "Chat is unavailable for this account." });
      if (!config.chatBackend.enabled || !chatModuleState.child || !chatModuleState.token) {
        return json(res, 503, { error: "The Chat backend module is not running." });
      }
      const allowedMethod = req.method === "GET" || (
        req.method === "POST" && ["conversations", "messages"].includes(action)
      );
      if (!allowedMethod) return json(res, 405, { error: "Method not allowed." });
      const identity = chatIdentity(session);
      const users = config.users
        .filter((user) => {
          const role = config.roles.find((item) => item.id === user.roleId);
          return role && (role.permissions.includes("*") || role.permissions.includes("chat:use"));
        })
        .map(({ id, username, displayName }) => ({ id, username, displayName }));
      if (action === "messages" && req.method === "POST" &&
        !consumeLimit(chatMessageAttempts, identity.id, 60, 60_000)) {
        return json(res, 429, { error: "You are sending messages too quickly." });
      }
      const body = req.method === "POST" ? await readBody(req) : null;
      const payload = JSON.stringify({
        action,
        method: req.method,
        query: action === "messages" ? { conversation: url.searchParams.get("conversation") } : {},
        identity,
        users,
        body,
      });
      const signature = createHmac("sha256", chatModuleState.token).update(payload).digest("hex");
      try {
        const backendResponse = await fetch(
          `http://127.0.0.1:${config.chatBackend.port}${chatBase}/internal`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-jnet-module-signature": signature,
            },
            body: payload,
            signal: AbortSignal.timeout(5000),
          },
        );
        const result = await backendResponse.json();
        return json(res, backendResponse.status, result);
      } catch {
        chatModuleState.error = "The Chat backend did not respond to an internal request.";
        return json(res, 503, { error: "The Chat backend module is unavailable." });
      }
    }
    if (url.pathname === "/api/announcement" && req.method === "PUT") {
      if (!requirePermission(session, res, "announcements:manage")) return;
      const body = await readBody(req);
      const text = typeof body.text === "string" ? body.text.trim().slice(0, 500) : "";
      const color = typeof body.color === "string" && /^#[0-9a-f]{6}$/i.test(body.color) ? body.color : "#304b68";
      const image = typeof body.image === "string" ? body.image : "";
      if (image && image.length > 180_000) return json(res, 400, { error: "Announcement image is too large." });
      if (image && !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image)) {
        return json(res, 400, { error: "Use a PNG, JPEG, or WebP image upload." });
      }
      const nextConfig = { ...config, announcement: { enabled: body.enabled === true && Boolean(text), text, color, image } };
      await writeConfig(nextConfig);
      config = nextConfig;
      return json(res, 200, { announcement: config.announcement });
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
      const chatDomain = config.chatSettings.domainId
        ? config.domains.find((domain) => domain.id === config.chatSettings.domainId)
        : null;
      const chatAppUrl = chatDomain
        ? `/domain/${domainName(chatDomain, config.domains, config.tlds)}${config.chatSettings.path}`
        : null;
      if (req.method === "GET" && (
        url.pathname === "/" ||
        url.pathname === "/admin" ||
        /^\/app\/(?:browser|wisp-browser|chat|storage|connect)$/.test(url.pathname) ||
        /^\/site-editor\/[a-f0-9]{32}$/.test(url.pathname) ||
        url.pathname === chatAppUrl
      )) {
        const body = await readFile(path.join(root, "public", "index.html"));
        const browserApp = /^\/app\/(?:browser|wisp-browser)$/.test(url.pathname);
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Length": body.length,
          "Cache-Control": "no-cache",
          ...(browserApp ? {
            "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src http: https:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
          } : {}),
        });
        return res.end(body);
      }
      if (req.method === "GET" && url.pathname === "/announcement.css") {
        const body = `#announcement-banner{background-color:${config.announcement.color}}`;
        res.writeHead(200, {
          "Content-Type": "text/css; charset=utf-8",
          "Content-Length": Buffer.byteLength(body),
          "Cache-Control": "no-store",
        });
        return res.end(body);
      }
      const hostedRoute = url.pathname.match(/^\/site\/([a-f0-9]{32})(?:\/(.*))?$/);
      const domainRoute = url.pathname.match(/^\/domain\/([a-z0-9.-]+)$/i);
      if ((hostedRoute || domainRoute) && req.method === "GET") {
        const domain = domainRoute
          ? config.domains.find((item) =>
            domainName(item, config.domains, config.tlds) === domainRoute[1].toLowerCase())
          : null;
        const site = hostedRoute
          ? config.sites.find((item) => item.id === hostedRoute[1])
          : config.sites.find((item) => item.domainId === domain?.id);
        if (site) {
          if (domainRoute) {
            res.writeHead(302, { Location: `/site/${site.id}/index.html`, "Cache-Control": "no-store" });
            return res.end();
          }
          let requestedPath = "index.html";
          if (hostedRoute?.[2]) {
            try {
              requestedPath = decodeURIComponent(hostedRoute[2]);
            } catch {
              return json(res, 400, { error: "Site path is invalid." });
            }
          }
          const safePath = validateSitePath(requestedPath);
          if (!site.files.includes(safePath)) return json(res, 404, { error: "Site file not found." });
          const body = await readFile(siteFilePath(site, safePath));
          res.writeHead(200, {
            "Content-Type": siteMimeType(safePath),
            "Content-Length": body.length,
            "Cache-Control": "no-store",
            "Content-Security-Policy": "default-src 'self'; script-src 'none'; style-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; frame-ancestors 'self'",
            "X-Frame-Options": "SAMEORIGIN",
            "X-Content-Type-Options": "nosniff",
            "Content-Disposition": "inline",
          });
          return res.end(body);
        }
        const host = hostedRoute
          ? config.hosts.find((item) => item.id === hostedRoute[1])
          : config.hosts.find((item) => item.domainId === domain?.id);
        if (!host) return json(res, 404, { error: "Hosted item not found." });
        const body = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(host.title)}</title><h1>${escapeHtml(host.title)}</h1><pre>${escapeHtml(host.content)}</pre></html>`;
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Length": Buffer.byteLength(body),
          "Cache-Control": "no-cache",
          "X-Frame-Options": "SAMEORIGIN",
          "Content-Security-Policy": "default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
        });
        return res.end(body);
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

  const scramjetAssets = new Map([
    ["/sw.js", ["scramjet-sw.js", "text/javascript; charset=utf-8"]],
    ["/assets/app.css", ["app.css", "text/css; charset=utf-8"]],
    ["/assets/browser.js", ["browser.js", "text/javascript; charset=utf-8"]],
    ["/assets/scramjet-app.js", ["scramjet-app.js", "text/javascript; charset=utf-8"]],
    ["/scramjet/scramjet.js", ["node_modules/@mercuryworkshop/scramjet/dist/scramjet.js", "text/javascript; charset=utf-8"]],
    ["/scramjet/scramjet.wasm", ["node_modules/@mercuryworkshop/scramjet/dist/scramjet.wasm", "application/wasm"]],
    ["/controller/controller.api.js", ["node_modules/@mercuryworkshop/scramjet-controller/dist/controller.api.js", "text/javascript; charset=utf-8"]],
    ["/controller/controller.inject.js", ["node_modules/@mercuryworkshop/scramjet-controller/dist/controller.inject.js", "text/javascript; charset=utf-8"]],
    ["/controller/controller.sw.js", ["node_modules/@mercuryworkshop/scramjet-controller/dist/controller.sw.js", "text/javascript; charset=utf-8"]],
    ["/libcurl/index.js", ["node_modules/@mercuryworkshop/libcurl-transport/dist/index.js", "text/javascript; charset=utf-8"]],
  ]);
  function canUseScramjet(session) {
    const app = config.apps.find((item) => item.id === "wisp-browser");
    return Boolean(
      session &&
      app?.enabled &&
      (app.public || hasPermission(session, "apps:manage")),
    );
  }
  function getScramjetSession(req) {
    const session = sessionFor(req);
    return canUseScramjet(session) ? session : null;
  }
  const scramjetServer = createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    try {
      const authority = req.headers.host || "";
      if (!/^(?:[a-z0-9.-]+|\[[0-9a-f:.]+\])(?::\d{1,5})?$/i.test(authority)) {
        return res.writeHead(400).end();
      }
      const url = new URL(req.url || "/", `http://${authority}`);
      const session = getScramjetSession(req);
      if (!session) {
        res.writeHead(401, { "Content-Type": "text/plain; charset=utf-8" });
        return res.end("Sign in to Jnet and launch Scramjet Browser again.");
      }
      if (req.method !== "GET") {
        res.writeHead(405, { Allow: "GET", "Content-Type": "text/plain; charset=utf-8" });
        return res.end("Method not allowed.");
      }
      if (url.pathname === "/") {
        const body = await readFile(path.join(root, "public", "scramjet.html"));
        const websocketScheme = req.socket.encrypted || secureCookies ? "wss" : "ws";
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Length": body.length,
          "Content-Security-Policy": `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data:; connect-src 'self' ${websocketScheme}://${authority}; frame-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`,
          "X-Frame-Options": "DENY",
          "Service-Worker-Allowed": "/",
        });
        return res.end(body);
      }
      if (url.pathname === "/session") {
        return json(res, 200, {
          userId: session.userId,
          wispStatus: config.wisp.enabled ? moduleState.status : "disabled",
        });
      }
      const asset = scramjetAssets.get(url.pathname);
      if (!asset) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        return res.end("Not found.");
      }
      const file = path.join(
        root,
        asset[0].startsWith("node_modules/") ? asset[0] : path.join("public", asset[0]),
      );
      const body = await readFile(file);
      res.writeHead(200, {
        "Content-Type": asset[1],
        "Content-Length": body.length,
        ...(url.pathname === "/sw.js" ? { "Service-Worker-Allowed": "/" } : {}),
      });
      return res.end(body);
    } catch (error) {
      if (!res.headersSent) {
        res.writeHead(error.code === "ENOENT" ? 404 : 500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(error.code === "ENOENT" ? "Not found." : "The Scramjet request could not be completed.");
      } else {
        res.destroy();
      }
    }
  });
  scramjetServer.on("upgrade", (req, socket, head) => {
    let url;
    try {
      url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    } catch {
      socket.destroy();
      return;
    }
    if (url.pathname !== "/wisp/" || url.search) {
      socket.destroy();
      return;
    }
    if (!checkScramjetOrigin(req)) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    const session = getScramjetSession(req);
    if (!session) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    if (!config.wisp.enabled || !moduleState.child) {
      socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    const headers = {
      Connection: "Upgrade",
      Upgrade: "websocket",
      "Sec-WebSocket-Key": req.headers["sec-websocket-key"] || "",
      "Sec-WebSocket-Version": req.headers["sec-websocket-version"] || "13",
    };
    if (req.headers["sec-websocket-protocol"]) {
      headers["Sec-WebSocket-Protocol"] = req.headers["sec-websocket-protocol"];
    }
    let upgraded = false;
    const upstreamRequest = createHttpRequest({
      host: "127.0.0.1",
      port: config.wisp.port,
      path: config.wisp.path,
      method: "GET",
      headers,
    });
    upstreamRequest.once("upgrade", (response, upstreamSocket, upstreamHead) => {
      if (response.statusCode !== 101 || !sessions.has(session.token)) {
        upstreamSocket.destroy();
        socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
        return;
      }
      const accept = response.headers["sec-websocket-accept"];
      if (typeof accept !== "string") {
        upstreamSocket.destroy();
        socket.destroy();
        return;
      }
      upgraded = true;
      const responseHeaders = [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${accept}`,
      ];
      const protocol = response.headers["sec-websocket-protocol"];
      if (typeof protocol === "string") responseHeaders.push(`Sec-WebSocket-Protocol: ${protocol}`);
      socket.write(`${responseHeaders.join("\r\n")}\r\n\r\n`);
      if (upstreamHead.length) socket.write(upstreamHead);
      if (head.length) upstreamSocket.write(head);
      let sessionSockets = scramjetSockets.get(session.token);
      if (!sessionSockets) {
        sessionSockets = new Set();
        scramjetSockets.set(session.token, sessionSockets);
      }
      sessionSockets.add(socket);
      const cleanup = () => {
        upstreamSocket.destroy();
        sessionSockets.delete(socket);
        if (!sessionSockets.size) scramjetSockets.delete(session.token);
      };
      socket.once("close", cleanup);
      socket.once("error", cleanup);
      upstreamSocket.once("close", () => socket.destroy());
      upstreamSocket.once("error", () => socket.destroy());
      socket.pipe(upstreamSocket);
      upstreamSocket.pipe(socket);
    });
    upstreamRequest.once("response", (response) => {
      response.resume();
      if (!upgraded && !socket.destroyed) {
        socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      }
    });
    upstreamRequest.once("error", () => {
      if (!upgraded && !socket.destroyed) {
        socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      }
    });
    socket.once("close", () => {
      if (!upgraded) upstreamRequest.destroy();
    });
    upstreamRequest.end();
  });

  server.on("close", () => {
    closeAllScramjetSessions();
    if (scramjetServer.listening) scramjetServer.close();
    void stopModule();
    void stopChatModule();
  });

  return { server, scramjetServer, host, port, scramjetPort, dataDir: dataRoot };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const app = await createJNetServer();
  app.server.listen(app.port, app.host, () => {
    console.log(`Jnet admin is listening at http://${app.host}:${app.port}/admin`);
    console.log(`Private application data: ${app.dataDir}`);
  });
  app.scramjetServer.listen(app.scramjetPort, app.host, () => {
    console.log(`Scramjet Browser is listening on isolated port ${app.scramjetPort}`);
  });
  const shutdown = () => app.server.close();
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
