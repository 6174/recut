/*
 * [INPUT]: 无外部依赖；承载平台 Python 脚本正文（PySceneDetect 切点检测、Pillow 接触表合成）
 * [OUTPUT]: 两个可执行 Python 脚本常量：sceneScript 打印切点 JSON，sheetScript 合成带时间码/词标签的接触表
 * [POS]: media/understand 的 Python 侧实现；通过 runPythonJSON 以「脚本文件 + payload JSON」方式调用，依赖平台 venv
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package understand

// sceneScript uses PySceneDetect's modern API and degrades gracefully: score is
// attached only when the detector exposes frame metrics, otherwise omitted.
const sceneScript = `import json, sys

def main():
    cfg = json.load(open(sys.argv[1]))
    path = cfg["path"]
    threshold = float(cfg.get("threshold") or 27.0)
    try:
        from scenedetect import open_video, SceneManager
        from scenedetect.detectors import ContentDetector
    except Exception as exc:
        print(json.dumps({"error": "scenedetect unavailable: %s" % exc}))
        return
    detector = ContentDetector(threshold=threshold)
    video = open_video(path)
    manager = SceneManager()
    manager.add_detector(detector)
    manager.detect_scenes(video, show_progress=False)
    scene_list = manager.get_scene_list()
    content_vals = None
    try:
        metrics = detector.get_metrics()
        content_vals = getattr(metrics, "content_val", None)
    except Exception:
        content_vals = None
    boundaries = []
    for scene in scene_list[1:]:
        try:
            start = scene[0]
            at_sec = start.get_seconds()
            frame = start.get_frames()
        except Exception:
            continue
        item = {"atSec": at_sec, "kind": "hard-cut"}
        if content_vals is not None and 0 <= frame < len(content_vals):
            try:
                item["score"] = float(content_vals[frame])
            except Exception:
                pass
        boundaries.append(item)
    print(json.dumps({"boundaries": boundaries}))

main()
`

// sheetScript composites extracted frames into a contact sheet with a per-cell
// timecode/word label. CJK glyphs depend on a resolvable font; without one it
// still draws the grid and any ASCII-safe label.
const sheetScript = `import json, sys

def main():
    from PIL import Image, ImageDraw, ImageFont
    cfg = json.load(open(sys.argv[1]))
    cells = cfg["cells"]
    cols = int(cfg["columns"])
    rows = int(cfg["rows"])
    cell = int(cfg["cellPx"])
    width = cols * cell
    height = rows * cell
    sheet = Image.new("RGB", (width, height), (18, 18, 20))
    draw = ImageDraw.Draw(sheet)
    font = None
    font_path = cfg.get("fontPath")
    if font_path:
        try:
            font = ImageFont.truetype(font_path, max(12, int(cell * 0.055)))
        except Exception:
            font = None
    if font is None:
        try:
            font = ImageFont.load_default()
        except Exception:
            font = None
    for index, item in enumerate(cells):
        x = (index % cols) * cell
        y = (index // cols) * cell
        try:
            image = Image.open(item["path"]).convert("RGB")
            image.thumbnail((cell, cell))
            sheet.paste(image, (x + (cell - image.width) // 2, y + (cell - image.height) // 2))
        except Exception:
            pass
        label = item.get("label") or ""
        if label and font is not None:
            try:
                bbox = draw.textbbox((0, 0), label, font=font)
                text_w = bbox[2] - bbox[0]
                text_h = bbox[3] - bbox[1]
                bx = x + 6
                by = y + cell - text_h - 8
                draw.rectangle([bx - 3, by - 3, bx + text_w + 3, by + text_h + 3], fill=(0, 0, 0))
                draw.text((bx, by), label, fill=(255, 255, 255), font=font)
            except Exception:
                pass
        draw.rectangle([x, y, x + cell - 1, y + cell - 1], outline=(60, 60, 66))
    sheet.save(cfg["output"], "PNG")
    print(json.dumps({"ok": True, "width": width, "height": height}))

main()
`
