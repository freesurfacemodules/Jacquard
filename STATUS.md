# Project Status (MaxWasm)

## Current Functionality
- **Graph Editing**: Node palette is driven by the DSP registry. Users can drag nodes around, create new nodes, and draw connections between ports via the canvas UI.
- **Code Generation**: Patch graphs produce AssemblyScript that is compiled to WebAssembly using the in-browser AssemblyScript toolchain. Compilation succeeds and serves the generated binary to the audio worklet.
- **Audio Pipeline**: AudioWorklet loads the compiled WebAssembly module and renders audio in real time. Worklet loading diagnostics are in place and verified working.
- **Validation & Tests**: Graph helpers prevent duplicate connections and expose utilities for node positioning/removal. Vitest coverage asserts graph validation, connection management, and code generation.

## Known Constraints / Pending Work
1. **Recompilation Triggered by Node Moves**
   - Any node drag (even without topology changes) triggers recompilation and stops audio.
   - We ultimately need user-controlled parameters (knobs, sliders, etc.), so recompilation should only occur on topological changes (node/connection adds or removals).

2. **Missing Delete/Disconnect UX**
   - Nodes and connections cannot yet be deleted or rewired.
   - Users can create graph cycles without delays, leaving the patch in an un-compilable state.
   - We should support removing the last-added connection automatically if it introduces an illegal cycle and provide explicit tools to delete or reroute connections.

3. **Patch Settings Mutability**
   - Sample rate, block size, and oversampling are fixed defaults in state.
   - UI controls are required to adjust these parameters and propagate them through compilation/runtime.

4. **Node UI Extensibility**
   - Node manifests do not yet expose runtime UI widgets (sliders, VU meters, oscilloscopes).
   - We need a framework for declarative UI controls and possibly streaming data (e.g., meter taps) back to React components.

## Next Steps / Roadmap Highlights
- Detect topology vs. positional changes and keep audio engine running when users only move nodes or adjust parameters.
- Implement deletion/disconnect controls, including undo/redo, and guard against invalid cycles by reverting the offending connection.
- Expose patch-level settings dialog for sample rate, block size, and oversampling, wiring values through compilePatch and the worklet loader.
- Extend node manifests with UI metadata, and render custom controls in the inspector (e.g., mixer gain/pan sliders, output meters, oscilloscope previews).
- Continue expanding the DSP library (filters, delays, mixers) and broaden test coverage for new behaviors (UI state, parameter automation, audio verification).
