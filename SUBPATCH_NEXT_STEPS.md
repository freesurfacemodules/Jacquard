# Subpatch Feature – Next Implementation Steps

_Updated: October 28, 2025_

This document captures the remaining work required to deliver fully‑functional subpatch support. Tasks are grouped by theme and ordered to minimize rework. Each item lists key considerations, expected touch points, and open questions (if any).

---

## 1. Codegen & Graph Infrastructure

### 1.1 Nested Subpatch Flattening ✅
- **Status:** Implemented — `flattenForCodegen` now iteratively expands subpatch hierarchies until no subpatch nodes remain, emitting a flattened DAG for codegen.
- **Follow-ups:** Add deeper unit coverage (e.g., nested pass-through chains) if regression risk arises.

### 1.2 Validation Awareness
- **Goal:** Ensure validation runs on the full root graph while respecting subpatch IO contracts.
- **Key work**
  - Update the validator to treat `logic.subpatch` nodes as having dynamic ports derived from their `SubpatchPortSpec`s.
  - When flattening, propagate any validation errors from subgraphs (e.g., missing output node) back to the root context with breadcrumb-like paths.
- **Touches:** `@graph/validation`, plan builder if it relies on static port definitions.
- **Tests:** Graph validation tests that simulate broken subpatch internals and confirm friendly, path-aware error messages.

---

## 2. Editor Workflow

### 2.1 “Create Subpatch” from Selection
- **Goal:** Consolidate a user-selected set of nodes into a subpatch node.
- **Key work**
  - Reuse copy-with-connections logic to gather internal vs. external edges.
  - Build new `SubpatchPortSpec`s for aggregated connections (group by source/sink node+port).
  - Clone selected nodes into the new subpatch graph, preserving relative positions.
  - Create corresponding subpatch input/output nodes, wiring them to the internal graph according to grouped edges.
  - Replace the selection in the parent graph with a new `logic.subpatch` node carrying the generated specs.
  - Update history stack/undo snapshot semantics.
- **Touches:** `app/ui/components/Canvas.tsx` (context menu action + command), `app/ui/state/PatchContext.tsx` (new API `createSubpatchFromSelection`), possibly new helpers under `@graph`.
- **Tests:** Maintain graph equivalence pre/post transformation (unit tests + integration).

### 2.2 Context Menu Enhancements
- **Goal:** Provide additional actions when right-clicking a subpatch node or canvas.
- **Key work**
  - Add “Create subpatch” option when ≥1 node selected.
  - Add “Flatten subpatch” (future optional) or “Duplicate subpatch” placeholders if required.
  - Ensure multi-selection semantics remain intact across all actions.
- **Touches:** `Canvas.tsx` context menu rendering.
- **Tests:** Interactions via Vitest component tests or Playwright (if available).

---

## 3. Port Management UX

### 3.1 Explicit Port Add/Remove Controls
- **Goal:** Allow managing subpatch inputs/outputs via UI beyond dummy drag.
- **Key work**
  - Add “+ Input” / “+ Output” buttons in the Node Properties panel for subpatch nodes and their IO helpers.
  - Provide delete buttons to remove unused ports (with confirmation modal if connections exist).
  - Update PatchContext with `removeSubpatchPort` (with safe connection teardown).
- **Touches:** `NodePropertiesPanel.tsx`, `PatchContext.tsx`, CSS for buttons.
- **Tests:** Unit tests for port addition/removal ensuring parent node manifests sync correctly; integration tests covering undo/redo.

### 3.2 Connection Re-routing on Port Removal
- **Goal:** Maintain graph integrity when a port is removed.
- **Key work**
  - Disconnect any existing wires before deleting port specs.
  - Update parent node ports and re-validate.
- **Touches:** `PatchContext.tsx` port removal function, `graph/validation`.

---

## 4. Navigation & UX Polish

### 4.1 Breadcrumb Enhancements
- **Goal:** Improve usability for deep hierarchies.
- **Key work**
  - Show clickable root segment even when only root is active (disabled hover state).
  - Add tooltips with full path when breadcrumb labels truncate.
  - Optionally, display subpatch node icons.
- **Touches:** `SubpatchBreadcrumb.tsx`, CSS adjustments.

### 4.2 Canvas Indicators
- **Goal:** Make it obvious when inside a subpatch.
- **Key work**
  - Optionally change canvas background or overlay a label with the current path.
  - Provide a quick “Up” keyboard shortcut (e.g., `Backspace`) to exit subpatch.
- **Touches:** `Canvas.tsx`, global keyboard handler in `PatchContext` or `Workspace`.

---

## 5. Persistence & Migration

### 5.1 Document Schema Update
- **Goal:** Ensure subpatch metadata survives load/save.
- **Key work**
  - Update `createPatchDocument` / `normalizePatchDocument` to include new port specs, IO node IDs, parent IDs.
  - Provide migration logic for existing patches without subpatch metadata.
- **Touches:** `app/graph/persistence.ts`.
- **Tests:** Round-trip tests verifying subpatch structures persist.

---

## 6. Quality & Tooling

### 6.1 Unit & Integration Coverage
- Add targeted tests for:
  - Nested flattening.
  - Subpatch creation/flatten commands.
  - Port addition/removal flows.
  - Breadcrumb navigation updates.

### 6.2 Performance Profiling (Post-Implementation)
- Stress-test flattening on large nested patches; optimize if flattening becomes a bottleneck.
- Consider caching flattened graphs between compiles when topology unchanged.

---

## Sequencing Recommendation
1. **Nested flattening & validation updates** (Section 1) – unblocks compilation for all future scenarios.
2. **Selection → subpatch transformation** (Section 2.1) – core usability feature.
3. **Port management APIs/UI improvements** (Section 3) – required for parity with spec.
4. **UX polish** (Section 4) and **persistence updates** (Section 5) – wrap-up refinements.
5. **Testing & profiling** (Section 6) – finalize stability/performance.

---

## Outstanding Questions
- Should flattening inline an entire subpatch tree every compile or can we incrementally cache per subpatch?
- Do we need a UI affordance to duplicate subpatch nodes while keeping internal graphs intact?
- What is the desired behavior when deleting a subpatch that still has nested subpatches inside?

Please review and confirm priorities or adjust ordering before implementation continues.
