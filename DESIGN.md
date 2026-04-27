# review-app — Design Document

> **Audience:** AI agents and human contributors continuing this project.
> **Status:** v0.1 skeleton. APIs, schema, and architecture are stable;
> implementation completeness varies (see "Implementation status" below).

This document is the source of truth for *why* the code is shaped the way
it is. Read this before making non-trivial changes — many decisions look
arbitrary in isolation but were tradeoffs against an explicit set of
constraints.

---

## 1. Product framing

### 1.1 What this is

A **lightweight browser-based code review tool** for self-review of
uncommitted changes on a remote development host, accessed over SSH. The
user opens a local CLI binary, a browser tab opens, they pick a host and
a repo path, and they see the equivalent of `git diff HEAD` rendered in a
clean diff UI with the ability to leave **markdown annotations** on any
5-line code window.

### 1.2 What this is **not**

This is *not* a remote IDE. It is *not* a competitor to VSCode Remote-SSH,
GitPod, or Coder. It deliberately rejects:

- Running language servers, debuggers, or terminals on the remote
- Editing remote code (the working tree is read-only from this tool's POV)
- Multi-user collaboration, shared annotations, or sync
- Integrations with GitHub/GitLab PRs (annotations are private to the user)
- Branch comparisons or arbitrary `git log` exploration (v1 is HEAD-only)

### 1.3 The motivating use case

> "Running VSCode is too heavy for me, but I still want VSCode-like git +
> SSH features for code review."

The user is a developer who SSHes into a dev box, edits code there
(with vim/emacs/whatever), and wants to **review their own uncommitted
work** in a browser before committing. Annotations exist primarily to
**capture review notes that they then paste into an AI coding agent
(Claude/Cursor/etc.) to fix the issues**.

### 1.4 Non-goals (will say no to feature requests)

- File watching / live diff updates → manual refresh is fine, simpler
- Annotation sync across machines → SQLite file is local; users who want
  sync can rsync `~/.review-app/db.sqlite` themselves
- Annotation drift detection → annotations carry their own quoted code, so
  drift doesn't matter (see §4.3)
- Mobile / responsive → desktop only, full keyboard
- Plugin system → out of scope; fork if you need extensibility

---

## 2. Architecture

```
┌──────────────────────────┐         ┌──────────────────────────┐
│   Browser                │  HTTP   │   Local agent            │   SSH    ┌─────────────┐
│   React + @pierre/diffs  │◄───────►│   Bun + Hono             │◄────────►│  Remote     │
│   localhost:7676         │         │   ssh2 + bun:sqlite      │          │  (just git) │
└──────────────────────────┘         └──────────────────────────┘          └─────────────┘
                                              │
                                              ▼
                                     ~/.review-app/
                                       ├─ config.json   (hosts, recents, read-marks, prefs)
                                       └─ db.sqlite     (annotations)
```

### 2.1 Process model

A single Bun process (`./review-app`) hosts:

1. The Hono HTTP server on `127.0.0.1:7676` (auto-incremented if busy, max 5 tries)
2. The SSH connection pool (`ExecutorPool`)
3. The SQLite database (`bun:sqlite`)
4. Static asset serving (the bundled React app)

Bound to `127.0.0.1` only. **Never** `0.0.0.0`. This is a security boundary,
do not change without re-evaluating threat model — a misconfiguration here
exposes the user's loaded passphrases to the local network.

### 2.2 Why Bun

- Faster cold start than Node (~50ms vs ~150ms typically)
- Lower memory baseline (~25MB vs ~80MB for Node)
- `bun:sqlite` built-in (no native compile)
- `bun build --compile` produces a single-file binary per platform

The code uses Node-compatible APIs except for `Bun.serve` and `bun:sqlite`,
so porting back to Node is mostly mechanical if Bun ever becomes a problem.

### 2.3 Why this architecture (the alternatives we rejected)

| Alternative                           | Why we didn't                                |
|---------------------------------------|----------------------------------------------|
| Pure browser, no agent                | Browsers can't open TCP/SSH sockets          |
| Browser + cloud relay                 | Adds a server we have to host & secure       |
| Bun agent + remote daemon (VSCode-style) | Requires installing something on remote — violates "remote zero-deps" goal |
| Electron app                          | Defeats "lighter than VSCode" entirely       |
| Native desktop (Tauri/etc.)           | Adds Rust toolchain; CLI + browser is simpler|

### 2.4 The `RemoteExecutor` boundary (very important)

All remote operations go through `RemoteExecutor` (`agent/src/remote/executor.ts`):

```ts
interface RemoteExecutor {
  exec(cmd: string, opts?: ExecOptions): Promise<ExecResult>;
  execStream(cmd: string, opts?: ExecOptions): AsyncIterable<Uint8Array>;
  close(): Promise<void>;
  isReady(): boolean;
}
```

The current implementation is `SSHExecutor`, which uses `ssh2` to maintain
one TCP connection per host with multiplexed channels for each `exec()`.

**Future**: a `DaemonExecutor` will satisfy the same interface but talk to
a small process running on the remote (over a unix socket forwarded
through SSH). This unlocks file watching, persistent state, and lower
per-call latency for power users — but **only if a user opts in by
installing the daemon**. The default zero-install path stays.

**Rule for changes**: the upper layers (`GitOps`, route handlers) must
never assume which `RemoteExecutor` implementation they're talking to.
If an op needs daemon-only capabilities, add a separate interface that
extends `RemoteExecutor`, don't pollute the base.

---

## 3. Module map

```
packages/
├── shared/src/types.ts          THE source of truth for cross-boundary types.
│                                If you add an API, the types go here first.
│
├── agent/src/
│   ├── index.ts                 Process entry. Hono app, port binding, browser open, SIGINT.
│   │
│   ├── remote/
│   │   ├── executor.ts          The RemoteExecutor interface + RemoteExecError.
│   │   ├── ssh-executor.ts      ssh2-based implementation.
│   │   └── pool.ts              Per-host pool with idle reaping. Holds passphrases in memory.
│   │
│   ├── git/
│   │   └── ops.ts               GitOps: validateRepo, listChanges, getFileDiff, getFileContent.
│   │                            All shell args escaped via utils/shell.shellEscape.
│   │                            Parsers for porcelain v2 + numstat are here.
│   │
│   ├── config/
│   │   ├── store.ts             load/save ~/.review-app/config.json with version migration.
│   │   └── keys.ts              Scan ~/.ssh/ for private keys + detect-encrypted helper.
│   │
│   ├── db/
│   │   ├── schema.ts            Drizzle table def for annotations.
│   │   └── annotations.ts       CRUD + SQLite pragmas (WAL/mmap/normal sync).
│   │
│   ├── routes/
│   │   ├── hosts.ts             /api/hosts CRUD, key scan, passphrase, test.
│   │   ├── repos.ts             /api/repos validate + recent.
│   │   ├── diff.ts              /api/diff changes/file/content.
│   │   ├── annotations.ts       /api/annotations CRUD.
│   │   ├── read-marks.ts        /api/read-marks.
│   │   └── prefs.ts             /api/prefs.
│   │
│   ├── static.ts                Serve the bundled client SPA.
│   └── utils/shell.ts           POSIX shell escaping. Used wherever paths are interpolated.
│
└── client/src/
    ├── App.tsx                  QueryClient provider + Routes.
    ├── routes.tsx               Hash-based router. Three views: hosts, repo-picker, review.
    ├── api/
    │   ├── client.ts            fetch wrapper, ApiError typed by RemoteError.
    │   └── hooks.ts             One TanStack Query hook per endpoint.
    ├── pages/
    │   ├── HostsPage.tsx        Host list + add/test/delete.
    │   ├── RepoPickerPage.tsx   Path input + recent list.
    │   └── ReviewPage.tsx       Two-pane review: tree + diff. The largest page.
    ├── components/
    │   ├── AddHostModal.tsx
    │   ├── PassphraseModal.tsx
    │   ├── FileTree.tsx         Flat or directory-tree view based on file count.
    │   ├── DiffView.tsx         Wraps @pierre/diffs PatchDiff.
    │   ├── AnnotationEditor.tsx
    │   ├── AnnotationCard.tsx
    │   ├── AnnotationSidebar.tsx
    │   └── CopyAllButton.tsx
    ├── lib/
    │   ├── llm-export.ts        Format annotations as LLM-friendly markdown.
    │   ├── lang.ts              Filename → Shiki language tag.
    │   └── types.ts             Client-only types.
    └── styles.css               Single stylesheet, CSS vars, light/dark via prefers-color-scheme.
```

---

## 4. Key design decisions

### 4.1 SSH auth: minimal and obvious

The user said "朴素做法就可以" — the simplest thing that works. So:

- We do NOT read `~/.ssh/config`.
- We do NOT consult ssh-agent (Windows or unix).
- We do NOT support ProxyJump, Pageant, 1Password agent, hardware tokens.
- We DO scan `~/.ssh/` for files matching `id_(rsa|ed25519|ecdsa|dsa)`
  and offer them in the "add host" UI.
- We DO support passphrase-protected keys: the user is prompted on
  first connect, the passphrase is held in `ExecutorPool.passphrases`
  in memory, and **never written to disk**. It dies with the agent process.

If a future contributor wants to add ssh-agent support, do it as an
*additional* auth path, not a replacement. Don't break the simple flow.

### 4.2 Connection pool: one host = one connection

`ExecutorPool` keeps at most one `SSHExecutor` per host alias. Idle
connections are reaped after 5 minutes (`IDLE_TIMEOUT_MS`). All `exec()`
calls multiplex over a single TCP — `ssh2` handles channel multiplexing
internally.

The pool also wraps each handed-out executor with a `touch()` proxy so
that calling `exec` resets the idle timer. This lets the lazy `connect()`
inside `SSHExecutor` cooperate with the reaping logic without explicit
calls.

### 4.3 Annotations: quoted, not anchored

Earlier iterations of this design had row-anchored annotations with
drift detection. We deleted all that. **Annotations carry a fixed 5-line
quote block from the file at creation time.** When you read the
annotation later, the quote is the full context — even if the
surrounding code has moved or been rewritten.

Implications:
- No drift detection algorithm. No "orphaned annotation" UI state.
- Storage is `quotedLines` + `quotedStartLine` + `quotedLang`.
  `quotedStartLine` is just for display — it's not used for re-anchoring.
- Annotations remain valid forever, even if the file is renamed or deleted.
- If the user wants to "update" an annotation after the code changed,
  they delete and recreate.

This simplification is the largest one in the design and not negotiable
without good reason — the user explicitly chose this tradeoff.

### 4.4 Read marks: hash-based invalidation

A "read mark" is keyed by `(host, repo, file_path, content_hash)`. When
the file's content hash changes (the user modifies the file), the mark
no longer matches the current hash and the file appears unread again.

This is better than `(host, repo, head_sha)` because committing one file
shouldn't invalidate read state on another file. The content hash is
SHA1 of the patch text (for tracked files) or full content (for
untracked) — see `git/ops.ts`.

### 4.5 Refresh strategy

- **Manual** via the "Refresh" button or `r` keyboard shortcut
- **Automatic on window focus** via TanStack Query's default
  `refetchOnWindowFocus: true`
- **No polling.** Polling would keep SSH connections busy and waste
  bandwidth for marginal benefit.

### 4.6 LLM-friendly export format

The export format (`lib/llm-export.ts`) is structured for AI agents to
parse easily:

````markdown
## src/auth.ts:40-44

```ts
function validateToken(token) {
  if (!token) return false;
  ...
}
```

jwt.decode doesn't verify the signature. Should use jwt.verify.
````

- File path includes line range so the agent can locate code.
- Code fence has a language tag for proper highlighting / parsing.
- User's markdown body sits below as instructions.

### 4.7 Path safety

Every user-controlled string concatenated into a remote shell command
goes through `utils/shell.shellEscape()`. We use `git -C <escaped-path>`
instead of `cd <path> && git ...` for the same reason — even though we
also escape the cd target. Two levels of defense against accidents.

The **local** shell never sees any user input, because `ssh2.exec()`
sends the command string directly to the remote sshd. So we only need
POSIX escaping rules; Windows shell rules are irrelevant.

---

## 5. The configuration file

`~/.review-app/config.json` is plain JSON. The shape is in
`shared/types.ts` as `AppConfig`. **Always include `version: 1`**.

To migrate to a new shape: bump the version, add a case to `migrate()`
in `agent/src/config/store.ts`, ship.

The file is rewritten atomically (write to `.tmp` then rename). Updates
are serialized via `writeLock` in `store.ts` so concurrent route
handlers can't clobber each other.

**Never** put secrets in here. Passphrases are memory-only.

---

## 6. The database

`~/.review-app/db.sqlite`, single table `annotations`. Schema in
`agent/src/db/schema.ts`. We don't use Drizzle migrations — the schema is
created with `CREATE TABLE IF NOT EXISTS` on first open. If you add
columns, do it as a separate `ALTER TABLE` block also gated on the
config version.

Pragmas applied on first open:

- `journal_mode = WAL` — concurrent readers, no global write lock
- `synchronous = NORMAL` — durable enough for a single-user local DB
- `mmap_size = 30000000` — 30MB memory-mapped read window

---

## 7. The frontend

### 7.1 Why no react-router

We use a hand-rolled hash router (`routes.tsx`) because:
- The agent serves the SPA without server-side routing fallback
- Hash routing makes refresh and back/forward "just work"
- Adding `@tanstack/react-router` for three routes is overkill

If the route count grows past ~6 distinct screens, swap in a real router.

### 7.2 Route shape

- `#/` → hosts list
- `#/h/<alias>` → repo picker for that host
- `#/h/<alias>/r/<base64-path>` → review screen
- `#/h/<alias>/r/<base64-path>?file=<path>` → review screen, specific file selected

The repo path is base64'd (URL-safe variant) to avoid escaping headaches
with slashes inside hash routes. See `routes.tsx` `encodeBase64`/`decodeBase64`.

### 7.3 @pierre/diffs integration

The `DiffView` component imports `PatchDiff` from `@pierre/diffs/react`
and feeds it the unified-diff text from our `/api/diff/:alias/file`
endpoint. **The exact prop names used in the v0.1 sketch may not match
the current `@pierre/diffs` API** — the package was new at the time of
writing this skeleton. When implementing, consult https://diffs.com/docs
and adjust the props (`patch`, `fileName`, `onLineClick`) to match.

The library handles syntax highlighting via Shiki internally. We pass
the raw patch and a filename; it does the rest.

### 7.4 State management

- Server state → TanStack Query (one query per endpoint)
- Local UI state → `useState` / props
- Cross-component state → none yet. If it grows, add Zustand
  (already a dep) but resist temptation; URL state is usually enough.

---

## 8. Performance budget

| Metric                | Target          | Notes                              |
|-----------------------|-----------------|-------------------------------------|
| Cold start            | <30 MB          | Bun runtime ~25 MB + small deps    |
| Steady state          | <60 MB          | One SSH conn + SQLite cache        |
| Time-to-first-render  | <500 ms         | After SSH connect                  |
| Diff load (avg file)  | <200 ms         | git diff is fast; SSH is the latency |
| Diff load (5MB diff)  | <2 s            | Streaming would help; not yet wired |

When perf regresses, look at:

1. New synchronous SSH calls per page load (each is one round-trip)
2. New full-buffer reads where streaming would do
3. Re-renders triggered by query refetches — check React Query
   `staleTime` settings in `api/hooks.ts`

---

## 9. Implementation status (what's actually done)

| Module                         | Status       | Notes                                  |
|--------------------------------|--------------|----------------------------------------|
| `shared/types.ts`              | ✅ complete  | All cross-boundary types defined      |
| `agent/remote/`                | ✅ complete  | SSH executor + pool, idle reaping     |
| `agent/git/ops.ts`             | ✅ complete  | All v1 ops + porcelain v2 parsing     |
| `agent/config/`                | ✅ complete  | Store + key scanner                    |
| `agent/db/`                    | ✅ complete  | Schema + CRUD                          |
| `agent/routes/`                | ✅ complete  | All six route modules                  |
| `agent/index.ts`               | ✅ complete  | Entry, port binding, browser open     |
| `agent/static.ts`              | ⚠️ dev-mode  | Production embedding TBD (see §10.4)  |
| `client/api/`                  | ✅ complete  | All hooks defined                     |
| `client/routes.tsx`            | ✅ complete  | Hash-based, three views               |
| `client/pages/`                | ✅ complete  | Hosts, RepoPicker, Review             |
| `client/components/`           | ✅ complete  | All 7 components written              |
| `client/styles.css`            | ✅ complete  | Single file, light + dark             |
| `DiffView.tsx`                 | ⚠️ unverified| `@pierre/diffs` props not runtime-tested |
| Tests                          | ❌ none      | Add when first bug bites              |
| `bun install`                  | ❌ not run   | Lockfile not in skeleton              |
| Type checking                  | ❌ not run   | Run `bun run typecheck` after install |

---

## 10. Open implementation questions

These were left for whoever continues:

### 10.1 `@pierre/diffs` API verification

`DiffView.tsx` uses prop names (`patch`, `fileName`, `onLineClick`) based
on a quick read of https://diffs.com/docs. The library was new at design
time and the exact API may differ. **First implementation step: do
`bun install`, run the dev server, look at what `@pierre/diffs/react`
actually exports, fix the imports/props to match.**

The annotation creation flow specifically depends on `onLineClick`
firing with `{ side, line }`. If the actual API exposes selection ranges
instead, adapt — the `AnnotationEditor` is happy with any 5-line slice.

### 10.2 Production static asset serving

`agent/src/static.ts` currently only serves `packages/client/dist` if
present on disk. For the compiled binary, we need to embed the client
build with Bun's `import ... with { type: "file" }` syntax. The build
pipeline should:

1. `bun run build:client` → produces `packages/client/dist/`
2. Generate `agent/src/embedded-assets.ts` that imports each file
3. `bun build --compile` produces a self-contained binary

The third bullet is a small build script — see `scripts/embed-assets.ts`
(to be written).

### 10.3 Initial UX: empty state guidance

When `~/.review-app/config.json` doesn't exist (first run), the user
sees an empty Hosts page with a single "Add your first host" button.
Consider replacing this with a guided onboarding flow: detect that no
hosts exist + no SSH keys in `~/.ssh/`, and show a "Set up SSH first"
explainer with a link to `ssh-keygen` docs.

### 10.4 Concurrent diff fetches

When the user clicks rapidly through files, each triggers a `git diff`
over SSH. We should debounce or cancel in-flight requests when the
selection changes. TanStack Query's `signal` parameter + `AbortController`
is the right tool — wire it through to the `fetch` calls in `api/client.ts`.

### 10.5 Streaming for very large diffs

The `/api/diff/:alias/file` endpoint currently buffers the full diff.
For files with 10MB+ diffs (rare but possible), streaming the diff over
HTTP and progressively parsing on the client would eliminate the spike.
This requires:

- Server: switch from `exec` to `execStream` in `routes/diff.ts`,
  return `Response` with a `ReadableStream` body.
- Client: read the stream, accumulate, render. `@pierre/diffs` may need
  to be re-fed as chunks arrive — verify it supports incremental rendering.

Probably not needed for v1; flag if a user actually hits this.

---

## 11. Future evolution paths

Listed in rough order of likely usefulness.

### 11.1 Daemon mode (path B from the design discussions)

Add a `DaemonExecutor` implementing `RemoteExecutor`. The daemon is a
small Go or Bun binary that runs on the remote, listens on a unix socket,
and handles git commands locally. The local agent connects via SSH port
forwarding. Benefits: ~10x lower per-command latency, file watching,
cached state. Cost: user has to install the daemon (one-time).

The `RemoteExecutor` interface was designed for exactly this swap.

### 11.2 More diff scopes

Currently only `git diff HEAD`. Easy additions:

- Branch comparison: `git diff main..HEAD`
- Specific commit range: `git diff <a>..<b>`
- Staged-only: `git diff --cached`

Each goes in `GitOps` as a new method, plus a UI affordance to choose
the scope.

### 11.3 Annotation tags / filtering

Add a `tags TEXT` JSON column to annotations. UI: a tag dropdown on the
editor, a tag filter in the sidebar. Keeps "what should I do about
this" notes separate from "TIL this exists" notes.

### 11.4 Keyboard-first power mode

Right now `j/k` and `r` work. Add: `c` for create-annotation on
selection, `x` for mark-read, `/` for fuzzy file search, `?` for help.
This is what makes the tool feel like a vim plugin instead of a webapp.

### 11.5 Integration with AI coding agents (beyond clipboard)

Currently the user copies the LLM-formatted markdown manually. A natural
next step: a "Send to Claude" button that uses the local Claude API key
to actually call an agent and stream the response back into the
annotation card. Or write the markdown to a file the agent can read.

### 11.6 Multi-window / multi-repo

Right now opening two tabs both point at the same agent. Eventually,
let each tab independently navigate. Already works because route state
lives in the URL — but test it explicitly.

---

## 12. How to extend this codebase (rules of thumb for AI agents)

1. **Read `shared/types.ts` first** for any feature involving the API
   boundary. Add types there before anything else.

2. **Don't bypass `RemoteExecutor`.** If you need to talk to the remote,
   add a method on `GitOps` (or a new sibling). Never `import { Client }
   from 'ssh2'` outside `agent/remote/`.

3. **Don't bypass `shellEscape`.** Every user-controlled string going
   into a remote command must be escaped. There are zero exceptions.

4. **Routes return errors as `{ error: RemoteError }`.** The client's
   `api/client.ts` knows how to decode this. If you add a new error
   shape, extend `RemoteError['kind']` in `shared/types.ts`.

5. **Don't add deps lightly.** This is meant to be lightweight.
   Especially: no Electron, no Tauri, no `node-keytar`, no
   tree-sitter parsers. If you think you need one, write down why and
   re-read §1.2.

6. **CSS is one file.** No CSS-in-JS, no Tailwind, no separate component
   stylesheets. Add a section comment and use the existing CSS vars.

7. **Annotations stay quote-based.** See §4.3. If a request seems to
   imply drift detection or row anchoring, that's the wrong direction.

8. **Bind to 127.0.0.1.** Always. See §2.1.

9. **The config file format is versioned.** Bump the version when you
   change the shape, add a migration step in `config/store.ts`.

10. **Test with a real SSH host before merging.** Mocking ssh2 is
    possible but the failure modes (encrypted key handling, slow
    networks, oddly-named branches) only show up in real use.

---

## 13. Appendix: API surface

All routes are JSON over HTTP. Errors return `{ error: RemoteError }`
with appropriate HTTP status. Successes return the body shapes documented
in `shared/types.ts`.

| Method | Path                                    | Description                        |
|--------|-----------------------------------------|------------------------------------|
| GET    | `/api/health`                           | `{ ok: true }`                     |
| GET    | `/api/hosts`                            | List hosts                         |
| POST   | `/api/hosts`                            | Add a host                         |
| PUT    | `/api/hosts/:alias`                     | Update a host                      |
| DELETE | `/api/hosts/:alias`                     | Remove a host                      |
| GET    | `/api/hosts/keys`                       | Scan ~/.ssh/ for keys              |
| POST   | `/api/hosts/:alias/passphrase`          | Submit passphrase for host         |
| POST   | `/api/hosts/:alias/test`                | Echo test + git --version          |
| GET    | `/api/repos/:alias/recent`              | Recent repos for host              |
| POST   | `/api/repos/:alias/validate`            | Check path is a git work tree      |
| POST   | `/api/repos/:alias/touch`               | Bump repo to top of recents        |
| GET    | `/api/diff/:alias/changes?repo=`        | Working-tree change summary        |
| GET    | `/api/diff/:alias/file?repo=&path=&status=` | Per-file diff                  |
| GET    | `/api/diff/:alias/content?repo=&path=&side=` | Raw file content (old/new)    |
| GET    | `/api/annotations?host=&repo=[&file=]`  | List annotations                   |
| POST   | `/api/annotations`                      | Create annotation                  |
| PATCH  | `/api/annotations/:id`                  | Update body only                   |
| DELETE | `/api/annotations/:id`                  | Delete annotation                  |
| GET    | `/api/read-marks?host=&repo=`           | List read marks                    |
| POST   | `/api/read-marks`                       | Set a read mark                    |
| DELETE | `/api/read-marks`                       | Remove a read mark                 |
| GET    | `/api/prefs`                            | UI preferences                     |
| PUT    | `/api/prefs`                            | Update UI preferences              |
