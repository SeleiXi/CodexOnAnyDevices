# RemodexOnAnyDevices

RemodexOnAnyDevices is a local-first fork/rework of [Emanuele-web04/remodex](https://github.com/Emanuele-web04/remodex). It keeps the Codex runtime on your own machine and expands the client surface so the project can be used across iPhone and browser-based workflows without reintroducing hosted-service assumptions.

This repository currently contains:

- `phodex-bridge/`: the local Node.js bridge that speaks to Codex
- `CodexMobile/`: the SwiftUI iOS client
- `web-client/`: a local web UI for pairing, thread browsing, and chat
- `relay/`: the relay service used by local/self-hosted setups

## Upstream Attribution

This project is derived from the original Remodex work by Emanuele Di Pietro:

- Upstream repository: <https://github.com/Emanuele-web04/remodex>
- Upstream license: ISC

The upstream ISC license is preserved in this fork. See [LICENSE](LICENSE).

## Current Focus

- Keep the project local-first and self-host friendly
- Avoid hardcoded production domains or hosted-only workflows
- Support QR pairing, trusted reconnects, and local bridge sessions
- Improve browser/mobile usability without changing the underlying local control model

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

## Repository Notes

- Local state, pairing payloads, session logs, and generated admin credentials are intentionally ignored and should not be committed
- If you publish or redistribute this fork, keep the upstream license notice intact
- If you want the original project context and broader app architecture, review the upstream repository and this repo's source side-by-side
