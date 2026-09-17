import { createRoot } from "react-dom/client";
import { EditorShell } from "@timeline/editor/editor-shell";
import "@timeline/globals.css";

const projectId = new URLSearchParams(window.location.search).get("projectId") ?? "";

createRoot(document.getElementById("root")!).render(<EditorShell projectId={projectId} />);
