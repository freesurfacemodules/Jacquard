# Subpatch Feature Specification

_Last updated: October 28, 2025_

This document describes the requirements, data model changes, and implementation plan for adding hierarchical “Subpatch” support to MaxWasm. The goal is to allow users to encapsulate part of a patch inside a reusable node, navigate into nested subpatches, and manage inputs/outputs dynamically—similar to Blender’s Geometry Nodes workflow.

## 1. Vocabulary

- **Host Patch** – The currently open patch container (top-level or a nested subpatch).
- **Subpatch Node** – A node that represents an embedded patch. It appears as a single node in the parent graph and contains its own internal patch graph.
- **Subpatch Graph** – The patch data that lives inside a subpatch node (its “inner” graph).
- **Subpatch Input Node** – An auto-managed node inside a subpatch that exposes inputs coming from the parent graph.
- **Subpatch Output Node** – An auto-managed node inside a subpatch that exposes outputs returning to the parent graph.
- **Dummy Port** – A special last port on the subpatch input/output nodes that users drag from to add a new external port.

## 2. High‑Level Requirements

1. **New Subpatch Node Type**
   - Palette includes a “Subpatch” node with no parameters/controls.
   - Default label “Subpatch”; renamable via the Node Properties panel.
   - Double-click or “Open subpatch” button opens its inner graph.
   - Supports arbitrary depth (subpatches within subpatches).

2. **Subpatch Creation from Selection**
   - Users can select nodes → right-click → “Create subpatch”.
   - Selected nodes move into a new subpatch node that replaces them in the parent graph.
   - Connectivity before/after conversion must be identical.

3. **Navigation & Breadcrumbs**
   - When a subpatch is open, show a persistent breadcrumb bar (“Patch > Sub1 > Sub2 …”).
   - Breadcrumb segments are clickable to jump up the hierarchy.
   - Include an explicit “Exit subpatch” control (e.g., button on the bar).

4. **Port Propagation**
   - Subpatch input/output nodes manage external interfaces.
   - Adding/removing/renaming ports inside the subpatch reflects on the parent subpatch node.
   - Default port names auto-derive from connected ports; user can rename via Node Properties.
   - Dummy port allows arbitrary number of interfaces.

5. **Persistence & Undo/Redo**
   - Serialization format stores nested graphs and port metadata.
   - Undo/redo treats subpatch creation, edits, navigation as normal topology operations.

6. **Keep Existing Counter Node Changes**
   - Preserve the user’s manual modifications to the counter node (no reverts).

## 3. Open Questions

1. **Port Ordering Rules** – When consolidating multiple external connections, should ports be sorted (e.g., alphabetical, by node name, or creation order)? _Proposal: preserve deterministic ordering based on connection discovery (stable sort by source/sink node id + port id)._
2. **Default Dummy Port Labels** – Should dummy ports show “+” or “Add”? _Proposal: label last port “+ Add Output” / “+ Add Input” visually distinct._
-3. **Maximum Depth** – No nesting limit; assume unlimited depth (subject to practical performance/memory constraints).
-4. **Shared Resources** – Subpatch graphs share DSP nodes, sample rate, block size, and oversampling with the parent graph (no overrides).

Please confirm/clarify these before implementation if they conflict with product expectations.

## 4. Data Model Changes

### 4.1 Graph Types (`app/graph/types.ts`)

- Introduce `SubpatchId = string`.
- Extend `NodeDescriptor` with optional `subpatchId?: SubpatchId` (referencing an entry in a new `subpatches` map).
- Extend `PatchGraph`:
  ```ts
  export interface SubpatchGraph {
    id: SubpatchId;
    name: string; // user-visible label default “Subpatch”
    inputs: SubpatchPortSpec[];  // tracked order + metadata
    outputs: SubpatchPortSpec[];
    graph: PatchGraph; // inner graph; note recursion
  }

  export interface SubpatchPortSpec {
    id: PortId;
    name: string;
    type: DataType; // currently always "audio"
    order: number;  // stable ordering for UI/serialization
  }

  export interface PatchGraph {
    nodes: NodeDescriptor[];
    connections: Connection[];
    sampleRate: number;
    blockSize: 128 | 256 | 512;
    oversampling: 1 | 2 | 4 | 8;
    subpatches?: Record<SubpatchId, SubpatchGraph>;
    rootSubpatchId?: SubpatchId; // optional convenience
  }
  ```
