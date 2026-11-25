# Jxo-Network

JNet is a local network-service manager. The initial release provides a protected
admin console and controls for a separately managed Wisp server process.

## Run

Requires Node.js 22.12 or newer (required by the maintained Wisp package). From
this directory, run:

```sh
npm start
```

Open [http://127.0.0.1:5060/admin](http://127.0.0.1:5060/admin). On first run,
open [http://127.0.0.1:5060/key](http://127.0.0.1:5060/key) on the same machine
to retrieve the generated setup key. The key is removed after the first
successful sign-in; JNet stores a salted hash thereafter. Save the key somewhere
safe, or rotate it later under **Settings**.

JNet binds to `127.0.0.1` by default. Its private configuration and module files
are stored in `~/.jnet` (or the directory set with `JNET_DATA_DIR`). To listen on
a different interface, set `JNET_HOST` before starting. Exposing the admin
console beyond the local machine should only be done behind a properly
configured HTTPS reverse proxy and firewall.
When TLS terminates at a trusted reverse proxy, set `JNET_SECURE_COOKIES=1` so
the admin session cookie is marked Secure.

## Wisp module

The Wisp module can be downloaded, enabled, started, stopped, restarted, and
configured from **Modules** and **Settings**. JNet pins the maintained
`@mercuryworkshop/wisp-js` package and disables npm install scripts. The Wisp
process binds to `127.0.0.1` on port `5001` by default; change its port and
managed relative path in Settings. Downloading requires an internet connection;
an installed module can be run without one.

Wisp is a proxy service, not an offline cache or a complete offline internet
replacement. Keep it bound to loopback unless you have deliberately configured
and secured the network access you need.

## Security notes

- Admin keys are generated with the operating system's cryptographic random
  source. The bootstrap key file is mode-restricted and can only be retrieved
  from a loopback connection before initial setup.
- Admin credentials are stored as salted scrypt hashes. Sessions use
  HttpOnly, SameSite cookies, origin checks, and per-session CSRF tokens.
- The server uses a restrictive content security policy, request-size limits,
  and login throttling. Its default bind address and the Wisp bind address are
  both loopback.
- Keep the data directory private and make regular backups of your configuration.
