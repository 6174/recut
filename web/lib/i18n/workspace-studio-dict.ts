/*
 * [INPUT]: 依赖 locales.ts 的 Locale；由 studio 面实施方扩充
 * [OUTPUT]: 工作台 Studio 首页 Header/每日灵感/提示模板/首访引导文案的逐语言字典；en 必须覆盖 zh 全部 key（Record<keyof typeof zh, string> 编译期保证）
 * [POS]: web/lib/i18n 的 studio 命名空间；合并进 workspaceDictionary，app/page.tsx 与 WebGL hero 消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { Locale } from "./locales";

// 每日灵感与提示模板的条目数：app/page.tsx 按此遍历命名空间 key（studio.inspiration.{i} / studio.template.{i}.*）。
export const STUDIO_INSPIRATION_COUNT = 20;
export const STUDIO_TEMPLATE_COUNT = 12;

const zh = {
  "studio.placeholder": "创作台",

  // 每日灵感（内容面，按日期稳定轮换）
  "studio.inspiration.0": "今天，镜头先于语言，让画面替你说出未尽的话。",
  "studio.inspiration.1": "把时间剪开一条缝，光就会从那里透进来。",
  "studio.inspiration.2": "一帧是一念，把念想连成故事。",
  "studio.inspiration.3": "每个故事都值得一个耐心的开始。",
  "studio.inspiration.4": "别急着回答，先让画面安静一会儿。",
  "studio.inspiration.5": "光影落下的地方，就是叙事的起点。",
  "studio.inspiration.6": "好故事不是被发现的，是被剪辑出来的。",
  "studio.inspiration.7": "从第一秒开始，让观看变成一场呼吸。",
  "studio.inspiration.8": "灵感是一阵风，剪进画面，它就停住了。",
  "studio.inspiration.9": "把日常拍成诗的，不是技巧，是目光。",
  "studio.inspiration.10": "空白也是内容，留白处有回声。",
  "studio.inspiration.11": "让节奏慢一点，情绪就会自己长出来。",
  "studio.inspiration.12": "你在意的细节，就是观众动容的瞬间。",
  "studio.inspiration.13": "今天的素材里，藏着你明天的代表作。",
  "studio.inspiration.14": "声音先到，画面随后抵达。",
  "studio.inspiration.15": "把想法落到时间轴上，它才算真正开始。",
  "studio.inspiration.16": "色彩会说话，情绪有形状。",
  "studio.inspiration.17": "好的开头是一句邀请，观众不会拒绝。",
  "studio.inspiration.18": "每一个转场，都是写给下个镜头的情书。",
  "studio.inspiration.19": "记录世界，或者创造它，都从这一帧开始。",

  // Studio 提示模板（内容面；title/description/prompt 逐语言）
  "studio.template.0.title": "把一段文字做成视频",
  "studio.template.0.description": "从你的故事或脚本开始，慢慢拼成一支短片。",
  "studio.template.0.prompt": "请根据下面这段脚本规划并制作一支完整视频。先梳理叙事结构、镜头清单和节奏，再给出可执行的生成与剪辑计划：\n\n[在这里粘贴脚本]",
  "studio.template.1.title": "给现有视频补一些画面",
  "studio.template.1.description": "补上细节和衔接画面，让故事看起来更完整。",
  "studio.template.1.prompt": "我正在制作一支视频，请为下面的内容规划并生成一组衔接主线的画面。每个画面请说明内容、运动、时长和它在故事里的作用：\n\n[描述主题、脚本或已有主镜头]",
  "studio.template.2.title": "做一支剪纸风格动画",
  "studio.template.2.description": "用纸片、纹理和手作感讲一个小故事。",
  "studio.template.2.prompt": "我想做一支剪纸风格的小动画。请帮我想好故事、画面、色彩和镜头节奏，再开始制作：[填写主题、人物、时长和想要的感觉]",
  "studio.template.3.title": "给产品拍一条短片",
  "studio.template.3.description": "把亮点、细节和使用场景讲清楚。",
  "studio.template.3.prompt": "请帮我策划一支产品发布短片。先提炼核心卖点与受众，再输出 30 秒的分镜、旁白和视觉生成提示词：\n\n[填写产品、卖点、受众和发布场景]",
  "studio.template.4.title": "做一支 Remotion 视频",
  "studio.template.4.description": "用清爽的动态画面，把一个主题讲明白。",
  "studio.template.4.prompt": "我想做一支 Remotion 视频。请根据下面的主题，帮我想好画面、文字、节奏和转场，再开始制作：[填写主题、时长、风格和想传达的重点]",
  "studio.template.5.title": "把数据讲成一支视频",
  "studio.template.5.description": "让数字、图表和结论变得一目了然。",
  "studio.template.5.prompt": "请制作一支数据解说视频。将下面的数据转成有节奏的图表动效、关键结论和旁白，并制作一支可编辑的视频：[填写数据、观点、时长和受众]",
  "studio.template.6.title": "给产品补一些好看的画面",
  "studio.template.6.description": "拍出细节、材质和真正被使用的瞬间。",
  "studio.template.6.prompt": "请为下面的产品设计一组高质感画面。覆盖开场、细节特写、使用场景与收束画面，并为每个画面写出可生成的视频提示词：[填写产品、材质、使用场景和风格参考]",
  "studio.template.7.title": "把一个人的故事剪成短片",
  "studio.template.7.description": "让采访、日常和细节连成一个故事。",
  "studio.template.7.prompt": "请把下面的人物与素材方向策划成一支人物故事短片。输出故事主线、采访问题、配套画面和剪辑节奏：[填写人物、故事、现有素材与目标时长]",
  "studio.template.8.title": "给短视频想一个好开头",
  "studio.template.8.description": "先在前三秒抓住观众，再慢慢把话讲完。",
  "studio.template.8.prompt": "请为下面的主题设计 5 个适合短视频的前三秒开场方案。每个方案包含画面、屏幕文案、旁白、音效节奏和后续画面的衔接：[填写主题、平台和目标观众]",
  "studio.template.9.title": "做一支教程演示视频",
  "studio.template.9.description": "把步骤、重点和操作过程讲得清清楚楚。",
  "studio.template.9.prompt": "请制作一支教程演示视频。根据下面的步骤规划屏幕录制、重点标注、字幕、转场和时间轴，再制作一支可编辑的视频：[填写教程主题、步骤、时长和画面素材]",
  "studio.template.10.title": "做一段循环的氛围视频",
  "studio.template.10.description": "给音乐、活动或页面添一点会呼吸的画面。",
  "studio.template.10.prompt": "请为下面的主题设计一支可无缝循环的氛围背景视频。明确镜头运动、色彩、循环衔接点和生成提示词：[填写使用场景、时长、画幅和情绪关键词]",
  "studio.template.11.title": "做一个好看的视频封面",
  "studio.template.11.description": "用一张画面先让人愿意点开。",
  "studio.template.11.prompt": "请为下面这支视频设计 3 个有吸引力的封面方向。每个方向包含构图、主体、标题文案、色彩和可直接用于生成图片的提示词：[描述视频主题与目标观众]",

  // 首访引导模板
  "studio.firstVisit.title": "第一次来这里？",
  "studio.firstVisit.description": "从认识 Recut 或做第一支视频开始。",
  "studio.firstVisit.prompt": "我是第一次使用 Recut。请用简单的话告诉我这里能做什么，并带我从一个最适合的新手视频开始。",

  // WebGL 英雄区渲染错误
  "studio.hero.texture.error": "无法创建 WebGL 磨砂纹理。",
  "studio.hero.glow.error": "无法创建 WebGL 光晕纹理。",
} as const;

const en: Record<keyof typeof zh, string> = {
  "studio.placeholder": "Studio",

  // Daily inspiration (content; rotates on a stable day-based cycle)
  "studio.inspiration.0": "Today, let the lens speak before words — let the frame say what remains unsaid.",
  "studio.inspiration.1": "Cut a slit in time and the light will come pouring through.",
  "studio.inspiration.2": "A frame is a thought; stitch thoughts into a story.",
  "studio.inspiration.3": "Every story deserves a patient beginning.",
  "studio.inspiration.4": "Don't rush to answer — let the image sit quiet for a moment.",
  "studio.inspiration.5": "Where light and shadow fall is where your narrative begins.",
  "studio.inspiration.6": "Great stories aren't found — they're cut into being.",
  "studio.inspiration.7": "From the very first second, let watching become breathing.",
  "studio.inspiration.8": "Inspiration is a breeze; cut it into the frame and it stops to stay.",
  "studio.inspiration.9": "What turns the everyday into poetry isn't technique — it's your eye.",
  "studio.inspiration.10": "Emptiness is content too; in the negative space, there's an echo.",
  "studio.inspiration.11": "Slow the rhythm and emotion will grow on its own.",
  "studio.inspiration.12": "The details you care about are the moments that move your audience.",
  "studio.inspiration.13": "Hidden in today's footage is tomorrow's signature work.",
  "studio.inspiration.14": "Sound arrives first; the picture follows.",
  "studio.inspiration.15": "An idea only truly begins once it lands on the timeline.",
  "studio.inspiration.16": "Color speaks, emotion has a shape.",
  "studio.inspiration.17": "A good opening is an invitation no viewer will refuse.",
  "studio.inspiration.18": "Every transition is a love letter to the next shot.",
  "studio.inspiration.19": "Whether you record the world or create it, it all starts with this frame.",

  // Studio prompt templates (content; title/description/prompt per language)
  "studio.template.0.title": "Turn a piece of text into a video",
  "studio.template.0.description": "Start from your story or script and piece it into a short film.",
  "studio.template.0.prompt": "Plan and produce a complete video from the script below. First map out the narrative structure, shot list and rhythm, then give an executable generation and editing plan:\n\n[Paste your script here]",
  "studio.template.1.title": "Fill in missing footage for an existing video",
  "studio.template.1.description": "Add detail and connecting shots to make the story feel complete.",
  "studio.template.1.prompt": "I'm making a video — please plan and generate a set of shots that connect the story below. For each shot, describe its content, motion, duration and role in the story:\n\n[Describe the topic, script or existing master shots]",
  "studio.template.2.title": "Make a paper-cut animation",
  "studio.template.2.description": "Tell a small story with paper, texture and a handmade feel.",
  "studio.template.2.prompt": "I'd like to make a short paper-cut animation. Help me work out the story, visuals, palette and shot rhythm before starting: [fill in topic, characters, duration and the mood you want]",
  "studio.template.3.title": "Shoot a short product film",
  "studio.template.3.description": "Clearly convey highlights, details and usage scenarios.",
  "studio.template.3.prompt": "Help me plan a product launch short. First distill the core selling points and audience, then produce a 30-second storyboard, narration and visual generation prompts:\n\n[Fill in product, selling points, audience and launch context]",
  "studio.template.4.title": "Make a Remotion video",
  "studio.template.4.description": "Explain a topic clearly with clean, dynamic visuals.",
  "studio.template.4.prompt": "I'd like to make a Remotion video. Based on the topic below, help me work out the visuals, on-screen text, rhythm and transitions, then start producing: [fill in topic, duration, style and the key points to convey]",
  "studio.template.5.title": "Turn data into a video",
  "studio.template.5.description": "Make numbers, charts and conclusions instantly clear.",
  "studio.template.5.prompt": "Produce a data-explainer video. Turn the data below into rhythmic chart animations, key takeaways and narration, and produce an editable video: [fill in data, viewpoint, duration and audience]",
  "studio.template.6.title": "Capture beautiful shots of a product",
  "studio.template.6.description": "Show detail, material and the moments it's truly used.",
  "studio.template.6.prompt": "Design a set of high-quality shots for the product below. Cover the opening, detail close-ups, usage scenarios and a closing shot, and write a generatable video prompt for each: [fill in product, materials, usage scenarios and style reference]",
  "studio.template.7.title": "Cut one person's story into a short film",
  "studio.template.7.description": "Let interviews, everyday moments and details form a story.",
  "studio.template.7.prompt": "Shape the person and footage direction below into a character-driven short. Output the story arc, interview questions, supporting shots and editing rhythm: [fill in the person, their story, existing footage and target duration]",
  "studio.template.8.title": "Come up with a great hook for a short",
  "studio.template.8.description": "Grab viewers in the first three seconds, then take your time.",
  "studio.template.8.prompt": "Design 5 first-three-second openings for a short on the topic below. Each should include the visual, on-screen text, narration, sound-effect rhythm and how it leads into the next scene: [fill in topic, platform and target audience]",
  "studio.template.9.title": "Make a tutorial / demo video",
  "studio.template.9.description": "Explain steps, key points and the process with total clarity.",
  "studio.template.9.prompt": "Produce a tutorial video. Based on the steps below, plan the screen recordings, highlights, captions, transitions and timeline, then produce an editable video: [fill in tutorial topic, steps, duration and footage]",
  "studio.template.10.title": "Create a seamlessly looping ambience video",
  "studio.template.10.description": "Add breathing visuals to music, events or a page.",
  "studio.template.10.prompt": "Design a seamlessly looping ambient background video for the topic below. Specify camera motion, palette, loop point and generation prompts: [fill in usage context, duration, aspect ratio and mood keywords]",
  "studio.template.11.title": "Design an attractive video cover",
  "studio.template.11.description": "Let a single frame make people want to click.",
  "studio.template.11.prompt": "Design 3 compelling cover directions for the video below. Each should include composition, subject, title text, palette and a prompt usable directly for image generation: [describe the video's topic and target audience]",

  // First-visit template
  "studio.firstVisit.title": "New here?",
  "studio.firstVisit.description": "Start by getting to know Recut or making your first video.",
  "studio.firstVisit.prompt": "I'm new to Recut. In simple terms, tell me what this can do and walk me through the best beginner video to start with.",

  // WebGL hero rendering errors
  "studio.hero.texture.error": "Couldn't create the WebGL frosted texture.",
  "studio.hero.glow.error": "Couldn't create the WebGL glow texture.",
};

export const studioZh = zh;
export const studioEn = en;
export type StudioDictionary = Record<Locale, typeof zh>;
