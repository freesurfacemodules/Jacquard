export type NodeId = string;
export type PortId = string;
export type SubpatchId = string;

export type DataType = "audio";

export interface NodePosition {
  x: number;
  y: number;
}

export interface NodeMetadata {
  position?: NodePosition;
  [key: string]: unknown;
}

export interface PortDescriptor {
  id: PortId;
  name: string;
  type: DataType;
}

export interface NodeDescriptor {
  id: NodeId;
  kind: string;
  label: string;
  inputs: PortDescriptor[];
  outputs: PortDescriptor[];
  parameters: Record<string, number>;
  metadata?: NodeMetadata;
  subpatchId?: SubpatchId;
}

export interface Connection {
  id: string;
  from: {
    node: NodeId;
    port: PortId;
  };
  to: {
    node: NodeId;
    port: PortId;
  };
}

export interface PatchGraph {
  nodes: NodeDescriptor[];
  connections: Connection[];
  oversampling: 1 | 2 | 4 | 8;
  blockSize: 128 | 256 | 512;
  sampleRate: number;
  subpatches?: Record<SubpatchId, SubpatchGraph>;
  rootSubpatchId?: SubpatchId;
}

export interface SubpatchPortSpec {
  id: PortId;
  name: string;
  type: DataType;
  order: number;
}

export interface SubpatchGraph {
  id: SubpatchId;
  name: string;
  parentId?: SubpatchId | null;
  inputs: SubpatchPortSpec[];
  outputs: SubpatchPortSpec[];
  inputNodeId: NodeId;
  outputNodeId: NodeId;
  graph: {
    nodes: NodeDescriptor[];
    connections: Connection[];
  };
}
