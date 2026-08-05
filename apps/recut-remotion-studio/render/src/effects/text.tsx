import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Palette } from "./registry";

export interface TextFXProps {
  text: string;
  subtitle?: string;
  palette: Palette;
}

/**
 * Parameterized text effects. Motion structure and spring tuning are adapted
 * from the vendored remotion-templates components (reactvideoeditor.com);
 * text and colors are driven by the design. All timing is frame-driven and
 * deterministic (no Math.random / Date.now).
 */

export const BounceText: React.FC<TextFXProps> = ({ text, subtitle, palette }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const slideIn = spring({ frame, fps, from: -100, to: 0, config: { damping: 100, mass: 1, stiffness: 200 } });
  const fadeIn = spring({ frame: frame - 15, fps, from: 0, to: 1, config: { damping: 100, mass: 1 } });
  const scaleIn = spring({ frame, fps, from: 0.5, to: 0.8, config: { damping: 100, mass: 1, stiffness: 200 } });
  const containerFadeIn = spring({ frame, fps, from: 0, to: 1, config: { damping: 100, mass: 1 } });
  return (
    <div style={{ position: "absolute", top: "50%", left: "50%", transform: `translate(-50%, -50%) scale(${scaleIn})`, width: "80%", padding: "2rem 3rem", background: `linear-gradient(45deg, ${palette.accent}, ${palette.primary})`, borderRadius: 20, opacity: containerFadeIn }}>
      <div style={{ transform: `translateX(${slideIn}%)` }}>
        <h1 style={{ fontSize: "3.5rem", fontWeight: 900, color: palette.background, margin: 0, lineHeight: 1, fontFamily: palette.fontFamily, textShadow: "0px 4px 8px rgba(0,0,0,0.3)" }}>{text}</h1>
        {subtitle ? <h2 style={{ fontSize: "1.8rem", color: palette.background, margin: 0, marginTop: "0.75rem", fontWeight: 500, opacity: fadeIn, fontFamily: palette.fontFamily }}>{subtitle}</h2> : null}
      </div>
    </div>
  );
};

export const Typewriter: React.FC<TextFXProps> = ({ text, subtitle, palette }) => {
  const frame = useCurrentFrame();
  const visible = Math.floor(interpolate(frame, [0, 45], [0, text.length], { extrapolateRight: "clamp" }));
  const cursorOn = frame % 15 < 7;
  return (
    <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: "100%", textAlign: "center", padding: "2rem" }}>
      <div style={{ fontFamily: "'Courier New', monospace", fontSize: "3rem", fontWeight: "bold", color: palette.text }}>
        {text.slice(0, visible)}
        <span style={{ color: palette.accent, opacity: cursorOn ? 1 : 0, marginLeft: "0.2rem" }}>▌</span>
      </div>
      {subtitle ? <p style={{ fontFamily: palette.fontFamily, color: palette.accent, fontSize: "1.4rem", marginTop: "0.75rem" }}>{subtitle}</p> : null}
    </div>
  );
};

export const GlitchText: React.FC<TextFXProps> = ({ text, palette }) => {
  const frame = useCurrentFrame();
  const glitchIntensity = Math.sin(frame / 10) * 10;
  const rgbOffset = Math.sin(frame / 5) * 5;
  const content = (color: string, x: number, y: number) => (
    <div style={{ position: "absolute", color, transform: `translate(${x}px, ${y}px)`, mixBlendMode: "screen", whiteSpace: "nowrap" }}>{text}</div>
  );
  return (
    <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", fontSize: "5rem", fontWeight: "bold", fontFamily: "monospace" }}>
      {content(palette.accent, rgbOffset, glitchIntensity)}
      {content(palette.primary, -rgbOffset, -glitchIntensity)}
      <div style={{ color: palette.text, opacity: 0.8, whiteSpace: "nowrap" }}>{text}</div>
    </div>
  );
};

