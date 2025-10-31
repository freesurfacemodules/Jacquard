# Introduction

This project is a browser-native, patchable synthesizer—something in the spirit of Max/MSP or Pure Data—but designed from the ground up to run entirely on the web without plugins or native installers. You build sounds by placing components (oscillators, filters, delays, mixers, math utilities, and your own custom DSP blocks) onto a canvas and connecting them with virtual wires. Every connection carries a stream of 32-bit floating-point samples at the audio sample rate; there is no separate “control” or “message” lane that runs slower. That choice keeps timing simple and predictable: a wire always means “one float per sample,” whether it’s carrying a pitch control signal or a raw waveform.

Under the hood the system turns your patch—the graph of nodes and their connections—into real AssemblyScript code. Each node becomes a small, deterministic function and each wire becomes a concrete data dependency between those functions. The tool generates a single AssemblyScript program that implements the whole patch, compiles it to WebAssembly in the browser, and runs the result inside an AudioWorklet. Because everything happens locally, hitting “Run” doesn’t bounce through a server; your code compiles and starts making sound right where you are.

The AudioWorklet is responsible for real-time audio. It asks the WebAssembly module for a fixed-size block of samples at a time (for example, 256 samples per block), and the module fills those buffers sample by sample. Internally we keep the execution model simple: the patch is treated as a directed acyclic graph; any intentional feedback is made explicit with a delay node, which guarantees that every sample has a clear “previous value” to pull from. Before we emit code, we validate the graph, compute a topological order, and assign each wire to a concrete buffer in linear memory. That layout step matters: it lets us avoid unnecessary copies and gives the Wasm engine tight, cache-friendly loops to run.

A key feature is oversampling, which is available at the patch level. When you enable 2×, 4×, or 8× oversampling, the entire patch runs multiple sub-steps per output sample. That means oscillators advance their phase at the higher internal rate, filters compute their coefficients for the oversampled time step, and delay lines measure their lengths in the oversampled domain. After the patch finishes its sub-steps, we downsample back to the hardware rate with a high-quality low-pass FIR (implemented to be SIMD-friendly). The benefit is reduced aliasing for “spiky” processes—hard clipping, fast modulation, non-linear filters—without forcing you to micromanage per-node oversampling policies.

The “custom” component is effectively a tiny gen~-style sandbox for your own DSP. You declare how many inputs and outputs it has and write AssemblyScript for its processing step. When you press Run on that component, its code is spliced into the generated patch program and compiled alongside the built-in nodes. Because this runs on the audio thread, we apply some guardrails: the custom code executes without garbage collection, avoids dynamic allocation, and sticks to math on numbers, typed arrays, and small `@unmanaged` structs. The point isn’t to limit creativity; it’s to make sure your code can be scheduled predictably in the hard realtime environment of an AudioWorklet.

Performance and determinism shape the rest of the technical choices. We compile with AssemblyScript’s optimizations enabled, request the minimal runtime, and write inner loops that are amenable to WebAssembly SIMD. Buffer access inside the render loop is bounds-check-free, and all state—filter histories, oscillator phases, delay write heads, parameter smoothers—is laid out contiguously in linear memory so it can be advanced with simple pointer arithmetic. We make one call from JavaScript to Wasm per audio block to minimize JS↔Wasm overhead. Parameters you tweak in the UI travel to the Worklet via a SharedArrayBuffer ring with sample-accurate timestamps; the Wasm code consumes those events at block boundaries and applies either per-sample ramps or a one-pole smoother, so sweeps and envelopes are clean and click-free.

Pitch handling follows the familiar “one volt per octave” convention from modular synths, but expressed as unitless floats. A pitch value of 0.0 corresponds to C4, and each increase of 1.0 doubles the frequency; nodes that need frequency convert from `pitch` to `Hz` with the standard `f = f_C4 * 2^pitch` mapping. Because every signal is just a float stream, you can modulate anything with anything: a slow LFO can drive a filter cutoff exactly the same way a step sequencer or an audio-rate oscillator would, and the scheduler treats all of those as the same kind of wire.