- `NodeDescriptor.kind` values:
  - `logic.subpatch` (parent node)
  - `logic.subpatch.input`
  - `logic.subpatch.output`

### 4.2 Persistence (`app/graph/persistence.ts`)

- Increment `PATCH_DOCUMENT_VERSION`.
- Migrate existing documents by wrapping legacy graphs into a `rootSubpatchId` with an implicit subpatch entry or set `subpatches = undefined`.
- Ensure `normalizePatchDocument` validates nested graphs recursively.

### 4.3 DSP / Codegen

- Subpatch nodes act as graph-level artifacts; no DSP snippet is generated directly. The subpatch compiler must inline child graphs during assembly emission:
  - Modify `ExecutionPlan` builder to recurse into subpatch graphs prior to codegen.
  - Each subpatch acts as a macro expansion; runtime scheduling remains single DAG.
  - Ensure inputs/outputs map to buffers appropriately.
  - NOTE: Actual DSP integration might be deferred; spec should note if initial milestone only cares about editor UX. Confirm scope.

## 5. UI & UX Changes

### 5.1 Canvas (`app/ui/components/Canvas.tsx`)

- **Node Creation**
  - Register new node type in palette.
  - For direct placement, create associated subpatch graph (with auto-created input/output nodes) and store `subpatchId` in node metadata.

- **Selection → Subpatch Conversion**
  1. Validate selection non-empty and excludes subpatch input/output nodes.
  2. Determine external connections:
     - Incoming edges where `to` is within selection and `from` outside.
     - Outgoing edges where `from` is within selection and `to` outside.
  3. Consolidate connections: group by {source node id, source port id} or {target node id, target port id}.
  4. For each unique group, create a subpatch port spec.
  5. Remove selected nodes/connections from parent graph; insert new subpatch node with aggregated ports.
  6. Clone selected nodes into subpatch graph (preserve positions relative to selection bounds).
  7. Create subpatch input/output nodes positioned near left/right edges.
  8. Recreate internal connections; connect new input/output nodes accordingly.
  9. Update clipboard/history logic (use existing `copySelection` as reference).

- **Context Menu**
  - Add “Create subpatch” item (enabled when ≥1 nodes selected).
  - Add “Open subpatch” for subpatch nodes.

- **Interactions**
  - Double-click detection: if node kind is subpatch → trigger open.
  - Breadcrumb overlay: create new component tied to navigation state in `PatchContext`.

- **Dummy Ports**
  - Render special port at end; dragging from it calls `addSubpatchInputPort` or `addSubpatchOutputPort`.
  - Update port rendering to mark dummy ports non-connectable except for drag start.

### 5.2 Node Properties Panel (`app/ui/components/panels/NodePropertiesPanel.tsx`)

- When selected node is a subpatch node:
  - Show editable text field for node label (updates subpatch metadata and node label).
  - Show list of inputs/outputs with rename capability.
  - Provide “Open subpatch” button.

- When inside a subpatch:
  - Input/output nodes should expose rename UI for their ports.
  - Changing names updates corresponding `SubpatchPortSpec` and parent node ports synchronously.

### 5.3 Navigation State (`app/ui/state/PatchContext.tsx`)

- Track current subpatch stack (array of `SubpatchId`).
- Provide APIs:
  - `openSubpatch(subpatchId: string)`
  - `exitSubpatch(levels = 1)`
  - `createSubpatchFromSelection(nodeIds: string[])`
  - `addSubpatchPort(subpatchId, direction, name?)`
  - `renameSubpatchPort(...)`
  - `renameSubpatch(...)`

- Ensure `viewModel` derivation respects current subpatch (i.e., returns graph for active subpatch).
- Update undo/redo snapshots to include subpatch stack and nested graphs.

### 5.4 Breadcrumb Component

- New component (e.g., `app/ui/components/SubpatchBreadcrumb.tsx`) receiving stack from context.
- Renders segments `Patch`, `Sub1`, `Sub2`…
- Each segment clickable except last (current).
- Include “Exit” / “Up one level” button.

### 5.5 Palette & Registry

- Register manifests for:
  - Subpatch node
  - Subpatch input node (hidden from palette)
  - Subpatch output node (hidden)
- Palette should only surface the main subpatch node. Input/output nodes created programmatically; mark them `metadata.hidden: true` to prevent accidental deletion (except via subpatch port removal flow).