export const CinematicTitle: React.FC<TextFXProps> = ({ text, subtitle, palette }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const titleY = spring({ frame, fps, from: 50, to: 0, durationInFrames: 40, config: { damping: 14, mass: 0.8 } });
  const titleOpacity = spring({ frame, fps, from: 0, to: 1, durationInFrames: 30 });
  const underlineWidth = interpolate(frame, [20, 50], [0, 100], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const subtitleOpacity = interpolate(frame, [40, 60], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", background: palette.background, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
      <h1 style={{ color: palette.text, fontSize: "4rem", fontWeight: "bold", opacity: titleOpacity, transform: `translateY(${titleY}px)`, margin: 0, letterSpacing: "0.05em", fontFamily: palette.fontFamily }}>{text}</h1>
      <div style={{ width: `${underlineWidth}%`, maxWidth: 320, height: 4, background: `linear-gradient(90deg, ${palette.accent}, ${palette.primary})`, borderRadius: 2, marginTop: 16 }} />
      {subtitle ? <p style={{ color: palette.accent, fontSize: "1.5rem", fontWeight: 300, opacity: subtitleOpacity, marginTop: 24, letterSpacing: "0.1em", fontFamily: palette.fontFamily }}>{subtitle}</p> : null}
    </div>
  );
};

export const SlideText: React.FC<TextFXProps> = ({ text, subtitle, palette }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const opacity = spring({ frame, fps, from: 0, to: 1, durationInFrames: 30 });
  const slideX = spring({ frame, fps, from: 200, to: 0, durationInFrames: 30, config: { damping: 12, mass: 0.5 } });
  return (
    <div style={{ position: "absolute", top: "50%", left: "50%", transform: `translate(-50%, -50%) translateX(${slideX}px)`, width: "100%", textAlign: "center" }}>
      <h1 style={{ opacity, color: palette.text, fontSize: "4rem", fontWeight: "bold", margin: 0, fontFamily: palette.fontFamily }}>{text}</h1>
      {subtitle ? <p style={{ opacity, color: palette.accent, fontSize: "1.6rem", marginTop: "0.75rem", fontFamily: palette.fontFamily }}>{subtitle}</p> : null}
    </div>
  );
};

/** Bottom-left reporter bar, adapted from the vendored lower-third template. */
export const LowerThird: React.FC<TextFXProps> = ({ text, subtitle, palette }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const accentSlide = spring({ frame, fps, from: -300, to: 0, durationInFrames: 25, config: { damping: 15, mass: 0.6 } });
  const barSlide = spring({ frame: Math.max(0, frame - 5), fps, from: -400, to: 0, durationInFrames: 30, config: { damping: 14, mass: 0.7 } });
  const textOpacity = spring({ frame: Math.max(0, frame - 15), fps, from: 0, to: 1, durationInFrames: 20 });
  return (
    <div style={{ position: "absolute", bottom: "20%", left: 40 }}>
      <div style={{ width: 200, height: 3, background: `linear-gradient(90deg, ${palette.accent}, ${palette.primary})`, transform: `translateX(${accentSlide}px)`, borderRadius: 2, marginBottom: 4 }} />
      <div style={{ display: "flex", flexDirection: "row", transform: `translateX(${barSlide}px)` }}>
        <div style={{ width: 4, background: palette.accent, borderRadius: "2px 0 0 2px" }} />
        <div style={{ background: "rgba(0,0,0,0.7)", padding: "16px 32px", borderRadius: "0 4px 4px 0" }}>
          <div style={{ color: "#fff", fontSize: "1.6rem", fontWeight: "bold", opacity: textOpacity, letterSpacing: "0.02em", fontFamily: palette.fontFamily }}>{text}</div>
          {subtitle ? <div style={{ color: "rgba(255,255,255,0.7)", fontSize: "1rem", fontWeight: 300, opacity: textOpacity, marginTop: 4, letterSpacing: "0.05em", fontFamily: palette.fontFamily }}>{subtitle}</div> : null}
        </div>
      </div>
    </div>
  );
};

const TEXT_EFFECTS: Record<string, React.FC<TextFXProps>> = {
  "bounce-text": BounceText,
  typewriter: Typewriter,
  glitch: GlitchText,
  "cinematic-title": CinematicTitle,
  "slide-text": SlideText,
  "lower-third": LowerThird,
};

export const TextFX: React.FC<TextFXProps & { effectId?: string }> = ({ effectId, ...props }) => {
  const Component = effectId ? TEXT_EFFECTS[effectId] : null;
  if (!Component) return null;
  return <Component {...props} />;
};
