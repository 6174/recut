> 来源: vertical-video-editing (.executor-tasks/sources/vertical-video-editing/SKILL.md) (MIT) — 本文件为其中 kinetic captions / keyword emphasis / 字幕样式相关段落的中文改写，介质中性，已去除宿主工具（HyperFrames CLI / GSAP / lint / render）专属内容，仅保留导演判断

# 动能字幕与关键词强调（源自 vertical-video-editing 的中文改写）

本文件改写自 `vertical-video-editing/SKILL.md` 中与字幕上屏直接相关的段落，保持导演判断的完整性，仅将宿主工具专属的 HyperFrames 实现细节（`npx hyperframes`、`data-*`、`class="clip"`、GSAP 语法、lint 规则、render 校验脚本等）去除，译为介质中性的字幕纪律。原文中与字幕无关的章节（camera-moves、sfx-and-audio、style-theming、workflow 等）不在此搬运。

---

## 一、动能字幕的定位

> 原文："Kinetic text / captions: animated entrances, keyword emphasis (one accent word), caption supers timed to the voice."

- 动能字幕不是装饰，是**随语音节拍进入的强调层**：每个字幕 cue 的入场与语音的词级或句级重音对齐，观众的视线与耳朵在同一节拍上着陆。
- 一屏只强调**一个强调词**（accent word），其余词保持常态；强调词的入场比普通词晚 0.08–0.12 秒，曲线快起缓落，落定后与整句一同呼吸。
- 字幕 super（屏上大字）与字幕 cue（跟随语音的小字）分工不同：前者承载主张的压缩版（3–7 字），后者承载完整语义；两者不复读同一完整句。

---

## 二、强调词纪律（keyword emphasis）

> 原文："highlight-bar supers with keyword color emphasis"、"one italic-serif accent word per frame in a pill"、"keyword color emphasis (one accent word)"

- **一屏一强调词**：每帧最多一个强调词，强调词即句子的支点（动词、转折词、数字、专名）；全句高亮等于没有高亮。
- **强调的角色化**：强调色是全片唯一的"强调色"角色（accent-strong / emphasis），不是随意挑的亮色；同一强调色在全片保持一致，不换色。参考帧中的红/黄是角色而非色值，应从当前风格的调色板中取同一角色。
- **强调手法**：颜色强调（强调词用强调色）、字重/字号强调（微放大 1.1–1.15 倍）、形态强调（下划线/描边/轻倾斜）三选一，不叠加；叠加两种手法互相抵消，读作噪音。
- **入场时序**：两行强调条错峰进入，第二条比第一条晚 0.08–0.12 秒；强调词的入场带动整句的节奏，数字类强调词（`1 out of 3 employees` 中的 `1`）用强调色，动词类强调词用字重或形态。
- **衬线斜体强调**：在编辑类视觉语言中，强调词可用衬线斜体（italic serif）与无衬线粗体的对比来形成"一词转折"的张力，但每帧只给一到两个词，不给整行。

---

## 三、高亮条 super（boxed statement）

> 原文搬运自 Appendix "editorial-look" §5 "Highlight-bar super (the boxed statement)"，已去除 CSS 实现，仅保留版式判断

- 高亮条是**文字在实色条内的陈述**，一到两条叠放，关键词在条内用强调色弹出。条的形式有两种：墨色条/白字（报纸感）与强调色条。
- 两行条错峰进入，第二条晚 0.08–0.12 秒，减轻并列感；条的内边距与字距保证在 480px 宽下仍可读。
- 适用：需要让观众停留的结论句、对比句、数字句；不适用于需要快速扫读的连续对话。

---

## 四、缝线字幕（seam caption）

> 原文搬运自 Appendix "editorial-look" §4 "Stacked split (the workhorse layout)" 与 §10 "The seam caption"，已去除 HTML/CSS，仅保留版式与可读判断

- **缝线字幕是栈式分栏的默认字幕位**：B-roll 面板在上（约 52–56% 画幅高）、人物面板在下，字幕落在两面板的缝线处，居中，小字号，衬线斜体短语（如 `For 13 years`、`order sunlight`），用强调色或纸色。
- 缝线字幕一次只给一个短语，随语音的子句节拍出现，淡入或上移 20–30px 进入；不做段落字幕，不做全句卡拉 OK。
- 缝线字幕与分栏版式的进出是**有意的**：面板从半幅长到全幅（0.45–0.6 秒，缓动）或上方面板滑出、下方面板接管，字幕在面板运动的缝线上保持可读，不被面板边缘裁切。
- **可读性底线**：缝线字幕不得与人物面部、面板边缘或下一帧的图形重叠；若缝线处信息密度过高，优先拆句或让字幕暂停一拍，而非缩小字号硬塞。

---

## 五、名牌与 pills（name pill / seam pill）

> 原文搬运自 Appendix "editorial-look" §6 "Name pill / seam pill"

- 小圆角 pill 用于标识人物/事物，或在缝线处承载衬线强调词；入场带轻回弹，停留一拍后在面板切换前退出。
- Pill 是**身份与上下文**的轻量容器，不替代字幕；字幕承载语音，pill 承载身份，两者不混用。

---

## 六、安全摆位与可读性

> 原文搬运自 Appendix "editorial-look" Composition rules 与 Verification

- **每帧有地**：每帧都有明确的地面——纸面、深色网格或媒体面板边缘；不在无衬底的视频上直接叠裸字；必要时用条、pill 或半透明衬底保证可读，但默认不加底框。
- **强调阶梯（quiet → loud）**：缝线字幕（最轻）→ 名牌 pill → 高亮条 → 编辑类大标题 → 辉光大字（最响）；选能完成任务的最低一档，不在同一帧叠两档响亮元素。
- **风格映射必做**：参考帧的红/黄是角色（accent-strong / emphasis），不是要复制的颜色；从当前风格的调色板中填同一角色，保持全片一致。
- **入场节拍**：所有条/pill/卡片的入场错峰 0.1–0.14 秒，轻微旋转 ±1–2° 可用于卡片堆叠，但字幕本身不做旋转。
- **验收**：在预览与成片的定格帧中抽检，缝线字幕与高亮条在人物面板、网格墙与纸面三种地面上均保持高对比可读；缩至 480px 宽仍可读。

---

## 七、与其它纪律的衔接

- 动能字幕的**入场曲线**与全片的动效嗓音（energy × tone 两轴）保持一致，但时长不跟随动效嗓音的入场预设——字幕的入场始终服务于语音节拍，而非品牌嗓音的时长。
- 节奏密度（切点多快、何时切）归 editing，字幕只决定"怎么上屏"，不决定"何时切"；切点与字幕入场的对齐由 editing 的卡点纪律决定，字幕在此只保证入场不抢拍。
- 缝线字幕的版式使命（何时用分栏、何时用全幅）归 b-roll，本文件只规定缝线字幕本身的可读与强调。

---

## 改写说明

- 源文件 `vertical-video-editing/SKILL.md` 共 676 行，本文件改写的 kinetic captions / keyword emphasis / 字幕样式相关段落约 120 行原文（含 Appendix editorial-look §4/§5/§6/§10 与 Editing grammar 中 kinetic text 一节），改写后保留全部导演判断，仅做语言中文化与介质中性转述，未作有损删改。
- 去除的宿主工具专属内容：HyperFrames 脚手架（`npx hyperframes init/preview/lint/render`）、`data-start`/`data-duration`/`class="clip"`、GSAP 时间线注册、`cqw`/`cqh` 容器单位、SFX 合成与 master audio 混音、verify-render 脚本等。
