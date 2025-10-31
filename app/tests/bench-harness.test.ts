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
    expect(baseline.source).toContain("return Mathf.sin(x);");
    expect(baseline.source).toContain("return Mathf.cos(x);");
    expect(baseline.source).toContain("return Mathf.exp(x);");
    expect(baseline.source).toContain("return Mathf.pow(2.0, x);");
    expect(baseline.source).toContain("return Mathf.log(x);");
    expect(baseline.source).toContain("return Mathf.log2(x);");
    expect(baseline.source).toContain("return Mathf.pow(base, exponent);");
  });

  it("runs benchmarks for both math modes on the FM patch", async () => {
    const cases = await resolveBenchCases([
      { label: "fm", patchPath: FM_PATCH, mathMode: "both" }
    ]);

    expect(cases).toHaveLength(2);

    const metrics = cases.map((entry) =>
      measureRuntime(entry.label, entry.runtime, {
        warmupBlocks: 8,
        iterations: 64
      })
    );

    const modes = metrics.map((entry) => entry.mathMode).sort();
    expect(modes).toEqual(["baseline", "fast"]);

    for (const metric of metrics) {
      expect(metric.frames).toBeGreaterThan(0);
      expect(metric.blocks).toBeGreaterThan(0);
      expect(metric.averageBlockMicros).toBeGreaterThan(0);
      expect(Number.isFinite(metric.realtimeRatio)).toBe(true);
    }

    const summary = summarizeBenchmarks(metrics);
    expect(summary.table).toMatch(/Case\s+Math/);
    expect(summary.table).toMatch(/baseline/);
    expect(summary.table).toMatch(/fast/);
  });
});
