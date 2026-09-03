#!/usr/bin/env node
/**
 * L0 Editor authoring-quality gate：检查生产 prompt 与项目 Markdown 工作稿是否仍
 * 把“做视频”缩退成“插入文字 + 堆关键帧”。它不渲染真片，也不替代结构/像素/交付证据。
 *
 * [INPUT]: apps/editor/manifest.json、skills/recut-editor/SKILL.md 与 authoring-fixtures/*.md
 * [OUTPUT]: 进程退出码；通过时输出可读的 authoring quality assertions。
 * [POS]: Editor prompt/worklog 的低成本回归门，位于真实 renderer 与 L5 golden 之前。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
const fs = require("fs");
const path = require("path");

const APP_ROOT = path.join(__dirname, "..");
const SKILL_ROOT = path.join(APP_ROOT, "skills", "recut-editor");
const FIXTURE_ROOT = path.join(__dirname, "authoring-fixtures");

let failures = 0;
function assert(name, condition, detail) {
  if (condition) {
    console.log(`  ok  ${name}`);
    return;
  }
  failures += 1;
  console.error(`FAIL  ${name}${detail ? `: ${detail}` : ""}`);
}

function read(relativePath) {
  return fs.readFileSync(path.join(APP_ROOT, relativePath), "utf8");
}

function hasAll(text, needles) {
  return needles.every((needle) => text.includes(needle));
}

function checkManifest() {
  console.log("\n== manifest onboarding authoring gate ==");
  const manifest = JSON.parse(read("manifest.json"));
  const prompts = [
    ...(manifest.localized?.en?.onboarding || []).map((entry) => entry.prompt || ""),
    ...(manifest.onboarding || []).map((entry) => entry.prompt || ""),
  ];
  assert("manifest 至少有一条 onboarding prompt", prompts.length > 0);
  const promptText = prompts.join("\n");
  assert("onboarding 先识别新片/二次编辑", /新视频|新片|已有时间线|二次编辑|timeline revision/.test(promptText));
  assert("onboarding 引导 route/treatment", /speech-led/.test(promptText) && /motion-graphics/.test(promptText));
  assert("onboarding 要求真实媒体或 verified component 主体", /真实媒体/.test(promptText) && /组件/.test(promptText));
  assert("onboarding 要求 settled frame 验证", /settled frame/.test(promptText));
  assert("onboarding 不把导出当默认创作动作", !/自动导出|立即导出|默认导出/.test(promptText));
}

function checkSkill() {
  console.log("\n== recut-editor skill authoring gate ==");
  const skill = fs.readFileSync(path.join(SKILL_ROOT, "SKILL.md"), "utf8");
  assert("Skill 定义统一导演链", hasAll(skill, ["intent / scope", "route / treatments", "design system", "visual assets", "settled-frame proof"]));
  assert("Skill 覆盖二次编辑 scope 保持规则", /二次编辑/.test(skill) && /未被用户点名的内容默认不动/.test(skill));
  assert("Skill 覆盖连续会话快照复用", /连续编辑会话/.test(skill) && /不重复读取/.test(skill));
  assert("Skill 覆盖 ChatCut treatment 语义", hasAll(skill, ["A-roll", "B-roll", "motion graphics", "voice-led", "generated-video"]));
  assert("Skill 在新片先读取设计系统", hasAll(skill, ["recut.skills.reference", "recut-design-system"]));
  assert("Skill 把组件作为 motion graphic 默认载体", /component.*默认实现载体/.test(skill));
  assert("Skill 不把能力缺失退化为文字片", /不退化为文字片/.test(skill));
  assert("Skill 明确先证明 settled frame 再精修", /proof 之后/.test(skill) && /关键帧/.test(skill));

  const forbidden = [
    "CreativePlan",
    "timeline.applyPlan",
    "tokenReceipt",
    "styleId",
    "Plan CRUD",
    "Plan schema",
    "不要去阅读和修改 recut 和 apps/editor 的源码",
  ];
  for (const phrase of forbidden) {
    assert(`Skill 不暴露内部设计词：${phrase}`, !skill.includes(phrase));
  }
}

function checkReferences() {
  console.log("\n== treatment reference gate ==");
  const files = {
    speech: "references/speech-editing.md",
    motion: "references/motion-graphics.md",
    voice: "references/voiceover.md",
    generated: "references/video-generation.md",
    verification: "references/verification.md",
  };
  const content = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, read(path.join("skills", "recut-editor", file))]));
  assert("speech reference 有 Audio Studio 缺失提示", /Audio Studio/.test(content.speech) && /暂不可用/.test(content.speech) && /重新路由/.test(content.speech));
  assert("speech reference 有 A-roll 分支", hasAll(content.speech, ["cleanup", "highlight", "restructure", "hook"]));
  assert("motion reference 有 representative component 与 settled frame", /representative/.test(content.motion) && /settled frame/.test(content.motion));
  assert("motion reference 统一使用 motion graphic 语义", !/\bMG\b/.test(content.motion) && /motion graphic/.test(content.motion));
  assert("voice reference 有 visual-first sync", /visual-first/i.test(content.voice) && /duration/.test(content.voice));
  assert("generated reference 有 shot/anchor/continuity", hasAll(content.generated, ["shot", "anchor", "continuity"]));
  assert("verification reference 有三层证据", hasAll(content.verification, ["结构", "画面", "交付"]));
}

function checkFixture(file, expected) {
  const fixture = fs.readFileSync(path.join(FIXTURE_ROOT, file), "utf8");
  assert(`${file} 存在并可读`, fixture.length > 0);
  assert(`${file} 写明 route`, /route\s*:/i.test(fixture));
  assert(`${file} 写明设计系统与视觉规则`, /design system\s*:/i.test(fixture) && /visual rule\s*:/i.test(fixture));
  assert(`${file} 写明 treatment 理由`, /treatments/i.test(fixture) && /selected|not needed/.test(fixture));
  assert(`${file} scene 写明 viewer job`, /viewer job\s*:/i.test(fixture));
  assert(`${file} scene 写明 visual mechanism`, /visual mechanism\s*:/i.test(fixture));
  assert(`${file} scene 写明主体状态`, /asset\/status\s*:/i.test(fixture));
  assert(`${file} scene 写明 proof`, /proof\s*:/i.test(fixture));
  assert(`${file} 有执行记录与下一步`, /execution log/i.test(fixture) && /next\s*:/i.test(fixture));
  assert(`${file} 不把工作稿伪装成结构化时间线`, !/CreativePlan|timeline\.applyPlan|TProject schema|Plan CRUD/i.test(fixture));
  if (expected === "revision") {
    assert(`${file} 明确 revision scope`, /scope\s*:/i.test(fixture) && /preserve|保持|未点名/i.test(fixture));
  }
}

checkManifest();
checkSkill();
checkReferences();
checkFixture("new-authoring.md", "new");
checkFixture("timeline-revision.md", "revision");

if (failures > 0) {
  console.error(`\n${failures} authoring-quality assertion(s) FAILED`);
  process.exit(1);
}
console.log("\nL0 authoring-quality: all assertions passed");
