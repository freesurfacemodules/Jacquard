# Immediate Follow-Up Tasks

- **Patch Settings:** Allow edits to sample rate, block size, and oversampling without interrupting playback (hot reload worklet caches, cross-fade audio).
- **Parameter Transport:** Implement SharedArrayBuffer-backed parameter/event rings so high-rate automation doesn’t rely on postMessage.
- **Custom UI Controls:** Expand manifest controls (sliders, meters, scopes) and provide reusable React components for node/inspector rendering.
- **Compiler Worker:** Move AssemblyScript compilation to a Web Worker to keep the UI responsive during large compiles.
