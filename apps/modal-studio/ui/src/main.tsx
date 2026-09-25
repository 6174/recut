/**
 * [INPUT]: 依赖 React 根渲染与全局样式
 * [OUTPUT]: 挂载 Modal 云函数 App 界面
 * [POS]: ui 的入口
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
