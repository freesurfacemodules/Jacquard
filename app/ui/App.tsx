import "./App.css";
import { Canvas } from "./components/Canvas";
import { Inspector } from "./components/Inspector";
import { Toolbar } from "./components/Toolbar";
import { PatchProvider } from "./state/PatchContext";
import { useState, useCallback, useEffect, useRef } from "react";

function Workspace(): JSX.Element {
  const [inspectorVisible, setInspectorVisible] = useState(true);
  const [inspectorWidth, setInspectorWidth] = useState(360);
  const inspectorWidthRef = useRef(inspectorWidth);
  const inspectorRef = useRef<HTMLDivElement | null>(null);
  const [isResizing, setIsResizing] = useState(false);

  const toggleInspector = useCallback(() => {
    setInspectorVisible((prev) => !prev);
  }, []);

  const handleResizeStart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!inspectorVisible) {
        return;
      }
      event.preventDefault();
      inspectorWidthRef.current = inspectorWidth;
      setIsResizing(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [inspectorVisible, inspectorWidth]
  );

  const handleResizeMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!isResizing || !inspectorVisible) {
        return;
      }
      const viewportWidth = window.innerWidth;
      const minWidth = 240;
      const maxWidth = Math.min(600, viewportWidth * 0.6);
      const next = viewportWidth - event.clientX;
      const clamped = Math.max(minWidth, Math.min(maxWidth, next));
      inspectorWidthRef.current = clamped;
      if (inspectorRef.current) {
        inspectorRef.current.style.width = `${clamped}px`;
      }
    },
    [isResizing, inspectorVisible]
  );

  const handleResizeEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    setIsResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setInspectorWidth(inspectorWidthRef.current);
  }, []);

  const handleWorkspacePointerUp = useCallback(() => {
    if (isResizing) {
      setIsResizing(false);
      setInspectorWidth(inspectorWidthRef.current);
    }
  }, [isResizing]);

  const handleWorkspacePointerLeave = useCallback(() => {
    if (isResizing) {
      setIsResizing(false);
      setInspectorWidth(inspectorWidthRef.current);
    }
  }, [isResizing]);

  useEffect(() => {
    if (!inspectorVisible) {
      setIsResizing(false);
    }
  }, [inspectorVisible]);

  useEffect(() => {
    if (inspectorVisible && inspectorRef.current) {
      inspectorRef.current.style.width = `${inspectorWidth}px`;
    }
  }, [inspectorVisible, inspectorWidth]);

  return (
    <div
      className="workspace"
      onPointerMove={handleResizeMove}
      onPointerUp={handleWorkspacePointerUp}
      onPointerLeave={handleWorkspacePointerLeave}
    >
      <Canvas inspectorVisible={inspectorVisible} toggleInspector={toggleInspector} />
      <div
        className={`inspector-wrapper${inspectorVisible ? "" : " inspector-wrapper--hidden"}`}
        ref={inspectorRef}
        style={inspectorVisible ? { width: inspectorWidth } : undefined}
      >
        <div
          className="inspector-resizer"
          onPointerDown={handleResizeStart}
          onPointerMove={handleResizeMove}
          onPointerUp={handleResizeEnd}
          onPointerCancel={handleResizeEnd}
        />
        <Inspector />
      </div>
    </div>
  );
}

export function App(): JSX.Element {
  return (
    <PatchProvider>
      <div className="app-shell">
        <Toolbar />
        <main>
          <Workspace />
        </main>
      </div>
    </PatchProvider>
  );
}
