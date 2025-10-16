# Project Status (MaxWasm)

## Current Functionality
- **Graph Editing**: Registry-driven node palette with drag/drop placement, connection drawing, and node selection. Interactive knobs live on the nodes themselves.
- **Realtime Audio**: AssemblyScript codegen → Wasm compile in-browser → AudioWorklet playback. Parameter updates stream to the worklet with smoothing so audio keeps running while knobs move.
- **Compilation Flow**: Compile logs surface module sizes and parameter counts. Topology changes invalidate the running artifact; parameter/position changes do not.
- **Validation & Tests**: DAG validation, duplicate detection, control bindings, and codegen snippets are covered by Vitest; linting enforces TS/React style.

## Known Constraints / Pending Work
1. **Deletion & Cycle Recovery**
   - Nodes/connections cannot yet be removed or rewired. Users can still create illegal cycles requiring manual cleanup.
   - We should provide delete/undo tooling and revert any new connection that forms an invalid cycle.

2. **Patch Settings**
   - Sample rate, block size, and oversampling remain fixed defaults.
   - Expose editable patch settings and propagate changes through the compilation/runtime path without reloading the page.

3. **Worklet Parameter Channel**
   - Parameter updates currently post messages per event. We still need the planned SharedArrayBuffer ring for higher-rate automation and eventual scheduling.

4. **Node UI Extensibility**
   - Only simple knobs are supported. Nodes need a richer UI manifest for sliders, meters, oscilloscopes, etc., plus data taps back to React.

5. **Persistence & Undo**
   - Graph edits aren’t stored outside in-memory state. Add persistent storage (local/save file) and history (undo/redo).

## Next Steps / Roadmap Highlights
- Implement delete/disconnect/undo tooling and automatic rejection of illegal cycles.
- Add patch-level settings UI, wiring them through `compilePatch`, the worklet, and status displays.
- Introduce a SAB-backed parameter/event ring plus scheduling timestamps to support automation.
- Expand node manifests with rich UI controls and streaming taps; build helper components (meters, scopes).
- Persist patches (JSON) and add undo/redo stacks.
- Broaden the DSP library and tests, including audio render regression checks and end-to-end UI flows.
