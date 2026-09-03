import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "@/globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div className="h-full dark">
      <App />
    </div>
  </StrictMode>,
);
