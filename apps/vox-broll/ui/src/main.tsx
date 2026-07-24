/**
 * [INPUT]: 依赖 React 与 recut UI SDK
 * [OUTPUT]: 渲染 B-roll 资源管理器，创建意图经 background.js 交给 Codex
 * [POS]: vox-broll 的项目 UI 根；只显示资源投影，不直接访问 HTTP、终端或 SQLite
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { recut } from "./recut-sdk";
import "./style.css";

type Resource = { id: string; kind: string; title: string; content: unknown; dependencies: string[] };
const stages = ["Brief", "Beats", "Look", "Keyframes", "Motion", "Audio", "Delivery"];
const examples = ["做口播短视频你最应该关注的三件事", "为什么 AI 视频工作流总是卡在最后一步？", "一条 Vox 风格视频如何让复杂概念变简单？"];

function App() {
  const [selected, setSelected] = useState("Brief");
  const [instruction, setInstruction] = useState("");
  const [dependencies, setDependencies] = useState<string[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [status, setStatus] = useState("");
  const refresh = async () => { try { setResources(await recut.state.query("resource.list")); } catch { /* SDK 尚未连接 */ } };
  useEffect(() => { window.addEventListener("recut-sdk-ready", refresh); return () => window.removeEventListener("recut-sdk-ready", refresh); }, []);
  const selectedResources = resources.filter((resource) => dependencies.includes(resource.id));
  const current = resources.find((resource) => resource.kind.toLowerCase() === selected.toLowerCase());
  const toggle = (id: string) => setDependencies((items) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id]);
  const request = async () => {
    setStatus("正在准备给 Codex 的上下文…");
    try {
      const prepared = await recut.background.call("resource.prepare", { kind: selected, dependencies: selectedResources.map((item) => `${item.kind}:${item.id}`), instruction });
      const run = await recut.agent.send({ prompt: prepared.prompt });
      setStatus(`已发送到 Codex（${run.terminalId ?? "正在启动会话"}）。等待 MCP 提交资源。`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "无法创建 Agent 请求"); }
  };
  return <main><p className="eyebrow">RECUT APP / VOX B-ROLL</p><h1>资源管理器</h1><p className="copy">选择一个资源，引用已有产物，再把结构化创作请求交给右侧 Codex。</p><div className="workspace"><nav>{stages.map((stage) => <button className={selected === stage ? "stage active" : "stage"} key={stage} onClick={() => setSelected(stage)}>{stage}<small>{resources.some((item) => item.kind.toLowerCase() === stage.toLowerCase()) ? "已生成" : "待创建"}</small></button>)}</nav><section><p className="eyebrow">{selected} / {current ? "最新产物" : "新资源"}</p>{current ? <><h2>{current.title}</h2><pre>{JSON.stringify(current.content, null, 2)}</pre></> : <p className="empty">尚无 {selected}。选择依赖和要求后，Codex 会通过 MCP 提交它。</p>}<label>创作要求<textarea onChange={(event) => setInstruction(event.target.value)} placeholder="写下你希望这次资源具备什么特征" value={instruction} /></label>{selected === "Brief" && <div className="examples">{examples.map((example) => <button className="example" key={example} onClick={() => setInstruction(example)}>{example}</button>)}</div>}<p className="hint">选择本次应参考的资源</p><div className="dependencies">{resources.length ? resources.map((resource) => <label className="dependency" key={resource.id}><input checked={dependencies.includes(resource.id)} onChange={() => toggle(resource.id)} type="checkbox" />{resource.kind}: {resource.title}</label>) : <span>暂无可选资源</span>}</div><button className="primary" onClick={() => void request()}>让 Codex 创建 {selected}</button>{status && <p className="status">{status}</p>}</section></div></main>;
}

createRoot(document.getElementById("root")!).render(<App />);
