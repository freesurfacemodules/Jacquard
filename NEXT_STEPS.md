# Immediate Follow-Up Tasks

- **Editing & Undo:** Add guard rails that revert the last connection when it introduces a delay-free cycle; deletion/disconnect UI and undo/redo tooling are in place.
- **Persistence:** Save/load patches (JSON, IndexedDB) and sync knob/position state as part of the patch document.
- **Patch Settings:** Expose sample rate, block size, and oversampling controls in the inspector; plumb changes through compile/start without full reload.
- **Parameter Transport:** Implement SharedArrayBuffer-backed parameter/event rings so high-rate automation doesn’t rely on postMessage.
- **Custom UI Controls:** Expand manifest controls (sliders, meters, scopes) and provide reusable React components for node/inspector rendering.
- **Compiler Worker:** Move AssemblyScript compilation to a Web Worker to keep the UI responsive during large compiles.
