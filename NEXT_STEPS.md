# Immediate Follow-Up Tasks

- **Cycle Guardrails:** Surface inline guidance (e.g., highlight offending ports, suggest inserting a delay) when a connection is rejected for creating a delay-free loop.
- **Persistence:** Extend manual save/load with IndexedDB-backed autosave and a patch browser; capture patch metadata (name, updatedAt) alongside graph state.
- **Patch Settings:** Expose sample rate, block size, and oversampling controls in the inspector; plumb changes through compile/start without full reload.
- **Parameter Transport:** Implement SharedArrayBuffer-backed parameter/event rings so high-rate automation doesn’t rely on postMessage.
- **Custom UI Controls:** Expand manifest controls (sliders, meters, scopes) and provide reusable React components for node/inspector rendering.
- **Compiler Worker:** Move AssemblyScript compilation to a Web Worker to keep the UI responsive during large compiles.
