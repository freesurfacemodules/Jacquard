import {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  addNode,
  connectNodes as connectGraphNodes,
  createGraph,
  removeConnection,
  removeConnectionsFromPort as removeGraphConnectionsFromPort,
  removeConnectionsToPort as removeGraphConnectionsToPort,
  removeNode as removeGraphNode,
  PatchSettingsUpdate,
  updatePatchSettings as updateGraphPatchSettings,
  updateNodePosition as updateGraphNodePosition,
  updateNodeParameter as updateGraphNodeParameter,
  type ConnectNodesParams
} from "@graph/graph";
import {
  GraphViewModel,
  graphViewModelFromGraph
} from "@graph/view-model";
import {
  Connection,
  NodeDescriptor,
  NodePosition,
  PatchGraph,
  NodeMetadata,
  PortDescriptor,
  SubpatchGraph,
  SubpatchId,
  SubpatchPortSpec
} from "@graph/types";
import { GraphValidationResult, validateGraph } from "@graph/validation";
import { compilePatch, CompileResult } from "@compiler/compiler";
import type { ScopeMonitor } from "@codegen/plan";
import {
  loadPatchProcessor,
  WorkletHandle
} from "@audio/worklet-loader";
import { getNodeImplementation, instantiateNode } from "@dsp/nodes";
import { resolveControlMin, resolveControlMax, resolveControlStep } from "@dsp/utils/controls";
import type { PlanControl, EnvelopeMonitor } from "@codegen/plan";
import {
  createPatchDocument,
  normalizePatchDocument,
  PATCH_DOCUMENT_VERSION,
  PatchDocument
} from "@graph/persistence";
import { nanoid } from "@codegen/utils/nanoid";
import { clearAutosavePatch, loadAutosavePatch, saveAutosavePatch } from "@ui/utils/indexedDb";

const PARAM_MESSAGE_BATCH = "parameterBatch";
const PARAM_MESSAGE_SINGLE = "parameter";

const makeParameterKey = (nodeId: string, controlId: string): string =>
  `${nodeId}:${controlId}`;

const DELAY_NODE_KINDS = new Set<string>(["delay.ddl", "delay.waveguide"]);
const DELAY_CONTROL_ID = "delay";
const isDelayNodeKind = (kind: string): boolean => DELAY_NODE_KINDS.has(kind);

const createInitialGraph = (): PatchGraph => {
  const baseGraph = createGraph();
  const outputNode = instantiateNode("io.output", nanoid());
  return addNode(baseGraph, outputNode);
};

export const SUBPATCH_INPUT_DUMMY_PORT = "__subpatch_input_dummy__" as const;
export const SUBPATCH_OUTPUT_DUMMY_PORT = "__subpatch_output_dummy__" as const;

const clampControlValue = (
  kind: string,
  controlId: string,
  value: number,
  oversampling: number
): number => {
  const implementation = getNodeImplementation(kind);
  const control = implementation?.manifest.controls?.find((entry) => entry.id === controlId);
  const context = { oversampling };
  if (control && control.type === "select") {
    if (control.options.length === 0) {
      return value;
    }
    let closest = control.options[0].value;
    let minDistance = Math.abs(value - closest);
    for (let index = 1; index < control.options.length; index++) {
      const optionValue = control.options[index].value;
      const distance = Math.abs(value - optionValue);
      if (distance < minDistance) {
        closest = optionValue;
        minDistance = distance;
      }
    }
    return closest;
  }
  const min = resolveControlMin(control, context);
  const max = resolveControlMax(control, context);
  const clamped = Math.min(max, Math.max(min, value));
  const step = resolveControlStep(control, context);
  if (step > 0) {
    const quantized = Math.round(clamped / step) * step;
    return Number.isFinite(quantized) ? quantized : clamped;
  }
  return clamped;
};

const cloneValue = <T,>(value: T): T =>
  typeof structuredClone === "function"
    ? structuredClone(value)
    : (JSON.parse(JSON.stringify(value)) as T);

const sortPortSpecs = (specs: SubpatchGraph["inputs"]): SubpatchGraph["inputs"] =>
  specs
    .slice()
    .sort((lhs, rhs) => lhs.order - rhs.order)
    .map((spec, index) => ({ ...spec, order: index }));

const buildPortDescriptors = (specs: SubpatchGraph["inputs"]): PortDescriptor[] =>
  specs.map((spec) => ({ id: spec.id, name: spec.name, type: "audio" }));

const SUBPATCH_INPUT_DUMMY_DESCRIPTOR: PortDescriptor = {
  id: SUBPATCH_INPUT_DUMMY_PORT,
  name: "+ Add Input",
  type: "audio"
};

const SUBPATCH_OUTPUT_DUMMY_DESCRIPTOR: PortDescriptor = {
  id: SUBPATCH_OUTPUT_DUMMY_PORT,
  name: "+ Add Output",
  type: "audio"
};

const refreshSubpatchIONodes = (entry: SubpatchGraph): void => {
  entry.inputs = sortPortSpecs(entry.inputs);
  entry.outputs = sortPortSpecs(entry.outputs);

  const sortedInputs = entry.inputs;
  const sortedOutputs = entry.outputs;

  const inputNodeIndex = entry.graph.nodes.findIndex((node) => node.id === entry.inputNodeId);
  if (inputNodeIndex >= 0) {
    const inputNode = entry.graph.nodes[inputNodeIndex];
    entry.graph.nodes[inputNodeIndex] = {
      ...inputNode,
      outputs: [...buildPortDescriptors(sortedInputs), SUBPATCH_INPUT_DUMMY_DESCRIPTOR]
    };
  }

  const outputNodeIndex = entry.graph.nodes.findIndex((node) => node.id === entry.outputNodeId);
  if (outputNodeIndex >= 0) {
    const outputNode = entry.graph.nodes[outputNodeIndex];
    entry.graph.nodes[outputNodeIndex] = {
      ...outputNode,
      inputs: [...buildPortDescriptors(sortedOutputs), SUBPATCH_OUTPUT_DUMMY_DESCRIPTOR]
    };
  }
};

const resolveParentContainer = (
  rootGraph: PatchGraph,
  parentId: SubpatchId | null | undefined
): { nodes: NodeDescriptor[]; connections: PatchGraph["connections"] } => {
  if (!parentId) {
    return rootGraph;
  }
  const entry = rootGraph.subpatches?.[parentId];
  if (!entry) {
    throw new Error(`Missing parent subpatch ${parentId}`);
  }
  return entry.graph;
};

const updateParentSubpatchNode = (rootGraph: PatchGraph, entry: SubpatchGraph): void => {
  const container = resolveParentContainer(rootGraph, entry.parentId ?? null);
  const nodeIndex = container.nodes.findIndex((node) => node.subpatchId === entry.id);
  if (nodeIndex < 0) {
    return;
  }
  const parentNode = container.nodes[nodeIndex];
  container.nodes[nodeIndex] = {
    ...parentNode,
    inputs: [...buildPortDescriptors(entry.inputs), { ...SUBPATCH_INPUT_DUMMY_DESCRIPTOR }],
    outputs: [...buildPortDescriptors(entry.outputs), { ...SUBPATCH_OUTPUT_DUMMY_DESCRIPTOR }]
  };
};

const resolveMutableContainer = (
  rootGraph: PatchGraph,
  path: SubpatchId[]
): {
  container: { nodes: NodeDescriptor[]; connections: Connection[] };
  entry?: SubpatchGraph | null;
} => {
  let container: { nodes: NodeDescriptor[]; connections: Connection[] } = rootGraph;
  let entry: SubpatchGraph | null | undefined = null;
  for (const id of path) {
    entry = rootGraph.subpatches?.[id];
    if (!entry) {
      return { container, entry: null };
    }
    container = entry.graph;
  }
  return { container, entry };
};

type PatchChangeType = "topology" | "parameter" | "metadata";

interface PatchSnapshot {
  graph: PatchGraph;
  parameterValues: Record<string, number>;
  selectedNodeId: string | null;
  selectedNodeIds: string[];
  changeType: PatchChangeType;
}

interface EnvelopeSnapshot {
  value: number;
  progress: number;
}

export interface ScopeSnapshot {
  samples: Float32Array;
  sampleInterval: number;
  scale: number;
  requestedTime: number;
  mode: number;
  factor: number;
  coverage: number;
}

const filterParameterValuesForGraph = (
  values: Record<string, number>,
  graph: PatchGraph
): Record<string, number> => {
  const allowedNodeIds = new Set(graph.nodes.map((node) => node.id));
  const next: Record<string, number> = {};
  for (const [key, value] of Object.entries(values)) {
    const [nodeId] = key.split(":");
    if (nodeId && allowedNodeIds.has(nodeId)) {
      next[key] = value;
    }
  }
  return next;
};

const normalizeDelayNodes = (
  graph: PatchGraph,
  oversampling: number
): { graph: PatchGraph; updatedValues: Record<string, number> } => {
  let changed = false;
  const updatedValues: Record<string, number> = {};
  const nodes = graph.nodes.map((node) => {
    if (!isDelayNodeKind(node.kind)) {
      return node;
    }
    const rawValue = typeof node.parameters[DELAY_CONTROL_ID] === "number"
      ? node.parameters[DELAY_CONTROL_ID]
      : 1;
    const clamped = clampControlValue(node.kind, DELAY_CONTROL_ID, rawValue, oversampling);
    updatedValues[node.id] = clamped;
    if (clamped === rawValue) {
      return node;
    }
    changed = true;
    return {
      ...node,
      parameters: {
        ...node.parameters,
        [DELAY_CONTROL_ID]: clamped
      }
    };
  });

  return {
    graph: changed ? { ...graph, nodes } : graph,
    updatedValues
  };
};