From the user’s perspective, the application is a clean node editor on the left and a details panel on the right. You create nodes, drag from an output port to an input port to make a connection, tweak the knobs rendered on the node cards, and press Run. The system compiles the patch in a background worker, transfers the compiled WebAssembly into the AudioWorklet, and starts pulling audio blocks. If compilation fails, the error is reported with line and column numbers in the embedded code editor (for custom nodes) or as a graph validation message (for wiring and scheduling issues), and the previously working patch keeps running so your speakers don’t pop. Meters show peaks and CPU load, and transport controls let you start and stop the render loop without destroying state—handy for debugging feedback lines or tuning filters.

All of this lives entirely in the browser. There is no server-side compiler, no native helper process, and no privileged APIs beyond what modern browsers already provide. The result is a portable, view-sourceable instrument: a modular environment where DSP blocks are real code you can read, modify, and extend, stitched together at compile time into a single fast WebAssembly program that runs in a safe, deterministic audio engine.

# Web-Based Modular Synth — Design Document (Draft v1)

## 1) Product overview

A browser-native, patchable synthesizer inspired by Max/MSP, Pure Data, and gen~:

* **Nodes (“components”)**: oscillators, filters, delays, mixers, math, utilities, etc.
* **Wires**: sample-rate floating-point streams (no separate control/message rate).
* **Custom node**: user-authored **AssemblyScript** (AS) compiled in-browser to Wasm.
* **Audio**: sample-accurate rendering inside an **AudioWorklet**, block size = power-of-two (e.g., 256 frames), with optional **global oversampling** (e.g., 2×, 4×).
* **Patch**: a directed acyclic graph (DAG) of nodes and connections, with explicit support for feedback via delay elements.

Primary goals: extremely low latency, deterministic scheduling, sandboxed user DSP, and “click-drag wire” UX.

---

## 2) Goals & non-goals

### Goals

* **All in browser**: authoring, compiling (AS→Wasm), executing (Wasm in AudioWorklet).
* **Real-time audio**: stable processing at 44.1/48/96 kHz with 128–512 frame render quanta.
* **Deterministic graph execution**: pure sample-rate pipelines, no hidden control rate.
* **Global oversampling** with high-quality downsampling to output rate.
* **Safe custom DSP**: AssemblyScript surface with guardrails to avoid allocation and GC on the audio thread.
* **Composable**: nodes defined by a manifest; codegen stitches a patch into a single AS program for optimal inlining.

### Non-goals (v1)

* MIDI/clock I/O beyond basic note/trigger (can be v1.1).
* Patch-within-patch (subpatchers) and polyphonic voice allocation (v2).
* Offline rendering/export (v2).
* Multi-channel ambisonics (v2).

---

## 3) Technology stack

* **UI**: React + TypeScript, Canvas/SVG node editor; Zustand for state; Vite build.
* **Graph/IR**: TypeScript model → validated DAG with typed ports.
* **Codegen**: TypeScript → AssemblyScript source (single file per patch).
* **Compiler**: AssemblyScript (`asc`) **browser build**. Flags:
  `-O3 --noAssert --runtime minimal --use SIMD --enable relaxed-simd`
* **Audio**: Web Audio **AudioWorklet**. Ring buffer via **SharedArrayBuffer** between main/UI and worklet for parameter events & metering.
* **Runtime**: WebAssembly.instantiateStreaming (or fallback) with import table minimalism; optional tiny WASI shim only if needed (avoid for v1 to reduce size).
* **Persistence**: JSON patch format, user files via IndexedDB + File System Access API.
* **Testing**: Jest for graph/IR, Playwright for UI, audio golden tests via offline AudioWorklet in WorkletGlobalScope (debug build).

---

## 4) Data model

### 4.1 Port types

All ports are **`f32` sample streams**.

