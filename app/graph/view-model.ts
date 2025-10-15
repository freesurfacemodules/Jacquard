import { createGraph } from "./graph";
import { NodeDescriptor, PatchGraph } from "./types";

export interface GraphViewModel {
  nodes: NodeDescriptor[];
  connections: PatchGraph["connections"];
  oversampling: PatchGraph["oversampling"];
  blockSize: PatchGraph["blockSize"];
  sampleRate: number;
}

export namespace GraphViewModel {
  export function fromGraph(graph: PatchGraph): GraphViewModel {
    return {
      nodes: graph.nodes,
      connections: graph.connections,
      oversampling: graph.oversampling,
      blockSize: graph.blockSize,
      sampleRate: graph.sampleRate
    };
  }

  export function createEmpty(): GraphViewModel {
    return fromGraph(createGraph());
  }
}
