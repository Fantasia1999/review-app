# CLAUDE.md

> Instructions for Claude / other AI agents working on this repo.

## Read this first

1. **Read [DESIGN.md](./DESIGN.md) before any non-trivial change.** It
   captures the *why* behind every architectural choice. Many decisions
   look arbitrary in isolation but were tradeoffs against explicit
   constraints (lightweight, no remote daemon, simple SSH auth, etc.).

2. **The user's mental model**: this is *not* "a small VSCode" — it's
   the inverse: a tool that does the two things VSCode Remote does that
   the user actually wants (SSH + git diff) without any of the IDE
   weight. Resist any feature that smells IDE-shaped.

3. **Implementation status** is in DESIGN.md §9. The skeleton is
   functionally complete in code shape but has never been run end-to-end.
   First task for a continuing agent: `bun install`, run dev mode,
   verify the `@pierre/diffs` integration in `DiffView.tsx` matches the
   library's actual API (see DESIGN.md §10.1).

## Hard rules (do not break)

These are the rules from DESIGN.md §12, condensed:

1. **No remote installs.** The remote host must work with just `git`.
   If you find yourself wanting to install a daemon, see DESIGN.md §11.1
   — it's a future path, but opt-in only.

2. **All remote commands go through `RemoteExecutor`.** Never import
   `ssh2` outside `agent/src/remote/`.

3. **All paths in remote commands go through `shellEscape`.** Zero
   exceptions. Use `git -C <escaped-path>` rather than `cd && git`
   where possible.

4. **Bind only to `127.0.0.1`.** Never `0.0.0.0`. This is a security
   boundary protecting the in-memory passphrases.

5. **Annotations are quote-based, not anchored.** No drift detection,
   no row anchors, no AST nodes. The user explicitly chose this. See
   DESIGN.md §4.3.

6. **Passphrases live in memory only.** Never write to disk, never to
   keychain, never to config.

7. **Single CSS file.** No CSS-in-JS, Tailwind, or per-component styles.

8. **Bump config version on schema change.** And add a migration in
   `agent/src/config/store.ts`.

9. **Two-tier delete for annotations.** Review screens expose only
   *soft-clear* (set `archived_at`). The Comments management page
   (`#/comments`) is the *only* place that exposes hard delete. Don't
   re-add hard delete to the review flow.

## Don't add these

(From DESIGN.md §1.4 + §12.5)

- Electron, Tauri, or any native shell
- `node-keytar` or any system credential store
- ssh-agent / ssh-config / Pageant / 1Password integration
- tree-sitter or any AST library
- WebSocket-based real-time updates
- Multi-user / shared annotations
- File watching on the remote
- Editing files on the remote (this tool is read-only)

## Workflow for typical changes

### Adding an API endpoint

1. Add request/response types to `packages/shared/src/types.ts`.
2. Add the route in `packages/agent/src/routes/`.
3. Wire it into `agent/src/index.ts` if it's a new top-level router.
4. Add a hook in `packages/client/src/api/hooks.ts`.
5. Use the hook in components.

### Adding a new git operation

1. Add a method on `GitOps` in `packages/agent/src/git/ops.ts`.
2. **Use `shellEscape` on every interpolated path.**
3. Use `git -C <path>` rather than `cd <path> && git`.
4. Use `exec` for small outputs, `execStream` for large.

### Adding a page

1. Add a component to `packages/client/src/pages/`.
2. Add the route to `packages/client/src/routes.tsx`'s `parseHash`,
   `buildHash`, and `Routes`.
3. Use `navigate({...})` to link to it.

## Performance notes

DESIGN.md §8 has the budget. If you're worried about a regression:

- Look at synchronous SSH calls per page load (each is a round-trip)
- Look at full-buffer reads where streaming would do
- Check React Query `staleTime` settings in `api/hooks.ts`

Cold start should stay under 30MB. Steady state under 60MB. If you blow
through these, something is wrong.

## When stuck on @pierre/diffs API

The `DiffView.tsx` was written from docs without runtime verification.
Likely fixes:

- Prop names may be `lines` instead of `patch`, or the component may
  want a parsed structure from `parsePatchFiles` rather than raw patch text.
- `onLineClick` may have a different signature, or the library may use
  selection ranges instead of click events.
- Annotation gutter rendering may be a render-prop or a children pattern.

Check https://diffs.com/docs and adjust. The annotation editor
(`AnnotationEditor.tsx`) is decoupled from the diff component — feed
it any 5-line slice and it works.

## When the user asks for something that conflicts with these rules

Push back. Quote the relevant section of DESIGN.md. The user has been
through several rounds of trimming this scope and has explicit reasons
for each constraint. Adding "just one feature" tends to drag the project
back toward IDE territory.

If they really want it, propose making it *opt-in* (config flag,
separate command, something the default path doesn't pay for).
