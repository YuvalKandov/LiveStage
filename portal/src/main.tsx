import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { applyTheme, watchSystemTheme } from "./theme";
import "./index.css";

// Apply the saved (or system) theme before the first paint to avoid a flash, then keep it in sync
// with the OS setting while in system mode.
applyTheme();
watchSystemTheme();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
