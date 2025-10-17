import type { PlanInput, PlanNode } from "@codegen/plan";
import type { PortDescriptor } from "@graph/types";

export interface DspNodeManifest {
  kind: string;
  category: "oscillator" | "filter" | "io" | "utility" | "math";
  label: string;
  inputs: PortDescriptor[];
  outputs: PortDescriptor[];
  defaultParams?: Record<string, number>;
  appearance?: {
    width?: number;
    height?: number;
    icon?: string;
  };
  controls?: NodeControl[];
}

export interface NodeEmitHelpers {
  indentLines(block: string, level?: number): string;
  numberLiteral(value: number): string;
  sanitizeIdentifier(identifier: string): string;
  buildInputExpression(input: PlanInput): string;
  parameterRef(index: number): string;
}

export interface NodeAssembly {
  declarations?: string;
  emit?(planNode: PlanNode, helpers: NodeEmitHelpers): string;
}

export interface NodeImplementation {
  manifest: DspNodeManifest;
  assembly?: NodeAssembly;
}

export interface NodeControl {
  id: string;
  label: string;
  type: "slider";
  min: number;
  max: number;
  step?: number;
}
