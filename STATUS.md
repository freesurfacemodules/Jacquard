# Project Status (MaxWasm)

## Current Functionality
- **Graph Editing**: Registry-driven node palette with drag/drop placement, connection drawing, and node selection. Interactive knobs live on the nodes themselves.
- **Realtime Audio**: AssemblyScript codegen → Wasm compile in-browser → AudioWorklet playback. Parameter updates stream to the worklet with smoothing so audio keeps running while knobs move.
- **Voltage Scaling**: Core nodes follow Eurorack conventions (audio ±5 V, pitches 1 V/oct around user-set offsets, envelopes 0–10 V, triggers 0–5 V) so modulation behaves predictably across the patch.
- **Analog Oscillator**: Multi-wave oscillator with adaptive harmonic capping, FM-friendly partial limiting, and selectable analog-style spectra.
- **Allpass Filter**: SVF-based allpass stage with cutoff control for phase shaping and cross-over duties.
- **Clock Generator**: CV addressable BPM with reset input, multiplier/divider ratios, and a BPM CV output for syncing downstream patches.
- **Copy/Paste Workflow**: Context menu and keyboard shortcuts duplicate nodes (optionally retaining external connections) with parameter/state preservation.
- **Envelopes**: AD envelope generator with Schmitt-triggered gating feeds a live SVG visualizer so users can watch attack/decay progress in real time.
- **Seeded Random**: Triggered Xoroshiro-based source that reseeds deterministically from a seed control/CV pair for repeatable random sequences.
- **Slew Limiter**: Utility node smooths signals with independent rise/fall times and a linear↔exponential morph control for dialing glide behavior.
- **Soft Clip & Rectifier**: Distortion suite includes tanh-based soft clip with gain trims plus a rectifier for absolute-value shaping.
- **Waveguide Delay**: Fractional delay line with 4-point Lagrange interpolation, oversampling-aware timing, and modulation-ready delay input.
- **Debugging**: Oscilloscope node captures patch signals with trigger support and streams history into the UI for real-time waveform inspection.
- **Compilation Flow**: Compile logs surface module sizes and parameter counts. Topology changes invalidate the running artifact; parameter/position changes do not.
- **Validation & Tests**: DAG validation, duplicate detection, control bindings, and codegen snippets are covered by Vitest; linting enforces TS/React style.
- **Logic & Circuit Utilities**: AND/OR/XOR/NOT gates handle boolean logic, while comparator, counter, mux/demux, and sample & hold nodes sit under the Circuit toolbox for edge sequencing; the new Gate Length utility turns triggers into fixed-duration 10 V gates.
- **Node Library**: Categories refreshed (Mixing, Random, Circuit, Control, Meta) with the patch document updated to version 2; older exports are rejected with a friendly error so users can rebuild with the new taxonomy.
- **DSP Benchmarking**: Standalone Node/Vite-node CLI compiles patches to Wasm and runs headless DSP benchmarks for A/B performance testing outside the browser.
- **Math Mode A/B**: AssemblyScript codegen exposes fast vs baseline math toggles (sin/cos/log/exp/pow) so benchmarks can compare accuracy/perf trade-offs per patch.
- **Binaryen Post-Opt**: Benchmark harness can invoke Binaryen’s wasm-opt pipeline (`--optimizer binaryen`) to compare asc vs. asc+Binaryen builds.

## Known Constraints / Pending Work
1. **Cycle Recovery**
   - Delay-free cycles are rejected at connection time, but we still need inline guidance (highlighting offending ports/nodes) to help users resolve the loop quickly.

2. **Patch Settings**
   - Editing sample rate, block size, or oversampling forces a full recompilation and restarts audio.
   - Streamline the workflow so small changes cross-fade or schedule seamlessly without interrupting playback.

3. **Worklet Parameter Channel**
   - Parameter updates currently post messages per event. We still need the planned SharedArrayBuffer ring for higher-rate automation and eventual scheduling.

4. **Node UI Extensibility**
   - Only simple knobs are supported. Nodes need a richer UI manifest for sliders, meters, oscilloscopes, etc., plus data taps back to React.

5. **Persistence & Undo**
   - Autosave persists the active patch in IndexedDB (format v2), but there is no curated patch library or metadata/history management yet.

## Next Steps / Roadmap Highlights
- Surface inline diagnostics for rejected feedback loops (highlight offending ports, suggest delay nodes).
- Make patch settings edits seamless (hot-reload worklet state, minimize audio interruptions).
- Introduce a SAB-backed parameter/event ring plus scheduling timestamps to support automation.
- Expand node manifests with rich UI controls and streaming taps; build helper components (meters, scopes).
- Add autosave/patch library via IndexedDB with metadata and quick recall.
- Broaden the DSP library and tests, including audio render regression checks and end-to-end UI flows.
