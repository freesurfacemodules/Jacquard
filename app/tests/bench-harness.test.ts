import { describe, expect, it } from "vitest";
import { compilePatchFromFile } from "../../scripts/dsp-runtime/utils";
import {
  resolveBenchCases,
  measureRuntime,
  summarizeBenchmarks
} from "../../scripts/dsp-runtime/harness";

const FM_PATCH = "scripts/dsp-runtime/fixtures/fm-example.json";

describe("DSP math mode benchmarking", () => {
  it("emits baseline math wrappers that delegate to Mathf", async () => {
    const baseline = await compilePatchFromFile(FM_PATCH, {
      moduleName: "fm_baseline",
      mathMode: "baseline"
    });

    expect(baseline.mathMode).toBe("baseline");
    expect(baseline.optimizer).toBe("asc");
    expect(baseline.source).toContain("return Mathf.sin(x);");
    expect(baseline.source).toContain("return Mathf.cos(x);");
    expect(baseline.source).toContain("return Mathf.exp(x);");
    expect(baseline.source).toContain("return Mathf.pow(2.0, x);");
    expect(baseline.source).toContain("return Mathf.log(x);");
    expect(baseline.source).toContain("return Mathf.log2(x);");
    expect(baseline.source).toContain("return Mathf.pow(base, exponent);");
  });

  it("runs benchmarks for both math modes on the FM patch", async () => {
    let binaryenAvailable = true;
    try {
      await import("binaryen");
    } catch {
      binaryenAvailable = false;
      console.warn("[bench-harness test] binaryen not installed; skipping asc+binaryen variant.");
    }

    const cases = await resolveBenchCases([
      {
        label: "fm",
        patchPath: FM_PATCH,
        mathMode: "both",
        optimizer: binaryenAvailable ? "both" : "asc"
      }
    ]);

    expect(cases.length).toBeGreaterThanOrEqual(binaryenAvailable ? 4 : 2);

    const metrics = cases.map((entry) =>
      measureRuntime(entry.label, entry.runtime, {
        warmupBlocks: 8,
        iterations: 64
      })
    );

    const optimizers = new Set(metrics.map((entry) => entry.optimizer));
    expect(optimizers.has("asc")).toBe(true);
    if (binaryenAvailable) {
      expect(optimizers.has("asc+binaryen")).toBe(true);
    }

    for (const metric of metrics) {
      console.log(
        `bench: ${metric.caseLabel} | math=${metric.mathMode} | optimizer=${metric.optimizer} | blocks/sec=${metric.blocksPerSecond.toFixed(
          2
        )} | avg_block_us=${metric.averageBlockMicros.toFixed(3)} | realtime=${metric.realtimeRatio.toFixed(3)}x`
      );
    }

    const modes = Array.from(new Set(metrics.map((entry) => entry.mathMode))).sort();
    expect(modes).toEqual(["baseline", "fast"]);

    for (const metric of metrics) {
      expect(metric.frames).toBeGreaterThan(0);
      expect(metric.blocks).toBeGreaterThan(0);
      expect(metric.averageBlockMicros).toBeGreaterThan(0);
      expect(Number.isFinite(metric.realtimeRatio)).toBe(true);
    }

    const summary = summarizeBenchmarks(metrics);
    console.log("bench summary:\n" + summary.table);
    expect(summary.table).toMatch(/Case\s+Math\s+Optimizer/);
    if (binaryenAvailable) {
      expect(summary.table).toMatch(/asc\W+/);
      expect(summary.table).toMatch(/binaryen/);
    }
  });
});