* **Signal**: arbitrary audio-rate value.
* **Pitch**: same wire type as signal; **semantics** only. Convention:
  `pitch = 0.0` → **C4** frequency; `pitch = +1.0` → C5 (1 V/oct semantics).
  Frequency mapping (for convenience inside nodes):
  `f = f_C4 * 2^(pitch)` with `f_C4 = 261.625565... Hz`.

> No separate control messages. Gates/triggers are floats (e.g., >0.5 = high).

### 4.2 Node manifest (TypeScript)

```ts
type Port = { id: string; label: string; role: "in" | "out"; };
type NodeKind = "osc.sine" | "filter.biquad" | "delay.ddl" | "utility.gain" | "clock.basic" | "custom.as" | ...;

type NodeManifest = {
  kind: NodeKind;
  label: string;
  inputs: Port[];
  outputs: Port[];
  parameters?: Record<string, ParamSpec>;  // Smoothed params (see 6.3)
  codegen: CodegenDescriptor;              // References template/snippet id
  attributes?: Record<string, any>;        // e.g., maxDelayMs for DDL
};
```

### 4.3 Patch JSON

```json
{
  "sampleRate": 48000,
  "blockSize": 256,
  "oversample": 4,
  "nodes": [
    {"id":"n1","kind":"osc.sine","x":120,"y":200,
     "params":{"detune":0.0}},
    {"id":"n2","kind":"filter.biquad","params":{"type":"lowpass","Q":0.707,"cut":0.2}},
    {"id":"n3","kind":"out.stereo"}
  ],
  "wires": [
    {"from":{"node":"n1","port":"out"}, "to":{"node":"n2","port":"in"}},
    {"from":{"node":"n2","port":"out"}, "to":{"node":"n3","port":"L"}},
    {"from":{"node":"n2","port":"out"}, "to":{"node":"n3","port":"R"}}
  ]
}
```

---

## 5) Architecture

### 5.1 End-to-end pipeline

1. **User edits patch** in the node editor.
2. **Validate graph** (acyclic except declared feedback via delay nodes).
3. **Lower to IR**: topologically sorted execution schedule; port indices assigned.
4. **Generate AssemblyScript**: compose a single module by stitching together the node-specific AssemblyScript snippets declared in the DSP library, plus the shared process scaffolding:

   * Node helper classes/state taken from each manifest bundle
   * Per-node processing bodies emitted in topological order
   * Block renderer that loops `blockSize × oversample`
5. **Compile** AS→Wasm in the **main thread** (or a Worker) using `asc`.
6. **Load** Wasm module in **AudioWorkletProcessor** via `WebAssembly.compile` transfer or `instantiate`.
7. **Render** audio blocks: Worklet pulls `blockSize` samples from Wasm each callback.
8. **UI ↔ Worklet**: parameter changes shipped via SAB ring buffer with sample-accurate timestamps.

### 5.2 Graph execution & scheduling

* **DAG**: We require all combinational cycles to be broken by **explicit Delay** nodes (z⁻¹ or more).
* **Topological order** computed at compile time.
* **Per-node call** is a pure function on **per-sample** basis (for oversampled substeps), with state kept in preallocated arrays.

**Feedback** pattern:

```
 [node A] --> [delay D] --> [node B] --> (back to A?)
```

The **delay** ensures well-defined causality.

### 5.3 Memory layout

* **Linear memory** (Wasm): single `ArrayBuffer` partitioned at initialization:

  * **Audio buffers**: `float32` ring buffers per port (double-buffered at block granularity).
  * **Node state**: tightly packed structs (aligned to 16 bytes for SIMD).
  * **Smoothing envelopes**: per-param 1-pole state (see 6.3).
* **No dynamic allocation** in render path. The AS runtime uses `--runtime minimal`; collections are `StaticArray<T>` or raw pointer math.

### 5.4 Oversampling model

* Choose **`OS` = {1, 2, 4, 8}**. The patch runs at `fs' = fs * OS`.
* **Up**: Zero-order hold (v1) or polyphase halfband (v1.1). Because we recompute the whole graph OS times per output sample, ZOH is implicit (i.e., we recompute at substeps).
* **Down**: High-quality low-pass **FIR half-band** (e.g., 63 taps for 4×) at the final output only. Coeffs precomputed and embedded in codegen; SIMD friendly.

