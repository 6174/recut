import { createRoot } from "react-dom/client";
import { EditorShell } from "@/editor/editor-shell";
import "@/globals.css";

const projectId = new URLSearchParams(window.location.search).get("projectId") ?? "";

createRoot(document.getElementById("root")!).render(<EditorShell projectId={projectId} />);
