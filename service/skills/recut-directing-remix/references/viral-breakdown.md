> 来源: KINNONG/viral-video-breakdown (MIT)

---
name: viral-video-breakdown
description: Generic viral short-video breakdown workflow. Use when the user asks to 拆解/复盘/分析 爆款视频、短视频、AI短片、剧情短片、账号视频、对标视频, or wants a package with source video, keyframes, Chinese transcript, speaker-attributed transcript, story/conflict/hook analysis, and optional Douyin comment-area insight. Supports Douyin share links, local video files, and other yt-dlp-supported video URLs without tying the output to any single IP or account.
---

# Viral Video Breakdown

## Output Contract

Create one folder per video. Keep only these visible outputs:

- `source.mp4`
- `keyframes/`
- `speaker_transcript.md`
- `story_analysis.md`

Put raw JSON, audio, logs, screenshots, download metadata, and comment raw data under hidden `_work/`. Do not delete `_work/` unless the user asks; it allows rebuilds without redownloading.

## Workflow

1. Parse the input.
   Identify whether the user gave a Douyin share link, another video URL, or a local video path. Extract title/caption/tags and any requested account or episode ordering.

2. Choose the output directory.
   Use a user-specified directory when given. Otherwise create a clear dated slug under the current project or a generic `爆款视频拆解` folder. Use account folders when processing a series.

3. Build the base package.
   Use `scripts/run_viral_video.py` instead of hand-writing ASR or FFmpeg commands. Read `README.md` and `references/local-setup.md` before the first run on a new machine.

4. Collect comments only when useful and possible.
   The bundled comment collector currently supports Douyin. For Douyin comments, use the user's logged-in browser only with permission, and keep the run conservative: about 30 comments, 5 scrolls, 3 seconds between scrolls, `--skip-network` unless the user explicitly asks for deeper collection. Before browser-act commands, use the `browser-act` skill and run its core setup command.

5. Refine the analysis manually.
   The scripted `story_analysis.md` is a draft. Before finishing, read the transcript, keyframes/contact sheet, and comments if collected, then rewrite or expand `story_analysis.md` into a specific creator-research report. Do not leave placeholders such as “待根据...” in the final answer.

6. Verify.
   Confirm the four visible outputs exist. If comments were requested, verify `_work/comments_raw.json` has `status: ok` and a nonzero usable comment count. Hide `_work/` after completion.

## Analysis Requirements

Make `story_analysis.md` useful for generic content research, not tied to one IP. Cover:

- title, caption, tags, target audience signal
- one-sentence video summary
- first 3-second and 5-second hook
- transcript and speaker roles
- key visual frames, scene changes, shot rhythm, subtitles, props, visual symbols
- plot beats, conflict, escalation, reversal, ending payoff
- jokes, memes, rough language, emotional particles, quotable lines
- comment-area resonance when available: top-liked comments, repeated emotions, why viewers comment, what the creator can learn
- reusable structure: what can be borrowed, what should not be copied, what risks may cause audience fatigue
- platform notes for Douyin, Xiaohongshu, Video Channel, YouTube Shorts, TikTok, X, or other platforms when relevant

## Bundled Resources

- `scripts/run_viral_video.py`: integrated downloader/ASR/keyframe/package runner.
- `scripts/build_viral_package.py`: creates visible package files from video and transcript artifacts.
- `scripts/collect_douyin_comments_browser_act.py`: conservative Douyin comment collector.
- `scripts/run_faster_whisper_asr.py`: faster-whisper transcript helper.
- `scripts/run_funasr_asr.py`: SenseVoice/FunASR transcript and speaker helper.
- `references/local-setup.md`: current Windows paths, model cache, and command templates.
- `references/output-style.md`: final analysis style and content checklist.
- `references/portable-setup.md`: notes for moving this skill to another machine or GitHub.
