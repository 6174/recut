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
    id: "inc-nowhere-land",
    name: "Nowhere Land",
    moods: ["Upbeat","Happy"],
    styles: ["Electronic","Synth"],
    bpm: 120,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Nowhere%20Land.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Nowhere Land by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-inspired",
    name: "Inspired",
    moods: ["Upbeat","Happy","Relaxed","Calm"],
    styles: ["Electronic","Synth"],
    bpm: 120,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Inspired.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Inspired by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-newer-wave",
    name: "Newer Wave",
    moods: ["Upbeat","Happy","Energetic"],
    styles: ["Electronic","Synth"],
    bpm: 110,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Newer%20Wave.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Newer Wave by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-super-friendly",
    name: "Super Friendly",
    moods: ["Upbeat","Happy","Playful"],
    styles: ["Electronic","Synth"],
    bpm: 108,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Super%20Friendly.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Super Friendly by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-electrodoodle",
    name: "Electrodoodle",
    moods: ["Upbeat","Playful"],
    styles: ["Electronic","Synth"],
    bpm: 120,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Electrodoodle.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Electrodoodle by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-life-of-riley",
    name: "Life of Riley",
    moods: ["Upbeat","Happy","Relaxed"],
    styles: ["Pop","Electronic"],
    bpm: 102,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Life%20of%20Riley.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Life of Riley by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-glitter-blast",
    name: "Glitter Blast",
    moods: ["Happy","Playful","Energetic"],
    styles: ["Pop","Electronic"],
    bpm: 100,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Glitter%20Blast.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Glitter Blast by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-show-your-moves",
    name: "Show Your Moves",
    moods: ["Happy","Playful","Energetic"],
    styles: ["Electronic","Synth"],
    bpm: 136,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Show%20Your%20Moves.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Show Your Moves by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-laser-groove",
    name: "Laser Groove",
    moods: ["Happy","Energetic","Relaxed"],
    styles: ["Electronic","Synth"],
    bpm: 140,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Laser%20Groove.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Laser Groove by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-getting-it-done",
    name: "Getting it Done",
    moods: ["Happy","Energetic","Relaxed"],
    styles: ["Electronic","Synth"],
    bpm: 135,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Getting%20it%20Done.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Getting it Done by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-voice-over-under",
    name: "Voice Over Under",
    moods: ["Happy","Playful"],
    styles: ["Electronic","Synth"],
    bpm: 135,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Voice%20Over%20Under.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Voice Over Under by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-bit-shift",
    name: "Bit Shift",
    moods: ["Happy","Playful","Energetic"],
    styles: ["Electronic","Synth"],
    bpm: 130,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Bit%20Shift.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Bit Shift by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-presenterator",
    name: "Presenterator",
    moods: ["Happy","Playful","Intense"],
    styles: ["Electronic","Synth"],
    bpm: 130,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Presenterator.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Presenterator by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-laserpack",
    name: "Laserpack",
    moods: ["Playful","Energetic","Intense"],
    styles: ["Electronic","Synth"],
    bpm: 128,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Laserpack.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Laserpack by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-special-spotlight",
    name: "Special Spotlight",
    moods: ["Playful","Energetic","Intense"],
    styles: ["Electronic","Synth"],
    bpm: 126,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Special%20Spotlight.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Special Spotlight by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-digital-lemonade",
    name: "Digital Lemonade",
    moods: ["Happy","Playful","Relaxed"],
    styles: ["Electronic","Synth"],
    bpm: 120,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Digital%20Lemonade.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Digital Lemonade by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-delightful-d",
    name: "Delightful D",
    moods: ["Happy","Energetic","Intense"],
    styles: ["Electronic","Synth"],
    bpm: 120,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Delightful%20D.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Delightful D by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-blippy-trance",
    name: "Blippy Trance",
    moods: ["Happy","Playful","Energetic"],
    styles: ["Electronic","Synth"],
    bpm: 100,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Blippy%20Trance.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Blippy Trance by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-bit-quest",
    name: "Bit Quest",
    moods: ["Happy","Playful"],
    styles: ["Electronic","Synth"],
    bpm: 100,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Bit%20Quest.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Bit Quest by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-killing-time",
    name: "Killing Time",
    moods: ["Happy","Energetic"],
    styles: ["Electronic","Synth"],
    bpm: 100,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Killing%20Time.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Killing Time by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-voxel-revolution",
    name: "Voxel Revolution",
    moods: ["Happy","Playful","Energetic"],
    styles: ["Electronic","Synth"],
    bpm: 122,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Voxel%20Revolution.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Voxel Revolution by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-pookatori-and-friends",
    name: "Pookatori and Friends",
    moods: ["Happy","Playful","Energetic"],
    styles: ["Electronic","Synth"],
    bpm: 124,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Pookatori%20and%20Friends.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Pookatori and Friends by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-new-friendly",
    name: "New Friendly",
    moods: ["Upbeat","Happy","Playful","Energetic"],
    styles: ["Electronic","Synth"],
    bpm: 114,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/New%20Friendly.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: New Friendly by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-pinball-spring",
    name: "Pinball Spring",
    moods: ["Upbeat","Happy","Playful","Playful"],
    styles: ["Electronic","Synth"],
    bpm: 116,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Pinball%20Spring.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Pinball Spring by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-disco-con-tutti",
    name: "Disco con Tutti",
    moods: ["Upbeat","Happy","Playful","Energetic"],
    styles: ["Disco","Electronic"],
    bpm: 115,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Disco%20con%20Tutti.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Disco con Tutti by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-funky-chunk",
    name: "Funky Chunk",
    moods: ["Upbeat","Happy","Energetic"],
    styles: ["Funky","Groove"],
    bpm: 115,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Funky%20Chunk.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Funky Chunk by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-enter-the-party",
    name: "Enter the Party",
    moods: ["Happy","Playful","Energetic","Intense"],
    styles: ["Funky","Groove"],
    bpm: 120,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Enter%20the%20Party.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Enter the Party by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-loopster",
    name: "Loopster",
    moods: ["Happy","Energetic","Intense"],
    styles: ["Funky","Groove"],
    bpm: 108,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Loopster.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Loopster by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-werq",
    name: "Werq",
    moods: ["Happy","Energetic","Relaxed"],
    styles: ["Pop","Electronic"],
    bpm: 125,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Werq.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Werq by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
    license: "CC BY 4.0",
  },
  {
    id: "inc-overcast",
    name: "Overcast",
    moods: ["Happy","Playful","Energetic"],
    styles: ["Disco","Electronic"],
    bpm: 120,
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Overcast.mp3",
    source: "https://incompetech.com/music/royalty-free/full_list.php",
    attribution: "Music: Overcast by Kevin MacLeod (incompetech.com), Licensed under Creative Commons: By Attribution 4.0",
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
