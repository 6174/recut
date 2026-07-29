/*
 * [INPUT]: 依赖 wavesurfer.js 的音频解码、波形渲染和定位能力，以及 lucide-react 图标
 * [OUTPUT]: 对外提供 AudioWaveformPlayer 音频波形预览播放器
 * [POS]: web/components 的音频预览原子；由 AssetPreviewDialog 消费，统一替代浏览器原生音频控件
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Download, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type WaveSurfer from "wavesurfer.js";

type AudioWaveformPlayerProps = {
  name: string;
  src: string;
};

function formatTime(seconds: number) {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

export function AudioWaveformPlayer({ name, src }: AudioWaveformPlayerProps) {
  const container = useRef<HTMLDivElement>(null);
  const player = useRef<WaveSurfer | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let disposed = false;
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
    setIsMuted(false);
    setFailed(false);
    setReady(false);

    void import("wavesurfer.js").then(({ default: WaveSurfer }) => {
      if (disposed || !container.current) return;
      const instance = WaveSurfer.create({
        barGap: 2,
        barRadius: 3,
        barWidth: 2,
        container: container.current,
        cursorColor: "#7c3aed",
        cursorWidth: 2,
        dragToSeek: true,
        height: 144,
        normalize: true,
        progressColor: "#7c3aed",
        url: src,
        waveColor: "#ddd6fe",
      });
      player.current = instance;
      instance.on("ready", (nextDuration) => {
        setDuration(nextDuration);
        setReady(true);
      });
      instance.on("timeupdate", setCurrentTime);
      instance.on("play", () => setIsPlaying(true));
      instance.on("pause", () => setIsPlaying(false));
      instance.on("finish", () => setIsPlaying(false));
      instance.on("error", () => setFailed(true));
    }).catch(() => {
      if (!disposed) setFailed(true);
    });

    return () => {
      disposed = true;
      player.current?.destroy();
      player.current = null;
    };
  }, [src]);

  function togglePlayback() {
    player.current?.playPause();
  }

  function seek(time: number) {
    player.current?.setTime(time);
    setCurrentTime(time);
  }

  function toggleMute() {
    const nextMuted = !isMuted;
    player.current?.setVolume(nextMuted ? 0 : 1);
    setIsMuted(nextMuted);
  }

  if (failed) return <audio aria-label={`${name} 音频预览`} className="w-full" controls preload="metadata" src={src}>你的浏览器不支持音频播放。</audio>;

  return <div className="w-full max-w-3xl" aria-label={`${name} 波形播放器`}>
    <div className="min-h-36 overflow-hidden rounded-xs border bg-background px-3 py-2" ref={container} />
    <div className="mt-3 flex items-center gap-2 rounded-full bg-muted px-3 py-2">
      <button aria-label={isPlaying ? "暂停" : "播放"} className="grid size-7 shrink-0 place-items-center rounded-full text-foreground hover:bg-background disabled:cursor-not-allowed disabled:text-muted-foreground" disabled={!ready} onClick={togglePlayback} title={isPlaying ? "暂停" : "播放"} type="button">
        {isPlaying ? <Pause className="size-3.5 fill-current" /> : <Play className="size-3.5 fill-current" />}
      </button>
      <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">{formatTime(currentTime)} / {formatTime(duration)}</span>
      <input aria-label="播放进度" className="h-1 min-w-0 flex-1 accent-violet-600" disabled={!ready} max={duration || 1} min="0" onChange={(event) => seek(Number(event.target.value))} step="0.01" type="range" value={Math.min(currentTime, duration || 0)} />
      <button aria-label={isMuted ? "打开声音" : "静音"} className="grid size-7 shrink-0 place-items-center rounded-full text-foreground hover:bg-background disabled:cursor-not-allowed disabled:text-muted-foreground" disabled={!ready} onClick={toggleMute} title={isMuted ? "打开声音" : "静音"} type="button">
        {isMuted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
      </button>
      <a aria-label={`下载 ${name}`} className="grid size-7 shrink-0 place-items-center rounded-full text-foreground hover:bg-background" download href={src} title="下载音频"><Download className="size-3.5" /></a>
    </div>
  </div>;
}
