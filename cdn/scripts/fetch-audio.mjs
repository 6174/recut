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
    id: "oga-bossa-nova",
    name: "8-Bit Bossa",
    moods: ["Happy", "Relaxed"],
    styles: ["Latin", "Acoustic"],
    url: "https://opengameart.org/sites/default/files/8bit%20Bossa.mp3",
    source: "https://opengameart.org/content/bossa-nova",
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
    id: "oga-doodle-menu",
    name: "Doodle Menu",
    moods: ["Happy", "Playful"],
    styles: ["Acoustic"],
    url: "https://opengameart.org/sites/default/files/doodle_0.mp3",
    source: "https://opengameart.org/content/doodle-menu-like-song",
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
    id: "oga-story-time",
    name: "Story Time",
    moods: ["Calm", "Happy"],
    styles: ["Acoustic", "Retro"],
    url: "https://opengameart.org/sites/default/files/story%20time.ogg",
    source: "https://opengameart.org/content/story-time",
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
    id: "oga-carnival-rides",
    name: "Carnival Rides",
    moods: ["Happy", "Playful"],
    styles: ["Retro", "Acoustic"],
    url: "https://opengameart.org/sites/default/files/carnivalrides.ogg",
    source: "https://opengameart.org/content/carnival-rides",
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
    id: "oga-happy-adventure",
    name: "Happy Adventure Loop",
    moods: ["Happy", "Upbeat"],
    styles: ["Orchestral", "Acoustic"],
    url: "https://opengameart.org/sites/default/files/happy_adveture.mp3",
    source: "https://opengameart.org/content/happy-adventure-loop",
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
    id: "oga-november-snow",
    name: "November Snow",
    moods: ["Calm", "Emotional"],
    styles: ["Ambient", "Piano"],
    url: "https://opengameart.org/sites/default/files/155%20November_snow-33_tape_leveled.mp3",
    source: "https://opengameart.org/content/november-snow",
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
    id: "oga-forest-ambience",
    name: "Forest Ambience",
    moods: ["Calm", "Relaxed"],
    styles: ["Nature", "Ambient"],
    url: "https://opengameart.org/sites/default/files/Forest_Ambience.mp3",
    source: "https://opengameart.org/content/forest-ambience",
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
    id: "oga-flare-main",
    name: "Flare Main",
    moods: ["Calm", "Mysterious"],
    styles: ["Ambient", "Electronic"],
    url: "https://opengameart.org/sites/default/files/flaremain_0.ogg",
    source: "https://opengameart.org/content/flare-main",
    attribution: "OpenGameArt",
  },
  // === Joshua McLean (HoliznaCC0) — screen-recording / content BGM (CC0) ===
  {
    id: "holi-poor-but-happy",
    name: "Poor, But Happy",
    moods: ["Happy", "Relaxed"],
    styles: ["Lo-fi", "Chill"],
    url: "https://opengameart.org/sites/default/files/happy_lo-fi_lofi_collection.zip",
    zipEntry: "01 HoliznaCC0 - Poor, But Happy.mp3",
    source: "https://opengameart.org/content/happy-lo-fi-lofi-collection",
    attribution: "Joshua McLean (HoliznaCC0) via OpenGameArt",
  },
  {
    id: "holi-blue-skies",
    name: "Blue Skies",
    moods: ["Calm", "Relaxed"],
    styles: ["Lo-fi", "Chill"],
    url: "https://opengameart.org/sites/default/files/happy_lo-fi_lofi_collection.zip",
    zipEntry: "03 HoliznaCC0 - Blue Skies.mp3.mp3",
    source: "https://opengameart.org/content/happy-lo-fi-lofi-collection",
    attribution: "Joshua McLean (HoliznaCC0) via OpenGameArt",
  },
  {
    id: "holi-letting-go",
    name: "Letting Go Of The Past",
    moods: ["Calm", "Emotional"],
    styles: ["Lo-fi", "Chill"],
    url: "https://opengameart.org/sites/default/files/happy_lo-fi_lofi_collection.zip",
    zipEntry: "16 HoliznaCC0 - Letting Go Of The Past.mp3",
    source: "https://opengameart.org/content/happy-lo-fi-lofi-collection",
    attribution: "Joshua McLean (HoliznaCC0) via OpenGameArt",
  },
  {
    id: "holi-puppy-love",
    name: "Puppy Love",
    moods: ["Happy", "Playful"],
    styles: ["Lo-fi", "Chill"],
    url: "https://opengameart.org/sites/default/files/happy_lo-fi_lofi_collection.zip",
    zipEntry: "19 HoliznaCC0 - Puppy Love.mp3",
    source: "https://opengameart.org/content/happy-lo-fi-lofi-collection",
    attribution: "Joshua McLean (HoliznaCC0) via OpenGameArt",
  },
  {
    id: "holi-clouds",
    name: "Clouds",
    moods: ["Calm", "Relaxed"],
    styles: ["Lo-fi", "Ambient"],
    url: "https://opengameart.org/sites/default/files/happy_lo-fi_lofi_collection.zip",
    zipEntry: "21 HoliznaCC0 - Clouds.mp3",
    source: "https://opengameart.org/content/happy-lo-fi-lofi-collection",
    attribution: "Joshua McLean (HoliznaCC0) via OpenGameArt",
  },
  {
    id: "holi-happy-little-off",
    name: "Happy, But A Little Off",
    moods: ["Happy", "Playful"],
    styles: ["Lo-fi", "Chill"],
    url: "https://opengameart.org/sites/default/files/happy_lo-fi_lofi_collection.zip",
    zipEntry: "22 HoliznaCC0 - Happy, but a little off.mp3",
    source: "https://opengameart.org/content/happy-lo-fi-lofi-collection",
    attribution: "Joshua McLean (HoliznaCC0) via OpenGameArt",
  },
  {
    id: "holi-new-shoes",
    name: "New Shoes",
    moods: ["Happy", "Relaxed"],
    styles: ["Lo-fi", "Chill"],
    url: "https://opengameart.org/sites/default/files/happy_lo-fi_lofi_collection.zip",
    zipEntry: "26 HoliznaCC0 - New Shoes.mp3",
    source: "https://opengameart.org/content/happy-lo-fi-lofi-collection",
    attribution: "Joshua McLean (HoliznaCC0) via OpenGameArt",
  },
  {
    id: "holi-back-in-the-80s",
    name: "Back In The 80s",
    moods: ["Happy", "Upbeat"],
    styles: ["Electronic", "Retro"],
    url: "https://opengameart.org/sites/default/files/happy_electronic.zip",
    zipEntry: "03 HoliznaCC0 - Back In The 80s.mp3",
    source: "https://opengameart.org/content/happy-pop-electronic-collection",
    attribution: "Joshua McLean (HoliznaCC0) via OpenGameArt",
  },
  {
    id: "holi-earth",
    name: "Earth",
    moods: ["Calm", "Inspiring"],
    styles: ["Electronic", "Ambient"],
    url: "https://opengameart.org/sites/default/files/happy_electronic.zip",
    zipEntry: "03 HoliznaCC0 - Earth.mp3",
    source: "https://opengameart.org/content/happy-pop-electronic-collection",
    attribution: "Joshua McLean (HoliznaCC0) via OpenGameArt",
  },
  {
    id: "holi-small-town-pluto",
    name: "A Small Town On Pluto",
    moods: ["Happy", "Calm"],
    styles: ["Electronic", "Retro"],
    url: "https://opengameart.org/sites/default/files/happy_electronic.zip",
    zipEntry: "04 HoliznaCC0 - A Small Town On Pluto.mp3",
    source: "https://opengameart.org/content/happy-pop-electronic-collection",
    attribution: "Joshua McLean (HoliznaCC0) via OpenGameArt",
  },
  {
    id: "holi-happy-dance",
    name: "Happy Dance",
    moods: ["Happy", "Upbeat"],
    styles: ["Electronic", "Pop"],
    url: "https://opengameart.org/sites/default/files/happy_electronic.zip",
    zipEntry: "06 HoliznaCC0 - Happy Dance.mp3",
    source: "https://opengameart.org/content/happy-pop-electronic-collection",
    attribution: "Joshua McLean (HoliznaCC0) via OpenGameArt",
  },
  {
    id: "holi-transcendental",
    name: "Transcendental Earth People",
    moods: ["Calm", "Mysterious"],
    styles: ["Electronic", "Ambient"],
    url: "https://opengameart.org/sites/default/files/happy_electronic.zip",
    zipEntry: "08 HoliznaCC0 - transcendental earth people.mp3",
    source: "https://opengameart.org/content/happy-pop-electronic-collection",
    attribution: "Joshua McLean (HoliznaCC0) via OpenGameArt",
  },
  {
    id: "holi-bouncing",
    name: "Bouncing",
    moods: ["Happy", "Playful"],
    styles: ["Electronic", "Pop"],
    url: "https://opengameart.org/sites/default/files/happy_electronic.zip",
    zipEntry: "10 HoliznaCC0 - Bouncing.mp3",
    source: "https://opengameart.org/content/happy-pop-electronic-collection",
    attribution: "Joshua McLean (HoliznaCC0) via OpenGameArt",
  },
  {
    id: "holi-love-love-love",
    name: "Love Love Love",
    moods: ["Happy", "Upbeat"],
    styles: ["Electronic", "Pop"],
    url: "https://opengameart.org/sites/default/files/happy_electronic.zip",
    zipEntry: "11 HoliznaCC0 - Love Love Love.mp3",
    source: "https://opengameart.org/content/happy-pop-electronic-collection",
    attribution: "Joshua McLean (HoliznaCC0) via OpenGameArt",
  },
  {
    id: "holi-first-snow",
    name: "First Snow",
    moods: ["Calm", "Emotional"],
    styles: ["Lo-fi", "Chill"],
    url: "https://opengameart.org/sites/default/files/lo-fi_and_chill_lofi_collection.zip",
    zipEntry: "01 HoliznaCC0 - First Snow.mp3.mp3",
    source: "https://opengameart.org/content/lo-fi-and-chill-collection",
    attribution: "Joshua McLean (HoliznaCC0) via OpenGameArt",
  },
  {
    id: "holi-laundry",
    name: "Laundry On The Wire",
    moods: ["Calm", "Relaxed"],
    styles: ["Lo-fi", "Chill"],
    url: "https://opengameart.org/sites/default/files/lo-fi_and_chill_lofi_collection.zip",
    zipEntry: "01 HoliznaCC0 - Laundry On The Wire.mp3.mp3",
    source: "https://opengameart.org/content/lo-fi-and-chill-collection",
    attribution: "Joshua McLean (HoliznaCC0) via OpenGameArt",
  },
  {
    id: "holi-everything-dreamed",
    name: "Everything You Ever Dreamed",
    moods: ["Calm", "Emotional"],
    styles: ["Lo-fi", "Chill"],
    url: "https://opengameart.org/sites/default/files/lo-fi_and_chill_lofi_collection.zip",
    zipEntry: "02 HoliznaCC0 - Everything You Ever Dreamed.mp3",
    source: "https://opengameart.org/content/lo-fi-and-chill-collection",
    attribution: "Joshua McLean (HoliznaCC0) via OpenGameArt",
  },
  {
    id: "holi-keeping-cool",
    name: "Keeping Cool",
    moods: ["Calm", "Relaxed"],
    styles: ["Lo-fi", "Chill"],
    url: "https://opengameart.org/sites/default/files/lo-fi_and_chill_lofi_collection.zip",
    zipEntry: "02 HoliznaCC0 - Keeping Cool.mp3",
    source: "https://opengameart.org/content/lo-fi-and-chill-collection",
    attribution: "Joshua McLean (HoliznaCC0) via OpenGameArt",
  },
  {
    id: "holi-snow-drift",
    name: "Snow Drift",
    moods: ["Calm", "Relaxed"],
    styles: ["Lo-fi", "Chill"],
    url: "https://opengameart.org/sites/default/files/lo-fi_and_chill_lofi_collection.zip",
    zipEntry: "02 HoliznaCC0 - Snow Drift.mp3",
    source: "https://opengameart.org/content/lo-fi-and-chill-collection",
    attribution: "Joshua McLean (HoliznaCC0) via OpenGameArt",
  },
  {
    id: "holi-windows-down",
    name: "Windows Down",
    moods: ["Happy", "Relaxed"],
    styles: ["Lo-fi", "Chill"],
    url: "https://opengameart.org/sites/default/files/lo-fi_and_chill_lofi_collection.zip",
    zipEntry: "02 HoliznaCC0 - Windows Down.mp3.mp3",
    source: "https://opengameart.org/content/lo-fi-and-chill-collection",
    attribution: "Joshua McLean (HoliznaCC0) via OpenGameArt",
  },
  {
    id: "holi-2-hour-delay",
    name: "2 Hour Delay",
    moods: ["Calm", "Relaxed"],
    styles: ["Lo-fi", "Chill"],
    url: "https://opengameart.org/sites/default/files/lo-fi_and_chill_lofi_collection.zip",
    zipEntry: "03 HoliznaCC0 - 2 Hour Delay.mp3",
    source: "https://opengameart.org/content/lo-fi-and-chill-collection",
    attribution: "Joshua McLean (HoliznaCC0) via OpenGameArt",
  },
  {
    id: "holi-glad-stuck-inside",
    name: "Glad To Be Stuck Inside",
    moods: ["Calm", "Happy"],
    styles: ["Lo-fi", "Chill"],
    url: "https://opengameart.org/sites/default/files/lo-fi_and_chill_lofi_collection_2.zip",
    zipEntry: "07 HoliznaCC0 - Glad To Be Stuck Inside.mp3.mp3",
    source: "https://opengameart.org/content/lo-fi-and-chill-collection",
    attribution: "Joshua McLean (HoliznaCC0) via OpenGameArt",
  },
  {
    id: "holi-vintage",
    name: "Vintage",
    moods: ["Calm", "Relaxed"],
    styles: ["Lo-fi", "Retro"],
    url: "https://opengameart.org/sites/default/files/lo-fi_and_chill_lofi_collection_2.zip",
    zipEntry: "08 HoliznaCC0 - Vintage.mp3.mp3",
    source: "https://opengameart.org/content/lo-fi-and-chill-collection",
    attribution: "Joshua McLean (HoliznaCC0) via OpenGameArt",
  },
  {
    id: "holi-morning-coffee",
    name: "Morning Coffee",
    moods: ["Calm", "Happy"],
    styles: ["Lo-fi", "Chill"],
    url: "https://opengameart.org/sites/default/files/lo-fi_and_chill_lofi_collection_2.zip",
    zipEntry: "09 HoliznaCC0 - Morning Coffee.mp3",
    source: "https://opengameart.org/content/lo-fi-and-chill-collection",
    attribution: "Joshua McLean (HoliznaCC0) via OpenGameArt",
  },
  {
    id: "holi-little-shade",
    name: "A Little Shade",
    moods: ["Calm", "Relaxed"],
    styles: ["Lo-fi", "Chill"],
    url: "https://opengameart.org/sites/default/files/lo-fi_and_chill_lofi_collection_2.zip",
    zipEntry: "10 HoliznaCC0 - A Little Shade.mp3",
    source: "https://opengameart.org/content/lo-fi-and-chill-collection",
    attribution: "Joshua McLean (HoliznaCC0) via OpenGameArt",
  },
  {
    id: "holi-ghosts",
    name: "Ghosts",
    moods: ["Calm", "Mysterious"],
    styles: ["Lo-fi", "Chill"],
    url: "https://opengameart.org/sites/default/files/lo-fi_and_chill_lofi_collection_2.zip",
    zipEntry: "12 HoliznaCC0 - Ghosts.mp3",
    source: "https://opengameart.org/content/lo-fi-and-chill-collection",
    attribution: "Joshua McLean (HoliznaCC0) via OpenGameArt",
  },
  {
    id: "holi-whatever",
    name: "Whatever",
    moods: ["Calm", "Relaxed"],
    styles: ["Lo-fi", "Chill"],
    url: "https://opengameart.org/sites/default/files/lo-fi_and_chill_lofi_collection_2.zip",
    zipEntry: "14 HoliznaCC0 - Whatever.mp3",
    source: "https://opengameart.org/content/lo-fi-and-chill-collection",
    attribution: "Joshua McLean (HoliznaCC0) via OpenGameArt",
  },
  {
    id: "holi-ramen",
    name: "Ramen",
    moods: ["Happy", "Relaxed"],
    styles: ["Lo-fi", "Chill"],
    url: "https://opengameart.org/sites/default/files/lo-fi_and_chill_lofi_collection_2.zip",
    zipEntry: "20 HoliznaCC0 - Ramen.mp3.mp3",
    source: "https://opengameart.org/content/lo-fi-and-chill-collection",
    attribution: "Joshua McLean (HoliznaCC0) via OpenGameArt",
  },
  {
    id: "holi-pretty-little-lies",
    name: "Pretty Little Lies",
    moods: ["Calm", "Emotional"],
    styles: ["Lo-fi", "Chill"],
    url: "https://opengameart.org/sites/default/files/lo-fi_and_chill_lofi_collection_3.zip",
    zipEntry: "03 HoliznaCC0 - Pretty Little Lies.mp3",
    source: "https://opengameart.org/content/lo-fi-and-chill-collection",
    attribution: "Joshua McLean (HoliznaCC0) via OpenGameArt",
  },
  {
    id: "holi-so-broke",
    name: "So Broke",
    moods: ["Calm", "Relaxed"],
    styles: ["Lo-fi", "Chill"],
    url: "https://opengameart.org/sites/default/files/lo-fi_and_chill_lofi_collection_3.zip",
    zipEntry: "03 HoliznaCC0 - So Broke.mp3",
    source: "https://opengameart.org/content/lo-fi-and-chill-collection",
    attribution: "Joshua McLean (HoliznaCC0) via OpenGameArt",
  },
  {
    id: "holi-come-again",
    name: "Come Again",
    moods: ["Happy", "Relaxed"],
    styles: ["Lo-fi", "Chill"],
    url: "https://opengameart.org/sites/default/files/lo-fi_and_chill_lofi_collection_3.zip",
    zipEntry: "04 HoliznaCC0 - Come Again.mp3",
    source: "https://opengameart.org/content/lo-fi-and-chill-collection",
    attribution: "Joshua McLean (HoliznaCC0) via OpenGameArt",
  },
  {
    id: "holi-something-air",
    name: "Something In The Air",
    moods: ["Calm", "Relaxed"],
    styles: ["Lo-fi", "Chill"],
    url: "https://opengameart.org/sites/default/files/lo-fi_and_chill_lofi_collection_3.zip",
    zipEntry: "04 HoliznaCC0 - Something In the Air.mp3",
    source: "https://opengameart.org/content/lo-fi-and-chill-collection",
    attribution: "Joshua McLean (HoliznaCC0) via OpenGameArt",
  },
  {
    id: "holi-waves",
    name: "Waves",
    moods: ["Calm", "Relaxed"],
    styles: ["Lo-fi", "Ambient"],
    url: "https://opengameart.org/sites/default/files/lo-fi_and_chill_lofi_collection_3.zip",
    zipEntry: "04 HoliznaCC0 - Waves.mp3.mp3",
    source: "https://opengameart.org/content/lo-fi-and-chill-collection",
    attribution: "Joshua McLean (HoliznaCC0) via OpenGameArt",
  },
  {
    id: "holi-creature-comforts",
    name: "Creature Comforts",
    moods: ["Calm", "Happy"],
    styles: ["Lo-fi", "Chill"],
    url: "https://opengameart.org/sites/default/files/lo-fi_and_chill_lofi_collection_3.zip",
    zipEntry: "23 HoliznaCC0 - Creature Comforts.mp3",
    source: "https://opengameart.org/content/lo-fi-and-chill-collection",
    attribution: "Joshua McLean (HoliznaCC0) via OpenGameArt",
  },
  {
    id: "holi-foggy-headed",
    name: "Foggy Headed",
    moods: ["Calm", "Emotional"],
    styles: ["Lo-fi", "Ambient"],
    url: "https://opengameart.org/sites/default/files/lo-fi_and_chill_lofi_collection_3.zip",
    zipEntry: "27 HoliznaCC0 - Foggy Headed.mp3",
    source: "https://opengameart.org/content/lo-fi-and-chill-collection",
    attribution: "Joshua McLean (HoliznaCC0) via OpenGameArt",
  },
  {
    id: "holi-night-driving",
    name: "Night Driving",
    moods: ["Calm", "Relaxed"],
    styles: ["Ambient", "Piano"],
    url: "https://opengameart.org/sites/default/files/relaxing_instrumentals.zip",
    zipEntry: "02 HoliznaCC0 - Night Driving.mp3",
    source: "https://opengameart.org/content/relaxing-instrumentals-collection",
    attribution: "Joshua McLean (HoliznaCC0) via OpenGameArt",
  },
  {
    id: "holi-boredom",
    name: "Boredom",
    moods: ["Calm", "Emotional"],
    styles: ["Ambient", "Chill"],
    url: "https://opengameart.org/sites/default/files/relaxing_instrumentals.zip",
    zipEntry: "03 HoliznaCC0 - Boredom.mp3",
    source: "https://opengameart.org/content/relaxing-instrumentals-collection",
    attribution: "Joshua McLean (HoliznaCC0) via OpenGameArt",
  },
  {
    id: "holi-love",
    name: "Love",
    moods: ["Emotional", "Calm"],
    styles: ["Piano", "Ambient"],
    url: "https://opengameart.org/sites/default/files/relaxing_instrumentals.zip",
    zipEntry: "05 HoliznaCC0 - Love.mp3",
    source: "https://opengameart.org/content/relaxing-instrumentals-collection",
    attribution: "Joshua McLean (HoliznaCC0) via OpenGameArt",
  },
  {
    id: "holi-lost-in-your-eyes",
    name: "Lost In Your Eyes",
    moods: ["Emotional", "Calm"],
    styles: ["Piano", "Ambient"],
    url: "https://opengameart.org/sites/default/files/relaxing_instrumentals.zip",
    zipEntry: "06 HoliznaCC0 - Lost In Your Eyes.mp3",
    source: "https://opengameart.org/content/relaxing-instrumentals-collection",
    attribution: "Joshua McLean (HoliznaCC0) via OpenGameArt",
  },
  {
    id: "holi-you-loved-me-once",
    name: "You Loved Me Once",
    moods: ["Emotional", "Sad"],
    styles: ["Piano", "Ambient"],
    url: "https://opengameart.org/sites/default/files/relaxing_instrumentals.zip",
    zipEntry: "18 HoliznaCC0 - You Loved Me Once.mp3",
    source: "https://opengameart.org/content/relaxing-instrumentals-collection",
    attribution: "Joshua McLean (HoliznaCC0) via OpenGameArt",
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
