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
  updateNodeParameter as updateGraphNodeParameter
} from "@graph/graph";
import {
  GraphViewModel,
  graphViewModelFromGraph
} from "@graph/view-model";
import {
  ConnectNodesParams,
  NodeDescriptor,
  NodePosition,
  PatchGraph
} from "@graph/types";
import { GraphValidationResult, validateGraph } from "@graph/validation";
import { compilePatch, CompileResult } from "@compiler/compiler";
import type { ScopeMonitor } from "@codegen/plan";
import {
  loadPatchProcessor,
  WorkletHandle
} from "@audio/worklet-loader";
import { getNodeImplementation } from "@dsp/nodes";
import { resolveControlMin, resolveControlMax, resolveControlStep } from "@dsp/utils/controls";
import type { PlanControl, EnvelopeMonitor } from "@codegen/plan";
import {
  createPatchDocument,
  normalizePatchDocument,
  PATCH_DOCUMENT_VERSION,
  PatchDocument
} from "@graph/persistence";

const PARAM_MESSAGE_BATCH = "parameterBatch";
const PARAM_MESSAGE_SINGLE = "parameter";

const makeParameterKey = (nodeId: string, controlId: string): string =>
  `${nodeId}:${controlId}`;

const DELAY_NODE_KINDS = new Set<string>(["delay.ddl", "delay.waveguide"]);
const DELAY_CONTROL_ID = "delay";
const DELAY_MAX_SAMPLES = 4096;

const isDelayNodeKind = (kind: string): boolean => DELAY_NODE_KINDS.has(kind);