> **Node responsibility**: Nodes must incorporate `oversampleMul = OS` when mapping pitches to frequencies, delay times to samples, and computing filter coefficients.

### 5.5 AudioWorklet integration

* **WorkletProcessor** holds the instantiated Wasm exports:

  * `init(sampleRate, blockSize, oversample)` (called once)
  * `process(ptrOutL, ptrOutR)` fills `blockSize` samples each render quantum
  * `writeParams(ptr, count)` copies param events from SAB into Wasm memory

* **Communications**

  * **SharedArrayBuffer** ring for param events `{paramId, value, sampleTime}`.
  * **MessagePort** for compile result, diagnostics, meters, and UI state.

### 5.6 Parameter events & smoothing (sample-accurate)

* UI writes **timestamped events** (in worklet time base) into SAB.
* Worklet transfers pending events to Wasm at the start of each block.
* Inside Wasm, every param has a **1-pole equal-ripple-safe** smoother or **per-sample ramp**:

  * Linear ramp when `targetTime ≤ block horizon`
  * Else, 1-pole `y += a*(x - y)` with `a = 1 - exp(-1/(τ·fs'))`

---

## 6) DSP component model

### 6.0 Source layout

Nodes live under `app/dsp/nodes/<category>/<name>/`. Each node bundle contains:

* `manifest.ts` — describes ports, default parameters, appearance metadata, and provides an `emit()` function that writes the AssemblyScript body for the node when the code generator visits it.
* Optional `*.as` files (imported with Vite’s `?raw` modifier) — reusable AssemblyScript helpers such as oscillator classes or filter kernels that the manifest can inject into the generated module.

`app/dsp/library.ts` registers every manifest and exposes helpers (`instantiateNode`, `getNodeImplementation`) shared by the UI and the code generator. Extending the DSP library means dropping a new folder with these files and re-exporting it from the library list.

Controls defined in the manifest’s `controls` array (e.g., knobs) are included in the execution plan, assigned parameter indices, and surfaced both on the canvas node cards and in the inspector. Codegen emits `setParameter(index, value)` along with parameter smoothing so UI changes stream to the AudioWorklet without requiring recompilation.

### 6.1 AssemblyScript node helpers

```ts
// app/dsp/nodes/oscillator/sine/sine.as
export class SineOsc {
  private phase: f32 = 0.0;

  step(frequency: f32): f32 {
    const phaseDelta: f32 = frequency * INV_SAMPLE_RATE * TAU;
    this.phase += phaseDelta;
    if (this.phase >= TAU) {
      this.phase -= TAU;
    }
    return Mathf.sin(this.phase);
  }
}
```

The paired manifest (`manifest.ts`) imports this snippet (`import sineOsc from "./sine.as?raw"`) and registers it as a declaration with the generator. During codegen the emitter adds the declaration once, allocates `const node_<id> = new SineOsc();` for each instance, and writes the per-sample logic referencing `node_<id>.step(...)`.

> **Design constraints**
>
> * Helpers avoid dynamic allocation; persistent state is held in module-level constants generated alongside the process loop.
> * Ports are audio-rate floats. Manifests provide default parameter values and the emitter decides how to fold constants vs. live wires.
> * Emitters use shared utilities (`indentLines`, `numberLiteral`, `buildInputExpression`) so output is consistent and readable.

### 6.2 Example standard nodes

* **osc.sine**

  * Manifest declares one `pitch` input and one `out` output with default pitch 0.
  * AssemblyScript snippet defines the `SineOsc` class; emitter instantiates it and writes its output to connected wires or auto-route buffers.

* **mixer.stereo**

  * Manifest exposes four mono inputs with per-channel gain/pan parameters and two outputs (`left`, `right`).
  * Emitter accumulates gain/pan-scaled sums for each channel and fans results into downstream wires or the auto-routing buffers when outputs are unconnected.

