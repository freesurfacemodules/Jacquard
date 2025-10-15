export type NodeId = string;
export type PortId = string;

export type DataType = "audio";

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
  metadata?: Record<string, unknown>;
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
}
