# RemodexOnAnyDevices

[English](README.md) | [Chinese](README-zh.md)

RemodexOnAnyDevices is a cross-platform version of [remodex](https://github.com/Emanuele-web04/remodex). It enables you to keep vibe coding from your phone at the gym or to use Codex-app on your remote server (which is not directly supported by the official Codex app). It keeps the Codex runtime on your own machine and expands the client surface so the project can be used across any platforms and browser-based workflows without reintroducing hosted-service assumptions.

The upstream ISC license is preserved in [LICENSE](LICENSE).

## Demo

<div align="center">
  <img src="assets/demo(1).jpg" alt="demo1" width="20%" style="margin: 10px;">
  <img src="assets/demo(2).jpg" alt="demo2" width="20%" style="margin: 10px;">
  <img src="assets/demo(3).jpg" alt="demo3" width="60%" style="margin: 10px;">
</div>

## Differences between remodex

- login via password (no need to QR pairing)
- trusted reconnects, and local bridge sessions
- better support windows and linux deployment

## Details

This repository currently contains:

- `phodex-bridge/`: the local Node.js bridge that speaks to Codex
- `web-client/`: a local web UI for pairing, thread browsing, and chat
- `relay/`: the relay service used by local/self-hosted setups

## Quick Start

### Bridge

```sh
cd phodex-bridge
npm install
npm start
```

### Web Client

```sh
cd web-client
npm install
npm run set-password -- --generate --write-plaintext
npm start
```

Then open `http://127.0.0.1:8787`.

## Admin Password

The web UI uses a local admin password.

- Recommended: `npm run set-password -- --generate --write-plaintext`
- This generates a strong password, stores the hash in `web-client/state/auth-state.json`, and writes the plaintext password to `web-client/state/admin-password.txt`
- You can also set your own password with `npm run set-password -- --password "<strong password>"`
- The script also accepts `REMODEX_WEB_ADMIN_PASSWORD` if you prefer supplying it through an environment variable

## Deployment Options

You do not have to expose everything directly to the public internet. The practical options are:

### 1. Local LAN / same-network setup

Use the built-in local relay helper and advertise a hostname or IP that your phone can actually reach on the same network:

```sh
./run-local-remodex.sh --hostname <reachable-lan-ip-or-hostname> --port 9000
```

Then start the web client locally and use the generated password to sign in.

This is the simplest setup when your phone and the machine running Codex are on the same LAN or Wi-Fi.

### 2. Windows or local desktop + public relay

Yes, this is supported by the current architecture.

- Run `relay/` on a host that has a public IP or public domain
- Start `phodex-bridge/` on your Windows, macOS, or Linux machine where Codex actually runs
- Point the bridge at that relay with `REMODEX_RELAY`
- Run `web-client/` wherever you want the browser UI to live, usually on the same machine as the bridge

Example bridge startup:

```sh
cd phodex-bridge
npm install
REMODEX_RELAY=wss://your-linux-host.example.com/relay npm start
```

Example relay startup on Linux:

```sh
cd relay
npm install
npm start
```

In this mode, Codex and your repository stay on your own machine. The Linux box is only the relay transport hop.

### 3. Private access with Tailscale instead of public exposure

If you do not want to open ports to the public internet, Tailscale is usually the cleanest option.

Typical setup:

1. Install Tailscale on the machine running the relay or the all-in-one local launcher
2. Install Tailscale on the phone and log it into the same tailnet
3. Use the machine's Tailscale IP or MagicDNS name as the relay hostname
4. Start the relay/bridge with that reachable Tailscale hostname

Example:

```sh
./run-local-remodex.sh --hostname <your-machine-tailnet-name-or-tailscale-ip> --port 9000
```

Or, if the relay is separate:

```sh
cd phodex-bridge
REMODEX_RELAY=ws://<relay-tailnet-name-or-tailscale-ip>:9000/relay npm start
```

If you also want the web UI to be reachable only inside your tailnet, start the web client normally and expose `8787` through Tailscale Serve on that machine. Recent Tailscale versions use:

```sh
tailscale serve localhost:8787
```

That keeps the web UI private to your tailnet. If you instead need a public internet URL, Tailscale Funnel is the public-sharing feature, but that is different from the private tailnet-only flow above.

## Web Client Notes

The web client is intended for local administration and chat access against your own running bridge:

- it reads pairing JSON from a local file
- it keeps auth/security state under `web-client/state/`
- it does not assume any hosted backend
- it now includes a mobile-oriented chat layout instead of a desktop-only squeeze-down

See [web-client/README.md](web-client/README.md) for details.
