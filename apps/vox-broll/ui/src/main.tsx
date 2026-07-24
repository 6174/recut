/**
 * [INPUT]: 依赖 React、recut UI SDK、资源卡片与资源弹窗
 * [OUTPUT]: 对外提供 B-roll 资源管理器根视图与项目事件驱动的资源刷新
 * [POS]: vox-broll 的项目 UI 编排层；不直接访问 HTTP、终端或 SQLite
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { Plus } from "lucide-react";
import { createRoot } from "react-dom/client";
import { useEffect, useMemo, useState } from "react";
import { CreateResourceDialog, ResourcePreviewDialog } from "./resource-dialogs";
import { ResourceCard } from "./resource-card";
import { recut } from "./recut-sdk";
import { Button, EmptyState, Tabs, TabsList, TabsTrigger } from "./ui";
import "./style.css";

export type Resource = { id: string; kind: string; title: string; content: unknown; dependencies: string[]; createdAt?: string };
type CapabilityEvent = { type?: string; appId?: string; kind?: string; name?: string };

const stages = ["Brief", "Beats", "Look", "Keyframes", "Motion", "Audio", "Delivery"];
const examples = ["做口播短视频你最应该关注的三件事", "为什么 AI 视频工作流总是卡在最后一步？", "一条 Vox 风格视频如何让复杂概念变简单？"];

function App() {
  const [selected, setSelected] = useState("Brief");
  const [resources, setResources] = useState<Resource[]>([]);
  const [preview, setPreview] = useState<Resource | null>(null);
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState("");
  const refresh = async () => { try { setResources(await recut.state.query("resource.list")); } catch { /* SDK 尚未连接 */ } };

  useEffect(() => {
    window.addEventListener("recut-sdk-ready", refresh);
    const unsubscribe = recut.events.subscribe((event) => {
      const capability = event as CapabilityEvent;
      if (capability.type === "app.capability.completed" && capability.appId === "recut.vox-broll" && capability.kind === "mcp" && capability.name === "create_resource") void refresh();
    });
    return () => { window.removeEventListener("recut-sdk-ready", refresh); unsubscribe(); };
  }, []);

  const tabResources = useMemo(() => resources.filter((resource) => resource.kind.toLowerCase() === selected.toLowerCase()), [resources, selected]);
  const create = async (instruction: string, dependencies: string[]) => {
    const selectedResources = resources.filter((resource) => dependencies.includes(resource.id));
    const prepared = await recut.background.call("resource.prepare", { kind: selected, dependencies: selectedResources.map((item) => `${item.kind}:${item.id}`), instruction });
    await recut.agent.send({ prompt: prepared.prompt });
    setStatus("创作请求已发给 Codex；资源完成后会自动出现。 ");
  };

  return <main className="min-h-screen p-5 sm:p-8"><div className="mx-auto max-w-6xl">
    <header className="mb-8 flex flex-col gap-5 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="font-mono text-[11px] font-semibold tracking-[0.16em] text-primary">RECUT APP / VOX B-ROLL</p><h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">资源管理器</h1><p className="mt-2 text-sm text-muted-foreground">按创作阶段管理素材与结构化产物。</p></div>
      <Button onClick={() => setCreating(true)}><Plus className="size-4" />新建 {selected}</Button>
    </header>
    <Tabs><TabsList>{stages.map((stage) => <TabsTrigger active={selected === stage} count={resources.filter((resource) => resource.kind.toLowerCase() === stage.toLowerCase()).length} key={stage} onClick={() => setSelected(stage)}>{stage}</TabsTrigger>)}</TabsList></Tabs>
    <section className="mt-7"><div className="mb-4 flex items-center justify-between"><div><h2 className="text-base font-semibold">{selected}</h2><p className="mt-1 text-xs text-muted-foreground">{tabResources.length ? `${tabResources.length} 个已创建资源` : "尚未创建资源"}</p></div></div>
      {tabResources.length ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{tabResources.map((resource) => <ResourceCard key={resource.id} onClick={() => setPreview(resource)} resource={resource} />)}</div> : <EmptyState action={() => setCreating(true)} label={`新建 ${selected}`} />}
    </section>
    {status && <p className="mt-5 text-sm text-muted-foreground" role="status">{status}</p>}
  </div>
  <ResourcePreviewDialog onOpenChange={(open) => !open && setPreview(null)} resource={preview} />
  <CreateResourceDialog examples={selected === "Brief" ? examples : []} onCreate={create} onOpenChange={setCreating} open={creating} resources={resources} stage={selected} />
  </main>;
}

createRoot(document.getElementById("root")!).render(<App />);