* **io.output**

  * Terminal node writes the current left/right accumulators into the linear-memory buffers pointed to by the AudioWorklet. Auto-routing fills in defaults when its ports are left open.

### 6.3 Parameters vs inputs

* **All ports** carry audio-rate floats. **Parameters** are metadata-only default values that surface in the UI inspector.
* Parameters get injected into the generated code as scalar literals; when a port is unconnected the emitter falls back to the parameter default.
* Runtime smoothing/ramping is handled in the generated Wasm by converting parameter events into per-sample scalars (future work includes bringing back the SAB event queue mentioned earlier).

---

## 7) Code generation

### 7.1 IR lowering

* Assign **continuous indices** to node instances and ports.
* Build a **schedule** (topological order).
* Construct a **buffer map**: each wire assigns a source buffer index; fan-out is free (multiple readers).
* Insert **copy-elision**: consume source directly when single-use; otherwise allocate shared read-only buffer.

### 7.2 AS output skeleton (single file)

```ts
// --- generated header ---
export const FS: i32 = /* sampleRate * OS at runtime via init */;
export const OS: i32 = /* oversample factor */;

// Node state arrays
var osc0 = SineOsc.init();
var biq0 = Biquad.init(/*type*/0);

// Per-block entry point called by Worklet
export function process(ptrOutL: i32, ptrOutR: i32): void {
  // Pointers to linear memory mapped outL/outR buffers
  // Outer loop: blockSize frames
  for (let n = 0; n < BLOCK; n++) {
    var accL: f32 = 0.0, accR: f32 = 0.0;

    // Oversample loop
    for (let k = 0; k < OS; k++) {
      // --- schedule ---
      // n1: osc.sine
      const freq = hzFromPitch(buf_pitch[n], F_C4);
      const s = osc0.step(freq, DT);           // DT = 1/(fs*OS)

      // n2: biquad
      const y = biq0.process(s, /*cut,Q handled with smoothing*/);

      // accumulate to final
      accL = y; accR = y;
    }

    // Downsample (FIR HB): write one sample after OS ticks
    const ds = halfband_accumulate(accL, accR); // pseudo; implemented inlined & SIMD
    store<f32>(ptrOutL + (n<<2), ds.l);
    store<f32>(ptrOutR + (n<<2), ds.r);
  }
}
```

### 7.3 Custom node code injection

* **Custom node** provides:

  * **AS snippet** implementing `class UserNodeN { static init(); step(in0: f32, in1: f32): f32 }`
  * **Manifest** with declared ports (N inputs, M outputs; v1: M ∈ {1,2})
* Codegen **validates**: no `new` in `step`, no strings/arrays, no imports; whitelists math intrinsics.
* On compile, the snippet is concatenated and referenced in the schedule just like built-ins.

---

## 8) Real-time constraints

* **No GC on audio thread**: `--runtime minimal`, `@unmanaged` structs, `StaticArray`.
* **No dynamic memory** in `process`/`step`.
* **SIMD**: expose `v128` intrinsics for hot loops (downsampler, biquads in blocks).
* **Bounds-check removal** with `unchecked` in inner loops.
* **JS↔Wasm crossings** amortized: one call per block.

---

## 9) UI/UX

### 9.1 Node editor

* **Canvas/SVG** graph:

  * Nodes rendered as rounded cards with **input ports on top**, **output ports on bottom**.
  * Port tooltips show **signal range expectations** (e.g., pitch, Hz, seconds).
* **Wire creation**:

  * Click-drag from **output → input**. All ports are compatible (always f32).
  * **Magnet targets** with hover outlines.
* **Selection & edit**:

  * Click to select; Shift-click multi-select.
  * Delete to remove; ⌘/Ctrl-D duplicates with offset.
* **Inspector panel**:

  * Parameters with sliders/number boxes; **live-preview** graphs for envelopes/filters.
  * **Oversampling** toggle & factor at patch level.
