# RemodexOnAnyDevices

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
- `CodexMobile/`: the SwiftUI iOS client
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
npm run set-password -- --generate
npm start
```

Then open `http://127.0.0.1:8787`.

## Web Client Notes

The web client is intended for local administration and chat access against your own running bridge:

- it reads pairing JSON from a local file
- it keeps auth/security state under `web-client/state/`
- it does not assume any hosted backend
- it now includes a mobile-oriented chat layout instead of a desktop-only squeeze-down

See [web-client/README.md](web-client/README.md) for details.