const buildParameterValuesForGraph = (graph: PatchGraph): Record<string, number> => {
  const values: Record<string, number> = {};
  for (const node of graph.nodes) {
    const implementation = getNodeImplementation(node.kind);
    const controls = implementation?.manifest.controls ?? [];
    for (const control of controls) {
      const key = makeParameterKey(node.id, control.id);
      const nodeValue = node.parameters?.[control.id];
      if (typeof nodeValue === "number") {
        values[key] = clampControlValue(node.kind, control.id, nodeValue, graph.oversampling);
      } else if (
        implementation?.manifest.defaultParams &&
        typeof implementation.manifest.defaultParams[control.id] === "number"
      ) {
        const fallbackValue = implementation.manifest.defaultParams[control.id]!;
        values[key] = clampControlValue(node.kind, control.id, fallbackValue, graph.oversampling);
      } else {
        const context = { oversampling: graph.oversampling };
        const minValue = resolveControlMin(control, context);
        values[key] = clampControlValue(node.kind, control.id, minValue, graph.oversampling);
      }
    }
  }
  return values;
};

type AudioEngineState = "unsupported" | "idle" | "starting" | "running" | "error";

export interface AudioControls {
  state: AudioEngineState;
  error: string | null;
  isSupported: boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface PatchController {
  graph: PatchGraph;
  rootGraph: PatchGraph;
  viewModel: GraphViewModel;
  validation: GraphValidationResult;
  artifact: CompileResult | null;
  compile(): Promise<CompileResult>;
  audio: AudioControls;
  addNode(node: NodeDescriptor): void;
  connectNodes(params: ConnectNodesParams): void;
  disconnectConnection(connectionId: string): void;
  removeNode(nodeId: string): void;
  removeNodes(nodeIds: string[]): void;
  removeConnectionsFromPort(nodeId: string, portId: string): void;
  removeConnectionsToPort(nodeId: string, portId: string): void;
  updateNodePosition(nodeId: string, position: NodePosition): void;
  updateNodeParameter(nodeId: string, parameterId: string, value: number): void;
  selectedNodeId: string | null;
  selectedNodeIds: string[];
  selectNode(nodeId: string | null): void;
  selectNodes(nodeIds: string[]): void;
  getParameterValue(nodeId: string, controlId: string): number;
  envelopeSnapshots: Record<string, EnvelopeSnapshot>;
  getEnvelopeSnapshot(nodeId: string): EnvelopeSnapshot;
  getScopeSnapshot(nodeId: string): ScopeSnapshot;
  subscribeScopeSnapshot(nodeId: string, listener: (snapshot: ScopeSnapshot) => void): () => void;
  undo(): void;
  redo(): void;
  canUndo: boolean;
  canRedo: boolean;
  exportPatch(): PatchDocument;
  importPatch(document: PatchDocument | PatchGraph, options?: { recordHistory?: boolean }): void;
  updatePatchSettings(settings: PatchSettingsUpdate): void;
  activeSubpatchPath: SubpatchId[];
  openSubpatch(subpatchId: SubpatchId): void;
  exitSubpatch(levels?: number): void;
  renameNode(nodeId: string, label: string): void;
  renameNodeOutput(nodeId: string, portId: string, label: string): void;
  addSubpatchPort(
    subpatchId: SubpatchId,
    direction: "input" | "output",
    preferredName?: string
  ): SubpatchPortSpec | null;
  renameSubpatchPort(
    subpatchId: SubpatchId,
    direction: "input" | "output",
    portId: string,
    name: string
  ): void;
  removeSubpatchPort(
    subpatchId: SubpatchId,
    direction: "input" | "output",
    portId: string
  ): void;
  createSubpatchFromSelection(nodeIds: string[]): void;
  resetPatch(): void;
  updateActiveGraph(
    updater: (graph: PatchGraph) => PatchGraph,
    options?: {
      changeType?: PatchChangeType;
      selectNode?: string | null;
      recordHistory?: boolean;
      afterCommit?: (previous: PatchGraph, updated: PatchGraph) => void;
    }
  ): boolean;
}

const PatchContext = createContext<PatchController | null>(null);

export function PatchProvider({ children }: PropsWithChildren): JSX.Element {
  const [graph, setGraph] = useState<PatchGraph>(() => createInitialGraph());
  const [artifact, setArtifact] = useState<CompileResult | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [parameterBindings, setParameterBindings] = useState<PlanControl[]>([]);
  const [envelopeSnapshots, setEnvelopeSnapshots] = useState<Record<string, EnvelopeSnapshot>>(
    {}
  );
  const [parameterValues, setParameterValues] = useState<Record<string, number>>({});
  const [topologyVersion, setTopologyVersion] = useState(0);
  const [undoStack, setUndoStack] = useState<PatchSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<PatchSnapshot[]>([]);
  const [subpatchPath, setSubpatchPath] = useState<SubpatchId[]>([]);

  const activeGraph = useMemo(() => {
    if (subpatchPath.length === 0) {
      return graph;
    }

    const targetId = subpatchPath[subpatchPath.length - 1];
    const target = graph.subpatches?.[targetId];
    if (!target) {
      console.warn("[PatchContext] Missing subpatch graph for id", targetId);
      return graph;
    }

    return {
      nodes: target.graph.nodes,
      connections: target.graph.connections,
      oversampling: graph.oversampling,
      blockSize: graph.blockSize,
      sampleRate: graph.sampleRate,
      subpatches: graph.subpatches,
      rootSubpatchId: graph.rootSubpatchId
    };
  }, [graph, subpatchPath]);

  const viewModel = useMemo(() => graphViewModelFromGraph(activeGraph), [activeGraph]);
  const validation = useMemo(() => validateGraph(graph), [graph]);

  const audioSupported =
    typeof window !== "undefined" &&
    (typeof window.AudioContext === "function" ||
      typeof (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ===
        "function");
  const [audioState, setAudioState] = useState<AudioEngineState>(
    audioSupported ? "idle" : "unsupported"
  );
  const [audioError, setAudioError] = useState<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletHandleRef = useRef<WorkletHandle | null>(null);
  const portListenerRef = useRef<((event: MessageEvent) => void) | null>(null);
  const parameterBindingsRef = useRef<PlanControl[]>([]);
  const envelopeSnapshotsRef = useRef<Record<string, EnvelopeSnapshot>>({});
  const envelopeBindingsRef = useRef<EnvelopeMonitor[]>([]);
  const scopeSnapshotsRef = useRef<Record<string, ScopeSnapshot>>({});
  const scopeBindingsRef = useRef<ScopeMonitor[]>([]);
  const scopeSnapshotListenersRef = useRef<Map<string, Set<(snapshot: ScopeSnapshot) => void>>>(
    new Map()
  );

  const notifyScopeListeners = useCallback((nodeId: string, snapshot: ScopeSnapshot) => {
    const listeners = scopeSnapshotListenersRef.current.get(nodeId);
    if (!listeners || listeners.size === 0) {
      return;
    }
    for (const listener of Array.from(listeners)) {
      try {
        listener(snapshot);
      } catch (error) {
        console.error("[PatchContext] Scope listener error", error);
      }
    }
  }, []);
  const artifactRef = useRef<CompileResult | null>(null);
  const parameterValuesRef = useRef<Record<string, number>>({});
  const graphRef = useRef<PatchGraph>(graph);
  const selectedNodeIdRef = useRef<string | null>(selectedNodeId);
  const selectedNodeIdsRef = useRef<string[]>(selectedNodeIds);
  const subpatchPathRef = useRef<SubpatchId[]>(subpatchPath);
  const autosaveHydratedRef = useRef(false);

  useEffect(() => {
    parameterBindingsRef.current = parameterBindings;
  }, [parameterBindings]);

  useEffect(() => {
    selectedNodeIdsRef.current = selectedNodeIds;
  }, [selectedNodeIds]);

  useEffect(() => {
    subpatchPathRef.current = subpatchPath;
  }, [subpatchPath]);

  useEffect(() => {
    artifactRef.current = artifact;
    const bindings = artifact?.envelopeMonitors ?? [];
    envelopeBindingsRef.current = bindings;
    const scopeBindings = artifact?.scopeMonitors ?? [];
    scopeBindingsRef.current = scopeBindings;
    if (bindings.length === 0) {
      if (Object.keys(envelopeSnapshotsRef.current).length !== 0) {
        envelopeSnapshotsRef.current = {};
        setEnvelopeSnapshots({});
      }
      return;
    }

    setEnvelopeSnapshots((prev) => {
      const next: Record<string, EnvelopeSnapshot> = {};
      let changed = false;
      for (const binding of bindings) {
        const existing = prev[binding.nodeId] ?? { value: 0, progress: -1 };
        next[binding.nodeId] = existing;
        if (!prev[binding.nodeId]) {
          changed = true;
        }
      }
      if (Object.keys(prev).length !== bindings.length) {
        changed = true;
      }
      if (changed) {
        envelopeSnapshotsRef.current = next;
        return next;
      }
      envelopeSnapshotsRef.current = prev;
      return prev;
    });

    if (scopeBindings.length === 0) {
      if (Object.keys(scopeSnapshotsRef.current).length !== 0) {
        const previous = scopeSnapshotsRef.current;
        scopeSnapshotsRef.current = {};
        for (const [nodeId, snapshot] of Object.entries(previous)) {
          notifyScopeListeners(nodeId, {
            samples: new Float32Array(0),
            sampleInterval: snapshot.sampleInterval,
            scale: snapshot.scale,
            requestedTime: snapshot.requestedTime,
            mode: 0,
            factor: snapshot.factor,
            coverage: 0
          });
        }
      }
    } else {
      const next: Record<string, ScopeSnapshot> = {};
      for (const binding of scopeBindings) {
        const snapshot = scopeSnapshotsRef.current[binding.nodeId] ?? {
          samples: new Float32Array(0),
          sampleInterval: 1 / Math.max(1, graph.sampleRate),
          scale: 1,
          requestedTime: 0.01,
          mode: 0,
          factor: binding.levelFactors?.[0] ?? 1,
          coverage: 0
        };
        next[binding.nodeId] = snapshot;
        notifyScopeListeners(binding.nodeId, snapshot);
      }
      scopeSnapshotsRef.current = next;
    }
  }, [artifact]);

  useEffect(() => {
    parameterValuesRef.current = parameterValues;
  }, [parameterValues]);

  useEffect(() => {
    graphRef.current = graph;
  }, [graph]);

  useEffect(() => {
    selectedNodeIdRef.current = selectedNodeId;
  }, [selectedNodeId]);

  const produceGraphForActivePath = useCallback(
    (updater: (graph: PatchGraph) => PatchGraph): PatchGraph => {
      const rootGraph = graphRef.current;
      const path = subpatchPathRef.current;
      if (path.length === 0) {
        return updater(rootGraph);
      }

      const subpatches = rootGraph.subpatches ?? {};
      const targetId = path[path.length - 1];
      const target = subpatches[targetId];
      if (!target) {
        console.warn("[PatchContext] Unable to locate subpatch for update", targetId);
        return rootGraph;
      }

      const sliceGraph: PatchGraph = {
        nodes: cloneValue(target.graph.nodes),
        connections: cloneValue(target.graph.connections),
        sampleRate: rootGraph.sampleRate,
        blockSize: rootGraph.blockSize,
        oversampling: rootGraph.oversampling,
        subpatches: undefined,
        rootSubpatchId: undefined
      };

      const updatedSlice = updater(sliceGraph);
      if (updatedSlice === sliceGraph) {
        return rootGraph;
      }

      const nextSubpatches = {
        ...subpatches,
        [targetId]: {
          ...target,
          graph: {
            nodes: updatedSlice.nodes,
            connections: updatedSlice.connections
          }
        }
      };

      return {
        ...rootGraph,
        subpatches: nextSubpatches
      };
    },
    []
  );

  const applyGraphChange = useCallback(
    (
      nextGraph: PatchGraph,
      options: {
        changeType?: PatchChangeType;
        selectNode?: string | null;
        recordHistory?: boolean;
        afterCommit?: (previous: PatchGraph, updated: PatchGraph) => void;
      } = {}
    ): boolean => {
      const previousGraph = graphRef.current;
      if (nextGraph === previousGraph) {
        if (options.selectNode !== undefined) {
          const nextIds = options.selectNode ? [options.selectNode] : [];
          setSelectedNodeIds(nextIds);
          selectedNodeIdsRef.current = nextIds;
          setSelectedNodeId(options.selectNode);
          selectedNodeIdRef.current = options.selectNode;
        }
        return false;
      }

      const changeType = options.changeType ?? "topology";
      const shouldRecord = options.recordHistory ?? true;

      if (shouldRecord) {
        const snapshot: PatchSnapshot = {
          graph: previousGraph,
          parameterValues: { ...parameterValuesRef.current },
          selectedNodeId: selectedNodeIdRef.current,
          selectedNodeIds: [...selectedNodeIdsRef.current],
          changeType
        };
        setUndoStack((prev) => [...prev, snapshot]);
      }
      setRedoStack([]);

      setGraph(nextGraph);
      graphRef.current = nextGraph;

      if (options.selectNode !== undefined) {
        const nextIds = options.selectNode ? [options.selectNode] : [];
        setSelectedNodeIds(nextIds);
        selectedNodeIdsRef.current = nextIds;
        setSelectedNodeId(options.selectNode);
        selectedNodeIdRef.current = options.selectNode;
      }

      if (changeType === "topology") {
        setTopologyVersion((version) => version + 1);
        setParameterBindings([]);
      }

      if (options.afterCommit) {
        options.afterCommit(previousGraph, nextGraph);
      }

      return true;
    },
    [
      setGraph,
      setUndoStack,
      setRedoStack,
      setSelectedNodeId,
      setTopologyVersion,
      setParameterBindings
    ]
  );

  const applyActiveGraphChange = useCallback(
    (
      updater: (graph: PatchGraph) => PatchGraph,
      options?: Parameters<typeof applyGraphChange>[1]
    ) => {
      const nextGraph = produceGraphForActivePath(updater);
      return applyGraphChange(nextGraph, options);
    },
    [applyGraphChange, produceGraphForActivePath]
  );
  const updateActiveGraph = useCallback(
    (
      updater: (graph: PatchGraph) => PatchGraph,
      options?: {
        changeType?: PatchChangeType;
        selectNode?: string | null;
        recordHistory?: boolean;
        afterCommit?: (previous: PatchGraph, updated: PatchGraph) => void;
      }
    ) => applyActiveGraphChange(updater, options),
    [applyActiveGraphChange]
  );

  const openSubpatch = useCallback(
    (subpatchId: SubpatchId) => {
      const rootGraph = graphRef.current;
      const entry = rootGraph.subpatches?.[subpatchId];
      if (!entry) {
        console.warn("[PatchContext] Attempted to open missing subpatch", subpatchId);
        return;
      }

      const currentPath = subpatchPathRef.current;
      const expectedParent = currentPath.length > 0 ? currentPath[currentPath.length - 1] : null;
      const declaredParent = entry.parentId ?? null;
      if (declaredParent !== null && declaredParent !== expectedParent) {
        console.warn(
          "[PatchContext] Subpatch parent mismatch",
          { subpatchId, declaredParent, expectedParent }
        );
      }

      const nextPath = [...currentPath, subpatchId];
      setSubpatchPath(nextPath);
      subpatchPathRef.current = nextPath;
      setSelectedNodeIds([]);
      selectedNodeIdsRef.current = [];
      setSelectedNodeId(null);
      selectedNodeIdRef.current = null;
    },
    [setSelectedNodeId, setSelectedNodeIds]
  );

  const exitSubpatch = useCallback(
    (levels = 1) => {
      if (levels <= 0) {
        return;
      }
      const currentPath = subpatchPathRef.current;
      if (currentPath.length === 0) {
        return;
      }
      const nextLength = Math.max(0, currentPath.length - levels);
      const nextPath = currentPath.slice(0, nextLength);
      setSubpatchPath(nextPath);
      subpatchPathRef.current = nextPath;
      setSelectedNodeIds([]);
      selectedNodeIdsRef.current = [];
      setSelectedNodeId(null);
      selectedNodeIdRef.current = null;
    },
    [setSelectedNodeId, setSelectedNodeIds]
  );

  const addNodeToGraph = useCallback(
    (node: NodeDescriptor) => {
      if (node.kind === "meta.subpatch") {
        const subpatchId = nanoid();
        node.subpatchId = subpatchId;
        const parentId = subpatchPathRef.current.length > 0
          ? subpatchPathRef.current[subpatchPathRef.current.length - 1]
          : null;

        const inputNode = instantiateNode("meta.subpatch.input", nanoid());
        const outputNode = instantiateNode("meta.subpatch.output", nanoid());

        inputNode.metadata = {
          ...(inputNode.metadata ?? {}),
          position: { x: 64, y: 120 }
        };
        outputNode.metadata = {
          ...(outputNode.metadata ?? {}),
          position: { x: 320, y: 120 }
        };

        const subpatchEntry: SubpatchGraph = {
          id: subpatchId,
          name: node.label,
          parentId,
          inputs: [],
          outputs: [],
          inputNodeId: inputNode.id,
          outputNodeId: outputNode.id,
          graph: {
            nodes: [inputNode, outputNode],
            connections: []
          }
        };

        refreshSubpatchIONodes(subpatchEntry);

        const nextGraph = produceGraphForActivePath((current) => addNode(current, node));
        const nextSubpatches = {
          ...(nextGraph.subpatches ?? {}),
          [subpatchId]: subpatchEntry
        };
        const graphWithEntry = {
          ...nextGraph,
          subpatches: nextSubpatches
        };

        updateParentSubpatchNode(graphWithEntry, subpatchEntry);

        applyGraphChange(graphWithEntry, { changeType: "topology", selectNode: node.id });
        return;
      }

      applyActiveGraphChange(
        (current) => addNode(current, node),
        { changeType: "topology", selectNode: node.id }
      );
    },
    [applyActiveGraphChange, applyGraphChange, produceGraphForActivePath]
  );

  const renameNode = useCallback(
    (nodeId: string, rawLabel: string) => {
      const nextLabel = rawLabel.trim();
      if (!nextLabel) {
        return;
      }

      let targetSubpatchId: SubpatchId | null = null;

      const result = produceGraphForActivePath((current) => {
        let changed = false;
        const nodes = current.nodes.map((node) => {
          if (node.id !== nodeId) {
            return node;
          }
          if (node.label === nextLabel) {
            return node;
          }
          changed = true;
          if (node.subpatchId) {
            targetSubpatchId = node.subpatchId;
          }
          return {
            ...node,
            label: nextLabel
          };
        });

        if (!changed) {
          return current;
        }

        return {
          ...current,
          nodes
        };
      });

      if (result === graphRef.current) {
        // No change necessary.
        return;
      }

      let finalGraph = result;
      if (targetSubpatchId) {
        const existing = finalGraph.subpatches?.[targetSubpatchId];
        if (existing && existing.name !== nextLabel) {
          finalGraph = {
            ...finalGraph,
            subpatches: {
              ...(finalGraph.subpatches ?? {}),
              [targetSubpatchId]: {
                ...existing,
                name: nextLabel
              }
            }
          };
        }
      }

      applyGraphChange(finalGraph, {
        changeType: "metadata",
        recordHistory: false
      });
    },
    [applyGraphChange, produceGraphForActivePath]
  );

  const renameNodeOutput = useCallback(
    (nodeId: string, portId: string, rawLabel: string) => {
      const trimmed = rawLabel.trim();
      if (!trimmed) {
        return;
      }

      const result = produceGraphForActivePath((current) => {
        let changed = false;
        const nodes = current.nodes.map((node) => {
          if (node.id !== nodeId) {
            return node;
          }
          const outputIndex = node.outputs.findIndex((port) => port.id === portId);
          if (outputIndex < 0) {
            return node;
          }
          if (node.outputs[outputIndex].name === trimmed) {
            return node;
          }

          changed = true;
          const updatedOutputs = node.outputs.map((port) =>
            port.id === portId ? { ...port, name: trimmed } : port
          );

          const implementation = getNodeImplementation(node.kind);
          const controlId = implementation?.manifest.controls?.[outputIndex]?.id;

          const existingMetadata = node.metadata ?? {};
          const outputDefaults = implementation?.manifest.outputs ?? [];
          const defaultOutputName = outputDefaults[outputIndex]?.name ?? node.outputs[outputIndex].name;
          const existingOutputNames = (existingMetadata.outputNames as Record<string, string> | undefined) ?? {};
          let nextOutputNames: Record<string, string> | undefined;
          if (trimmed !== defaultOutputName) {
            nextOutputNames = {
              ...existingOutputNames,
              [portId]: trimmed
            };
          } else if (existingOutputNames[portId]) {
            const { [portId]: _, ...rest } = existingOutputNames;
            nextOutputNames = Object.keys(rest).length ? rest : undefined;
          } else if (Object.keys(existingOutputNames).length > 0) {
            nextOutputNames = existingOutputNames;
          }

          const existingControlNames = (existingMetadata.controlNames as Record<string, string> | undefined) ?? {};
          let nextControlNames: Record<string, string> | undefined = existingControlNames;
          const controlDefaults = implementation?.manifest.controls ?? [];
          const defaultControlLabel = controlId ? controlDefaults[outputIndex]?.label ?? controlId : undefined;
          if (controlId) {
            if (trimmed !== defaultControlLabel) {
              nextControlNames = {
                ...existingControlNames,
                [controlId]: trimmed
              };
            } else if (existingControlNames[controlId]) {
              const { [controlId]: _, ...rest } = existingControlNames;
              nextControlNames = Object.keys(rest).length ? rest : undefined;
            }
          }

          let nextMetadata: NodeMetadata | undefined = { ...existingMetadata };
          if (nextOutputNames) {
            nextMetadata.outputNames = nextOutputNames;
          } else {
            delete nextMetadata.outputNames;
          }
          if (nextControlNames) {
            nextMetadata.controlNames = nextControlNames;
          } else {
            delete nextMetadata.controlNames;
          }

          if (nextMetadata && Object.keys(nextMetadata).length === 0) {
            nextMetadata = undefined;
          }

          return {
            ...node,
            outputs: updatedOutputs,
            metadata: nextMetadata
          };
        });

        if (!changed) {
          return current;
        }

        return {
          ...current,
          nodes
        };
      });

      if (result === graphRef.current) {
        return;
      }

      applyGraphChange(result, { changeType: "metadata", recordHistory: false });
    },
    [applyGraphChange, produceGraphForActivePath]
  );

  type SubpatchPortDirection = "input" | "output";

  const addSubpatchPort = useCallback(
    (subpatchId: SubpatchId, direction: SubpatchPortDirection, preferredName?: string): SubpatchPortSpec | null => {
      const rootGraph = graphRef.current;
      const entry = rootGraph.subpatches?.[subpatchId];
      if (!entry) {
        console.warn("[PatchContext] Missing subpatch for port addition", subpatchId);
        return null;
      }

      const nextGraph = cloneValue(rootGraph);
      const nextEntry = nextGraph.subpatches?.[subpatchId];
      if (!nextEntry) {
        return null;
      }

      const specs = direction === "input" ? nextEntry.inputs : nextEntry.outputs;
      const baseIndex = specs.length + 1;
      const rawName = preferredName ?? `${direction === "input" ? "Input" : "Output"} ${baseIndex}`;
      const portName = rawName.trim() || `${direction === "input" ? "Input" : "Output"} ${baseIndex}`;
      const newSpec: SubpatchPortSpec = {
        id: nanoid(),
        name: portName,
        type: "audio",
        order: specs.length
      };

      if (direction === "input") {
        nextEntry.inputs = [...specs, newSpec];
      } else {
        nextEntry.outputs = [...specs, newSpec];
      }

      refreshSubpatchIONodes(nextEntry);
      updateParentSubpatchNode(nextGraph, nextEntry);

      applyGraphChange(nextGraph, { changeType: "topology" });
      return newSpec;
    },
    [applyGraphChange]
  );

  const renameSubpatchPort = useCallback(
    (
      subpatchId: SubpatchId,
      direction: SubpatchPortDirection,
      portId: string,
      rawName: string
    ) => {
      const trimmed = rawName.trim();
      if (!trimmed) {
        return;
      }

      const rootGraph = graphRef.current;
      const entry = rootGraph.subpatches?.[subpatchId];
      if (!entry) {
        console.warn("[PatchContext] Missing subpatch for rename", subpatchId);
        return;
      }

      const nextGraph = cloneValue(rootGraph);
      const nextEntry = nextGraph.subpatches?.[subpatchId];
      if (!nextEntry) {
        return;
      }

      const specs = direction === "input" ? nextEntry.inputs : nextEntry.outputs;
      const index = specs.findIndex((spec) => spec.id === portId);
      if (index < 0) {
        console.warn("[PatchContext] Missing port for rename", { subpatchId, portId });
        return;
      }
      if (specs[index].name === trimmed) {
        return;
      }

      const updatedSpec: SubpatchPortSpec = {
        ...specs[index],
        name: trimmed
      };
      if (direction === "input") {
        nextEntry.inputs = specs.map((spec, idx) => (idx === index ? updatedSpec : spec));
      } else {
        nextEntry.outputs = specs.map((spec, idx) => (idx === index ? updatedSpec : spec));
      }

      refreshSubpatchIONodes(nextEntry);
      updateParentSubpatchNode(nextGraph, nextEntry);

      applyGraphChange(nextGraph, { changeType: "topology", recordHistory: false });
    },
    [applyGraphChange]
  );

  const removeSubpatchPort = useCallback(
    (subpatchId: SubpatchId, direction: SubpatchPortDirection, portId: string): void => {
      const rootGraph = cloneValue(graphRef.current);
      const entry = rootGraph.subpatches?.[subpatchId];
      if (!entry) {
        console.warn("[PatchContext] Missing subpatch for removal", subpatchId);
        return;
      }

      const specs = direction === "input" ? entry.inputs : entry.outputs;
      const index = specs.findIndex((spec) => spec.id === portId);
      if (index < 0) {
        return;
      }

      const parentContainer = resolveParentContainer(rootGraph, entry.parentId ?? null);
      const parentNode = parentContainer.nodes.find((node) => node.subpatchId === subpatchId);
      if (!parentNode) {
        console.warn("[PatchContext] Subpatch parent node missing", subpatchId);
        return;
      }

      const parentNodeId = parentNode.id;

      const filterParentConnections = (conn: Connection): boolean => {
        if (direction === "input") {
          return !(conn.to.node === parentNodeId && conn.to.port === portId);
        }
        return !(conn.from.node === parentNodeId && conn.from.port === portId);
      };

      parentContainer.connections = parentContainer.connections.filter((conn) => filterParentConnections(conn));

      if (direction === "input") {
        entry.graph.connections = entry.graph.connections.filter(
          (conn) => !(conn.from.node === entry.inputNodeId && conn.from.port === portId)
        );
        entry.inputs = specs.filter((spec) => spec.id !== portId).map((spec, idx) => ({ ...spec, order: idx }));
      } else {
        entry.graph.connections = entry.graph.connections.filter(
          (conn) => !(conn.to.node === entry.outputNodeId && conn.to.port === portId)
        );
        entry.outputs = specs.filter((spec) => spec.id !== portId).map((spec, idx) => ({ ...spec, order: idx }));
      }

      refreshSubpatchIONodes(entry);
      updateParentSubpatchNode(rootGraph, entry);

      applyGraphChange(rootGraph, { changeType: "topology", recordHistory: true });
    },
    [applyGraphChange]
  );

  const createSubpatchFromSelection = useCallback(
    (nodeIds: string[]) => {
      const uniqueIds = Array.from(new Set(nodeIds));
      if (uniqueIds.length === 0) {
        return;
      }

      const rootGraph = cloneValue(graphRef.current);
      const { container } = resolveMutableContainer(rootGraph, subpatchPathRef.current);
      if (!container) {
        return;
      }

      const nodesById = new Map(container.nodes.map((node) => [node.id, node]));
      const selectedNodes = uniqueIds
        .map((id) => nodesById.get(id))
        .filter((node): node is NodeDescriptor => Boolean(node));

      if (selectedNodes.length === 0 || selectedNodes.some((node) => node.kind === "meta.subpatch.input" || node.kind === "meta.subpatch.output")) {
        return;
      }

      const selectedSet = new Set(selectedNodes.map((node) => node.id));
      const selectedNodeMap = new Map(selectedNodes.map((node) => [node.id, node]));

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      for (const node of selectedNodes) {
        const pos = (node.metadata?.position as NodePosition | undefined) ?? { x: 0, y: 0 };
        minX = Math.min(minX, pos.x);
        minY = Math.min(minY, pos.y);
        maxX = Math.max(maxX, pos.x);
        maxY = Math.max(maxY, pos.y);
      }

      if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
        minX = 0;
        minY = 0;
        maxX = 0;
        maxY = 0;
      }

      const internalConnections: Connection[] = [];
      const incomingConnections: Connection[] = [];
      const outgoingConnections: Connection[] = [];
      const remainingConnections: Connection[] = [];

      for (const connection of container.connections) {
        const fromSelected = selectedSet.has(connection.from.node);
        const toSelected = selectedSet.has(connection.to.node);
        if (fromSelected && toSelected) {
          internalConnections.push(connection);
          continue;
        }
        if (!fromSelected && toSelected) {
          incomingConnections.push(connection);
          continue;
        }
        if (fromSelected && !toSelected) {
          outgoingConnections.push(connection);
          continue;
        }
        remainingConnections.push(connection);
      }

      container.connections = remainingConnections;

      const inputGroups = new Map<string, { spec: SubpatchPortSpec; connections: Connection[] }>();
      const outputGroups = new Map<string, { spec: SubpatchPortSpec; connections: Connection[] }>();
      const usedInputNames = new Set<string>();
      const usedOutputNames = new Set<string>();

      const ensureUnique = (base: string, used: Set<string>, fallbackPrefix: string): string => {
        const trimmed = base.trim();
        let candidate = trimmed.length > 0 ? trimmed : fallbackPrefix;
        let counter = 1;
        while (used.has(candidate)) {
          candidate = `${trimmed.length > 0 ? trimmed : fallbackPrefix} ${++counter}`;
        }
        used.add(candidate);
        return candidate;
      };

      const getPortLabel = (nodeId: string, portId: string, direction: "input" | "output"): string => {
        const node = selectedNodeMap.get(nodeId);
        if (!node) {
          return portId;
        }
        const port = (direction === "input" ? node.inputs : node.outputs).find((entry) => entry.id === portId);
        return port?.name ?? portId;
      };

      const createPortSpec = (
        direction: SubpatchPortDirection,
        label: string,
        used: Set<string>,
        count: number
      ): SubpatchPortSpec => ({
        id: nanoid(),
        name: ensureUnique(label, used, direction === "input" ? `Input ${count}` : `Output ${count}`),
        type: "audio",
        order: count - 1
      });

      for (const connection of incomingConnections) {
        const groupKey = `${connection.from.node}::${connection.from.port}`;
        let existing = inputGroups.get(groupKey);
        if (!existing) {
          const label = getPortLabel(connection.to.node, connection.to.port, "input");
          const spec = createPortSpec("input", label, usedInputNames, inputGroups.size + 1);
          existing = { spec, connections: [] };
          inputGroups.set(groupKey, existing);
        }
        existing.connections.push(connection);
      }

      for (const connection of outgoingConnections) {
        const groupKey = `${connection.to.node}::${connection.to.port}`;
        let existing = outputGroups.get(groupKey);
        if (!existing) {
          const label = getPortLabel(connection.from.node, connection.from.port, "output");
          const spec = createPortSpec("output", label, usedOutputNames, outputGroups.size + 1);
          existing = { spec, connections: [] };
          outputGroups.set(groupKey, existing);
        }
        existing.connections.push(connection);
      }

      const subpatchId = nanoid();
      const parentId = subpatchPathRef.current.length > 0
        ? subpatchPathRef.current[subpatchPathRef.current.length - 1]
        : null;

      const subpatchNode = instantiateNode("meta.subpatch", nanoid());
      subpatchNode.subpatchId = subpatchId;
      subpatchNode.label = "Subpatch";

      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      subpatchNode.metadata = {
        position: {
          x: Number.isFinite(centerX) ? centerX : 0,
          y: Number.isFinite(centerY) ? centerY : 0
        }
      };

      const inputNode = instantiateNode("meta.subpatch.input", nanoid());
      const outputNode = instantiateNode("meta.subpatch.output", nanoid());

      const offsetX = Number.isFinite(minX) ? minX : 0;
      const offsetY = Number.isFinite(minY) ? minY : 0;
      const spanY = Number.isFinite(maxY) && Number.isFinite(minY) ? Math.max(120, maxY - minY) : 240;

      inputNode.metadata = {
        position: {
          x: 40,
          y: spanY / 2 + 40
        }
      };
      outputNode.metadata = {
        position: {
          x: 480,
          y: spanY / 2 + 40
        }
      };

      const clonedSelectedNodes = selectedNodes.map((node) => {
        const clone = cloneValue(node);
        const pos = (clone.metadata?.position as NodePosition | undefined) ?? { x: 0, y: 0 };
        clone.metadata = {
          position: {
            x: pos.x - offsetX + 200,
            y: pos.y - offsetY + 40
          }
        };
        return clone;
      });

      const entry: SubpatchGraph = {
        id: subpatchId,
        name: subpatchNode.label,
        parentId,
        inputs: Array.from(inputGroups.values()).map((group, index) => ({ ...group.spec, order: index })),
        outputs: Array.from(outputGroups.values()).map((group, index) => ({ ...group.spec, order: index })),
        inputNodeId: inputNode.id,
        outputNodeId: outputNode.id,
        graph: {
          nodes: [...clonedSelectedNodes, inputNode, outputNode],
          connections: []
        }
      };

      const entryConnections: Connection[] = [];
      for (const conn of internalConnections) {
        if (!selectedSet.has(conn.from.node) || !selectedSet.has(conn.to.node)) {
          continue;
        }
        entryConnections.push({ ...conn });
      }

      for (const group of inputGroups.values()) {
        for (const conn of group.connections) {
          entryConnections.push({
            id: nanoid(),
            from: { node: inputNode.id, port: group.spec.id },
            to: { node: conn.to.node, port: conn.to.port }
          });
        }
      }

      for (const group of outputGroups.values()) {
        for (const conn of group.connections) {
          entryConnections.push({
            id: nanoid(),
            from: { node: conn.from.node, port: conn.from.port },
            to: { node: outputNode.id, port: group.spec.id }
          });
        }
      }

      entry.graph.connections = entryConnections;

      rootGraph.subpatches = {
        ...(rootGraph.subpatches ?? {}),
        [subpatchId]: entry
      };

      refreshSubpatchIONodes(entry);

      container.nodes = container.nodes.filter((node) => !selectedSet.has(node.id));
      container.nodes.push(subpatchNode);

      updateParentSubpatchNode(rootGraph, entry);

      for (const [_key, group] of inputGroups.entries()) {
        for (const conn of group.connections) {
          container.connections.push({
            id: nanoid(),
            from: { ...conn.from },
            to: { node: subpatchNode.id, port: group.spec.id }
          });
        }
      }

      for (const [_key, group] of outputGroups.entries()) {
        for (const conn of group.connections) {
          container.connections.push({
            id: nanoid(),
            from: { node: subpatchNode.id, port: group.spec.id },
            to: { ...conn.to }
          });
        }
      }

      applyGraphChange(rootGraph, {
        changeType: "topology",
        selectNode: subpatchNode.id,
        afterCommit: (_prev, updated) => {
          setParameterValues((prev) => {
            const filtered = filterParameterValuesForGraph(prev, updated);
            parameterValuesRef.current = filtered;
            return filtered;
          });
        }
      });
    },
    [applyGraphChange]
  );

  const connectNodes = useCallback(
    (params: ConnectNodesParams) => {
      applyActiveGraphChange(
        (current) => {
          const next = connectGraphNodes(current, params);
          const validationResult = validateGraph(next);
          const cycleIssue = validationResult.issues.find(
            (issue) => issue.code === "CYCLE_DETECTED"
          );
          if (cycleIssue) {
            throw new Error(cycleIssue.message);
          }
          return next;
        },
        { changeType: "topology" }
      );
    },
    [applyActiveGraphChange]
  );

  const disconnectConnection = useCallback(
    (connectionId: string) => {
      applyActiveGraphChange(
        (current) => removeConnection(current, connectionId),
        { changeType: "topology" }
      );
    },
    [applyActiveGraphChange]
  );

  const removeNodeFromGraph = useCallback(
    (nodeId: string) => {
      const options: {
        changeType: PatchChangeType;
        selectNode?: string | null;
        afterCommit?: (previous: PatchGraph, updated: PatchGraph) => void;
      } = {
        changeType: "topology",
        afterCommit: (_prev, updated) => {
          setParameterValues((prevValues) => {
            const filtered = filterParameterValuesForGraph(prevValues, updated);
            parameterValuesRef.current = filtered;
            return filtered;
          });
        }
      };
      if (selectedNodeIdRef.current === nodeId) {
        options.selectNode = null;
      }
      applyActiveGraphChange(
        (current) => removeGraphNode(current, nodeId),
        options
      );
    },
    [applyActiveGraphChange]
  );

  const removeNodesFromGraph = useCallback(
    (nodeIds: string[]) => {
      const uniqueIds = Array.from(new Set(nodeIds));
      if (uniqueIds.length === 0) {
        return;
      }
      applyActiveGraphChange(
        (current) => {
          let next = current;
          for (const id of uniqueIds) {
            next = removeGraphNode(next, id);
          }
          return next;
        },
        {
          changeType: "topology",
          selectNode: null,
          afterCommit: (_prev, updated) => {
            setParameterValues((prevValues) => {
              const filtered = filterParameterValuesForGraph(prevValues, updated);
              parameterValuesRef.current = filtered;
              return filtered;
            });
          }
        }
      );
    },
    [applyActiveGraphChange]
  );

  const removeConnectionsFromPort = useCallback(
    (nodeId: string, portId: string) => {
      applyActiveGraphChange(
        (current) => removeGraphConnectionsFromPort(current, nodeId, portId),
        { changeType: "topology" }
      );
    },
    [applyActiveGraphChange]
  );

  const removeConnectionsToPort = useCallback(
    (nodeId: string, portId: string) => {
      applyActiveGraphChange(
        (current) => removeGraphConnectionsToPort(current, nodeId, portId),
        { changeType: "topology" }
      );
    },
    [applyActiveGraphChange]
  );

  const updatePatchSettings = useCallback(
    (settings: PatchSettingsUpdate) => {
      const oversampling = settings.oversampling ?? graphRef.current.oversampling;
      const updatedBase = updateGraphPatchSettings(graphRef.current, settings);
      const { graph: normalizedGraph, updatedValues } = normalizeDelayNodes(
        updatedBase,
        oversampling
      );
      applyGraphChange(normalizedGraph, {
        changeType: "topology",
        afterCommit: (_prev, _updated) => {
          if (Object.keys(updatedValues).length === 0) {
            return;
          }
          setParameterValues((prev) => {
            const next = { ...prev };
            for (const [nodeId, value] of Object.entries(updatedValues)) {
              const key = makeParameterKey(nodeId, DELAY_CONTROL_ID);
              next[key] = value;
            }
            parameterValuesRef.current = next;
            return next;
          });
        }
      });
    },
    [applyGraphChange]
  );

  const updateNodePosition = useCallback(
    (nodeId: string, position: NodePosition) => {
      applyActiveGraphChange(
        (current) => updateGraphNodePosition(current, nodeId, position),
        {
          changeType: "metadata",
          recordHistory: false
        }
      );
    },
    [applyActiveGraphChange]
  );

  const getParameterValue = useCallback(
    (nodeId: string, controlId: string) => {
      const key = makeParameterKey(nodeId, controlId);
      if (key in parameterValues) {
        return parameterValues[key];
      }
      const node = activeGraph.nodes.find((candidate) => candidate.id === nodeId);
      if (node && typeof node.parameters[controlId] === "number") {
        const raw = node.parameters[controlId];
        if (isDelayNodeKind(node.kind)) {
          return clampControlValue(node.kind, controlId, raw, activeGraph.oversampling);
        }
        return raw;
      }
      if (node) {
        const implementation = getNodeImplementation(node.kind);
        const fallback = implementation?.manifest.defaultParams?.[controlId];
        if (typeof fallback === "number") {
          if (isDelayNodeKind(node.kind)) {
            return clampControlValue(node.kind, controlId, fallback, activeGraph.oversampling);
          }
          return fallback;
        }
      }
      return 0;
    },
    [activeGraph.nodes, activeGraph.oversampling, parameterValues]
  );

  const getEnvelopeSnapshot = useCallback(
    (nodeId: string): EnvelopeSnapshot => {
      return envelopeSnapshotsRef.current[nodeId] ?? { value: 0, progress: -1 };
    },
    []
  );

  const getScopeSnapshot = useCallback(
    (nodeId: string): ScopeSnapshot => {
      return scopeSnapshotsRef.current[nodeId] ?? {
        samples: new Float32Array(0),
        sampleInterval: 1 / Math.max(1, graphRef.current.sampleRate),
        scale: 1,
        requestedTime: 0.01,
        mode: 0,
        factor: 1,
        coverage: 0
      };
    },
    []
  );

  const subscribeScopeSnapshot = useCallback(
    (nodeId: string, listener: (snapshot: ScopeSnapshot) => void): (() => void) => {
      let listeners = scopeSnapshotListenersRef.current.get(nodeId);
      if (!listeners) {
        listeners = new Set();
        scopeSnapshotListenersRef.current.set(nodeId, listeners);
      }
      listeners.add(listener);
      try {
        listener(getScopeSnapshot(nodeId));
      } catch (error) {
        console.error("[PatchContext] Failed to deliver initial scope snapshot", error);
      }
      return () => {
        const current = scopeSnapshotListenersRef.current.get(nodeId);
        if (!current) {
          return;
        }
        current.delete(listener);
        if (current.size === 0) {
          scopeSnapshotListenersRef.current.delete(nodeId);
        }
      };
    },
    [getScopeSnapshot]
  );

  const updateNodeParameter = useCallback(
    (nodeId: string, parameterId: string, value: number) => {
      const oversampling = activeGraph.oversampling;
      const targetNode = activeGraph.nodes.find((candidate) => candidate.id === nodeId);
      let adjustedValue = value;
      if (targetNode && isDelayNodeKind(targetNode.kind)) {
        adjustedValue = clampControlValue(targetNode.kind, parameterId, value, oversampling);
      }
      const changed = applyActiveGraphChange(
        (current) => updateGraphNodeParameter(current, nodeId, parameterId, adjustedValue),
        {
          changeType: "parameter",
          recordHistory: false
        }
      );
      const key = makeParameterKey(nodeId, parameterId);
      setParameterValues((prev) => {
        if (!changed && prev[key] === adjustedValue) {
          return prev;
        }
        const next = { ...prev, [key]: adjustedValue };
        parameterValuesRef.current = next;
        return next;
      });

      const binding = parameterBindingsRef.current.find(
        (entry) => entry.nodeId === nodeId && entry.controlId === parameterId
      );
      const handle = workletHandleRef.current;
      if (binding && handle) {
        handle.node.port.postMessage({
          type: PARAM_MESSAGE_SINGLE,
          index: binding.index,
          value: adjustedValue
        });
      }
    },
    [activeGraph.nodes, activeGraph.oversampling, applyActiveGraphChange]
  );

  const selectNodes = useCallback((nodeIds: string[]) => {
    const unique = Array.from(new Set(nodeIds));
    setSelectedNodeIds(unique);
    selectedNodeIdsRef.current = unique;
    const primary = unique.length > 0 ? unique[unique.length - 1] : null;
    setSelectedNodeId(primary);
    selectedNodeIdRef.current = primary;
  }, []);

  const selectNode = useCallback(
    (nodeId: string | null) => {
      if (nodeId) {
        selectNodes([nodeId]);
      } else {
        selectNodes([]);
      }
    },
    [selectNodes]
  );

  const undo = useCallback(() => {
    setUndoStack((prevUndo) => {
      if (prevUndo.length === 0) {
        return prevUndo;
      }
      const snapshot = prevUndo[prevUndo.length - 1];
      const remaining = prevUndo.slice(0, -1);
      const currentSnapshot: PatchSnapshot = {
        graph: graphRef.current,
        parameterValues: { ...parameterValuesRef.current },
        selectedNodeId: selectedNodeIdRef.current,
        selectedNodeIds: [...selectedNodeIdsRef.current],
        changeType: snapshot.changeType
      };
      setRedoStack((prevRedo) => [...prevRedo, currentSnapshot]);
      setGraph(snapshot.graph);
      graphRef.current = snapshot.graph;
      setParameterValues(snapshot.parameterValues);
      parameterValuesRef.current = snapshot.parameterValues;
      setSelectedNodeId(snapshot.selectedNodeId);
      selectedNodeIdRef.current = snapshot.selectedNodeId;
      setSelectedNodeIds(snapshot.selectedNodeIds);
      selectedNodeIdsRef.current = [...snapshot.selectedNodeIds];
      if (snapshot.changeType === "topology") {
        setTopologyVersion((version) => version + 1);
        setParameterBindings([]);
      }
      return remaining;
    });
  }, [
    setGraph,
    setParameterValues,
    setParameterBindings,
    setRedoStack,
    setSelectedNodeId,
    setTopologyVersion,
    setUndoStack
  ]);

  const redo = useCallback(() => {
    setRedoStack((prevRedo) => {
      if (prevRedo.length === 0) {
        return prevRedo;
      }
      const snapshot = prevRedo[prevRedo.length - 1];
      const remaining = prevRedo.slice(0, -1);
      const currentSnapshot: PatchSnapshot = {
        graph: graphRef.current,
        parameterValues: { ...parameterValuesRef.current },
        selectedNodeId: selectedNodeIdRef.current,
        selectedNodeIds: [...selectedNodeIdsRef.current],
        changeType: snapshot.changeType
      };
      setUndoStack((prevUndo) => [...prevUndo, currentSnapshot]);
      setGraph(snapshot.graph);
      graphRef.current = snapshot.graph;
      setParameterValues(snapshot.parameterValues);
      parameterValuesRef.current = snapshot.parameterValues;
      setSelectedNodeId(snapshot.selectedNodeId);
      selectedNodeIdRef.current = snapshot.selectedNodeId;
      setSelectedNodeIds(snapshot.selectedNodeIds);
      selectedNodeIdsRef.current = [...snapshot.selectedNodeIds];
      if (snapshot.changeType === "topology") {
        setTopologyVersion((version) => version + 1);
        setParameterBindings([]);
      }
      return remaining;
    });
  }, [
    setGraph,
    setParameterValues,
    setParameterBindings,
    setUndoStack,
    setSelectedNodeId,
    setTopologyVersion,
    setRedoStack
  ]);

  const stopAudioInternal = useCallback(async () => {
    const handle = workletHandleRef.current;
    workletHandleRef.current = null;

    if (handle) {
      const listener = portListenerRef.current;
      if (listener) {
        handle.node.port.removeEventListener("message", listener);
        portListenerRef.current = null;
      }
      try {
        handle.node.disconnect();
      } catch (error) {
        console.warn("Failed to disconnect AudioWorkletNode", error);
      }

      try {
        handle.node.port.postMessage({ type: "shutdown" });
        if ("close" in handle.node.port) {
          handle.node.port.close();
        }
      } catch (error) {
        console.warn("Failed to close AudioWorkletNode port", error);
      }
    }

    const context = audioContextRef.current;
    if (context && context.state !== "closed") {
      try {
        await context.suspend();
      } catch (error) {
        console.warn("Failed to suspend AudioContext", error);
      }
    }
  }, []);

  const resetPatch = useCallback(() => {
    const initialGraph = createInitialGraph();
    void stopAudioInternal();
    setAudioState(audioSupported ? "idle" : "unsupported");
    setAudioError(null);
    setArtifact(null);
    artifactRef.current = null;
    setParameterBindings([]);
    parameterBindingsRef.current = [];
    setGraph(initialGraph);
    graphRef.current = initialGraph;
    const initialValues = buildParameterValuesForGraph(initialGraph);
    setParameterValues(initialValues);
    parameterValuesRef.current = initialValues;
    setUndoStack([]);
    setRedoStack([]);
    setSelectedNodeId(null);
    selectedNodeIdRef.current = null;
    setSelectedNodeIds([]);
    selectedNodeIdsRef.current = [];
    setSubpatchPath([]);
    subpatchPathRef.current = [];
    setEnvelopeSnapshots({});
    envelopeSnapshotsRef.current = {};
    const previousScopes = scopeSnapshotsRef.current;
    scopeSnapshotsRef.current = {};
    for (const [nodeId, snapshot] of Object.entries(previousScopes)) {
      notifyScopeListeners(nodeId, {
        samples: new Float32Array(0),
        sampleInterval: snapshot.sampleInterval,
        scale: snapshot.scale,
        requestedTime: snapshot.requestedTime,
        mode: 0,
        factor: snapshot.factor,
        coverage: 0
      });
    }
    autosaveHydratedRef.current = true;
    setTopologyVersion((version) => version + 1);
  }, [audioSupported, stopAudioInternal]);

  useEffect(() => {
    setArtifact(null);
    if (!audioSupported) {
      setAudioState("unsupported");
      setAudioError("AudioContext is not available in this environment.");
      return;
    }

    void (async () => {
      await stopAudioInternal();
      setAudioState("idle");
      setAudioError(null);
    })();
  }, [topologyVersion, audioSupported, stopAudioInternal]);

  const createAudioContext = useCallback((): AudioContext => {
    if (!audioSupported) {
      throw new Error("AudioContext is not supported in this environment.");
    }

    if (typeof window === "undefined") {
      throw new Error("AudioContext requires a browser environment.");
    }

    const browserWindow = window as typeof window & {
      webkitAudioContext?: typeof AudioContext;
    };

    const Ctor =
      browserWindow.AudioContext ?? browserWindow.webkitAudioContext;

    if (!Ctor) {
      throw new Error("Failed to locate AudioContext constructor.");
    }

    return new Ctor();
  }, [audioSupported]);

  const compileGraph = useCallback(async (): Promise<CompileResult> => {
    console.info("[Jacquard] compile start", {
      nodes: graph.nodes.length,
      connections: graph.connections.length
    });
    const result = await compilePatch(graph);
    console.info("[Jacquard] compile finished", {
      wasmBytes: result.wasmBinary.byteLength,
      parameters: result.parameterBindings.length
    });
    await stopAudioInternal();
    setArtifact(result);
    setParameterBindings(result.parameterBindings);
    envelopeBindingsRef.current = result.envelopeMonitors;
    scopeBindingsRef.current = result.scopeMonitors;
    if (result.envelopeMonitors.length === 0) {
      envelopeSnapshotsRef.current = {};
      setEnvelopeSnapshots({});
    } else {
      const initialSnapshots: Record<string, EnvelopeSnapshot> = {};
      for (const binding of result.envelopeMonitors) {
        initialSnapshots[binding.nodeId] =
          envelopeSnapshotsRef.current[binding.nodeId] ?? { value: 0, progress: -1 };
      }
      envelopeSnapshotsRef.current = initialSnapshots;
      setEnvelopeSnapshots(initialSnapshots);
    }
    if (result.scopeMonitors.length === 0) {
      scopeSnapshotsRef.current = {};
    } else {
      const initialScopes: Record<string, ScopeSnapshot> = {};
      for (const binding of result.scopeMonitors) {
        const snapshot: ScopeSnapshot =
          scopeSnapshotsRef.current[binding.nodeId] ?? {
            samples: new Float32Array(0),
            sampleInterval: 1 / Math.max(1, graph.sampleRate),
            scale: 1,
            requestedTime: 0.01,
            mode: 0,
            factor: binding.levelFactors?.[0] ?? 1,
            coverage: 0
          };
        initialScopes[binding.nodeId] = snapshot;
        notifyScopeListeners(binding.nodeId, snapshot);
      }
      scopeSnapshotsRef.current = initialScopes;
    }
    setParameterValues((prev) => {
      const next = { ...prev };
      for (const binding of result.parameterBindings) {
        const key = makeParameterKey(binding.nodeId, binding.controlId);
        const node = graph.nodes.find((candidate) => candidate.id === binding.nodeId);
        if (node && typeof node.parameters[binding.controlId] === "number") {
          next[key] = node.parameters[binding.controlId];
        } else {
          next[key] = binding.defaultValue;
        }
      }
      parameterValuesRef.current = next;
      return next;
    });

    if (audioSupported) {
      setAudioState("idle");
      setAudioError(null);
    }
    return result;
  }, [graph, audioSupported, stopAudioInternal]);

  const stopAudio = useCallback(async () => {
    await stopAudioInternal();
    setAudioState(audioSupported ? "idle" : "unsupported");
    setAudioError(null);
  }, [audioSupported, stopAudioInternal]);

  const startAudio = useCallback(async () => {
    if (!audioSupported) {
      setAudioState("unsupported");
      setAudioError("AudioContext is not supported in this environment.");
      return;
    }

    if (!artifact) {
      setAudioState("error");
      setAudioError("Compile the patch before starting audio playback.");
      return;
    }

    setAudioState("starting");
    setAudioError(null);

    try {
      await stopAudioInternal();

      let context = audioContextRef.current;
      if (!context || context.state === "closed") {
        context = createAudioContext();
        audioContextRef.current = context;
      }

      console.info("[Jacquard] Creating audio worklet node");
      const handle = await loadPatchProcessor(context, artifact);
      console.info("[Jacquard] Worklet node created");
      workletHandleRef.current = handle;
      const listener = (event: MessageEvent): void => {
        const data = event.data;
        if (!data || typeof data !== "object") {
          return;
        }
        if (data.type === "error") {
          const message =
            typeof data.message === "string"
              ? data.message
              : "Audio processor reported an error.";
          console.error("[Jacquard] Worklet error", message);
          setAudioState("error");
          setAudioError(message);
          void (async () => {
            await stopAudioInternal();
          })();
        } else if (data.type === "stopped") {
          setAudioState("idle");
        } else if (data.type === "envelopes") {
          const bindings = envelopeBindingsRef.current;
          if (!bindings || bindings.length === 0) {
            return;
          }

          const rawValues = (data as { values?: unknown }).values;
          if (!rawValues) {
            return;
          }

          let payload: Float32Array | null = null;
          if (rawValues instanceof Float32Array) {
            payload = rawValues;
          } else if (rawValues instanceof ArrayBuffer) {
            payload = new Float32Array(rawValues);
          } else if (Array.isArray(rawValues)) {
            payload = Float32Array.from(rawValues as number[]);
          }

          if (!payload) {
            return;
          }

          const next: Record<string, EnvelopeSnapshot> = {};
          let changed = false;
          for (const binding of bindings) {
            const baseIndex = binding.index * 2;
            if (baseIndex + 1 >= payload.length) {
              continue;
            }
            const value = payload[baseIndex];
            const progress = payload[baseIndex + 1];
            next[binding.nodeId] = { value, progress };
            const previous = envelopeSnapshotsRef.current[binding.nodeId];
            if (!previous || previous.value !== value || previous.progress !== progress) {
              changed = true;
            }
          }

          if (
            changed ||
            Object.keys(next).length !== Object.keys(envelopeSnapshotsRef.current).length
          ) {
            envelopeSnapshotsRef.current = next;
            setEnvelopeSnapshots(next);
          }
        } else if (data.type === "scopes") {
          const bindings = scopeBindingsRef.current;
          if (!bindings || bindings.length === 0) {
            return;
          }

          const monitors = (data as { monitors?: unknown }).monitors;
          if (!Array.isArray(monitors)) {
            return;
          }

          const updated: Record<string, ScopeSnapshot> = { ...scopeSnapshotsRef.current };
          let changed = false;

          for (const monitor of monitors as Array<Record<string, unknown>>) {
            const index = typeof monitor.index === "number" ? monitor.index : -1;
            if (index < 0 || index >= bindings.length) {
              continue;
            }
            const binding = bindings[index];

            let samples: Float32Array | null = null;
            const rawSamples = monitor.samples;
            if (rawSamples instanceof Float32Array) {
              samples = rawSamples;
            } else if (rawSamples instanceof ArrayBuffer) {
              samples = new Float32Array(rawSamples);
            } else if (Array.isArray(rawSamples)) {
              samples = Float32Array.from(rawSamples as number[]);
            }
            if (!samples) {
              continue;
            }

            const sampleInterval =
              typeof monitor.sampleInterval === "number" && Number.isFinite(monitor.sampleInterval)
                ? monitor.sampleInterval
                : 1 / Math.max(1, graphRef.current.sampleRate);
            const scale = typeof monitor.scale === "number" ? monitor.scale : 1;
            const requestedTime = typeof monitor.time === "number" ? monitor.time : 0.01;
            const mode = typeof monitor.mode === "number" ? monitor.mode : 0;
            const factor = typeof monitor.factor === "number" ? monitor.factor : 1;
            const coverage =
              typeof monitor.coverage === "number" && Number.isFinite(monitor.coverage)
                ? monitor.coverage
                : samples.length * sampleInterval;

            const snapshot: ScopeSnapshot = {
              samples,
              sampleInterval,
              scale,
              requestedTime,
              mode,
              factor,
              coverage
            };

            updated[binding.nodeId] = snapshot;
            changed = true;
            notifyScopeListeners(binding.nodeId, snapshot);
          }

          if (changed) {
            scopeSnapshotsRef.current = updated;
          }
        }
      };

      handle.node.port.addEventListener("message", listener);
      handle.node.port.start?.();
      portListenerRef.current = listener;
      handle.node.connect(context.destination);

      if (artifact.parameterBindings.length > 0) {
        const values = artifact.parameterBindings.map((binding) => {
          const key = makeParameterKey(binding.nodeId, binding.controlId);
          const current = parameterValuesRef.current[key];
          return {
            index: binding.index,
            value: current ?? binding.defaultValue
          };
        });
        handle.node.port.postMessage({ type: PARAM_MESSAGE_BATCH, values });
        console.info("[Jacquard] Sent parameter batch", values);
      }

      if (context.state === "suspended") {
        await context.resume();
      }

      console.info("[Jacquard] Audio rendering started");
      setAudioState("running");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      console.error("[Jacquard] Failed to start audio", error);
      setAudioState("error");
      setAudioError(message);
      await stopAudioInternal();
    }
  }, [audioSupported, artifact, stopAudioInternal, createAudioContext]);

  const exportPatch = useCallback((): PatchDocument => {
    return createPatchDocument(graphRef.current);
  }, []);

  const importPatch = useCallback(
    (input: PatchDocument | PatchGraph, options?: { recordHistory?: boolean }) => {
      const document = normalizePatchDocument(input);
      if (document.version !== PATCH_DOCUMENT_VERSION) {
        throw new Error(
          `Unsupported patch document version ${document.version}. This build expects version ${PATCH_DOCUMENT_VERSION}.`
        );
      }

      const { graph: normalizedGraph, updatedValues } = normalizeDelayNodes(
        document.graph,
        document.graph.oversampling
      );
      const validationResult = validateGraph(normalizedGraph);
      if (!validationResult.isValid) {
        const firstIssue = validationResult.issues[0];
        const detail = firstIssue
          ? `${firstIssue.code}: ${firstIssue.message}`
          : "Patch is invalid.";
        throw new Error(detail);
      }

      setSubpatchPath([]);
      subpatchPathRef.current = [];
      setSelectedNodeIds([]);
      selectedNodeIdsRef.current = [];
      setSelectedNodeId(null);
      selectedNodeIdRef.current = null;

      applyGraphChange(normalizedGraph, {
        changeType: "topology",
        selectNode: null,
        recordHistory: options?.recordHistory ?? true,
        afterCommit: (_prev, updated) => {
          const derivedValues = buildParameterValuesForGraph(updated);
          for (const [nodeId, value] of Object.entries(updatedValues)) {
            derivedValues[makeParameterKey(nodeId, DELAY_CONTROL_ID)] = value;
          }
          setParameterValues(derivedValues);
          parameterValuesRef.current = derivedValues;
        }
      });
    },
    [applyGraphChange]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await loadAutosavePatch();
        if (cancelled) {
          return;
        }
        if (stored) {
          importPatch(stored, { recordHistory: false });
          setUndoStack([]);
          setRedoStack([]);
          setSelectedNodeId(null);
          selectedNodeIdRef.current = null;
          setSelectedNodeIds([]);
          selectedNodeIdsRef.current = [];
        }
      } catch (error) {
        console.warn("[PatchContext] Failed to restore autosave", error);
        if (
          error instanceof Error &&
          error.message.includes("Unsupported patch document version")
        ) {
          await clearAutosavePatch().catch((clearError) => {
            console.warn("[PatchContext] Failed to clear incompatible autosave", clearError);
          });
        }
      } finally {
        if (!cancelled) {
          autosaveHydratedRef.current = true;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [importPatch]);

  useEffect(() => {
    if (!autosaveHydratedRef.current) {
      return;
    }
    const handle = window.setTimeout(() => {
      const document = createPatchDocument(graphRef.current);
      void saveAutosavePatch(document).catch((error) => {
        console.warn("[PatchContext] Failed to write autosave", error);
      });
    }, 300);
    return () => {
      window.clearTimeout(handle);
    };
  }, [graph]);

  const canUndo = undoStack.length > 0;
  const canRedo = redoStack.length > 0;

  const value = useMemo<PatchController>(
    () => ({
      graph: activeGraph,
      rootGraph: graph,
      viewModel,
      validation,
      artifact,
      compile: compileGraph,
      audio: {
        state: audioState,
        error: audioError,
        isSupported: audioSupported,
        start: startAudio,
        stop: stopAudio
      },
      addNode: addNodeToGraph,
      connectNodes,
      disconnectConnection,
      removeNode: removeNodeFromGraph,
      removeNodes: removeNodesFromGraph,
      removeConnectionsFromPort,
      removeConnectionsToPort,
      updateNodePosition,
      updateNodeParameter,
      selectedNodeId,
      selectedNodeIds,
      selectNode,
      selectNodes,
      getParameterValue,
      envelopeSnapshots,
      getEnvelopeSnapshot,
      getScopeSnapshot,
      subscribeScopeSnapshot,
      undo,
      redo,
      canUndo,
      canRedo,
      exportPatch,
      importPatch,
      updatePatchSettings,
      activeSubpatchPath: subpatchPath,
      openSubpatch,
      exitSubpatch,
      renameNode,
      renameNodeOutput,
      addSubpatchPort,
      renameSubpatchPort,
      removeSubpatchPort,
      createSubpatchFromSelection,
      resetPatch,
      updateActiveGraph
    }),
    [
      activeGraph,
      graph,
      viewModel,
      validation,
      artifact,
      compileGraph,
      audioState,
      audioError,
      audioSupported,
      startAudio,
      stopAudio,
      addNodeToGraph,
      connectNodes,
      disconnectConnection,
      removeNodeFromGraph,
      removeNodesFromGraph,
      removeConnectionsFromPort,
      removeConnectionsToPort,
      updateNodePosition,
      updateNodeParameter,
      selectedNodeId,
      selectedNodeIds,
      selectNode,
      selectNodes,
      getParameterValue,
      envelopeSnapshots,
      getEnvelopeSnapshot,
      getScopeSnapshot,
      subscribeScopeSnapshot,
      undo,
      redo,
      canUndo,
      canRedo,
      exportPatch,
      importPatch,
      updatePatchSettings,
      subpatchPath,
      openSubpatch,
      exitSubpatch,
      renameNode,
      renameNodeOutput,
      addSubpatchPort,
      renameSubpatchPort,
      removeSubpatchPort,
      createSubpatchFromSelection,
      resetPatch,
      updateActiveGraph
    ]
  );

  return <PatchContext.Provider value={value}>{children}</PatchContext.Provider>;
}

export function usePatch(): PatchController {
  const context = useContext(PatchContext);
  if (!context) {
    throw new Error("usePatch must be used within a PatchProvider");
  }
  return context;
}
