#!/usr/bin/env node
/**
 * Fetch a curated CC0 audio library (Music + SFX) into cdn/buckets/audio and
 * generate cdn/buckets/audio/catalog.json.
 *
 * Only CC0 / public-domain sources are used so Recut can redistribute them via
 * the CDN. Sources verified in this manifest:
 *   - OpenGameArt.org CC0 music (direct mp3/ogg/wav links)
 *   - Kenney.nl CC0 SFX packs (zips, CC0 license included)
 *
 * Usage: node scripts/fetch-audio.mjs [--music-only]
 *
 * Requires ffmpeg + ffprobe on PATH.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, readdirSync, existsSync, statSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = new URL("../", import.meta.url).pathname;
const PUBLIC_AUDIO = join(ROOT, "buckets", "audio");
const MUSIC_DIR = join(PUBLIC_AUDIO, "music");
const SFX_DIR = join(PUBLIC_AUDIO, "sfx");
const TMP = join(tmpdir(), "recut-audio-fetch");

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

/** Curated CC0 music. url can be a direct file or an OGA content page. */
const MUSIC = [
  {
    id: "inc-feelin-good",
    name: "Feelin Good",
    moods: ["Happy","Upbeat","Playful","Energetic"],
    styles: ["Rock","Band"],
    bpm: 131,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Feelin%20Good.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Feelin Good by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-funky-chunk",
    name: "Funky Chunk",
    moods: ["Happy","Upbeat","Energetic"],
    styles: ["Funk","Groove"],
    bpm: 115,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Funky%20Chunk.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Funky Chunk by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-welcome-to-the-show",
    name: "Welcome to the Show",
    moods: ["Upbeat","Energetic"],
    styles: ["Rock","Band"],
    bpm: 124,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Welcome%20to%20the%20Show.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Welcome to the Show by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-c-funk",
    name: "C-Funk",
    moods: ["Energetic"],
    styles: ["Funk","Groove"],
    bpm: 117,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/C-Funk.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: C-Funk by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-celebration",
    name: "Celebration",
    moods: ["Energetic","Relaxed"],
    styles: ["Funk","Groove"],
    bpm: 115,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Celebration.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Celebration by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-style-funk",
    name: "Style Funk",
    moods: ["Happy","Energetic"],
    styles: ["Funk","Groove"],
    bpm: 100,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/StyleFunk.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Style Funk by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-funkorama",
    name: "Funkorama",
    moods: ["Upbeat","Energetic"],
    styles: ["Funk","Groove"],
    bpm: 101,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Funkorama.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Funkorama by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-who-likes-to-party",
    name: "Who Likes to Party",
    moods: ["Happy","Upbeat","Energetic"],
    styles: ["Disco","Retro"],
    bpm: 117,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Who%20Likes%20to%20Party.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Who Likes to Party by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-montauk-point",
    name: "Montauk Point",
    moods: ["Happy","Upbeat","Playful"],
    styles: ["Band","Groove"],
    bpm: 118,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Montauk%20Point.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Montauk Point by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-i-feel-you",
    name: "I Feel You",
    moods: ["Energetic","Upbeat"],
    styles: ["Rock","Band"],
    bpm: 120,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/I%20Feel%20You.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: I Feel You by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-groundwork",
    name: "Groundwork",
    moods: ["Happy","Playful"],
    styles: ["Band","Groove"],
    bpm: 102,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Groundwork.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Groundwork by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-motivator",
    name: "Motivator",
    moods: ["Happy","Upbeat","Playful"],
    styles: ["Rock","Band"],
    bpm: 126,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Motivator.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Motivator by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-nonstop",
    name: "Nonstop",
    moods: ["Upbeat","Energetic"],
    styles: ["Band","Groove"],
    bpm: 128,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Nonstop.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Nonstop by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-sock-hop",
    name: "Sock Hop",
    moods: ["Upbeat","Playful","Relaxed"],
    styles: ["Rock","Band"],
    bpm: 124,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Sock%20Hop.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Sock Hop by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-funin-and-sunin",
    name: "Funin and Sunin",
    moods: ["Happy","Playful","Relaxed"],
    styles: ["Rock","Band"],
    bpm: 120,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Funin%20and%20Sunin.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Funin and Sunin by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-happy-bee",
    name: "Happy Bee",
    moods: ["Happy","Upbeat","Playful"],
    styles: ["Rock","Band"],
    bpm: 122,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Happy%20Bee.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Happy Bee by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-twisted",
    name: "Twisted",
    moods: ["Energetic","Upbeat"],
    styles: ["Rock","Band"],
    bpm: 118,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Twisted.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Twisted by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-porch-swing-days-faster",
    name: "Porch Swing Days - faster",
    moods: ["Happy","Upbeat","Calm","Relaxed"],
    styles: ["Band","Groove"],
    bpm: 130,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Porch%20Swing%20Days%20-%20faster.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Porch Swing Days - faster by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-wepa",
    name: "Wepa",
    moods: ["Happy","Energetic"],
    styles: ["Jazz","Latin"],
    bpm: 120,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Wepa.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Wepa by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-beachfront-celebration",
    name: "Beachfront Celebration",
    moods: ["Happy","Upbeat","Playful","Energetic"],
    styles: ["Jazz","Latin"],
    bpm: 120,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Beachfront%20Celebration.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Beachfront Celebration by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-verano-sensual",
    name: "Verano Sensual",
    moods: ["Happy","Playful","Energetic"],
    styles: ["Jazz","Latin"],
    bpm: 103,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Verano%20Sensual.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Verano Sensual by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-casa-bossa-nova",
    name: "Casa Bossa Nova",
    moods: ["Energetic","Calm","Playful"],
    styles: ["Jazz","Latin"],
    bpm: 116,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Casa%20Bossa%20Nova.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Casa Bossa Nova by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-notanico-merengue",
    name: "Notanico Merengue",
    moods: ["Happy","Playful","Upbeat"],
    styles: ["Jazz","Latin"],
    bpm: 120,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Notanico%20Merengue.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Notanico Merengue by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-big-drumming",
    name: "Big Drumming",
    moods: ["Energetic","Upbeat"],
    styles: ["Band","Groove"],
    bpm: 104,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Big%20Drumming.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Big Drumming by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-backbay-lounge",
    name: "Backbay Lounge",
    moods: ["Happy","Energetic","Relaxed"],
    styles: ["Jazz","Latin"],
    bpm: 120,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Backbay%20Lounge.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Backbay Lounge by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-on-hold-for-you",
    name: "On Hold for You",
    moods: ["Happy","Energetic","Relaxed"],
    styles: ["Jazz","Latin"],
    bpm: 115,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/On%20Hold%20for%20You.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: On Hold for You by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-night-in-venice",
    name: "Night in Venice",
    moods: ["Energetic","Relaxed"],
    styles: ["Jazz","Latin"],
    bpm: 114,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Night%20in%20Venice.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Night in Venice by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-airport-lounge",
    name: "Airport Lounge",
    moods: ["Playful","Calm","Relaxed"],
    styles: ["Jazz","Latin"],
    bpm: 129,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Airport%20Lounge.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Airport Lounge by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-lobby-time",
    name: "Lobby Time",
    moods: ["Energetic","Calm","Relaxed"],
    styles: ["Jazz","Latin"],
    bpm: 128,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Lobby%20Time.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Lobby Time by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-overcast",
    name: "Overcast",
    moods: ["Happy","Playful","Energetic"],
    styles: ["Disco","Retro"],
    bpm: 120,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Overcast.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Overcast by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-ether-disco",
    name: "Ether Disco",
    moods: ["Happy","Upbeat"],
    styles: ["Disco","Retro"],
    bpm: 120,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Ether%20Disco.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Ether Disco by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-disco-con-tutti",
    name: "Disco con Tutti",
    moods: ["Happy","Upbeat","Playful","Energetic"],
    styles: ["Disco","Retro"],
    bpm: 115,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Disco%20con%20Tutti.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Disco con Tutti by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-electro-cabello",
    name: "Electro Cabello",
    moods: ["Playful","Energetic"],
    styles: ["Disco","Retro"],
    bpm: 117,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Electro%20Cabello.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Electro Cabello by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-realizer",
    name: "Realizer",
    moods: ["Happy","Energetic","Upbeat"],
    styles: ["Disco","Retro"],
    bpm: 125,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Realizer.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Realizer by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-disco-medusae",
    name: "Disco Medusae",
    moods: ["Happy","Energetic"],
    styles: ["Disco","Retro"],
    bpm: 115,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Disco%20Medusae.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Disco Medusae by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
];

/** Curated CC0 SFX. url is a Kenney zip; select specific files. */
const SFX = [
  {
    pack: "kenney-interface-sounds",
    name: "Kenney Interface Sounds",
    url: "https://kenney.nl/media/pages/assets/interface-sounds/fa43c1dd4d-1677589452/kenney_interface-sounds.zip",
    source: "https://kenney.nl/assets/interface-sounds",
    attribution: "Kenney",
    files: [
      ["click_001", "UI", ["click", "ui"]],
      ["click_002", "UI", ["click", "ui"]],
      ["click_003", "UI", ["click", "ui"]],
      ["confirmation_001", "UI", ["confirm", "success"]],
      ["confirmation_002", "UI", ["confirm", "success"]],
      ["error_001", "UI", ["error", "alert"]],
      ["error_002", "UI", ["error", "alert"]],
      ["switch_001", "UI", ["switch", "toggle"]],
      ["switch_002", "UI", ["switch", "toggle"]],
      ["toggle_001", "UI", ["toggle", "switch"]],
      ["toggle_002", "UI", ["toggle", "switch"]],
      ["open_001", "UI", ["open", "panel"]],
      ["close_001", "UI", ["close", "panel"]],
      ["back_001", "UI", ["back", "nav"]],
      ["drop_001", "UI", ["drop", "drag"]],
      ["glass_001", "UI", ["glass", "break"]],
      ["glitch_001", "UI", ["glitch", "tech"]],
      ["scroll_001", "UI", ["scroll", "wheel"]],
      ["select_001", "UI", ["select", "tick"]],
      ["tick_001", "UI", ["tick", "beep"]],
      ["question_001", "UI", ["question", "prompt"]],
      ["bong_001", "UI", ["bong", "chime"]],
      ["maximize_001", "UI", ["maximize", "expand"]],
      ["minimize_001", "UI", ["minimize", "collapse"]],
    ],
  },
  {
    pack: "kenney-impact-sounds",
    name: "Kenney Impact Sounds",
    url: "https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip",
    source: "https://kenney.nl/assets/impact-sounds",
    attribution: "Kenney",
    files: [
      ["impactGeneric_light_000", "Impact", ["impact", "hit", "generic"]],
      ["impactGeneric_light_001", "Impact", ["impact", "hit", "generic"]],
      ["impactPunch_heavy_000", "Impact", ["punch", "impact", "hit"]],
      ["impactPunch_medium_000", "Impact", ["punch", "impact", "hit"]],
      ["impactWood_heavy_000", "Impact", ["wood", "impact", "hit"]],
      ["impactWood_medium_000", "Impact", ["wood", "impact", "hit"]],
      ["impactGlass_heavy_000", "Impact", ["glass", "impact", "break"]],
      ["impactGlass_medium_000", "Impact", ["glass", "impact", "break"]],
      ["impactMetal_heavy_000", "Impact", ["metal", "impact", "hit"]],
      ["impactMetal_medium_000", "Impact", ["metal", "impact", "hit"]],
      ["impactSoft_heavy_000", "Impact", ["soft", "impact", "hit"]],
      ["impactSoft_medium_000", "Impact", ["soft", "impact", "hit"]],
      ["footstep_carpet_000", "Footstep", ["footstep", "walk"]],
      ["footstep_concrete_000", "Footstep", ["footstep", "walk"]],
      ["footstep_grass_000", "Footstep", ["footstep", "walk"]],
      ["footstep_wood_000", "Footstep", ["footstep", "walk"]],
    ],
  },
  {
    pack: "kenney-rpg-audio",
    name: "Kenney RPG Audio",
    url: "https://kenney.nl/media/pages/assets/rpg-audio/8e99002d76-1677590336/kenney_rpg-audio.zip",
    source: "https://kenney.nl/assets/rpg-audio",
    attribution: "Kenney",
    files: [
      ["doorOpen_1", "Door", ["door", "open"]],
      ["doorClose_1", "Door", ["door", "close"]],
      ["handleCoins", "Coins", ["coin", "money"]],
      ["bookFlip1", "Book", ["book", "flip", "page"]],
      ["metalClick", "Metal", ["metal", "click"]],
      ["chop", "Impact", ["chop", "slice"]],
      ["cloth1", "Foley", ["cloth", "fabric"]],
      ["creak1", "Foley", ["creak", "wood"]],
    ],
  },
  {
    id: "rot-big-berlin",
    name: "Big Berlin",
    moods: ["Happy","Upbeat"],
    styles: ["Electronic","Groove"],
    url: "https://video.rotato.app/music/Big%20Berlin.m4a",
    source: "",
    attribution: "Free for commercial use. Verify redistribution rights before publishing.",
    license: "Free for commercial use",
  },
  {
    id: "rot-bongo-drop",
    name: "Bongo Drop",
    moods: ["Energetic","Playful"],
    styles: ["Latin","Groove"],
    url: "https://video.rotato.app/music/Bongo%20Drop.m4a",
    source: "",
    attribution: "Free for commercial use. Verify redistribution rights before publishing.",
    license: "Free for commercial use",
  },
  {
    id: "rot-brass-step",
    name: "Brass Step",
    moods: ["Energetic","Playful"],
    styles: ["Brass","Groove"],
    url: "https://video.rotato.app/music/Brass%20Step.m4a",
    source: "",
    attribution: "Free for commercial use. Verify redistribution rights before publishing.",
    license: "Free for commercial use",
  },
  {
    id: "rot-dubstep",
    name: "Dubstep",
    moods: ["Energetic","Playful"],
    styles: ["Percussion","Groove"],
    url: "https://video.rotato.app/music/Dubstep.m4a",
    source: "",
    attribution: "Free for commercial use. Verify redistribution rights before publishing.",
    license: "Free for commercial use",
  },
  {
    id: "rot-flute-conga",
    name: "Flute Conga",
    moods: ["Calm","Relaxed"],
    styles: ["Latin","Groove"],
    url: "https://video.rotato.app/music/Flute%20Conga.m4a",
    source: "",
    attribution: "Free for commercial use. Verify redistribution rights before publishing.",
    license: "Free for commercial use",
  },
  {
    id: "rot-jazzy-launch",
    name: "Jazzy Launch",
    moods: ["Happy","Upbeat"],
    styles: ["Jazz","Groove"],
    url: "https://video.rotato.app/music/Jazzy%20Launch.m4a",
    source: "",
    attribution: "Free for commercial use. Verify redistribution rights before publishing.",
    license: "Free for commercial use",
  },
  {
    id: "rot-latin-horns",
    name: "Latin Horns",
    moods: ["Energetic","Playful"],
    styles: ["Latin","Groove"],
    url: "https://video.rotato.app/music/Latin%20Horns.m4a",
    source: "",
    attribution: "Free for commercial use. Verify redistribution rights before publishing.",
    license: "Free for commercial use",
  },
  {
    id: "rot-lounge",
    name: "Lounge",
    moods: ["Calm","Relaxed"],
    styles: ["Band","Groove"],
    url: "https://video.rotato.app/music/Lounge.m4a",
    source: "",
    attribution: "Free for commercial use. Verify redistribution rights before publishing.",
    license: "Free for commercial use",
  },
  {
    id: "rot-marimba",
    name: "Marimba",
    moods: ["Calm","Relaxed"],
    styles: ["Marimba","Chill"],
    url: "https://video.rotato.app/music/Marimba.m4a",
    source: "",
    attribution: "Free for commercial use. Verify redistribution rights before publishing.",
    license: "Free for commercial use",
  },
  {
    id: "rot-mellow-lead-guitar",
    name: "Mellow Lead Guitar",
    moods: ["Calm","Relaxed"],
    styles: ["Guitar","Band"],
    url: "https://video.rotato.app/music/Mellow%20Lead%20Guitar.m4a",
    source: "",
    attribution: "Free for commercial use. Verify redistribution rights before publishing.",
    license: "Free for commercial use",
  },
  {
    id: "rot-nostalgic-guitar",
    name: "Nostalgic Guitar",
    moods: ["Calm","Relaxed"],
    styles: ["Guitar","Band"],
    url: "https://video.rotato.app/music/Nostalgic%20Guitar.m4a",
    source: "",
    attribution: "Free for commercial use. Verify redistribution rights before publishing.",
    license: "Free for commercial use",
  },
  {
    id: "rot-organ-disco",
    name: "Organ Disco",
    moods: ["Energetic","Playful"],
    styles: ["Brass","Groove"],
    url: "https://video.rotato.app/music/Organ%20Disco.m4a",
    source: "",
    attribution: "Free for commercial use. Verify redistribution rights before publishing.",
    license: "Free for commercial use",
  },
  {
    id: "rot-sax-vs-drums",
    name: "Sax vs Drums",
    moods: ["Energetic","Playful"],
    styles: ["Brass","Groove"],
    url: "https://video.rotato.app/music/Sax%20vs%20Drums.m4a",
    source: "",
    attribution: "Free for commercial use. Verify redistribution rights before publishing.",
    license: "Free for commercial use",
  },
  {
    id: "rot-simple-band",
    name: "Simple Band",
    moods: ["Happy","Energetic"],
    styles: ["Band","Groove"],
    url: "https://video.rotato.app/music/Simple%20Band.m4a",
    source: "",
    attribution: "Free for commercial use. Verify redistribution rights before publishing.",
    license: "Free for commercial use",
  },
  {
    id: "rot-solo-drums",
    name: "Solo drums",
    moods: ["Energetic","Playful"],
    styles: ["Percussion","Groove"],
    url: "https://video.rotato.app/music/Solo%20drums.m4a",
    source: "",
    attribution: "Free for commercial use. Verify redistribution rights before publishing.",
    license: "Free for commercial use",
  },
  {
    id: "rot-stomp-finger-snap",
    name: "Stomp Finger Snap",
    moods: ["Energetic","Playful"],
    styles: ["Percussion","Groove"],
    url: "https://video.rotato.app/music/Stomp%20Finger%20Snap.m4a",
    source: "",
    attribution: "Free for commercial use. Verify redistribution rights before publishing.",
    license: "Free for commercial use",
  },
  {
    id: "rot-text-message-dub",
    name: "Text Message Dub",
    moods: ["Energetic","Playful"],
    styles: ["Percussion","Groove"],
    url: "https://video.rotato.app/music/Text%20Message%20Dub.m4a",
    source: "",
    attribution: "Free for commercial use. Verify redistribution rights before publishing.",
    license: "Free for commercial use",
  },
  {
    id: "rot-the-right-thing",
    name: "The Right Thing",
    moods: ["Upbeat","Inspiring"],
    styles: ["Band","Groove"],
    url: "https://video.rotato.app/music/The%20Right%20Thing.m4a",
    source: "",
    attribution: "Free for commercial use. Verify redistribution rights before publishing.",
    license: "Free for commercial use",
  },
  {
    id: "rot-upbeat-mystic",
    name: "Upbeat Mystic",
    moods: ["Upbeat","Inspiring"],
    styles: ["Band","Groove"],
    url: "https://video.rotato.app/music/Upbeat%20Mystic.m4a",
    source: "",
    attribution: "Free for commercial use. Verify redistribution rights before publishing.",
    license: "Free for commercial use",
  },
  {
    id: "rot-wild-town",
    name: "Wild Town",
    moods: ["Energetic","Playful"],
    styles: ["Band","Groove"],
    url: "https://video.rotato.app/music/Wild%20Town.m4a",
    source: "",
    attribution: "Free for commercial use. Verify redistribution rights before publishing.",
    license: "Free for commercial use",
  },
];

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function run(cmd, args) {
  return execFileSync(cmd, args, { stdio: ["ignore", "pipe", "ignore"] });
}

function probeDuration(file) {
  try {
    const out = run("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      file,
    ]).toString().trim();
    return Math.round(parseFloat(out) * 100) / 100;
  } catch {
    return 0;
  }
}

