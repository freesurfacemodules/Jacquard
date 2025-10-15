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
import { addNode, createGraph } from "@graph/graph";
import { GraphViewModel } from "@graph/view-model";
import { NodeDescriptor, PatchGraph } from "@graph/types";
import { GraphValidationResult, validateGraph } from "@graph/validation";
import { compilePatch, CompileResult } from "@compiler/compiler";
import {
  loadPatchProcessor,
  WorkletHandle
} from "@audio/worklet-loader";

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
}

const PatchContext = createContext<PatchController | null>(null);

export function PatchProvider({ children }: PropsWithChildren): JSX.Element {
  const [graph, setGraph] = useState<PatchGraph>(() => createGraph());
  const [artifact, setArtifact] = useState<CompileResult | null>(null);
  const viewModel = useMemo(() => GraphViewModel.fromGraph(graph), [graph]);
  const validation = useMemo(() => validateGraph(graph), [graph]);
  const audioSupported =
    typeof window !== "undefined" &&
    (typeof window.AudioContext === "function" ||
      typeof (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext === "function");
  const [audioState, setAudioState] = useState<AudioEngineState>(
    audioSupported ? "idle" : "unsupported"
  );
  const [audioError, setAudioError] = useState<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletHandleRef = useRef<WorkletHandle | null>(null);

  const addNodeToGraph = useCallback((node: NodeDescriptor) => {
    setGraph((prev) => addNode(prev, node));
  }, []);

  const stopAudioInternal = useCallback(async () => {
    const handle = workletHandleRef.current;
    workletHandleRef.current = null;

    if (handle) {
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
    const result = await compilePatch(graph);
    await stopAudioInternal();
    setArtifact(result);
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

      const handle = await loadPatchProcessor(context, artifact);
      workletHandleRef.current = handle;
      handle.node.connect(context.destination);

      if (context.state === "suspended") {
        await context.resume();
      }

      setAudioState("running");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      setAudioState("error");
      setAudioError(message);
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
      addNode: addNodeToGraph
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
      addNodeToGraph
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
