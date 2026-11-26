import { randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, readdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_USER_BYTES = 100 * 1024 * 1024;
const MAX_USER_FILES = 2000;

function safePath(value) {
  if (
    typeof value !== "string" ||
    !value.length ||
    value.length > 240 ||
    value.includes("\\") ||
    value.includes("\0") ||
    value.startsWith("/") ||
    /^[a-zA-Z]:/.test(value)
  ) throw Object.assign(new Error("Choose a safe relative file path."), { status: 400 });
  const segments = value.split("/");
  if (segments.some((part) =>
    !part ||
    part === "." ||
    part === ".." ||
    !/^[\p{L}\p{N}._ -]+$/u.test(part) ||
    part.endsWith(".") ||
    part.endsWith(" "))) {
    throw Object.assign(new Error("Choose a safe relative file path."), { status: 400 });
  }
  return segments.join("/");
}

async function ensureDirectory(directory) {
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw Object.assign(new Error("Storage contains an unsafe directory entry."), { status: 400 });
  }
  await chmod(directory, 0o700);
}

export async function createStorageBackend(dataDirectory) {
  const root = path.resolve(dataDirectory);
  await mkdir(root, { recursive: true, mode: 0o700 });
  await ensureDirectory(root);
  await realpath(root);

  function userRoot(userId) {
    if (!/^[a-f0-9]{32}$/.test(userId || "")) {
      throw Object.assign(new Error("Storage account identity is invalid."), { status: 400 });
    }
    return path.join(root, userId);
  }

  async function resolve(userId, relativePath, createParents = false) {
    const rootDirectory = userRoot(userId);
    await ensureDirectory(rootDirectory);
    const safe = safePath(relativePath);
    const target = path.resolve(rootDirectory, ...safe.split("/"));
    if (!target.startsWith(`${rootDirectory}${path.sep}`)) {
      throw Object.assign(new Error("File path is outside account storage."), { status: 400 });
    }
    const segments = safe.split("/");
    let current = rootDirectory;
    for (const segment of segments.slice(0, -1)) {
      current = path.join(current, segment);
      if (createParents) await ensureDirectory(current);
      else {
        let info;
        try {
          info = await lstat(current);
        } catch (error) {
          if (error.code === "ENOENT") {
            throw Object.assign(new Error("Storage item not found."), { status: 404 });
          }
          throw error;
        }
        if (!info.isDirectory() || info.isSymbolicLink()) {
          throw Object.assign(new Error("Storage path contains an unsafe directory."), { status: 400 });
        }
      }
    }
    return { root: rootDirectory, safe, target };
  }

  async function list(userId) {
    const directory = userRoot(userId);
    await ensureDirectory(directory);
    const items = [];
    let totalBytes = 0;
    async function walk(current, relative = "", depth = 0) {
      if (depth > 12) throw Object.assign(new Error("Storage folder nesting limit reached."), { status: 413 });
      const entries = await readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        if (items.length >= MAX_USER_FILES + 1000) {
          throw Object.assign(new Error("Storage contains too many files and folders."), { status: 413 });
        }
        if (entry.isSymbolicLink()) {
          throw Object.assign(new Error("Storage contains a symbolic link; remove it from the server filesystem."), { status: 400 });
        }
        const itemPath = safePath(relative ? `${relative}/${entry.name}` : entry.name);
        const absolute = path.join(current, entry.name);
        const info = await lstat(absolute);
        if (info.isDirectory()) {
          items.push({ path: itemPath, type: "folder", size: 0, updatedAt: info.mtime.toISOString() });
          await walk(absolute, itemPath, depth + 1);
        } else if (info.isFile()) {
          totalBytes += info.size;
          if (items.length >= MAX_USER_FILES || totalBytes > MAX_USER_BYTES) {
            throw Object.assign(new Error("Storage quota has been exceeded."), { status: 413 });
          }
          items.push({ path: itemPath, type: "file", size: info.size, updatedAt: info.mtime.toISOString() });
        } else {
          throw Object.assign(new Error("Storage contains an unsupported file type."), { status: 400 });
        }
      }
    }
    await walk(directory);
    return items.sort((left, right) => left.path.localeCompare(right.path));
  }

  async function read(userId, relativePath) {
    const { target } = await resolve(userId, relativePath);
    let info;
    try {
      info = await lstat(target);
    } catch (error) {
      if (error.code === "ENOENT") throw Object.assign(new Error("Storage file not found."), { status: 404 });
      throw error;
    }
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_FILE_BYTES) {
      throw Object.assign(new Error("File cannot be read from storage."), { status: 400 });
    }
    return readFile(target);
  }

  async function write(userId, relativePath, content) {
    if (!Buffer.isBuffer(content)) content = Buffer.from(String(content), "utf8");
    if (content.length > MAX_FILE_BYTES) {
      throw Object.assign(new Error("Storage files are limited to 10 MB."), { status: 413 });
    }
    const items = await list(userId);
    const existing = items.find((item) => item.path === safePath(relativePath));
    if (!existing && items.filter((item) => item.type === "file").length >= MAX_USER_FILES) {
      throw Object.assign(new Error("The storage file limit has been reached."), { status: 413 });
    }
    const total = items.reduce((sum, item) => sum + item.size, 0);
    if (total - (existing?.size || 0) + content.length > MAX_USER_BYTES) {
      throw Object.assign(new Error("The storage account is limited to 100 MB."), { status: 413 });
    }
    const { target } = await resolve(userId, relativePath, true);
    const temporary = `${target}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(temporary, content, { flag: "wx", mode: 0o600 });
    try {
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }

  async function createFolder(userId, relativePath) {
    const { target } = await resolve(userId, relativePath, true);
    try {
      await mkdir(target, { mode: 0o700 });
    } catch (error) {
      if (error.code === "EEXIST") throw Object.assign(new Error("A file or folder already exists at that path."), { status: 409 });
      throw error;
    }
  }

  async function remove(userId, relativePath) {
    const { target } = await resolve(userId, relativePath);
    let info;
    try {
      info = await lstat(target);
    } catch (error) {
      if (error.code === "ENOENT") throw Object.assign(new Error("Storage item not found."), { status: 404 });
      throw error;
    }
    if (info.isSymbolicLink()) throw Object.assign(new Error("Symbolic links cannot be deleted through Storage."), { status: 400 });
    await rm(target, { recursive: info.isDirectory(), force: false });
  }

  async function renameItem(userId, fromPath, toPath) {
    const source = await resolve(userId, fromPath);
    const destination = await resolve(userId, toPath, true);
    const info = await lstat(source.target);
    if (info.isSymbolicLink()) throw Object.assign(new Error("Symbolic links cannot be renamed through Storage."), { status: 400 });
    try {
      await lstat(destination.target);
      throw Object.assign(new Error("A file or folder already exists at that path."), { status: 409 });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await rename(source.target, destination.target);
  }

  async function deleteUser(userId) {
    const directory = userRoot(userId);
    await ensureDirectory(directory);
    await rm(directory, { recursive: true, force: true });
  }

  return { list, read, write, createFolder, remove, renameItem, deleteUser };
}
