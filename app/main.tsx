import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "@ui/App";
import "@ui/index.css";

const container = document.getElementById("root");

if (!container) {
  throw new Error("Failed to find root element");
}

// Render the root React tree.
ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
