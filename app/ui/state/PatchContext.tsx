import {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useState
} from "react";
import { addNode, createGraph } from "@graph/graph";
import { GraphViewModel } from "@graph/view-model";
import { NodeDescriptor, PatchGraph } from "@graph/types";

export interface PatchController {
  graph: PatchGraph;
  viewModel: GraphViewModel;
  addNode(node: NodeDescriptor): void;
}

const PatchContext = createContext<PatchController | null>(null);

export function PatchProvider({ children }: PropsWithChildren): JSX.Element {
  const [graph, setGraph] = useState<PatchGraph>(() => createGraph());

  const viewModel = useMemo(() => GraphViewModel.fromGraph(graph), [graph]);

  const addNodeToGraph = useCallback((node: NodeDescriptor) => {
    setGraph((prev) => addNode(prev, node));
  }, []);

  const value = useMemo<PatchController>(
    () => ({
      graph,
      viewModel,
      addNode: addNodeToGraph
    }),
    [graph, viewModel, addNodeToGraph]
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
