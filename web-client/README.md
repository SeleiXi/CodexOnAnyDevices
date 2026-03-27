# Remodex Web Client

Minimal browser frontend for the Remodex bridge.

## What it does

- Connects to the existing Remodex relay with a QR pairing payload
- Completes the secure handshake server-side
- Lists threads
- Creates new chats
- Sends text prompts
- Polls `thread/read` to render the conversation in the browser

## Start

```sh
cd web-client
npm install
npm run set-password -- --generate
npm start
```

Open `http://127.0.0.1:8787`.

The password command writes a strong admin password hash to `web-client/state/auth-state.json`.
If you add `--write-plaintext`, it also writes the generated password to `web-client/state/admin-password.txt`.

## Use

1. Keep the Remodex bridge running from the repo root:

```sh
./run-local-remodex.sh --hostname <reachable-local-hostname-or-ip> --port 9100
```

2. In the web UI, click `Load local JSON`
3. Sign in with the admin password
4. Click `Connect`
5. Create a new thread or open an existing one
6. Send a prompt

## Notes

- The default pairing payload is read from the repo-root `remodex-pairing.json`
- Pairing payloads expire quickly; if connect fails with an expiry error, restart the bridge to generate a fresh one
- Admin sessions are stored server-side and survive process restarts for 30 days
- Failed login attempts are tracked per IP with escalating bans: 5 attempts -> 15 minutes, 10 -> 24 hours, 15 -> 7 days, 20 -> 30 days
- There is a persisted IP allowlist under `web-client/state/security-state.json`; when the app sits behind Cloudflare, enable `Trust Cloudflare proxy headers` in the UI so it uses `CF-Connecting-IP` only when the TCP peer is a known Cloudflare edge range
- `On-Request` mode is wired through, but the current UI only handles command-approval prompts, not the full plan-mode structured input flow
- The chat UI is designed for local-first use and now has a dedicated compact/mobile layout instead of relying on the desktop shell
