import "./App.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PatchProvider } from "./state/PatchContext";
import { Toolbar } from "./components/Toolbar";
import { Workspace, type WindowKey, type WindowVisibility } from "./components/Workspace";
import { HelpModal } from "./components/HelpModal";
import {
  loadHelpStartupPreference,
  saveHelpStartupPreference
} from "./utils/indexedDb";

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
  const [helpOpen, setHelpOpen] = useState(false);
  const [showHelpOnStartup, setShowHelpOnStartup] = useState(true);
  const [helpPreferenceLoaded, setHelpPreferenceLoaded] = useState(false);

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

  useEffect(() => {
    let mounted = true;
    const hasIndexedDb = typeof window !== "undefined" && "indexedDB" in window;
    if (!hasIndexedDb) {
      setShowHelpOnStartup(true);
      setHelpOpen(true);
      setHelpPreferenceLoaded(true);
      return () => {
        mounted = false;
      };
    }
    const loadPreference = async () => {
      try {
        const stored = await loadHelpStartupPreference();
        if (!mounted) {
          return;
        }
        const shouldShow = stored ?? true;
        setShowHelpOnStartup(shouldShow);
        setHelpOpen(shouldShow);
      } catch (error) {
        console.warn("[Help] Failed to load startup preference", error);
        if (mounted) {
          setShowHelpOnStartup(true);
          setHelpOpen(true);
        }
      } finally {
        if (mounted) {
          setHelpPreferenceLoaded(true);
        }
      }
    };
    void loadPreference();
    return () => {
      mounted = false;
    };
  }, []);

  const handleShowHelpOnStartupChange = useCallback((value: boolean) => {
    setShowHelpOnStartup(value);
    if (typeof window !== "undefined" && "indexedDB" in window) {
      void saveHelpStartupPreference(value).catch((error) => {
        console.warn("[Help] Failed to save startup preference", error);
      });
    }
  }, []);

  const handleCloseHelp = useCallback(() => {
    setHelpOpen(false);
  }, []);

  const handleOpenHelp = useCallback(() => {
    setHelpOpen(true);
  }, []);

  return (
    <PatchProvider>
      <div className="app-shell">
        <Toolbar
          windows={toolbarWindowState}
          onToggleWindow={toggleWindow}
          onOpenHelp={handleOpenHelp}
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
        {helpPreferenceLoaded ? (
          <HelpModal
            open={helpOpen}
            onClose={handleCloseHelp}
            showOnStartup={showHelpOnStartup}
            onShowOnStartupChange={handleShowHelpOnStartupChange}
          />
        ) : null}
      </div>
    </PatchProvider>
  );
}
