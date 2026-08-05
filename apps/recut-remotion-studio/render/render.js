/*
 * Remotion Studio — programmatic server-side render entry.
 *
 * Reads ${RECUT_APP_FILES_DIR}/exports/{renderId}/props.json, materializes the
 * referenced media into a temporary bundle public directory, bundles the
 * Remotion project, and renders the StoryVideo composition to
 * ${RECUT_APP_FILES_DIR}/exports/{renderId}/out.mp4 while streaming progress to
 * ${RECUT_APP_FILES_DIR}/exports/{renderId}/progress.json.
 *
 * Env: RECUT_APP_FILES_DIR is injected by the Recut host for every app shell job.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { bundle } = require("@remotion/bundler");
const { getCompositions, renderMedia } = require("@remotion/renderer");

function readArg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : null;
}

const renderId = readArg("renderId");
if (!renderId) {
  console.error("remotion-render: missing --renderId");
  process.exit(1);
}
const filesRoot = process.env.RECUT_APP_FILES_DIR;
if (!filesRoot) {
  console.error("remotion-render: RECUT_APP_FILES_DIR is not set");
  process.exit(1);
}
const workDir = path.join(filesRoot, "exports", renderId);
const outFile = path.join(workDir, "out.mp4");
const progressFile = path.join(workDir, "progress.json");

function writeProgress(phase, progress, message) {
  try {
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(progressFile, JSON.stringify({ phase, progress, message, at: new Date().toISOString() }));
  } catch (_) {
    /* progress is best-effort */
  }
  console.log(`remotion-render: ${phase} ${Math.round((progress || 0) * 100)}% ${message || ""}`.trim());
}

(async () => {
  writeProgress("reading", 0.01, "读取渲染配置");
  const propsPath = path.join(workDir, "props.json");
  const rawProps = JSON.parse(fs.readFileSync(propsPath, "utf8"));
  const design = rawProps.design;
  const settings = rawProps.settings || { width: 1920, height: 1080, fps: 30, codec: "h264" };
  const media = rawProps.media || {};
  if (!design || !Array.isArray(design.scenes)) {
    throw new Error("props.json 缺少 design 或 scenes");
  }

  // Materialize media into a per-render public directory so the bundle can
  // serve them at /media/{assetId}{ext} during rendering.
  writeProgress("media", 0.03, "准备画面素材");
  const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), "remotion-studio-public-"));
  const mediaDir = path.join(publicDir, "media");
  fs.mkdirSync(mediaDir, { recursive: true });
  const resolvedMedia = {};
  for (const [assetId, ref] of Object.entries(media)) {
    if (!ref || !ref.path) continue;
    const sourcePath = path.isAbsolute(ref.path) ? ref.path : path.join(filesRoot, ref.path);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`素材 ${assetId} 本地文件不存在：${sourcePath}`);
    }
    const extension = path.extname(sourcePath) || ".bin";
    const targetName = `${assetId}${extension}`;
    fs.copyFileSync(sourcePath, path.join(mediaDir, targetName));
    resolvedMedia[assetId] = { kind: ref.kind, mimeType: ref.mimeType, url: `/public/media/${targetName}`, path: sourcePath };
  }

  writeProgress("bundling", 0.05, "打包 Remotion 项目");
  const entryPoint = path.join(__dirname, "src", "index.ts");
  const serveUrl = await bundle({
    entryPoint,
    publicDir,
    enableCaching: false,
  });

  const inputProps = { design, media: resolvedMedia, settings };

  writeProgress("compositions", 0.08, "读取合成配置");
  const compositions = await getCompositions({
    serveUrl,
    inputProps,
    
  });
  const composition = compositions.find((candidate) => candidate.id === "StoryVideo");
  if (!composition) {
    throw new Error("未找到 StoryVideo 合成");
  }

  writeProgress("render", 0.1, `开始渲染 ${composition.width}x${composition.height}@${composition.fps}fps，共 ${composition.durationInFrames} 帧`);
  await renderMedia({
    composition,
    serveUrl,
    codec: settings.codec || "h264",
    outputLocation: outFile,
    inputProps,
    concurrency: "50%",
    timeoutInMilliseconds: 60000,
    onProgress: ({ progress }) => writeProgress("render", 0.1 + progress * 0.89, `渲染中 ${Math.round(progress * 100)}%`),
  });

  writeProgress("done", 1, "渲染完成");
  console.log(`remotion-render: output ${outFile}`);
  process.exit(0);
})().catch((error) => {
  writeProgress("failed", 0, String(error && error.stack ? error.stack : error));
  console.error("remotion-render: failed");
  console.error(String(error && error.stack ? error.stack : error));
  process.exit(1);
});
