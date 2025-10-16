# Project Status (MaxWasm)

## Current Functionality
- **Graph Editing**: Registry-driven node palette with drag/drop placement, connection drawing, and node selection. Interactive knobs live on the nodes themselves.
- **Realtime Audio**: AssemblyScript codegen → Wasm compile in-browser → AudioWorklet playback. Parameter updates stream to the worklet with smoothing so audio keeps running while knobs move.
- **Compilation Flow**: Compile logs surface module sizes and parameter counts. Topology changes invalidate the running artifact; parameter/position changes do not.
- **Validation & Tests**: DAG validation, duplicate detection, control bindings, and codegen snippets are covered by Vitest; linting enforces TS/React style.

## Known Constraints / Pending Work
1. **Cycle Recovery**
   - Delay-free cycles are rejected at connection time, but we still need inline guidance (highlighting offending ports/nodes) to help users resolve the loop quickly.

2. **Patch Settings**
   - Sample rate, block size, and oversampling remain fixed defaults.
   - Expose editable patch settings and propagate changes through the compilation/runtime path without reloading the page.

3. **Worklet Parameter Channel**
   - Parameter updates currently post messages per event. We still need the planned SharedArrayBuffer ring for higher-rate automation and eventual scheduling.

4. **Node UI Extensibility**
   - Only simple knobs are supported. Nodes need a richer UI manifest for sliders, meters, oscilloscopes, etc., plus data taps back to React.

5. **Persistence & Undo**
   - Manual save/load is available, but there is no auto-save or patch library. Add IndexedDB-backed autosave and patch metadata/history management.

## Next Steps / Roadmap Highlights
- Add guard rails that automatically reject illegal cycles now that delete/disconnect UI and undo/redo exist.
- Add patch-level settings UI, wiring them through `compilePatch`, the worklet, and status displays.
- Introduce a SAB-backed parameter/event ring plus scheduling timestamps to support automation.
- Expand node manifests with rich UI controls and streaming taps; build helper components (meters, scopes).
- Persist patches (JSON) and add undo/redo stacks.
- Broaden the DSP library and tests, including audio render regression checks and end-to-end UI flows.
