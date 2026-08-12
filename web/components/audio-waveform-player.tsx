/*
 * [INPUT]: 依赖原生 HTMLAudioElement 优先加载元数据与播放，wavesurfer.js 在后台解码和渲染波形，以及 lucide-react 图标
 * [OUTPUT]: 对外提供 AudioWaveformPlayer 音频波形预览播放器；波形尚未完成时也能立即播放
 * [POS]: web/components 的音频预览原子；由 AssetPreviewDialog 消费，播放与波形生成彼此独立
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
  const audio = useRef<HTMLAudioElement>(null);
  const player = useRef<WaveSurfer | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [playable, setPlayable] = useState(false);
  const [sourceFailed, setSourceFailed] = useState(false);
  const [waveformFailed, setWaveformFailed] = useState(false);
  const [waveformReady, setWaveformReady] = useState(false);

  useEffect(() => {
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
    setIsMuted(false);
    setPlayable(false);
    setSourceFailed(false);
    setWaveformFailed(false);
    setWaveformReady(false);
  }, [src]);

  useEffect(() => {
    if (!playable || !audio.current || !container.current) return;
    let disposed = false;
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
        media: audio.current ?? undefined,
        normalize: true,
        progressColor: "#7c3aed",
        url: src,
        waveColor: "#ddd6fe",
      });
      player.current = instance;
      instance.on("ready", () => {
        if (!disposed) setWaveformReady(true);
      });
      instance.on("error", () => {
        if (!disposed) setWaveformFailed(true);
      });
    }).catch(() => {
      if (!disposed) setWaveformFailed(true);
    });

    return () => {
      disposed = true;
      player.current?.destroy();
      player.current = null;
    };
  }, [playable, src]);

  function syncDuration() {
    const nextDuration = audio.current?.duration ?? 0;
    if (Number.isFinite(nextDuration)) setDuration(nextDuration);
  }

  function togglePlayback() {
    if (!audio.current) return;
    if (audio.current.paused) void audio.current.play();
    else audio.current.pause();
  }

  function seek(time: number) {
    if (audio.current) audio.current.currentTime = time;
    setCurrentTime(time);
  }

  function toggleMute() {
    const nextMuted = !isMuted;
    if (audio.current) audio.current.muted = nextMuted;
    setIsMuted(nextMuted);
  }

  if (sourceFailed) return <audio aria-label={`${name} 音频预览`} className="w-full" controls preload="metadata" src={src}>你的浏览器不支持音频播放。</audio>;

  return <div className="w-full max-w-3xl" aria-label={`${name} 波形播放器`}>
    <audio aria-hidden="true" className="sr-only" onDurationChange={syncDuration} onEnded={() => setIsPlaying(false)} onError={() => setSourceFailed(true)} onLoadedMetadata={() => { syncDuration(); setPlayable(true); }} onPause={() => setIsPlaying(false)} onPlay={() => setIsPlaying(true)} onTimeUpdate={() => setCurrentTime(audio.current?.currentTime ?? 0)} preload="metadata" ref={audio} src={src} />
    <div className="relative min-h-36 overflow-hidden rounded-xs border bg-background px-3 py-2" ref={container}>
      {!waveformReady && <div className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">{waveformFailed ? "波形无法显示，不影响播放。" : "正在生成波形…可立即播放。"}</div>}
    </div>
    <div className="mt-3 flex items-center gap-2 rounded-full bg-muted px-3 py-2">
      <button aria-label={isPlaying ? "暂停" : "播放"} className="grid size-7 shrink-0 place-items-center rounded-full text-foreground hover:bg-background disabled:cursor-not-allowed disabled:text-muted-foreground" disabled={!playable} onClick={togglePlayback} title={isPlaying ? "暂停" : "播放"} type="button">
        {isPlaying ? <Pause className="size-3.5 fill-current" /> : <Play className="size-3.5 fill-current" />}
      </button>
      <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">{formatTime(currentTime)} / {formatTime(duration)}</span>
      <input aria-label="播放进度" className="h-1 min-w-0 flex-1 accent-violet-600" disabled={!playable} max={duration || 1} min="0" onChange={(event) => seek(Number(event.target.value))} step="0.01" type="range" value={Math.min(currentTime, duration || 0)} />
      <button aria-label={isMuted ? "打开声音" : "静音"} className="grid size-7 shrink-0 place-items-center rounded-full text-foreground hover:bg-background disabled:cursor-not-allowed disabled:text-muted-foreground" disabled={!playable} onClick={toggleMute} title={isMuted ? "打开声音" : "静音"} type="button">
        {isMuted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
      </button>
      <a aria-label={`下载 ${name}`} className="grid size-7 shrink-0 place-items-center rounded-full text-foreground hover:bg-background" download href={src} title="下载音频"><Download className="size-3.5" /></a>
    </div>
  </div>;
}
