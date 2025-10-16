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
import {
  loadPatchProcessor,
  WorkletHandle
} from "@audio/worklet-loader";
import { getNodeImplementation } from "@dsp/nodes";
import type { PlanControl } from "@codegen/plan";

const PARAM_MESSAGE_BATCH = "parameterBatch";
const PARAM_MESSAGE_SINGLE = "parameter";

const makeParameterKey = (nodeId: string, controlId: string): string =>
  `${nodeId}:${controlId}`;

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
  updateNodePosition(nodeId: string, position: NodePosition): void;
  updateNodeParameter(nodeId: string, parameterId: string, value: number): void;
  selectedNodeId: string | null;
  selectNode(nodeId: string | null): void;
  getParameterValue(nodeId: string, controlId: string): number;
}

const PatchContext = createContext<PatchController | null>(null);

export function PatchProvider({ children }: PropsWithChildren): JSX.Element {
  const [graph, setGraph] = useState<PatchGraph>(() => createGraph());
  const [artifact, setArtifact] = useState<CompileResult | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [parameterBindings, setParameterBindings] = useState<PlanControl[]>([]);
  const [parameterValues, setParameterValues] = useState<Record<string, number>>({});

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
  const parameterValuesRef = useRef<Record<string, number>>({});

  useEffect(() => {
    parameterBindingsRef.current = parameterBindings;
  }, [parameterBindings]);

  useEffect(() => {
    parameterValuesRef.current = parameterValues;
  }, [parameterValues]);

  const addNodeToGraph = useCallback((node: NodeDescriptor) => {
    setGraph((prev) => addNode(prev, node));
  }, []);

  const connectNodes = useCallback((params: ConnectNodesParams) => {
    setGraph((prev) => connectGraphNodes(prev, params));
  }, []);

  const disconnectConnection = useCallback((connectionId: string) => {
    setGraph((prev) => removeConnection(prev, connectionId));
  }, []);

  const updateNodePosition = useCallback(
    (nodeId: string, position: NodePosition) => {
      setGraph((prev) => updateGraphNodePosition(prev, nodeId, position));
    },
    []
  );

  const getParameterValue = useCallback(
    (nodeId: string, controlId: string) => {
      const key = makeParameterKey(nodeId, controlId);
      if (key in parameterValues) {
        return parameterValues[key];
      }
      const node = graph.nodes.find((candidate) => candidate.id === nodeId);
      if (node && typeof node.parameters[controlId] === "number") {
        return node.parameters[controlId];
      }
      if (node) {
        const implementation = getNodeImplementation(node.kind);
        const fallback = implementation?.manifest.defaultParams?.[controlId];
        if (typeof fallback === "number") {
          return fallback;
        }
      }
      return 0;
    },
    [graph.nodes, parameterValues]
  );

  const updateNodeParameter = useCallback(
    (nodeId: string, parameterId: string, value: number) => {
      setGraph((prev) => updateGraphNodeParameter(prev, nodeId, parameterId, value));
      const key = makeParameterKey(nodeId, parameterId);
      setParameterValues((prev) => ({ ...prev, [key]: value }));

      const binding = parameterBindingsRef.current.find(
        (entry) => entry.nodeId === nodeId && entry.controlId === parameterId
      );
      const handle = workletHandleRef.current;
      if (binding && handle) {
        handle.node.port.postMessage({
          type: PARAM_MESSAGE_SINGLE,
          index: binding.index,
          value
        });
      }
    },
    []
  );

  const selectNode = useCallback((nodeId: string | null) => {
    setSelectedNodeId(nodeId);
  }, []);

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
  }, [graph, audioSupported, stopAudioInternal]);

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
    const parameterMap = parameterValuesRef.current;
    const graphWithParameters: PatchGraph = {
      ...graph,
      nodes: graph.nodes.map((node) => {
        const implementation = getNodeImplementation(node.kind);
        const controls = implementation?.manifest.controls ?? [];
        if (!controls.length) {
          return node;
        }
        const parameters = { ...node.parameters };
        let changed = false;
        for (const control of controls) {
          const key = makeParameterKey(node.id, control.id);
          if (parameterMap[key] !== undefined) {
            parameters[control.id] = parameterMap[key];
            changed = true;
          }
        }
        return changed ? { ...node, parameters } : node;
      })
    };

    const result = await compilePatch(graphWithParameters);
    await stopAudioInternal();
    setGraph(graphWithParameters);
    setArtifact(result);
    setParameterBindings(result.parameterBindings);

    setParameterValues((prev) => {
      const next = { ...prev };
      for (const binding of result.parameterBindings) {
        const key = makeParameterKey(binding.nodeId, binding.controlId);
        const node = graphWithParameters.nodes.find(
          (candidate) => candidate.id === binding.nodeId
        );
        if (node && typeof node.parameters[binding.controlId] === "number") {
          next[key] = node.parameters[binding.controlId];
        } else {
          next[key] = binding.defaultValue;
        }
      }
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
      updateNodePosition,
      updateNodeParameter,
      selectedNodeId,
      selectNode,
      getParameterValue
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
      updateNodePosition,
      updateNodeParameter,
      selectedNodeId,
      selectNode,
      getParameterValue
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
