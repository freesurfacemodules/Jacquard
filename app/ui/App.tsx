import "./App.css";
import { Canvas } from "./components/Canvas";
import { Inspector } from "./components/Inspector";
import { Toolbar } from "./components/Toolbar";
import { PatchProvider } from "./state/PatchContext";

export function App(): JSX.Element {
  return (
    <PatchProvider>
      <div className="app-shell">
        <Toolbar />
        <main className="workspace">
          <Canvas />
          <Inspector />
        </main>
      </div>
    </PatchProvider>
  );
}
