#!/usr/bin/env node
/**
 * Fetch a bundled CC0 audio library (Music + SFX) into ui/public/audio and
 * generate ui/public/audio/catalog.json.
 *
 * Only CC0 / public-domain sources are bundled so Recut can redistribute them
 * inside the app. Sources verified in this manifest:
 *   - OpenGameArt.org CC0 music (direct mp3/ogg/wav links)
 *   - Kenney.nl CC0 SFX packs (zips, CC0 license included)
 *
 * Usage: node scripts/fetch-audio-library.mjs [--music-only]
 *
 * Requires ffmpeg + ffprobe on PATH.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, readdirSync, existsSync, statSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = new URL("..", import.meta.url).pathname;
const PUBLIC_AUDIO = join(ROOT, "public", "audio");
const MUSIC_DIR = join(PUBLIC_AUDIO, "music");
const SFX_DIR = join(PUBLIC_AUDIO, "sfx");
const TMP = join(tmpdir(), "recut-audio-fetch");

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

/** Curated CC0 music. url can be a direct file or an OGA content page. */
const MUSIC = [
  {
    id: "oga-bossa-nova",
    name: "8-Bit Bossa",
    moods: ["Happy", "Relaxed"],
    styles: ["Latin", "Acoustic"],
    url: "https://opengameart.org/sites/default/files/8bit%20Bossa.mp3",
    source: "https://opengameart.org/content/bossa-nova",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-field-of-dreams",
    name: "The Field of Dreams",
    moods: ["Emotional", "Inspiring"],
    styles: ["Cinematic", "Orchestral"],
    url: "https://opengameart.org/sites/default/files/the_field_of_dreams.mp3",
    source: "https://opengameart.org/content/the-field-of-dreams",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-tragic-ambient",
    name: "Tragic Ambient Main Menu",
    moods: ["Dark", "Sad"],
    styles: ["Ambient", "Piano"],
    url: "https://opengameart.org/sites/default/files/ambientmain_0.ogg",
    source: "https://opengameart.org/content/tragic-ambient-main-menu",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-mysterious-ambience",
    name: "Mysterious Ambience",
    moods: ["Mysterious", "Dark"],
    styles: ["Ambient"],
    url: "https://opengameart.org/sites/default/files/song21_0.mp3",
    source: "https://opengameart.org/content/mysterious-ambience-song21",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-rain-and-thunders",
    name: "Rain and Thunders",
    moods: ["Calm", "Mysterious"],
    styles: ["Ambient", "Nature"],
    url: "https://opengameart.org/sites/default/files/Dark_Rainy_Night%28ambience%29.ogg",
    source: "https://opengameart.org/content/rain-and-thunders",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-next-to-you",
    name: "Next to You",
    moods: ["Emotional", "Romantic"],
    styles: ["Piano", "Acoustic"],
    url: "https://opengameart.org/sites/default/files/Next%20to%20You.mp3",
    source: "https://opengameart.org/content/next-to-you",
    attribution: "OpenGameArt",
  },
  // Alexander Ehlers "Free Music Pack" (CC0) - 7 cinematic/electronic tracks
  {
    id: "ae-doomed",
    name: "Doomed",
    moods: ["Dark", "Intense"],
    styles: ["Cinematic", "Electronic"],
    url: "https://opengameart.org/sites/default/files/Alexander%20Ehlers%20-%20Free%20Music%20Pack.zip",
    zipEntry: "Doomed.mp3",
    source: "https://opengameart.org/content/free-music-pack",
    attribution: "Alexander Ehlers (OpenGameArt)",
  },
  {
    id: "ae-flags",
    name: "Flags",
    moods: ["Inspiring", "Epic"],
    styles: ["Cinematic", "Electronic"],
    url: "https://opengameart.org/sites/default/files/Alexander%20Ehlers%20-%20Free%20Music%20Pack.zip",
    zipEntry: "Flags.mp3",
    source: "https://opengameart.org/content/free-music-pack",
    attribution: "Alexander Ehlers (OpenGameArt)",
  },
  {
    id: "ae-great-mission",
    name: "Great Mission",
    moods: ["Epic", "Inspiring"],
    styles: ["Cinematic", "Electronic"],
    url: "https://opengameart.org/sites/default/files/Alexander%20Ehlers%20-%20Free%20Music%20Pack.zip",
    zipEntry: "Great mission.mp3",
    source: "https://opengameart.org/content/free-music-pack",
    attribution: "Alexander Ehlers (OpenGameArt)",
  },
  {
    id: "ae-spacetime",
    name: "Spacetime",
    moods: ["Mysterious", "Calm"],
    styles: ["Ambient", "Electronic"],
    url: "https://opengameart.org/sites/default/files/Alexander%20Ehlers%20-%20Free%20Music%20Pack.zip",
    zipEntry: "Spacetime.mp3",
    source: "https://opengameart.org/content/free-music-pack",
    attribution: "Alexander Ehlers (OpenGameArt)",
  },
  {
    id: "ae-twists",
    name: "Twists",
    moods: ["Intense", "Dark"],
    styles: ["Cinematic", "Electronic"],
    url: "https://opengameart.org/sites/default/files/Alexander%20Ehlers%20-%20Free%20Music%20Pack.zip",
    zipEntry: "Twists.mp3",
    source: "https://opengameart.org/content/free-music-pack",
    attribution: "Alexander Ehlers (OpenGameArt)",
  },
  {
    id: "ae-waking-the-devil",
    name: "Waking the Devil",
    moods: ["Dark", "Intense"],
    styles: ["Cinematic", "Electronic"],
    url: "https://opengameart.org/sites/default/files/Alexander%20Ehlers%20-%20Free%20Music%20Pack.zip",
    zipEntry: "Waking the devil.mp3",
    source: "https://opengameart.org/content/free-music-pack",
    attribution: "Alexander Ehlers (OpenGameArt)",
  },
  {
    id: "ae-warped",
    name: "Warped",
    moods: ["Mysterious", "Intense"],
    styles: ["Cinematic", "Electronic"],
    url: "https://opengameart.org/sites/default/files/Alexander%20Ehlers%20-%20Free%20Music%20Pack.zip",
    zipEntry: "Warped.mp3",
    source: "https://opengameart.org/content/free-music-pack",
    attribution: "Alexander Ehlers (OpenGameArt)",
  },
  {
    id: "oga-8bit-title-screen",
    name: "8-Bit Title Screen",
    moods: ["Happy", "Playful"],
    styles: ["Chiptune", "Retro"],
    url: "https://opengameart.org/sites/default/files/8Bit%20Title%20Screen.mp3",
    source: "https://opengameart.org/content/8bit-title-screen",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-a-new-town",
    name: "A New Town",
    moods: ["Happy", "Inspiring"],
    styles: ["Orchestral", "Acoustic"],
    url: "https://opengameart.org/sites/default/files/025_A_New_Town.mp3",
    source: "https://opengameart.org/content/a-new-town-rpg-theme",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-at-the-end-of-hope",
    name: "At the End of Hope",
    moods: ["Emotional", "Sad"],
    styles: ["Cinematic", "Orchestral"],
    url: "https://opengameart.org/sites/default/files/at%20the%20end%20of%20hope_0.mp3",
    source: "https://opengameart.org/content/at-the-end-of-hope",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-battle-theme-a",
    name: "Battle Theme A",
    moods: ["Intense", "Epic"],
    styles: ["Orchestral", "Cinematic"],
    url: "https://opengameart.org/sites/default/files/battleThemeA.mp3",
    source: "https://opengameart.org/content/battle-theme-a",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-battle-theme-b",
    name: "Battle Theme B",
    moods: ["Intense", "Epic"],
    styles: ["Orchestral", "Cinematic"],
    url: "https://opengameart.org/sites/default/files/battleThemeB.mp3",
    source: "https://opengameart.org/content/battle-theme-b-for-rpg",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-carnival-rides",
    name: "Carnival Rides",
    moods: ["Happy", "Playful"],
    styles: ["Retro", "Acoustic"],
    url: "https://opengameart.org/sites/default/files/carnivalrides.ogg",
    source: "https://opengameart.org/content/carnival-rides",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-cave-theme",
    name: "Cave Theme",
    moods: ["Mysterious", "Dark"],
    styles: ["Ambient"],
    url: "https://opengameart.org/sites/default/files/cave%20themeb4.ogg",
    source: "https://opengameart.org/content/cave-theme",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-chill-lofi",
    name: "Chill Lofi",
    moods: ["Calm", "Relaxed"],
    styles: ["Lo-fi", "Chill"],
    url: "https://opengameart.org/sites/default/files/ChillLofiR_0.mp3",
    source: "https://opengameart.org/content/chill-lofi-inspired",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-chill-main-menu",
    name: "Chill Main Menu",
    moods: ["Calm", "Mysterious"],
    styles: ["Ambient"],
    url: "https://opengameart.org/sites/default/files/zombie%20main%20music.ogg",
    source: "https://opengameart.org/content/chill-main-menu-music",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-creepy-forest",
    name: "Creepy Forest",
    moods: ["Dark", "Mysterious"],
    styles: ["Ambient"],
    url: "https://opengameart.org/sites/default/files/forest.ogg",
    source: "https://opengameart.org/content/creepy-forest-f",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-crystal-cave",
    name: "Crystal Cave",
    moods: ["Mysterious", "Calm"],
    styles: ["Ambient"],
    url: "https://opengameart.org/sites/default/files/song18_0.mp3",
    source: "https://opengameart.org/content/crystal-cave-song18",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-cyberpunk-moonlight",
    name: "Cyberpunk Moonlight Sonata",
    moods: ["Dark", "Mysterious"],
    styles: ["Electronic", "Piano"],
    url: "https://opengameart.org/sites/default/files/Cyberpunk%20Moonlight%20Sonata_0.mp3",
    source: "https://opengameart.org/content/cyberpunk-moonlight-sonata",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-dark-forest",
    name: "Dark Forest Theme",
    moods: ["Dark", "Emotional"],
    styles: ["Orchestral", "Ambient"],
    url: "https://opengameart.org/sites/default/files/GameMusic_ForestTheme_24_0.mp3",
    source: "https://opengameart.org/content/dark-forest-theme",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-determined-pursuit",
    name: "Determined Pursuit",
    moods: ["Epic", "Inspiring"],
    styles: ["Orchestral", "Cinematic"],
    url: "https://opengameart.org/sites/default/files/determined_pursuit_loop.wav",
    source: "https://opengameart.org/content/determined-pursuit-epic-orchestra-loop",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-doodle-menu",
    name: "Doodle Menu",
    moods: ["Happy", "Playful"],
    styles: ["Acoustic"],
    url: "https://opengameart.org/sites/default/files/doodle_0.mp3",
    source: "https://opengameart.org/content/doodle-menu-like-song",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-emotional-piano",
    name: "Emotional Piano Loop",
    moods: ["Emotional", "Calm"],
    styles: ["Piano"],
    url: "https://opengameart.org/sites/default/files/Piano%20Loop.wav",
    source: "https://opengameart.org/content/emotional-piano-loop",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-empty-city",
    name: "Empty City",
    moods: ["Dark", "Sad"],
    styles: ["Ambient", "Electronic"],
    url: "https://opengameart.org/sites/default/files/EmptyCity.ogg",
    source: "https://opengameart.org/content/emptycity-background-music",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-enchanted-tiki",
    name: "Enchanted Tiki 86",
    moods: ["Happy", "Playful"],
    styles: ["Chiptune", "Retro"],
    url: "https://opengameart.org/sites/default/files/enchanted%20tiki%2086_0.mp3",
    source: "https://opengameart.org/content/enchanted-tiki-86",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-eye-of-the-storm",
    name: "Eye of the Storm",
    moods: ["Epic", "Intense"],
    styles: ["Orchestral", "Cinematic"],
    url: "https://opengameart.org/sites/default/files/Eye%20of%20the%20Storm.mp3",
    source: "https://opengameart.org/content/eye-of-the-storm",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-flare-main",
    name: "Flare Main",
    moods: ["Calm", "Mysterious"],
    styles: ["Ambient", "Electronic"],
    url: "https://opengameart.org/sites/default/files/flaremain_0.ogg",
    source: "https://opengameart.org/content/flare-main",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-forest-ambience",
    name: "Forest Ambience",
    moods: ["Calm", "Relaxed"],
    styles: ["Nature", "Ambient"],
    url: "https://opengameart.org/sites/default/files/Forest_Ambience.mp3",
    source: "https://opengameart.org/content/forest-ambience",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-forgotten-tomb",
    name: "Forgotten Tomb Ambience",
    moods: ["Dark", "Mysterious"],
    styles: ["Ambient"],
    url: "https://opengameart.org/sites/default/files/Forgoten_tombs_1.mp3",
    source: "https://opengameart.org/content/forgoten-tomb-ambience",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-free-run",
    name: "Free Run",
    moods: ["Happy", "Upbeat"],
    styles: ["Chiptune", "Retro"],
    url: "https://opengameart.org/sites/default/files/Project%202%20marioish_0.mp3",
    source: "https://opengameart.org/content/free-run-8-bitish",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-gone-fishin",
    name: "Gone Fishin",
    moods: ["Happy", "Relaxed"],
    styles: ["Acoustic", "Jazz"],
    url: "https://opengameart.org/sites/default/files/gone_fishin_by_memoraphile_CC0_0.mp3",
    source: "https://opengameart.org/content/gone-fishin",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-happy-adventure",
    name: "Happy Adventure Loop",
    moods: ["Happy", "Upbeat"],
    styles: ["Orchestral", "Acoustic"],
    url: "https://opengameart.org/sites/default/files/happy_adveture.mp3",
    source: "https://opengameart.org/content/happy-adventure-loop",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-happy-lullaby",
    name: "Happy Lullaby",
    moods: ["Happy", "Calm"],
    styles: ["Piano", "Retro"],
    url: "https://opengameart.org/sites/default/files/song17.mp3",
    source: "https://opengameart.org/content/happy-lullaby-song17",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-horror-wastelands",
    name: "Post Apocalyptic Wastelands",
    moods: ["Dark", "Intense"],
    styles: ["Ambient", "Horror"],
    url: "https://opengameart.org/sites/default/files/Juhani%20Junkala%20-%20Post%20Apocalyptic%20Wastelands%20%5BLoop%20Ready%5D.ogg",
    source: "https://opengameart.org/content/horror-atmosphere",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-i-swear-i-saw-it",
    name: "I Swear I Saw It",
    moods: ["Mysterious", "Dark"],
    styles: ["Ambient", "Retro"],
    url: "https://opengameart.org/sites/default/files/IswearIsawit_0.ogg",
    source: "https://opengameart.org/content/i-swear-i-saw-it-background-track",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-insistent-loop",
    name: "Insistent Loop",
    moods: ["Intense", "Dark"],
    styles: ["Electronic"],
    url: "https://opengameart.org/sites/default/files/Insistent.ogg",
    source: "https://opengameart.org/content/insistent-background-loop",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-long-away-home",
    name: "Long Away Home",
    moods: ["Emotional", "Calm"],
    styles: ["Piano", "Chiptune"],
    url: "https://opengameart.org/sites/default/files/Long%20Away%20Home.wav",
    source: "https://opengameart.org/content/long-away-home-8bit",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-magic-space",
    name: "Magic Space",
    moods: ["Mysterious", "Calm"],
    styles: ["Space", "Ambient"],
    url: "https://opengameart.org/sites/default/files/magic%20space.mp3",
    source: "https://opengameart.org/content/magic-space",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-minstrel-dance",
    name: "Minstrel Dance",
    moods: ["Happy", "Playful"],
    styles: ["Medieval", "Acoustic"],
    url: "https://opengameart.org/sites/default/files/Minstrel_Dance_0.mp3",
    source: "https://opengameart.org/content/medieval-minstrel-dance",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-bards-tale",
    name: "The Bard's Tale",
    moods: ["Calm", "Emotional"],
    styles: ["Medieval", "Acoustic"],
    url: "https://opengameart.org/sites/default/files/The_Bards_Tale.mp3",
    source: "https://opengameart.org/content/medieval-the-bards-tale",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-old-tower-inn",
    name: "The Old Tower Inn",
    moods: ["Calm", "Happy"],
    styles: ["Medieval", "Acoustic"],
    url: "https://opengameart.org/sites/default/files/The_Old_Tower_Inn.mp3",
    source: "https://opengameart.org/content/medieval-the-old-tower-inn",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-mythica",
    name: "Mythica",
    moods: ["Epic", "Inspiring"],
    styles: ["Orchestral", "Cinematic"],
    url: "https://opengameart.org/sites/default/files/mythica.mp3",
    source: "https://opengameart.org/content/mythica",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-night-of-the-streets",
    name: "Night of the Streets",
    moods: ["Dark", "Intense"],
    styles: ["Cinematic", "Horror"],
    url: "https://opengameart.org/sites/default/files/Night%20of%20the%20Streets_0.mp3",
    source: "https://opengameart.org/content/night-of-the-streets-horrorsuspense",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-night-prowler",
    name: "Night Prowler",
    moods: ["Dark", "Mysterious"],
    styles: ["Electronic", "Retro"],
    url: "https://opengameart.org/sites/default/files/S31-Night%20Prowler.ogg",
    source: "https://opengameart.org/content/night-prowler",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-november-snow",
    name: "November Snow",
    moods: ["Calm", "Emotional"],
    styles: ["Ambient", "Piano"],
    url: "https://opengameart.org/sites/default/files/155%20November_snow-33_tape_leveled.mp3",
    source: "https://opengameart.org/content/november-snow",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-prepare-your-swords",
    name: "Prepare Your Swords",
    moods: ["Epic", "Intense"],
    styles: ["Orchestral", "Cinematic"],
    url: "https://opengameart.org/sites/default/files/prepare_your_swords.mp3",
    source: "https://opengameart.org/content/prepare-your-swords",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-sad-orchestral",
    name: "Sad Orchestral Theme",
    moods: ["Sad", "Emotional"],
    styles: ["Orchestral", "Cinematic"],
    url: "https://opengameart.org/sites/default/files/mess.wav",
    source: "https://opengameart.org/content/sad-orchestral-theme",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-searching",
    name: "Searching",
    moods: ["Mysterious", "Calm"],
    styles: ["Ambient"],
    url: "https://opengameart.org/sites/default/files/Searching.ogg",
    source: "https://opengameart.org/content/searching",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-shrine",
    name: "Shrine",
    moods: ["Mysterious", "Calm"],
    styles: ["Ambient", "Medieval"],
    url: "https://opengameart.org/sites/default/files/shrine_0.ogg",
    source: "https://opengameart.org/content/shrine",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-sirens-in-darkness",
    name: "Sirens in Darkness",
    moods: ["Dark", "Mysterious"],
    styles: ["Electronic", "Ambient"],
    url: "https://opengameart.org/sites/default/files/012_Sirens_in_Darkness_0.mp3",
    source: "https://opengameart.org/content/sirens-in-darkness",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-snowfall",
    name: "Snowfall",
    moods: ["Calm", "Emotional"],
    styles: ["Ambient", "Piano"],
    url: "https://opengameart.org/sites/default/files/Snowfall%20%28Looped%20ver.%29_0.ogg",
    source: "https://opengameart.org/content/snowfall",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-space-out-there",
    name: "Out There",
    moods: ["Mysterious", "Calm"],
    styles: ["Space", "Ambient"],
    url: "https://opengameart.org/sites/default/files/OutThere_0.ogg",
    source: "https://opengameart.org/content/space-music-out-there",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-spacelife-14",
    name: "Spacelife 14",
    moods: ["Mysterious", "Dark"],
    styles: ["Space", "Electronic"],
    url: "https://opengameart.org/sites/default/files/spacelifeNo14.ogg",
    source: "https://opengameart.org/content/spacelife-14",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-story-time",
    name: "Story Time",
    moods: ["Calm", "Happy"],
    styles: ["Acoustic", "Retro"],
    url: "https://opengameart.org/sites/default/files/story%20time.ogg",
    source: "https://opengameart.org/content/story-time",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-talking-cute-chiptune",
    name: "Talking Cute Chiptune",
    moods: ["Happy", "Playful"],
    styles: ["Chiptune", "Retro"],
    url: "https://opengameart.org/sites/default/files/TalkingCuteChiptune_0.mp3",
    source: "https://opengameart.org/content/talking-cute-chiptune",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-the-9th-circle",
    name: "The 9th Circle",
    moods: ["Dark", "Epic"],
    styles: ["Orchestral", "Cinematic"],
    url: "https://opengameart.org/sites/default/files/The%209th%20Circle%20V2.mp3",
    source: "https://opengameart.org/content/the-9th-circle",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-the-rush",
    name: "The Rush",
    moods: ["Epic", "Intense"],
    styles: ["Cinematic", "Electronic"],
    url: "https://opengameart.org/sites/default/files/The%20Rush_2.mp3",
    source: "https://opengameart.org/content/the-rush",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-tower-defense",
    name: "Tower Defense Theme",
    moods: ["Epic", "Intense"],
    styles: ["Orchestral", "Cinematic"],
    url: "https://opengameart.org/sites/default/files/DST-TowerDefenseTheme_1.mp3",
    source: "https://opengameart.org/content/tower-defense-theme",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-underwater",
    name: "Underwater Theme",
    moods: ["Calm", "Mysterious"],
    styles: ["Ambient"],
    url: "https://opengameart.org/sites/default/files/Cleyton%20RX%20-%20Underwater_0.mp3",
    source: "https://opengameart.org/content/underwater-theme",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-vampires-piano",
    name: "Vampire's Piano",
    moods: ["Dark", "Mysterious"],
    styles: ["Piano", "Classical"],
    url: "https://opengameart.org/sites/default/files/vampires_piano_6.mp3",
    source: "https://opengameart.org/content/vampires-piano",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-where-was-i",
    name: "Where Was I",
    moods: ["Mysterious", "Calm"],
    styles: ["Ambient", "Retro"],
    url: "https://opengameart.org/sites/default/files/WereWasI_0.ogg",
    source: "https://opengameart.org/content/where-was-i",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-zombies-march",
    name: "Zombies March",
    moods: ["Dark", "Intense"],
    styles: ["Retro", "Horror"],
    url: "https://opengameart.org/sites/default/files/ZombiesAreComing.ogg",
    source: "https://opengameart.org/content/zombies-march",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-adventure-time",
    name: "Adventure Time",
    moods: ["Happy", "Upbeat"],
    styles: ["Retro", "Acoustic"],
    url: "https://opengameart.org/sites/default/files/adventuring_song.mp3",
    source: "https://opengameart.org/content/adventure-time",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-desert-theme",
    name: "Desert Theme",
    moods: ["Mysterious", "Calm"],
    styles: ["Ambient", "Acoustic"],
    url: "https://opengameart.org/sites/default/files/caravan.ogg.ogg",
    source: "https://opengameart.org/content/desert-theme",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-dungeon-ambience",
    name: "Dungeon Ambience",
    moods: ["Dark", "Mysterious"],
    styles: ["Ambient"],
    url: "https://opengameart.org/sites/default/files/dungeon002_0.ogg",
    source: "https://opengameart.org/content/dungeon-ambience",
    attribution: "OpenGameArt",
  },
  {
    id: "oga-breves-dies-hominis",
    name: "Breves Dies Hominis",
    moods: ["Sad", "Epic"],
    styles: ["Orchestral", "Choral"],
    url: "https://opengameart.org/sites/default/files/breves_dies_hominis.ogg",
    source: "https://opengameart.org/content/breves-dies-hominis",
    attribution: "OpenGameArt",
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
        license: "CC0",
        source: item.source,
        attribution: item.attribution,
        url: `audio/music/${item.id}.mp3`,
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
