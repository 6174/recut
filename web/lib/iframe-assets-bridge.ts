/**
 * [INPUT]: 依赖已连接 Service 的 API base、iframe MessagePort 请求和当前 project scope。
 * [OUTPUT]: 对外提供 handleIframeAssetsRequest，把 recut.assets SDK 调用收敛为受 scope 限制的 Service 请求，并承接顶层 Clipboard 写入；
 *           同时承接 apps.request-install，让 iframe App 拉起宿主全局统一的 App 安装引导弹窗。
 * [POS]: web/lib 的 iframe Assets/安装引导能力边界；项目与独立 App 宿主共用，iframe 不发现 Service 或拼接资产 API。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

import { useAppInstallGuideStore } from "@/lib/app-install-guide-store";

type IframeRequest = {
  type?: unknown;
  input?: Record<string, unknown>;
};

type AssetsBridgeOptions = {
  apiBase: string;
  projectID: string;
  headers?: HeadersInit;
};

type AssetsBridgeResult =
  | { handled: false }
  | { handled: true; result: unknown };

function stringInput(input: Record<string, unknown> | undefined, key: string) {
  const value = input?.[key];
  return typeof value === "string" ? value.trim() : "";
}

async function responsePayload(response: Response) {
  const payload = await response.json().catch(() => null);
  if (response.ok) return payload;
  const error = payload && typeof payload === "object" && typeof (payload as { error?: unknown }).error === "string"
    ? (payload as { error: string }).error
    : `Assets request failed (${response.status})`;
  throw new Error(error);
}

function requireAssetID(input: Record<string, unknown> | undefined) {
  const assetID = stringInput(input, "assetId");
  if (!assetID) throw new Error("assetId is required");
  return assetID;
}

function assertProjectScope(input: Record<string, unknown> | undefined, projectID: string) {
  const requestedProjectID = stringInput(input, "projectId");
  if (requestedProjectID && requestedProjectID !== projectID) {
    throw new Error("assets request cannot cross the current project scope");
  }
}

export async function handleIframeAssetsRequest(
  request: IframeRequest,
  options: AssetsBridgeOptions,
): Promise<AssetsBridgeResult> {
  const type = typeof request.type === "string" ? request.type : "";
  // iframe App 请求拉起宿主全局安装引导：安全面由宿主页面持有，App 只提供身份与来源。
  if (type === "apps.request-install") {
    const input = request.input;
    useAppInstallGuideStore.getState().openInstallGuide({
      appId: stringInput(input, "appId") || undefined,
      name: stringInput(input, "name") || undefined,
      repository: stringInput(input, "repository") || undefined,
    });
    return { handled: true, result: { opened: true } };
  }
  if (type === "clipboard.write-text") {
    const text = typeof request.input?.text === "string" ? request.input.text : "";
    if (!text) throw new Error("clipboard text is required");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API 仍可能被浏览器策略拒绝；顶层文档的同步 fallback 不依赖 iframe policy。
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0;";
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      if (!copied) throw new Error("clipboard write was blocked");
    }
    return { handled: true, result: undefined };
  }
  if (!type.startsWith("assets.")) return { handled: false };

  const input = request.input;
  const headers = options.headers;
  const base = options.apiBase.replace(/\/$/, "");

  switch (type) {
    case "assets.get": {
      const assetID = requireAssetID(input);
      const response = await fetch(`${base}/v1/media/assets/${encodeURIComponent(assetID)}`, { headers });
      return { handled: true, result: await responsePayload(response) };
    }
    case "assets.list": {
      assertProjectScope(input, options.projectID);
      const response = await fetch(`${base}/v1/media/assets?projectId=${encodeURIComponent(options.projectID)}`, { headers });
      const assets = await responsePayload(response);
      return { handled: true, result: { projectId: options.projectID, assets } };
    }
    case "assets.upload": {
      assertProjectScope(input, options.projectID);
      const file = input?.file;
      if (!(file instanceof File)) throw new Error("file is required");
      const body = new FormData();
      body.set("file", file, file.name);
      const created = await responsePayload(await fetch(`${base}/v1/media/assets`, {
        method: "POST",
        headers,
        body,
      })) as { id?: unknown };
      if (typeof created.id !== "string" || !created.id) throw new Error("Assets service did not return an asset id");
      await responsePayload(await fetch(`${base}/v1/media/assets/${encodeURIComponent(created.id)}/attach`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(headers ?? {}) },
        body: JSON.stringify({ projectId: options.projectID }),
      }));
      return { handled: true, result: { asset: created } };
    }
    case "assets.attach": {
      assertProjectScope(input, options.projectID);
      const assetID = requireAssetID(input);
      await responsePayload(await fetch(`${base}/v1/media/assets/${encodeURIComponent(assetID)}/attach`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(headers ?? {}) },
        body: JSON.stringify({ projectId: options.projectID }),
      }));
      return { handled: true, result: null };
    }
    case "assets.delete": {
      const assetID = requireAssetID(input);
      await responsePayload(await fetch(`${base}/v1/media/assets/${encodeURIComponent(assetID)}`, {
        method: "DELETE",
        headers,
      }));
      return { handled: true, result: null };
    }
    case "assets.content-url": {
	  const assetID = requireAssetID(input);
	  return { handled: true, result: `${base}/v1/media/assets/${encodeURIComponent(assetID)}/content` };
    }
	case "assets.part-url": {
	  const assetID = requireAssetID(input);
	  const part = stringInput(input, "part");
	  if (!/^(srt|json|content|image)$/.test(part)) throw new Error("unsupported asset part");
	  return { handled: true, result: `${base}/v1/media/assets/${encodeURIComponent(assetID)}/parts/${part}` };
	}
    default:
      throw new Error(`unsupported assets request: ${type}`);
  }
}
