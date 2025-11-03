import { PatchGraph } from "./types";

export const PATCH_DOCUMENT_VERSION = 2;

export interface PatchDocument {
  version: number;
  graph: PatchGraph;
}

const clone = <T>(value: T): T =>
  typeof structuredClone === "function"
    ? structuredClone(value)
    : (JSON.parse(JSON.stringify(value)) as T);

const isPatchGraph = (value: unknown): value is PatchGraph => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<PatchGraph>;
  return Array.isArray(candidate.nodes) && Array.isArray(candidate.connections);
};

export function createPatchDocument(graph: PatchGraph): PatchDocument {
  return {
    version: PATCH_DOCUMENT_VERSION,
    graph: clone(graph)
  };
}

export function normalizePatchDocument(input: unknown): PatchDocument {
  if (!input || typeof input !== "object") {
    throw new Error("Invalid patch document: expected an object.");
  }

  const candidate = input as Partial<Record<string, unknown>>;

  if ("graph" in candidate) {
    const version =
      typeof candidate.version === "number"
        ? candidate.version
        : PATCH_DOCUMENT_VERSION;
    if (!isPatchGraph(candidate.graph)) {
      throw new Error("Invalid patch document: missing graph payload.");
    }
    return {
      version,
      graph: clone(candidate.graph as PatchGraph)
    };
  }

  // Fallback: assume the entire object is a raw PatchGraph.
  if (!isPatchGraph(input)) {
    throw new Error("Invalid patch document: expected a graph object.");
  }
  return {
    version: PATCH_DOCUMENT_VERSION,
    graph: clone(input as PatchGraph)
  };
}