* **Custom node UI**:

  * Code editor (Monaco) with AssemblyScript syntax, compile button, diagnostics list.
  * Inputs/outputs editable as a table (id/label/order). Preview shows resulting ports.
* **Transport/Metering**:

  * CPU %, XRuns (buffer underruns), peak/RMS meters; sample rate & block size read-only.

### 9.2 Interactions specifics

* **Wire editing**: dragging a wire end re-targets; **Alt-drag** to fork from midpoint (fan-out).
* **Auto-layout** (optional): “Neatify” command that runs layered DAG layout (Sugiyama-style).
* **Undo/redo**: history of edits, including wire moves and parameter changes.
* **Keyboard**: `G` grab/move, `R` run/stop, `Cmd/Ctrl+Enter` compile, `Z`/`Shift+Z` undo/redo.

---

## 10) Security & sandboxing

* Custom AS restricted to a **sandboxed subset**:

  * No imports of JS host functions except the provided math intrinsics.
  * No heap allocation in render loop (compile-time lint).
  * Max code size limit (e.g., 256 KB source).
* Worklet and main thread communicate via **structured clone** only; SAB is numeric only.
* CSP: cross-origin isolation enabled for **SharedArrayBuffer**.
* Compiler runs on **Worker** to keep UI responsive.

---

## 11) Performance targets

* **Cold compile** (typical patch): < 1–2 s for medium graphs (browser dependent, cached).
* **Steady-state CPU**:

  * 48 kHz, block 256, OS=1: < 10% of one modern core for ~50 simple nodes.
  * OS=4 adds ~4–5× node cost + downsampler overhead; still within real-time for moderate graphs.
* **Latency**: I/O ≈ AudioWorklet buffer + device buffer; aim ≤ 12 ms at 48 kHz, 128 frames.

---

## 12) Error handling & diagnostics

* **Compile errors**: surface AS line/column; highlight in editor; keep previous safe binary running.
* **Graph errors**: cycles without delays; port mismatch; excessive fan-out causing copies.
* **Runtime guards**: denormal handling (flush-to-zero), NaN kill-switch (mute node and warn).
* **Profiler** (v1.1): per-node timing via simple cycle counter in Wasm (debug only).

---

## 13) Testing strategy

* **Unit**: node math against golden vectors (osc phase continuity, biquad step response, delay wrap).
* **IR/codegen**: snapshot test generated AS for known patches.
* **Audio**: deterministic render of test patches → compare hashes/PSNR against CPU reference.
* **Performance**: microbench of oversampling/downsampler; check GC counters remain zero during render.
* **UX**: Playwright flows (create node, wire, compile, hear tone).

---

## 14) File/package layout

```
/app
  /ui          # React UI: node editor, inspector, meters
  /graph       # TS graph model, validation, topo sort
  /codegen     # TS -> AS emitters, templates, custom-node glue
  /compiler    # asc wrapper, worker harness, caching
  /audio       # WorkletProcessor, SAB rings, Wasm loader
  /dsp         # Built-in node manifests + AS snippets (tested)
  /assets
  /tests
```

---

## 15) Example: tiny patch end-to-end

**Patch**: Sine → Biquad LP → Out (stereo)

**Generated (excerpt)**:

```ts
// constants from init
const FS  : f32 = 48000.0 * OS as f32;
const DT  : f32 = 1.0 / FS;
const F_C4: f32 = 261.6255653;

// state
var osc0 = SineOsc.init();
var biq0 = Biquad.initLowpass(0.2, 0.707, FS); // 0.2 pitch ~ 2^(0.2) * C4

// process one block
export function process(ptrL: i32, ptrR: i32): void {
  for (let n = 0; n < BLOCK; n++) {
    let accL: f32 = 0.0; let accR: f32 = 0.0;
    for (let k = 0; k < OS; k++) {
      const f = hzFromPitch(inp_pitch[n], F_C4);
      const s = osc0.step(f, DT);
      const y = biq0.process(s);
      accL = y; accR = y;
    }
    const out = downsample(accL); // half-band fold; returns one sample
    store<f32>(ptrL + (n<<2), out);
    store<f32>(ptrR + (n<<2), out);
  }
}
```