async function download(url, dest) {
  console.log(`  ↓ ${url}`);
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buf);
  return dest;
}

async function fetchZipEntry(url, entrySuffix, dest) {
  const tmpZip = join(TMP, `zip-${Math.random().toString(36).slice(2)}.zip`);
  try {
    await download(url, tmpZip);
    // unzip only the matching entry into TMP, then move + rename
    run("unzip", ["-o", "-j", tmpZip, "*" + entrySuffix, "-d", join(TMP, "zipextract")]);
    const extracted = readdirSync(join(TMP, "zipextract")).find((f) =>
      f.toLowerCase().endsWith(entrySuffix.toLowerCase()),
    );
    if (!extracted) throw new Error(`entry not found: ${entrySuffix}`);
    const src = join(TMP, "zipextract", extracted);
    copyFileSync(src, dest);
  } finally {
    rmSync(tmpZip, { force: true });
    rmSync(join(TMP, "zipextract"), { recursive: true, force: true });
  }
}

async function fetchKenneyPack(pack, destDir) {
  const tmpZip = join(TMP, `${slugify(pack.pack)}.zip`);
  if (!existsSync(tmpZip)) {
    console.log(`  ↓ ${pack.url}`);
    await download(pack.url, tmpZip);
  }
  run("unzip", ["-o", "-q", tmpZip, "-d", join(TMP, slugify(pack.pack))]);
}

