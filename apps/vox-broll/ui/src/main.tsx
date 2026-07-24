/**
 * [INPUT]: 依赖 react 与 App UI 样式
 * [OUTPUT]: 渲染 Vox B-roll 项目型 App 的 React 界面
 * [POS]: vox-broll 的 UI 根；经 Vite 编译为 manifest 指向的 dist/ 产物
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { createRoot } from "react-dom/client";
import { useState } from "react";
import "./style.css";

function App() {
  const [topic, setTopic] = useState("");
  return <main><p className="eyebrow">RECUT APP / VOX B-ROLL</p><h1>制作一支解说视频</h1><p className="copy">这是 B-roll App 自己编译的 React UI。业务状态、文件和生成结果只通过平台 capability 使用。</p><label>想解释什么？<textarea onChange={(event) => setTopic(event.target.value)} placeholder="输入主题、观点或问题" value={topic} /></label><button disabled={!topic.trim()}>创建创作方向</button></main>;
}

createRoot(document.getElementById("root")!).render(<App />);
