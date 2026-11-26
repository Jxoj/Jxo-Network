# Jxo-Network

Jnet is a local network-service manager with account and role administration,
configurable apps, virtual domains, isolated site hosting, private user storage,
announcements, and managed service modules.

## Run

Requires Node.js 22.12 or newer (required by the maintained Wisp package). From
this directory, run:

```sh
npm start
```

Open [http://127.0.0.1:8080/admin](http://127.0.0.1:8080/admin) to sign in
with an Elevated administrator account. Regular users sign in from the public
homepage at [http://127.0.0.1:8080/](http://127.0.0.1:8080/). The admin server
uses port `8080` by default. Change its saved port in **Settings**; restart
Jnet to apply the change. The `PORT` environment variable overrides the saved
setting. On first run, read the one-time setup key
from the server filesystem at `JNET_DATA_DIR/key` (default `~/.jnet/key`), then
enter it in the local setup form to create your Elevated administrator account.
The key is never available over HTTP and is consumed during setup. **Settings**
can reset the administrator credential, writing a replacement key to the same
server-side file and signing out all active sessions.

Jnet binds to `127.0.0.1` by default. Its private configuration and module files
are stored in `~/.jnet` (or the directory set with `JNET_DATA_DIR`). To listen on
a different interface, set `JNET_HOST` before starting. Exposing the admin
console beyond the local machine should only be done behind a properly
configured HTTPS reverse proxy and firewall.
When TLS terminates at a trusted reverse proxy, set `JNET_SECURE_COOKIES=1` so
the admin session cookie is marked Secure.

## Accounts and apps

Users can be assigned the built-in Normal or Elevated permission level, or a
custom role with specific permissions. Elevated users have full administrative
access. Administrators can enable self-signup in **Settings**; new signups
receive Normal access. When enabled, the public homepage offers a switch
between sign-in and account creation. Private apps remain available only to
administrators in **Launch**.

The included apps are **Browser**, **Chat**, **Connect**, **Storage**, and
**Scramjet Browser**. Storage is disabled by default; once enabled by an
administrator, Normal users can manage their own private files. It supports
uploads, folders, text editing, downloads, renaming, and deletion. Connect
supports friend requests and sending a Storage file to an accepted friend.
Connect's public API is disabled by default. Chat supports direct messages and
groups through the chat-backend module. Chat messages are stored as plaintext
in the private Jnet data directory and are not end-to-end encrypted.

Browser and Scramjet Browser open as standalone apps with separate tabs and
per-account, per-browser bookmarks stored locally in the browser. Browser runs
public HTTP(S) pages in sandboxed frames. Scramjet Browser uses the Scramjet
rewriter and sends its network traffic through the managed Wisp module.

Scramjet Browser runs on a separate origin at port `8092` by default (change it
in **Settings**). That listener serves only the browser shell, Scramjet assets,
and its authenticated Wisp relay; it does not serve Jnet APIs. The relay checks
the Jnet session and same-origin WebSocket request, and does not forward the
Jnet cookie to the Wisp module. Wisp is restricted to public TCP ports 80/443;
private and loopback IP destinations and UDP are blocked. Remote users need
HTTPS on both the Jnet and Scramjet ports (or use localhost during development)
for the service worker to work. A reverse proxy must expose the Scramjet port
with TLS when Jnet is deployed behind HTTPS.

## Domains, hosting, and announcements

The **Domains** section lets administrators create logical TLDs, domains, and
subdomains. These names are internal to Jnet and do not configure public DNS.
The **Sites** section lets administrators upload a ZIP site to a logical
domain, edit its files, and preview it. Hosted site responses disable scripts
and external network connections. The preview is sandboxed. Administrators can
also configure a homepage announcement banner, including its message, color,
and optional image; updates appear on open pages within about five seconds.

The interface includes a persistent per-browser dark-mode preference. App
launches open in a new tab. Browser apps accept public HTTP(S) URLs and reject
known local/private addresses.

## Wisp module

The Wisp module can be downloaded, enabled, started, stopped, restarted, and
configured from **Modules**. Downloading installs the pinned
`@mercuryworkshop/wisp-js` package under `modules/wisp` in the private data
directory and creates `modules/wisp/main.js`, the managed Wisp server entry
point. It binds to `127.0.0.1` on port `8090` and accepts WebSocket connections
at `/wisp/v1/connection` by default. Change the listener port and URL path using
the module's **Module settings** button. Downloading requires an internet
connection; an installed module can be run without one.

Wisp is a proxy service, not an offline cache or a complete offline internet
replacement. Keep it bound to loopback unless you have deliberately configured
and secured the network access you need.

## Chat backend module

The managed Chat backend module runs as a separate child process, binds to
`127.0.0.1:8091` by default, and is configured from **Modules**. Jnet proxies
authorized Chat requests to it over loopback using per-process HMAC signatures.
The module entry point is installed at `modules/chat-backend/main.js` in the
private data directory. Its JSON data file is private to the server. Module
status changes are streamed to authorized admin pages and appear without a
manual refresh.

## Security notes

- Admin keys are generated with the operating system's cryptographic random
  source. The bootstrap key file is mode-restricted and is never exposed over
  HTTP; access it directly through the server filesystem.
- Admin credentials are stored as salted scrypt hashes. Sessions use
  HttpOnly, SameSite cookies, origin checks, and per-session CSRF tokens.
- Account passwords must be 8–128 characters. The one-time setup key is stored
  with restrictive file permissions and is never served over HTTP.
- The server uses a restrictive content security policy, request-size limits,
  and login throttling. Its default bind address and the Wisp bind address are
  both loopback.
- Hosted domains are logical Jnet routes, not DNS or network isolation.
- Chat access is authorization-checked per conversation, but chat data is
  plaintext at rest and is not end-to-end encrypted.
- Keep the data directory private and make regular backups of your configuration.