function pickExt(paths) {
  return paths.find((p) => p.toLowerCase().endsWith(".mp3")) || paths[0];
}

async function main() {
  const musicOnly = process.argv.includes("--music-only");
  mkdirSync(MUSIC_DIR, { recursive: true });
  mkdirSync(SFX_DIR, { recursive: true });
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });

  const catalog = { version: 1, generatedAt: new Date().toISOString(), music: [], sfx: [] };

  console.log("=== Music ===");
  for (const item of MUSIC) {
    const tmpFile = join(TMP, `m-${slugify(item.id)}.mp3`);
    try {
      if (item.zipEntry) {
        await fetchZipEntry(item.url, item.zipEntry, tmpFile);
      } else {
        await download(item.url, tmpFile);
      }
      const duration = probeDuration(tmpFile);
      const out = join(MUSIC_DIR, `${item.id}.mp3`);
      run("ffmpeg", ["-y", "-i", tmpFile, "-codec:a", "libmp3lame", "-q:a", "4", "-ar", "44100", out]);
      const filesize = statSync(out).size;
      catalog.music.push({
        id: item.id,
        name: item.name,
        moods: item.moods,
        styles: item.styles,
        duration,
        filesize,
        license: item.license ?? "CC0",
        source: item.source,
        attribution: item.attribution,
        url: `audio/music/${item.id}.mp3`,
        ...(item.bpm ? { bpm: item.bpm } : {}),
      });
      console.log(`  ✓ ${item.id} (${duration}s)`);
    } catch (e) {
      console.warn(`  ✗ ${item.id}: ${e.message}`);
    }
  }

  if (!musicOnly) {
    console.log("=== SFX ===");
    for (const pack of SFX) {
      const packDir = join(TMP, slugify(pack.pack));
      await fetchKenneyPack(pack, packDir);
      for (const [stem, category, tags] of pack.files) {
        const id = `${slugify(pack.pack)}-${slugify(stem)}`;
        try {
          const candidates = readdirSync(packDir, { recursive: true })
            .filter((f) => f.toLowerCase().includes(stem.toLowerCase()))
            .map((f) => join(packDir, f));
          const chosen = pickExt(candidates);
          if (!chosen) throw new Error(`missing ${stem}`);
          const tmpOut = join(TMP, `s-${id}.mp3`);
          run("ffmpeg", ["-y", "-i", chosen, "-codec:a", "libmp3lame", "-q:a", "6", "-ar", "44100", "-ac", "2", tmpOut]);
          const duration = probeDuration(tmpOut);
          const out = join(SFX_DIR, `${id}.mp3`);
          copyFileSync(tmpOut, out);
          const filesize = statSync(out).size;
          catalog.sfx.push({
            id,
            name: stem,
            category,
            tags,
            duration,
            filesize,
            license: "CC0",
            source: pack.source,
            attribution: pack.attribution,
            url: `audio/sfx/${id}.mp3`,
          });
          console.log(`  ✓ ${id} (${duration}s)`);
        } catch (e) {
          console.warn(`  ✗ ${id}: ${e.message}`);
        }
      }
    }
  }

  writeFileSync(join(PUBLIC_AUDIO, "catalog.json"), JSON.stringify(catalog, null, 2));
  console.log(`\nDone. music=${catalog.music.length} sfx=${catalog.sfx.length}`);
  console.log(`Catalog: ${join(PUBLIC_AUDIO, "catalog.json")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
