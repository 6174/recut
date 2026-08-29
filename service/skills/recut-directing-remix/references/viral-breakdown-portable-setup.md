> 来源: KINNONG/viral-video-breakdown (MIT)

# Portable Setup

Use this before sharing the skill to GitHub or installing it on another machine.

## Include

- `SKILL.md`
- `scripts/run_viral_video.py`
- `scripts/build_viral_package.py`
- `scripts/run_faster_whisper_asr.py`
- `scripts/run_funasr_asr.py`
- `scripts/collect_douyin_comments_browser_act.py`
- `references/local-setup.md`
- `references/output-style.md`
- `references/portable-setup.md`

## Do Not Include

- downloaded videos
- generated `_work/` folders
- model files
- HuggingFace tokens
- browser profiles, cookies, screenshots with private account data
- platform credentials
- `references/local-setup.private.md`

## External Dependencies

The scripts expect:

- Python 3.10+
- `ffmpeg`
- `yt-dlp` or `uvx yt-dlp`
- faster-whisper environment for transcript
- FunASR/SenseVoice environment for Chinese ASR and optional speaker attribution
- browser-act only when collecting Douyin comments

## Porting Notes

Update `references/local-setup.md` or create `references/local-setup.private.md` for each machine. The skill itself should not hardcode private model paths, tokens, browser profiles, browser ids, or project-specific output folders as mandatory requirements.