const clampControlValue = (
  kind: string,
  controlId: string,
  value: number,
  oversampling: number
): number => {
  const implementation = getNodeImplementation(kind);
  const control = implementation?.manifest.controls?.find((entry) => entry.id === controlId);
  const context = { oversampling };
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

type PatchChangeType = "topology" | "parameter" | "metadata";

interface PatchSnapshot {
  graph: PatchGraph;
  parameterValues: Record<string, number>;
  selectedNodeId: string | null;
  changeType: PatchChangeType;
}

interface EnvelopeSnapshot {
  value: number;
  progress: number;
}

interface ScopeSnapshot {
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
  viewModel: GraphViewModel;
  validation: GraphValidationResult;
  artifact: CompileResult | null;
  compile(): Promise<CompileResult>;
  audio: AudioControls;
  addNode(node: NodeDescriptor): void;
  connectNodes(params: ConnectNodesParams): void;
  disconnectConnection(connectionId: string): void;
  removeNode(nodeId: string): void;
  removeConnectionsFromPort(nodeId: string, portId: string): void;
  removeConnectionsToPort(nodeId: string, portId: string): void;
  updateNodePosition(nodeId: string, position: NodePosition): void;
  updateNodeParameter(nodeId: string, parameterId: string, value: number): void;
  selectedNodeId: string | null;
  selectNode(nodeId: string | null): void;
  getParameterValue(nodeId: string, controlId: string): number;
  envelopeSnapshots: Record<string, EnvelopeSnapshot>;
  getEnvelopeSnapshot(nodeId: string): EnvelopeSnapshot;
  scopeSnapshots: Record<string, ScopeSnapshot>;
  getScopeSnapshot(nodeId: string): ScopeSnapshot;
  undo(): void;
  redo(): void;
  canUndo: boolean;
  canRedo: boolean;
  exportPatch(): PatchDocument;
  importPatch(document: PatchDocument | PatchGraph): void;
  updatePatchSettings(settings: PatchSettingsUpdate): void;
}

const PatchContext = createContext<PatchController | null>(null);

export function PatchProvider({ children }: PropsWithChildren): JSX.Element {
  const [graph, setGraph] = useState<PatchGraph>(() => createGraph());
  const [artifact, setArtifact] = useState<CompileResult | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [parameterBindings, setParameterBindings] = useState<PlanControl[]>([]);
  const [envelopeSnapshots, setEnvelopeSnapshots] = useState<Record<string, EnvelopeSnapshot>>(
    {}
  );
  const [scopeSnapshots, setScopeSnapshots] = useState<Record<string, ScopeSnapshot>>({});
  const [parameterValues, setParameterValues] = useState<Record<string, number>>({});
  const [topologyVersion, setTopologyVersion] = useState(0);
  const [undoStack, setUndoStack] = useState<PatchSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<PatchSnapshot[]>([]);

  const viewModel = useMemo(() => graphViewModelFromGraph(graph), [graph]);
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
  const artifactRef = useRef<CompileResult | null>(null);
  const parameterValuesRef = useRef<Record<string, number>>({});
  const graphRef = useRef<PatchGraph>(graph);
  const selectedNodeIdRef = useRef<string | null>(selectedNodeId);

  useEffect(() => {
    parameterBindingsRef.current = parameterBindings;
  }, [parameterBindings]);

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
        scopeSnapshotsRef.current = {};
        setScopeSnapshots({});
      }
    } else {
      setScopeSnapshots((prev) => {
        const next: Record<string, ScopeSnapshot> = {};
        let changed = false;
        for (const binding of scopeBindings) {
          const existing = prev[binding.nodeId];
          if (existing) {
            next[binding.nodeId] = existing;
          } else {
            changed = true;
            next[binding.nodeId] = {
              samples: new Float32Array(0),
              sampleInterval: 1 / Math.max(1, graph.sampleRate),
              scale: 1,
              requestedTime: 0.01,
              mode: 0,
              factor: binding.levelFactors?.[0] ?? 1,
              coverage: 0
            };
          }
        }
        if (Object.keys(prev).length !== scopeBindings.length) {
          changed = true;
        }
        if (changed) {
          scopeSnapshotsRef.current = next;
          return next;
        }
        scopeSnapshotsRef.current = prev;
        return prev;
      });
    }
  }, [artifact]);

  useEffect(() => {
    scopeSnapshotsRef.current = scopeSnapshots;
  }, [scopeSnapshots]);

  useEffect(() => {
    parameterValuesRef.current = parameterValues;
  }, [parameterValues]);

  useEffect(() => {
    graphRef.current = graph;
  }, [graph]);

  useEffect(() => {
    selectedNodeIdRef.current = selectedNodeId;
  }, [selectedNodeId]);

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
        if (options.selectNode !== undefined && selectedNodeIdRef.current !== options.selectNode) {
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
          changeType
        };
        setUndoStack((prev) => [...prev, snapshot]);
      }
      setRedoStack([]);

      setGraph(nextGraph);
      graphRef.current = nextGraph;

      if (options.selectNode !== undefined) {
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

  const addNodeToGraph = useCallback(
    (node: NodeDescriptor) => {
      const nextGraph = addNode(graphRef.current, node);
      applyGraphChange(nextGraph, { changeType: "topology", selectNode: node.id });
    },
    [applyGraphChange]
  );

  const connectNodes = useCallback(
    (params: ConnectNodesParams) => {
      const nextGraph = connectGraphNodes(graphRef.current, params);
      const validationResult = validateGraph(nextGraph);
      const cycleIssue = validationResult.issues.find(
        (issue) => issue.code === "CYCLE_DETECTED"
      );
      if (cycleIssue) {
        throw new Error(cycleIssue.message);
      }
      applyGraphChange(nextGraph, { changeType: "topology" });
    },
    [applyGraphChange]
  );

  const disconnectConnection = useCallback(
    (connectionId: string) => {
      const nextGraph = removeConnection(graphRef.current, connectionId);
      applyGraphChange(nextGraph, { changeType: "topology" });
    },
    [applyGraphChange]
  );

  const removeNodeFromGraph = useCallback(
    (nodeId: string) => {
      const nextGraph = removeGraphNode(graphRef.current, nodeId);
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
      applyGraphChange(nextGraph, options);
    },
    [applyGraphChange]
  );

  const removeConnectionsFromPort = useCallback(
    (nodeId: string, portId: string) => {
      const nextGraph = removeGraphConnectionsFromPort(graphRef.current, nodeId, portId);
      applyGraphChange(nextGraph, { changeType: "topology" });
    },
    [applyGraphChange]
  );

  const removeConnectionsToPort = useCallback(
    (nodeId: string, portId: string) => {
      const nextGraph = removeGraphConnectionsToPort(graphRef.current, nodeId, portId);
      applyGraphChange(nextGraph, { changeType: "topology" });
    },
    [applyGraphChange]
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
        afterCommit: (_prev, updated) => {
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
      const nextGraph = updateGraphNodePosition(graphRef.current, nodeId, position);
      applyGraphChange(nextGraph, {
        changeType: "metadata",
        recordHistory: false
      });
    },
    [applyGraphChange]
  );

  const getParameterValue = useCallback(
    (nodeId: string, controlId: string) => {
      const key = makeParameterKey(nodeId, controlId);
      if (key in parameterValues) {
        return parameterValues[key];
      }
      const node = graph.nodes.find((candidate) => candidate.id === nodeId);
      if (node && typeof node.parameters[controlId] === "number") {
        const raw = node.parameters[controlId];
        if (isDelayNodeKind(node.kind)) {
          return clampControlValue(node.kind, controlId, raw, graph.oversampling);
        }
        return raw;
      }
      if (node) {
        const implementation = getNodeImplementation(node.kind);
        const fallback = implementation?.manifest.defaultParams?.[controlId];
        if (typeof fallback === "number") {
          if (isDelayNodeKind(node.kind)) {
            return clampControlValue(node.kind, controlId, fallback, graph.oversampling);
          }
          return fallback;
        }
      }
      return 0;
    },
    [graph.nodes, parameterValues]
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

  const updateNodeParameter = useCallback(
    (nodeId: string, parameterId: string, value: number) => {
      const currentGraph = graphRef.current;
      const oversampling = currentGraph.oversampling;
      const targetNode = currentGraph.nodes.find((candidate) => candidate.id === nodeId);
      let adjustedValue = value;
      if (targetNode && isDelayNodeKind(targetNode.kind)) {
        adjustedValue = clampControlValue(targetNode.kind, parameterId, value, oversampling);
      }
      const nextGraph = updateGraphNodeParameter(
        currentGraph,
        nodeId,
        parameterId,
        adjustedValue
      );
      const changed = applyGraphChange(nextGraph, {
        changeType: "parameter",
        recordHistory: false
      });
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
    []
  );

  const selectNode = useCallback((nodeId: string | null) => {
    setSelectedNodeId(nodeId);
    selectedNodeIdRef.current = nodeId;
  }, []);

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
        changeType: snapshot.changeType
      };
      setRedoStack((prevRedo) => [...prevRedo, currentSnapshot]);
      setGraph(snapshot.graph);
      graphRef.current = snapshot.graph;
      setParameterValues(snapshot.parameterValues);
      parameterValuesRef.current = snapshot.parameterValues;
      setSelectedNodeId(snapshot.selectedNodeId);
      selectedNodeIdRef.current = snapshot.selectedNodeId;
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
        changeType: snapshot.changeType
      };
      setUndoStack((prevUndo) => [...prevUndo, currentSnapshot]);
      setGraph(snapshot.graph);
      graphRef.current = snapshot.graph;
      setParameterValues(snapshot.parameterValues);
      parameterValuesRef.current = snapshot.parameterValues;
      setSelectedNodeId(snapshot.selectedNodeId);
      selectedNodeIdRef.current = snapshot.selectedNodeId;
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
    console.info("[MaxWasm] compile start", {
      nodes: graph.nodes.length,
      connections: graph.connections.length
    });
    const result = await compilePatch(graph);
    console.info("[MaxWasm] compile finished", {
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
      setScopeSnapshots({});
    } else {
      const initialScopes: Record<string, ScopeSnapshot> = {};
      for (const binding of result.scopeMonitors) {
        initialScopes[binding.nodeId] =
          scopeSnapshotsRef.current[binding.nodeId] ?? {
            samples: new Float32Array(0),
            sampleInterval: 1 / Math.max(1, graph.sampleRate),
            scale: 1,
            requestedTime: 0.01,
            mode: 0,
            factor: binding.levelFactors?.[0] ?? 1,
            coverage: 0
          };
      }
      scopeSnapshotsRef.current = initialScopes;
      setScopeSnapshots(initialScopes);
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

      console.info("[MaxWasm] Creating audio worklet node");
      const handle = await loadPatchProcessor(context, artifact);
      console.info("[MaxWasm] Worklet node created");
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
          console.error("[MaxWasm] Worklet error", message);
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
          }

          if (changed) {
            scopeSnapshotsRef.current = updated;
            setScopeSnapshots({ ...updated });
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
        console.info("[MaxWasm] Sent parameter batch", values);
      }

      if (context.state === "suspended") {
        await context.resume();
      }

      console.info("[MaxWasm] Audio rendering started");
      setAudioState("running");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      console.error("[MaxWasm] Failed to start audio", error);
      setAudioState("error");
      setAudioError(message);
      await stopAudioInternal();
    }
  }, [audioSupported, artifact, stopAudioInternal, createAudioContext]);

  const exportPatch = useCallback((): PatchDocument => {
    return createPatchDocument(graphRef.current);
  }, []);

  const importPatch = useCallback(
    (input: PatchDocument | PatchGraph) => {
      const document = normalizePatchDocument(input);
      if (document.version > PATCH_DOCUMENT_VERSION) {
        throw new Error(
          `Unsupported patch version ${document.version}. Upgrade the application to load this file.`
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

      applyGraphChange(normalizedGraph, {
        changeType: "topology",
        selectNode: null,
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

  const canUndo = undoStack.length > 0;
  const canRedo = redoStack.length > 0;

  const value = useMemo<PatchController>(
    () => ({
      graph,
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
      removeConnectionsFromPort,
      removeConnectionsToPort,
      updateNodePosition,
      updateNodeParameter,
      selectedNodeId,
      selectNode,
      getParameterValue,
      envelopeSnapshots,
      getEnvelopeSnapshot,
      scopeSnapshots,
      getScopeSnapshot,
      undo,
      redo,
      canUndo,
      canRedo,
      exportPatch,
      importPatch,
      updatePatchSettings
    }),
    [
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
      removeConnectionsFromPort,
      removeConnectionsToPort,
      updateNodePosition,
      updateNodeParameter,
      selectedNodeId,
      selectNode,
      getParameterValue,
      envelopeSnapshots,
      getEnvelopeSnapshot,
      scopeSnapshots,
      getScopeSnapshot,
      undo,
      redo,
      canUndo,
      canRedo,
      exportPatch,
      importPatch,
      updatePatchSettings
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