## 6. Logic & Algorithms

### 6.1 Creating Subpatch Ports

Pseudo-process (selection conversion):

```
incomingGroups = groupBy(connection, key = connection.from.node + connection.from.port)
for each group:
  portId = nanoid()
  spec = { id: portId, name: deriveName(group), type: connection type, order: sequence++ }
  // Parent graph: add input port to subpatch node
  // Subpatch graph: add output port on subpatch input node
  connect subpatch input port -> target inside

outgoingGroups = groupBy(connection, key = connection.to.node + connection.to.port)
...
```

Name derivation:
- Inspect target/source port names.
- Fallback: `Input 1`, `Input 2`, etc. Use helper to avoid duplicates.

### 6.2 Adding Ports Manually

- When user drags from dummy port:
  - Determine direction.
  - Create new port spec (with default name `Input N` / `Output N`).
  - Insert port spec in arrays with stable order; update both parent node and subpatch IO nodes.
  - Update graph connections if user completes drag to another node.

### 6.3 Renaming Ports

- Node Properties panel uses new API to rename spec.
- After rename, update:
  - Subpatch node’s manifest `inputs/outputs`.
  - Subpatch input/output node port descriptors.
  - Live connections (UI labels).

### 6.4 Navigation & Context Handling

- `PatchContext` should expose `currentGraph` from active subpatch id (root = main patch).
- When opening subpatch:
  - Push id onto stack.
  - Recompute `viewModel` & `validation` using nested graph.
- Undo/redo must store stack state or recompute based on node metadata.

## 7. Implementation Plan (Incremental)

1. **Data Model & Persistence**
   - Extend types, update serialization, provide migration path.
   - Update tests `app/tests/graph.test.ts` to cover new structures.

2. **Subpatch Node Infrastructure**
   - Add manifests & palette entry.
   - When creating node, allocate subpatch graph with input/output nodes.
   - Ensure DSP/codegen either handles or safely errors (decide scope).

3. **Navigation State**
   - Update `PatchContext` to maintain active subpatch.
   - Adjust `viewModel` to reflect subgraph.
   - Implement breadcrumb component & double-click open.

4. **Port Management APIs**
   - Implement helper functions inside `PatchContext` (add / remove / rename ports).
   - Port addition updates both parent and child graphs.

5. **Node Properties Enhancements**
   - Add rename fields & “Open subpatch” button.
   - Support port renames (for subpatch nodes and IO helper nodes).

6. **Selection → Subpatch Conversion**
   - Add context menu entry.
  - Reuse copy-with-connections logic for determining bounds/connectivity.
  - Implement transformation pipeline (as described in §6.1).
  - Add unit tests (graph transformation, port mapping).

7. **Dummy Ports & Dynamic Creation**
   - Update port rendering & interaction in `Canvas` to support dummy ports.
   - Ensure new ports appear in Node Properties and breadcrumbs update.

8. **QA & Testing**
   - Unit: transformation helpers, port rename logic.
   - Integration: codegen (if applicable), persistence round-trip.
   - Manual: navigation, undo/redo, nested subpatch scenarios.

## 8. Test Strategy

- Extend `app/tests/graph.test.ts` for:
  - Subpatch creation from selection.
  - Port addition/removal.
  - Serialization round-trip.

- Add UI-focused Vitest or Playwright tests (if available) for navigation & breadcrumb rendering.

- Update existing snapshot tests if manifests change (e.g., palette).

## 9. Risks & Mitigations

- **Complex Undo/Redo** – Ensure snapshots capture nested graphs; consider storing full graph state per change initially (optimize later).
- **Performance** – Deep recursion may impact codegen; profile after initial implementation.
- **User Confusion** – Provide clear UI affordances (breadcrumbs, open buttons).
- **Port Sync Bugs** – Centralize source of truth in `SubpatchPortSpec` to avoid divergence.

## 10. References

- `app/ui/components/Canvas.tsx` – copy/paste + context menu logic.
- `app/ui/state/PatchContext.tsx` – graph state, undo/redo, parameter binding.
- `app/ui/components/panels/NodePropertiesPanel.tsx` – rename/controls UI entry point.
- `app/graph/graph.ts` – existing graph manipulation helpers.

---

Prepared for engineering handoff. Awaiting clarification on open questions (port ordering, dummy port labeling, DSP scope). Once resolved, implementation can proceed following the plan above.
