# pi-acp (ACP adapter for pi-coding-agent)

This repository implements an **Agent Client Protocol (ACP)** adapter for **pi** (`@earendil-works/pi-coding-agent`) without modifying pi.

- ACP side: **JSON-RPC 2.0 over stdio** using `@agentclientprotocol/sdk` (TypeScript)
- Pi side: spawn `pi --mode rpc` and communicate via **newline-delimited JSON** over stdio

## Architecture (MVP)

### 1 ACP session ↔ 1 pi subprocess

Pi RPC mode is effectively single-session, so the adapter maps:

- `session/new` → spawn a dedicated `pi --mode rpc` process
- `session/prompt` → send `{type:"prompt"}` to that process and stream events back as `session/update`
- `session/cancel` → send `{type:"abort"}`

### ACP server wiring (modeled after opencode)

Use `@agentclientprotocol/sdk`:

- `ndJsonStream(input, output)` to speak ACP over stdio
- `new AgentSideConnection((conn) => new PiAcpAgent(conn, config), stream)`

## Implementation constraints / decisions

- Do **not** implement ACP client-side FS/terminal delegation in MVP. Pi already reads/writes and executes locally.
- Ignore `mcpServers` for MVP (accept in params, store in session state).
- Stream all pi assistant output as ACP `agent_message_chunk` initially.
- Tool events: map pi tool execution events to ACP `tool_call` / `tool_call_update` (as text content).

## Dev workflow (to be filled once scaffold exists)

- Install deps: `npm install`
- Run in dev: `npm run dev`
- Build: `npm run build`
- Smoke test (stdio): `npm run smoke`
- Lint: `npm run lint`
- Test: `npm run test`

## Manual testing notes

Once the adapter runs, it should behave like an ACP agent on stdio.

Quick sanity test (example):

```bashN
# Send initialize request via stdin (exact fields depend on ACP SDK version)
# echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1}}' | node dist/index.js
```

For real validation, test with an ACP client (e.g. Zed external agent).

## Coding guidelines

- Keep ACP protocol handling in `src/acp/*`.
- Keep pi RPC subprocess logic in `src/pi-rpc/*`.
- Prefer small translation functions (pi event → ACP session/update) with unit tests.
- Be strict about streaming and process cleanup (handle exit, drain stdout/stderr, timeouts).
- Avoid producing unnecessary comments! Use comments sparingly to explain non-obvious decisions, not to narrate code.
- Avoid using `any` in TypeScript; prefer explicit types and interfaces. Only use `any` when absolutely necessary (e.g. for untyped external data).

## Validation

- After making code edits, run formatting before finishing the task. Use `npm run format` when it is safe to format the whole worktree; otherwise use the narrowest safe formatter command for the files you touched.
- If formatting is skipped or fails, say so explicitly in the final response.

## Source control

- **DO NOT** commit unless explicitly asked!

## Fork divergence (timfel/pi-acp)

