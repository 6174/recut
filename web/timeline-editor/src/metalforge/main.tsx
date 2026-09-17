import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "@timeline/globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div className="h-full dark">
      <App />
    </div>
  </StrictMode>,
);
