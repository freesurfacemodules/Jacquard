import { ChangeEvent, useCallback, useMemo } from "react";
import { Canvas } from "./Canvas";
import { CommandPalette } from "./CommandPalette";
import { NodeBrowserPanel } from "./panels/NodeBrowserPanel";
import { NodePropertiesPanel } from "./panels/NodePropertiesPanel";
import { AssemblyPanel } from "./panels/AssemblyPanel";
import { AudioSettingsPanel } from "./panels/AudioSettingsPanel";
import { usePatch } from "../state/PatchContext";

export type WindowKey = "nodeBrowser" | "nodeProperties" | "assemblyView" | "audioSettings";

export interface WindowVisibility {
  nodeBrowser: boolean;
  nodeProperties: boolean;
  assemblyView: boolean;
  audioSettings: boolean;
}

export interface CommandPaletteState {
  open: boolean;
  canvasPosition: { x: number; y: number } | null;
  screenPosition: { x: number; y: number } | null;
}

interface WorkspaceProps {
  windows: WindowVisibility;
  onToggleWindow(key: WindowKey): void;
  commandPalette: CommandPaletteState;
  onOpenCommandPalette(
    canvasPoint: { x: number; y: number } | null,
    screenPoint: { x: number; y: number } | null
  ): void;
  onCloseCommandPalette(): void;
  onCommandPaletteSelect(kind: string): void;
  pendingNodeCreation: { kind: string; position: { x: number; y: number } | null } | null;
  onNodeCreationHandled(): void;
  onCreateNodeViaBrowser(kind: string): void;
}

const OVERSAMPLING_OPTIONS = [1, 2, 4, 8] as const;

export function Workspace({
  windows,
  onToggleWindow,
  commandPalette,
  onOpenCommandPalette,
  onCloseCommandPalette,
  onCommandPaletteSelect,
  pendingNodeCreation,
  onNodeCreationHandled,
  onCreateNodeViaBrowser
}: WorkspaceProps): JSX.Element {
  const { viewModel, validation, artifact, updatePatchSettings } = usePatch();

  const oversampling = viewModel.oversampling;

  const handleOversamplingChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const value = Number.parseInt(event.target.value, 10) as (typeof OVERSAMPLING_OPTIONS)[number];
      updatePatchSettings({ oversampling: value });
    },
    [updatePatchSettings]
  );

  const compilerStatus = useMemo(() => {
    if (!validation.isValid) {
      const primaryIssue = validation.issues[0]?.message;
      return {
        type: "error" as const,
        message: primaryIssue
          ? `${primaryIssue} Resolve graph issues before compiling.`
          : "Resolve graph issues before compiling."
      };
    }
    if (!artifact) {
      return {
        type: "info" as const,
        message: "Compile the patch to generate audio."
      };
    }
    return null;
  }, [validation.isValid, artifact]);

  return (
    <div className="workspace">
      {windows.nodeBrowser ? (
        <NodeBrowserPanel
          onCreateNode={onCreateNodeViaBrowser}
          onClose={() => onToggleWindow("nodeBrowser")}
        />
      ) : null}
      <div className="workspace-main">
        <Canvas
          onOpenCommandPalette={onOpenCommandPalette}
          pendingNodeCreation={pendingNodeCreation}
          onNodeCreationHandled={onNodeCreationHandled}
        />
        <div className="workspace-overlay workspace-overlay--top-right">
          <label className="oversampling-switch">
            <span>Oversampling</span>
            <select value={oversampling} onChange={handleOversamplingChange}>
              {OVERSAMPLING_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}×
                </option>
              ))}
            </select>
          </label>
        </div>
        {compilerStatus ? (
          <div className={`canvas-status canvas-status--${compilerStatus.type}`}>
            {compilerStatus.message}
          </div>
        ) : null}
      </div>
      <div className="workspace-dock">
        {windows.nodeProperties ? (
          <NodePropertiesPanel onClose={() => onToggleWindow("nodeProperties")} />
        ) : null}
        {windows.assemblyView ? (
          <AssemblyPanel onClose={() => onToggleWindow("assemblyView")} />
        ) : null}
        {windows.audioSettings ? (
          <AudioSettingsPanel onClose={() => onToggleWindow("audioSettings")} />
        ) : null}
      </div>
      <CommandPalette
        open={commandPalette.open}
        onClose={onCloseCommandPalette}
        onSelect={(kind) => onCommandPaletteSelect(kind)}
      />
    </div>
  );
}
