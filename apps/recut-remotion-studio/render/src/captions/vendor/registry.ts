import React from "react";
import { InternalThemeProps } from "./types";
import { PopTheme } from "./themes/pop";
import { KaraokeTheme } from "./themes/karaoke";
import { Kinetic01 } from "./themes/kinetic-01";
import { Kinetic02 } from "./themes/kinetic-02";

// Import custom themes
import { HustleTheme } from "./themes/hustle";
import { GrapeTheme } from "./themes/grape";
import { BeastTheme } from "./themes/beast";
import { PoppinTheme } from "./themes/poppin";
import { AaritTheme } from "./themes/aarit";
import { SoftAITheme } from "./themes/soft-ai";
import { GamingStreamTheme } from "./themes/gaming-stream";
import { SimpleOneWordTheme } from "./themes/simple-one-word";
import { PodcastTheme } from "./themes/podcast";

export const themeRegistry: Record<string, React.FC<InternalThemeProps>> = {
  pop: PopTheme,
  karaoke: KaraokeTheme,
  "kinetic-01": Kinetic01,
  "kinetic-02": Kinetic02,

  // Custom Themes
  hustle: HustleTheme,
  grape: GrapeTheme,
  beast: BeastTheme,
  poppin: PoppinTheme,
  aarit: AaritTheme,
  "soft-ai": SoftAITheme,
  "gaming-stream": GamingStreamTheme,
  "simple-one-word": SimpleOneWordTheme,
  podcast: PodcastTheme,
} as const;

export type ThemeName = keyof typeof themeRegistry;
