# Performance Roadmap (AssemblyScript DSP Runtime)

This document captures the most impactful opportunities we’ve spotted in the generated AssemblyScript hot path. The line references point at the current generator (`app/codegen/assemblyscript.ts` unless noted) on the branch where this analysis was performed.

## 1. Hot-Path Loop Structure

- **Per-sample parameter smoothing** (lines 101‑117): we run a `for (let p...)` loop inside every audio sample iteration even when parameter targets aren’t moving.  
  _Plan_: Move smoothing to a per-block pass, or gate the loop behind a dirty flag that only iterates over touched parameters. Expect double-digit percentage savings in patches with large control counts.
- **Oversampling loop always executes** (line 118): even when `OVERSAMPLING===1` we still pay the loop setup/branch cost each sample.  
  _Plan_: Emit two process kernels—one for OS==1, one for OS>1—or hoist a fast-path branch outside the `n` loop.
- **Wire zeroing** (line 123): every wire buffer is cleared each sub-step even if the node topology guarantees all writes before reads.  
  _Plan_: Track “source writes” in the execution plan and only emit initializers for wires that actually need them.

## 2. Math / Signal Helpers

- **Shared trig evaluation**: `fastSin` and `fastCos` both recompute `fastSinPoly/fastCosPoly` when called separately (lines 181‑207). The generator already has `fastSinCosInto`, but many node snippets still call the scalar versions.  
  _Plan_: Update node emitters (oscillators, filters, noise) to call `fastSinCosInto` once per sample and reuse both lanes.
- **Fast POW usage**: `fastPow` currently falls back to `fastExp(fastLog)` (lines 246‑250). For integer exponents (tilt curves, envelope shapes) we can emit specialized multiply chains or use `powf_approx` with caching.  
  _Plan_: Extend node manifests with exponent metadata and specialize in the emitter.

## 3. Memory & Data Layout

- **StaticArray access overhead**: parameter/state buffers (`StaticArray<f32>`) incur bounds handling and can’t be vectorized.  
  _Plan_: Move to manual linear-memory pointers (`memory.data`) and operate via `load<f32>/store<f32>` with explicit `unchecked` indexing.
- **Downsampler history** (`HalfbandDownsampler`, lines 330‑430): the push logic iterates generic FIR taps every oversample and performs multiple early returns.  
  _Plan_: Specialize per-factor kernels (2×/4×/8×) with unrolled loops and optional SIMD intrinsics once we add `--enable simd`.
- **State object proliferation**: nodes like ladder filters and scopes allocate helper structs even when not referenced (lines 752‑822).  
  _Plan_: Trim unused objects via execution-plan analysis (e.g., only create `FastTrigResult` if a node genuinely uses trig).

## 4. Monitoring & Instrumentation

- **Envelope/scope mirrors** (lines 538‑708): We always allocate and refresh monitor buffers even in audio-only patches.  
  _Plan_: Emit the entire monitor section behind compile-time guards—if no monitors exist, skip allocation and function stubs completely.
- **Scope push frequency**: scopes default to the same oversampled cadence as DSP.  
  _Plan_: decimate scope updates to ~60 Hz inside the Wasm (already adequate for UI) to free cycles in dense graphs.

- ## 5. Code Generation Enhancements

- ~~**Execution-plan metadata**: augment `PlanNode` with “pure control” vs “audio” markers so codegen can avoid unnecessary oversampled math (e.g., Schmitt triggers, counters).  
  _Plan_: precompute sample-rate requirements during planning and emit reduced-rate loops for control-only nodes.~~ (Explicitly deprioritized.)
- **Common subexpression hoisting**: Several nodes recompute the same coefficients inside the per-sample loop (e.g., ladder filter `cutoffHz` scaling, clock BPM conversions).  
  _Plan_: extend node emitters with `prepare` blocks executed once per audio block (or per parameter change) and reuse cached coefficients.

## 6. Tooling / Compiler Pipeline

- **SIMD enablement**: neither Binaryen nor `asc` auto-vectorize, but we can hand-author SIMD intrinsics in the generated AS once the host enables the Wasm SIMD feature during instantiation.  
  _Plan_: add a math-mode flag (`--simd`) to generate `v128` operations for FIRs, vector adds/subs, and trig polynomial evaluation.
- **Binaryen pass experiments** *(in progress)*: optional `--optimizer binaryen` flag runs `wasm-opt` with aggressive passes after `asc` compilation, enabling head-to-head benchmarks between plain `asc` and asc+Binaryen builds.
- **Profile-guided benchmarks**: integrate the new CLI with multiple fixtures (`sine`, `fm`, `complex`) under CI and collect JSON summaries; use the data to prioritize the roadmap above.
- **Per-node microbenchmarks** *(done)*: preset "nodes" suite drives minimal patches for oscillators, filters, delays, envelopes, etc., so we can spot hotspots quickly.

## 7. Subnormal Handling

- **Flush-to-zero / Dither**: Long feedback paths can generate denormals, tanking performance on some CPUs.  
  _Plan_: add a configurable flush-to-zero helper to clamp |x| < ~1e-20 to 0.0 (and optionally white-noise dither). Call it inside `pushOutputSamples` and other hot accumulators so we never feed subnormals into filters/delays.

## Immediate Next Steps

1. Prototype “dirty parameter smoothing” and measure on the FM/complex patches (expect 5‑10 % gain if many controls are static).
2. Split process kernels for oversampling==1 vs >1 to remove the extra loop and downsampler cost in simple patches.
3. Specialize downsampler kernels and ensure the generator uses the sin/cos dual call consistently.

These items should yield meaningful headroom increases before we tackle larger SIMD or architectural changes.
