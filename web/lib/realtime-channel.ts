/*
 * [INPUT]: 依赖 service-endpoint 的 stream 地址与 daemon `/v1/events` WebSocket 的 channels 契约
 * [OUTPUT]: 对外提供页面级唯一实时通道：一条 WS 长连接 + channels 订阅 + 心跳保活 + 指数退避重连；所有实时消费方共享该单例
 * [POS]: web/lib 的实时通道边界；素材、项目、App 安装等增量事件统一经此分发，取代各自 EventSource
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { streamServiceEndpoint } from "@/lib/service-endpoint";

type FrameHandler = (frame: Record<string, unknown>) => void;

interface Subscription {
  channel: string;
  key: string;
  after?: number;
  handler: FrameHandler;
}

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;
const PING_INTERVAL_MS = 20_000;
const WATCHDOG_INTERVAL_MS = 10_000;
const STALE_AFTER_MS = 45_000;

/**
 * Page-level singleton WebSocket client for the daemon realtime channel.
 * Keeps exactly one connection per page; components subscribe to channels and
 * receive unified frames. On a dead or dropped connection it reconnects with
 * exponential backoff and re-subscribes all active channels.
 */
export class RealtimeChannel {
  private readonly apiBase: string;
  private ws: WebSocket | null = null;
  private readonly subscriptions = new Set<Subscription>();
  private reconnectDelay = RECONNECT_BASE_MS;
  private reconnectTimer: number | null = null;
  private pingTimer: number | null = null;
  private watchdogTimer: number | null = null;
  private lastPong = 0;
  private closed = false;
  private readonly statusListeners = new Set<(connected: boolean) => void>();

  constructor(apiBase: string) {
    this.apiBase = apiBase;
    this.open();
  }

  private open() {
    if (this.closed) return;
    const url = new URL("/v1/events", streamServiceEndpoint(this.apiBase));
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.addEventListener("open", () => {
      this.lastPong = Date.now();
      this.reconnectDelay = RECONNECT_BASE_MS;
      this.sendSubscribe();
      this.startTimers();
      this.emitStatus(true);
    });

    ws.addEventListener("message", (event) => this.handleMessage(event.data));

    ws.addEventListener("close", () => {
      this.clearTimers();
      this.emitStatus(false);
      this.ws = null;
      if (!this.closed) this.scheduleReconnect();
    });

    ws.addEventListener("error", () => {
      // close event follows and drives the reconnect path.
    });
  }

  private handleMessage(raw: unknown) {
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(String(raw)) as Record<string, unknown>;
    } catch {
      return;
    }
    const type = frame.type;
    if (type === "ping") {
      this.sendFrame({ type: "pong", t: Date.now() });
      this.lastPong = Date.now();
      return;
    }
    if (type === "pong") {
      this.lastPong = Date.now();
      return;
    }
    if (type === "subscribed") return;

    if (type === "project.event") {
      const projectId =
        typeof frame.projectId === "string" ? frame.projectId : "";
      this.dispatch("project", projectId, frame);
      return;
    }
    if (type === "event" && typeof frame.channel === "string") {
      const data =
        frame.data && typeof frame.data === "object"
          ? (frame.data as Record<string, unknown>)
          : {};
      // 会话/项目级 channel 用帧内身份做 key 路由，避免跨会话串扰。
      const key =
        typeof frame.sessionId === "string"
          ? frame.sessionId
          : typeof frame.projectId === "string"
            ? frame.projectId
            : typeof data.key === "string"
              ? data.key
              : "";
      this.dispatch(frame.channel as string, key, frame);
    }
  }

  private dispatch(channel: string, key: string, frame: Record<string, unknown>) {
    for (const sub of this.subscriptions) {
      if (sub.channel !== channel) continue;
      if (sub.key !== "" && key !== "" && sub.key !== key) continue;
      sub.handler(frame);
    }
  }

  subscribe(
    channel: string,
    key: string,
    handler: FrameHandler,
    after?: number,
  ): () => void {
    const sub: Subscription = { channel, key, handler, after };
    this.subscriptions.add(sub);
    // 连接已建立时新增订阅需即时告知服务端，否则该 channel 事件不会送达。
    if (this.isConnected()) this.sendSubscribe();
    return () => {
      this.subscriptions.delete(sub);
      const stillSubscribed = [...this.subscriptions].some(
        (s) => s.channel === channel && s.key === key,
      );
      if (!stillSubscribed && this.isConnected()) {
        this.sendUnsubscribe(channel, key);
      }
    };
  }

  /** Register a listener for connection transitions; returns an unsubscribe fn. */
  onStatusChange(listener: (connected: boolean) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** Returns true when this instance is owned by a different endpoint. */
  isClosedFor(apiBase: string): boolean {
    return this.apiBase !== apiBase;
  }

  private sendSubscribe() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const channels = [...this.subscriptions].map((sub) => ({
      channel: sub.channel,
      key: sub.key || undefined,
      after: sub.after ?? undefined,
    }));
    if (channels.length === 0) return;
    this.sendFrame({ type: "subscribe", channels });
  }

  private sendUnsubscribe(channel: string, key: string) {
    this.sendFrame({ type: "unsubscribe", channels: [{ channel, key: key || undefined }] });
  }

  private sendFrame(frame: Record<string, unknown>) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(frame));
  }

  private startTimers() {
    this.clearTimers();
    this.pingTimer = window.setInterval(() => {
      this.sendFrame({ type: "ping", t: Date.now() });
    }, PING_INTERVAL_MS);
    this.watchdogTimer = window.setInterval(() => {
      if (Date.now() - this.lastPong > STALE_AFTER_MS) {
        this.reconnect();
      }
    }, WATCHDOG_INTERVAL_MS);
  }

  private clearTimers() {
    if (this.pingTimer !== null) window.clearInterval(this.pingTimer);
    if (this.watchdogTimer !== null) window.clearInterval(this.watchdogTimer);
    this.pingTimer = null;
    this.watchdogTimer = null;
  }

  private scheduleReconnect() {
    if (this.reconnectTimer !== null) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(
      this.reconnectDelay * 2,
      RECONNECT_MAX_MS,
    );
  }

  private reconnect() {
    this.ws?.close();
    this.ws = null;
    this.scheduleReconnect();
  }

  private emitStatus(connected: boolean) {
    for (const listener of this.statusListeners) listener(connected);
  }

  close() {
    this.closed = true;
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.clearTimers();
    this.subscriptions.clear();
    this.statusListeners.clear();
    this.ws?.close();
    this.ws = null;
  }
}

let instance: RealtimeChannel | null = null;

/** Returns the page singleton, (re)creating it if the endpoint changed. */
export function getRealtimeChannel(apiBase: string): RealtimeChannel {
  if (!instance || instance.isClosedFor(apiBase)) {
    instance?.close();
    instance = new RealtimeChannel(apiBase);
  }
  return instance;
}
