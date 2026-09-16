> 来源: KINNONG/viral-video-breakdown (MIT)

# Local Setup

Use this file as a machine-local setup guide. Replace the placeholder paths and
browser id with values from your own computer before running the skill.

## Recommended Layout

- Skill root: `<your-codex-home>\skills\viral-video-breakdown`
- Output root suggestion: `<your-project-dir>\viral-video-breakdowns`
- Model/cache root: `<your-model-cache-dir>`
- Douyin browser-act browser id: get it with `browser-act browser list`

Keep private machine notes in a separate file such as
`references/local-setup.private.md`. That file is intentionally ignored by git.

## Environment

PowerShell example:

```powershell
$env:PYTHONUTF8='1'
$env:AI_MODEL_CACHE='<your-model-cache-dir>'
$env:SENSEVOICE_MODEL_DIR='<your-model-cache-dir>\manual-models\SenseVoiceSmall'
$env:VIRAL_BREAKDOWN_DH_PYTHON='<path-to-python-with-funasr>\python.exe'
$env:VIRAL_BREAKDOWN_FW_PYTHON='<path-to-python-with-faster-whisper>\python.exe'
$env:VIRAL_BREAKDOWN_TORCH_LIB='<path-to-your-torch-lib-if-needed>'
$env:FW_DEVICE='cuda'
$env:FW_COMPUTE_TYPE='float16'
$env:BROWSER_ACT_BROWSER_ID='<browser-act-browser-id>'
```

For CPU-only faster-whisper runs, use:

```powershell
$env:FW_DEVICE='cpu'
$env:FW_COMPUTE_TYPE='int8'
```

The runner also accepts the older `DOUYIN_BREAKDOWN_*` env names as fallback.

## Douyin yt-dlp Cookies And Fallback

Douyin downloads try `yt-dlp` first. If `yt-dlp` fails and
`--comment-browser-id` is available, the runner can fall back to a logged-in
BrowserAct browser to keep package generation moving. The original `yt-dlp`
failure is still printed so cookie or extractor issues can be diagnosed.

Preferred test after logging in to Douyin in the same browser profile:

```powershell
uvx yt-dlp --cookies-from-browser "chrome:Default" `
  --skip-download --print title `
  "<douyin-video-url>"
```

Common results:

- `Could not copy Chrome cookie database`: close Chrome windows, then run the test again.
- `Failed to decrypt with DPAPI`: export a Netscape `cookies.txt` from a logged-in browser and pass `--yt-dlp-cookies`.
- `Fresh cookies`: confirm Douyin is logged in and the video page loads in that exact browser profile.
- Repeated `Fresh cookies` with confirmed login may mean the current `yt-dlp` Douyin extractor is blocked by browser-verification requirements.

Runner flags:

```powershell
--yt-dlp-cookies-from-browser "chrome:Default"
--yt-dlp-cookies "<path-to-douyin-cookies.txt>"
```

Equivalent env vars:

```powershell
$env:VIRAL_BREAKDOWN_YTDLP_COOKIES_FROM_BROWSER='chrome:Default'
$env:VIRAL_BREAKDOWN_YTDLP_COOKIES='<path-to-douyin-cookies.txt>'
```

Never commit exported cookies, browser profiles, screenshots with private
account data, or generated `_work/` folders.

## Douyin Link Command

```powershell
python -X utf8 -u `
  "<skill-root>\scripts\run_viral_video.py" `
  "<douyin share text or URL>" `
  --out-dir "<episode-dir>" `
  --title "<title plus tags>" `
  --comments auto `
  --yt-dlp-cookies-from-browser "chrome:Default" `
  --comment-browser-id "<browser-act-browser-id>" `
  --comment-limit 30 `
  --comment-scrolls 5 `
  --comment-delay 3
```

## Local Video Command

```powershell
python -X utf8 -u `
  "<skill-root>\scripts\run_viral_video.py" `
  --source-video "<path-to-video.mp4>" `
  --out-dir "<episode-dir>" `
  --title "<video title>" `
  --comments off
```

## Other Platform URL Command

Use the same runner. It downloads through `yt-dlp` when supported. Comments are
off by default unless the URL is Douyin.

```powershell
python -X utf8 -u `
  "<skill-root>\scripts\run_viral_video.py" `
  "<video URL>" `
  --out-dir "<episode-dir>" `
  --title "<video title>" `
  --comments off
```

## Verification

After each video, verify:

- `source.mp4` exists
- `keyframes/` exists
- `speaker_transcript.md` exists
- `story_analysis.md` exists
- `_work/comments_raw.json` has `status: ok` and useful comments when comments were requested