---

## 16) Headless DSP Benchmarking

To measure DSP performance without the browser or AudioWorklet, use the new Vite-node powered CLI tooling.

- **Build a Wasm artifact** from an existing patch JSON:

  ```bash
  npm run bench:build -- --patch scripts/dsp-runtime/fixtures/sine.json
  # or force baseline math implementations
  npm run bench:build -- --patch scripts/dsp-runtime/fixtures/sine.json --math baseline
  ```

  This writes the generated AssemblyScript source, compiled Wasm binary, and runtime metadata to `dist/dsp-runtime/`.

- **Run a benchmark directly from a patch** (compiles in-memory, runs N blocks, reports throughput):

  ```bash
  npm run bench:dsp -- --patch scripts/dsp-runtime/fixtures/fm-example.json --frames 96000 --math fast
  ```

- **Benchmark prebuilt modules** with metadata (ideal for A/B comparisons between different Wasm builds):

  ```bash
  npm run bench:dsp \
    -- --wasm dist/dsp-runtime/sine.wasm \
       --metadata dist/dsp-runtime/sine.metadata.json \
       --label prebuilt \
       --frames 96000
  ```

- **Compare math modes (fast vs baseline)** in one pass:

  ```bash
  npm run bench:dsp -- --patch scripts/dsp-runtime/fixtures/fm-example.json --math both --frames 96000
  ```

- **Batch comparisons**: supply a JSON config describing multiple cases to compare and optional warm-up/iteration settings:

  ```bash
  npm run bench:dsp -- --config scripts/dsp-runtime/fixtures/bench-example.json
  ```

- **Automation hooks**: pass `--json` to get machine-readable output (per-case throughput, average block time, relative speedups) for CI dashboards.

All commands run under Node, instantiate the Wasm module directly, and reuse the same AssemblyScript emitter that powers the browser build so benchmark results mirror production codegen. The harness now reports detailed per-case stats plus a summary table that highlights real-time ratios and speedups relative to the baseline math mode.

---

## 17) Extensibility roadmap

* **v1.1**: MIDI in, host tempo/transport, beat-synced nodes; better upsampler (polyphase).
* **v1.2**: Subpatchers, polyphony/voice allocation, parameter arrays.
* **v1.3**: Offline render/export; IR optimizations (common-subexpr, buffer fusion); node auto-vectorization.
* **v1.4**: GPU compute (WebGPU) nodes for heavy ops (FFT, convolution), mixed CPU/GPU scheduling.

---

## 18) Risks & mitigations

* **Compile size/latency** (asc in browser): cache compiler script; use a Worker; incremental rebuilds for small edits; pre-bundle built-in nodes.
* **Audio dropouts**: keep process call constant time; no dynamic allocation; parameter ingest O(1); keep downsampler efficient & SIMD.
* **Feedback abuse**: enforce minimum delay of 1 sample; add stability notes in UI; expose “DC blocker” utility node.
* **Cross-origin isolation**: document deployment headers for SAB (`COOP/COEP`).

---

## 19) Developer ergonomics

* **Node author kit**: template AS snippet + manifest, local hot-reload (no audio thread restarts when safe).
* **Graph debugger**: tap nodes to record short buffers; display spectrum/Lissajous.
* **Docstrings**: each node shows formulae and recommended ranges.

---

### Appendix A — Maths & conventions

**Pitch → frequency**
`f = 261.6255653005986 * 2^pitch`  (C4 baseline)

**1-pole smoother**
`y[n] = y[n-1] + a * (x[n] - y[n-1])`, `a = 1 - e^(−1/(τ·fs'))`

**Stereo downsample (half-band FIR, 4×)**
Use 33 non-zero taps (odd symmetry). SIMD accumulate four lanes per channel; keep phase state per channel.
