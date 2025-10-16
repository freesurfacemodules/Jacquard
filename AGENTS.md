# Agent Guide for MaxWasm

## Project Overview
- **STATUS.md** → High-level progress, known limitations, and roadmap items.
- **README.md** → Detailed architecture, data flow, and technology stack.
- **NEXT_STEPS.md** → Immediate engineering tasks in priority order.

## Repository Layout
```
/app
  /audio       # Worklet loader and processor glue (JS)
  /codegen     # Graph → AssemblyScript emitters and helpers
  /compiler    # Browser-facing AssemblyScript compilation wrapper
  /dsp         # Node manifests (metadata + AS snippets)
  /graph       # Graph model, validation, scheduling utilities
  /ui          # React components, state, canvas/inspector widgets
  /tests       # Vitest suites for graph + codegen behavior
```
Supporting files: `README.md`, `STATUS.md`, `NEXT_STEPS.md`, `AGENTS.md`, Vite/TypeScript configs.

## Best Practices
- Treat `STATUS.md`, `README.md`, and `NEXT_STEPS.md` as the source of truth—update them when behavior or priorities change.
- Prefer reusable utilities over ad hoc logic; follow existing patterns (manifest-driven nodes, hooks in `PatchContext`).
- Keep playback uninterrupted during UI changes: avoid recompiles unless topology changes.
- Add logging for non-trivial workflows (compile, worklet start) and remove obsolete logs once issues are resolved.

## Testing & Validation
- **Lint:** `npm run lint`
- **Unit:** `npm run test` (Vitest)
- **Manual QA:** `npm run dev`, compile, run, tweak knobs, drag nodes.
- Before committing UI changes, verify knobs/parameters continue streaming without stopping audio and that compile/run logs appear.
- Commit messages should describe user-facing behavior or developer-impacting changes.
