import { describe, expect, it } from "vitest";
import { createGraph, addNode } from "@graph/graph";
import { instantiateNode } from "@dsp/nodes";
import { nanoid } from "@codegen/utils/nanoid";
import { createPatchDocument, normalizePatchDocument } from "@graph/persistence";
import { updatePatchSettings } from "@graph/graph";

const createPatch = () => {
  let graph = createGraph();
  graph = addNode(
    graph,
    instantiateNode("osc.sine", nanoid())
  );
  graph = addNode(
    graph,
    instantiateNode("io.output", nanoid())
  );
  return graph;
};

describe("patch persistence", () => {
  it("creates a document with the current version", () => {
    const patch = createPatch();
    const document = createPatchDocument(patch);
    expect(document.version).toBe(1);
    expect(document.graph).toEqual(patch);
    expect(document.graph).not.toBe(patch);
  });

  it("normalizes a document payload", () => {
    const patch = createPatch();
    const document = createPatchDocument(patch);
    const normalized = normalizePatchDocument(document);
    expect(normalized.version).toBe(document.version);
    expect(normalized.graph).toEqual(document.graph);
    expect(normalized.graph).not.toBe(document.graph);
  });

  it("accepts raw patch graphs", () => {
    const patch = createPatch();
    const normalized = normalizePatchDocument(patch);
    expect(normalized.version).toBe(1);
    expect(normalized.graph).toEqual(patch);
  });

  it("preserves patch settings in documents", () => {
    let patch = createPatch();
    patch = updatePatchSettings(patch, {
      sampleRate: 96_000,
      blockSize: 256,
      oversampling: 4
    });
    const document = createPatchDocument(patch);
    const restored = normalizePatchDocument(document);
    expect(restored.graph.sampleRate).toBe(96_000);
    expect(restored.graph.blockSize).toBe(256);
    expect(restored.graph.oversampling).toBe(4);
  });

  it("throws on invalid payloads", () => {
    expect(() => normalizePatchDocument(null)).toThrow(/Invalid patch document/);
    expect(() => normalizePatchDocument(42)).toThrow(/Invalid patch document/);
    expect(() => normalizePatchDocument({ version: 1 })).toThrow(/graph/);
  });
});