This worktree tracks upstream `svkozak/pi-acp` as `origin` and pushes to the fork as remote `fork` (`timfel/pi-acp`). The fork exists to expose ACP features that [agent-shell](https://github.com/xenodium/agent-shell) (Emacs) needs, before they land upstream.

**Baseline:** forked from upstream main at `04d0a15` (v0.0.34, Nov 2026). `git log --oneline origin/main..main` shows exactly what diverges. Keep upstream `origin/main` merged in before each new fork change so the divergence stays small and reviewable.

### What is merged and why

Merged as real merge commits from the upstream PR refs (`git fetch origin pull/N/head:pr-N && git merge --no-ff pr-N`). When upstream merges one of these PRs, simply merge upstream and **drop our copy** — do not re-resolve:

| Merge commit | Upstream PR | Feature (why the fork needs it) |
|---|---|---|
| `274ff9e` | [#182](https://github.com/svkozak/pi-acp/pull/182) | `session/resume` (load without history replay); agent-shell shows `resume` in `sessionCapabilities` and prefers it for session restore |
| `5c0ee7b` | [#171](https://github.com/svkozak/pi-acp/pull/171) | `session/fork` via `pi --fork`; agent-shell fork feature. **Behavior change to remember:** first `session/load` of a just-forked session attaches to the running process instead of restarting it (`freshForks` set in `agent.ts`) |
| `3a87277` | [#176](https://github.com/svkozak/pi-acp/pull/176) | `_session/steering` extension method + `_meta.steering.supported` advertisement; agent-shell prompt queue steers mid-turn. Follow-up `2ae52b2` dropped the `acp-dev.sh` the PR bundled (author-local paths) |
| `5632612` | [#137](https://github.com/svkozak/pi-acp/pull/137) | No `in_progress` tool status before pi's `tool_call` hook ran; declining `select` options typed `reject_once` |
| `5edf3f7` | [#170](https://github.com/svkozak/pi-acp/pull/170) | `usage_update.cost` (agent-shell usage bar) |
| `16ec474` | [#180](https://github.com/svkozak/pi-acp/pull/180) | pi extension dialogs (`select`/`confirm`/`input`/`editor`) as ACP form elicitation when the client advertises `elicitation.form` (agent-shell renders in-buffer forms; falls back to permission bridge otherwise) |

### Custom fork commit (no upstream PR equivalent)

- `4cac981` — **pi extension slash commands over ACP**: hand-written blend of [#121](https://github.com/svkozak/pi-acp/pull/121) (advertising + custom-message forwarding) and [#118](https://github.com/svkozak/pi-acp/pull/118) (turn completion for command-only handlers), rebased onto the `settleTurn` refactor that #137 introduced. Deliberately excludes #121's fusion-harness-specific message rewrites and detail compaction. Three pieces, all in `session.ts` / `pi-commands.ts` / the `includeExtensionCommands: true` flags in `agent.ts`:
  1. `available_commands_update` includes `source === 'extension'` commands.
  2. `runPrompt()`: command-only extension handlers (RPC resolves, no `agent_start` ever fires) settle the turn on RPC resolve via `settleTurn()`; handlers that start an agent run still wait for `agent_settled`.
  3. `message_end` events with `role === 'custom'` (and `display !== false`) are forwarded as `agent_message_chunk` with `_meta.piAcp.customType`.
  Tests: `test/component/extension-commands.test.ts`. **If upstream later merges #121 or #118, reconcile against this commit and prefer upstream's mechanism**, keeping our no-hardcoding rule; check the three pieces above individually (upstream may land them piecemeal).

### Deliberately NOT merged (re-check only if the reason expires)

- **#115, #91** (steering) — superseded by #176; same wire method `_session/steering`. Never merge two implementations.
- **#101** (input/editor via elicitation) — strict subset of #180.
- **#121 as-is** — see custom commit above; only its general ideas were taken.
- **`session/push`** (agent-shell experimental server-initiated prompt) — no upstream PR exists; open one or implement if it becomes needed.

### Rebasing onto moving upstream

1. `git fetch origin && git merge origin/main` — upstream wins on any overlap with a merged PR (the PR's own history means identical changes merge cleanly).
2. Hot-spot conflicts: `agentCapabilities` block in `agent.ts` (five of our changes touch it), turn lifecycle in `session.ts` (`startTurn`/`runPrompt`/`settleTurn`/`agentRunStarted`), `handleExtensionUiRequest` (both #180 and the custom commit reach into it).
3. After a conflict in `session.ts` prompt/turn code, re-check these interactions explicitly: steering-while-idle (#176 → `prompt(...)` detached turn), extension-command completion (custom), usage after settle (#170 via #137's `publishContextUsage`), elicitation fallback (#180).
4. Validate before pushing: `npm run typecheck && npm run lint && npm run format && npm test && npm run build && npm run smoke`, plus the live advertising check: run the adapter, `session/new`, confirm `available_commands_update` still lists extension commands.
5. `git push fork main`.

Open upstream PRs still worth re-evaluating as they mature: #144 (tool-call replay on `session/load`), #166 (message ids on chunks), #134 (delta coalescing). None merged because they were not agent-shell gaps at fork time.

## Client information

- Current ACP client is Zed

## References

- Local ACP repo with protocol documentation and specs: `~/Dev/learning/agent-client-protocol`
- Local Zed repo `~/Dev/learning/zed/zed`
