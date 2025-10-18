import "./App.css";
import { useCallback, useMemo, useState } from "react";
import { PatchProvider } from "./state/PatchContext";
import { Toolbar } from "./components/Toolbar";
import { Workspace, type WindowKey, type WindowVisibility } from "./components/Workspace";

interface CommandPaletteState {
  open: boolean;
  canvasPosition: { x: number; y: number } | null;
  screenPosition: { x: number; y: number } | null;
}

interface PendingNodeCreation {
  kind: string;
  position: { x: number; y: number } | null;
}

const DEFAULT_WINDOWS: WindowVisibility = {
  nodeBrowser: true,
  nodeProperties: true,
  assemblyView: true,
  audioSettings: false
};

export function App(): JSX.Element {
  const [windows, setWindows] = useState<WindowVisibility>(DEFAULT_WINDOWS);
  const [commandPalette, setCommandPalette] = useState<CommandPaletteState>({
    open: false,
    canvasPosition: null,
    screenPosition: null
  });
  const [pendingNodeCreation, setPendingNodeCreation] = useState<PendingNodeCreation | null>(
    null
  );

  const toggleWindow = useCallback((key: WindowKey) => {
    setWindows((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const openCommandPalette = useCallback(
    (canvasPoint: { x: number; y: number } | null, screenPoint: { x: number; y: number } | null) => {
      setCommandPalette({ open: true, canvasPosition: canvasPoint, screenPosition: screenPoint });
    },
    []
  );

  const closeCommandPalette = useCallback(() => {
    setCommandPalette((prev) => ({ ...prev, open: false }));
  }, []);

  const handleCommandPaletteSelect = useCallback(
    (kind: string) => {
      setPendingNodeCreation({ kind, position: commandPalette.canvasPosition });
      setCommandPalette({ open: false, canvasPosition: null, screenPosition: null });
    },
    [commandPalette.canvasPosition]
  );

  const handleNodeBrowserCreate = useCallback((kind: string) => {
    setPendingNodeCreation({ kind, position: null });
  }, []);

  const handleNodeCreationHandled = useCallback(() => {
    setPendingNodeCreation(null);
  }, []);

  const toolbarWindowState = useMemo(() => windows, [windows]);

  return (
    <PatchProvider>
      <div className="app-shell">
        <Toolbar
          windows={toolbarWindowState}
          onToggleWindow={toggleWindow}
        />
        <main>
          <Workspace
            windows={windows}
            onToggleWindow={toggleWindow}
            commandPalette={commandPalette}
            onOpenCommandPalette={openCommandPalette}
            onCloseCommandPalette={closeCommandPalette}
            onCommandPaletteSelect={handleCommandPaletteSelect}
            onNodeCreationHandled={handleNodeCreationHandled}
            pendingNodeCreation={pendingNodeCreation}
            onCreateNodeViaBrowser={handleNodeBrowserCreate}
          />
        </main>
      </div>
    </PatchProvider>
  );
}
