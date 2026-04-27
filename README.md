# review-app

A lightweight browser-based code review tool for SSH-accessible remote
working trees. Get the SSH + git parts of a remote IDE, without the IDE.

> **Status**: v0.1 skeleton. See [DESIGN.md](./DESIGN.md) for the full
> architecture and implementation status.

## What it does

You SSH into a dev box, edit code there, want to review your uncommitted
changes before committing — but running VSCode Remote feels too heavy.
This is the minimum tool that solves that:

- Pick a host (private SSH key auth, no agent / no ssh-config parsing)
- Pick a repo path on that host
- See `git diff HEAD` rendered with [@pierre/diffs](https://diffs.com)
- Leave 5-line quoted markdown annotations on any code window
- One-click copy all annotations as LLM-friendly markdown to paste into
  Claude / Cursor / ChatGPT for fixes

Remote requirements: just `git`. No daemon to install.

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.1
- A remote host you can SSH to with a private key

Tested on macOS (Apple Silicon) and Windows 10/11 x64.

## Run from source (development)

```bash
git clone <this repo>
cd review-app
bun install

# Two terminals:
bun run dev:agent    # starts agent on http://127.0.0.1:7676
bun run dev:client   # starts Vite dev server on http://127.0.0.1:5173
```

Open http://127.0.0.1:5173 — Vite proxies `/api` to the agent.

## Build a single-file binary

```bash
bun run package:macos      # → dist/review-app-macos
bun run package:windows    # → dist/review-app-windows.exe
```

Then run the binary directly:

```bash
./review-app-macos
# or, on Windows:
review-app-windows.exe
```

The binary listens on `127.0.0.1:7676` (auto-incremented if busy) and
opens your browser. Press Ctrl+C to stop.

> **Note**: The packaging command embeds the client build into the
> binary. You must `bun run build:client` first or use `bun run build`
> which does both.

## Where data lives

All local. Nothing leaves your machine except SSH traffic.

- `~/.review-app/config.json` — host configs, recent repos, read marks, UI prefs
- `~/.review-app/db.sqlite` — your annotations

Move/sync these files manually if you want to share state across machines.

## Privacy & security

- The agent binds to `127.0.0.1` only. Not reachable from the network.
- SSH passphrases are held in memory only and die with the process.
  They're never written to disk.
- No telemetry, no auto-updates, no network calls except SSH.

## How to use it

1. Run the binary. Browser opens to the host list.
2. Click "Add host". Fill in alias + user + hostname + port. Pick a
   private key from `~/.ssh/` or specify a custom path.
3. Click your host. If the key is encrypted, enter the passphrase.
4. Type a repo path on the remote (e.g. `/home/me/code/myproject`).
   Hit Enter. The path is validated as a git work tree before opening.
5. Browse files in the left tree. Click any line in the diff to attach
   a 5-line quoted annotation.
6. When done, click "Copy all" at the top — paste into your AI agent.

### Keyboard shortcuts (in review screen)

- `r` — refresh diff
- `j` / `k` — next / previous file

## Project structure

```
packages/
├── shared/   types shared between agent and client
├── agent/    Bun + Hono + ssh2 + bun:sqlite (the backend)
└── client/   React + @pierre/diffs + TanStack Query (the UI)
```

See [DESIGN.md](./DESIGN.md) for the full module map and rationale.

## Contributing

Read [DESIGN.md](./DESIGN.md) first — it explains why things are the
way they are. Section 12 ("How to extend this codebase") has the rules
of thumb. Most importantly:

- Don't bypass `RemoteExecutor` (the SSH boundary).
- Don't bypass `shellEscape` for any path going to the remote.
- Don't add row-anchored annotations or drift detection — see §4.3.
- Don't add Electron / Tauri / heavy deps. The whole point is *light*.

## License

MIT
