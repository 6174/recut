# 生成提示词模板（Generation Prompt Template）

> 本文件归 `references/generation-prompt` 所有，是产出自检的填写形态。规则与边界见同级 `SKILL.md`；`<reference>` 标签属性、role 词表与编号规则见 SKILL.md《参考锚点表达规则》。

## 填写顺序

固定五段，顺序不可调换：

1. `[STYLE LOCK]`——冻结风格全文，逐字复用；
2. `参考锚定表`——每条 `<reference>` + 角色声明；
3. `音轨`——环境底声 / 动作声 / 对白 / BGM；
4. `镜头序列`——每镜一信息变化、一起止状态、一主导运动；
5. `[负面约束]`——本片/本镜真实风险，约 4–6 类。

## 骨架

```text
[STYLE LOCK]
<stock/胶片/LUT/颗粒/镜头/画幅/光比/调色/氛围/物理规则，逐字冻结>

参考锚定表
<reference id="__" kind="image" role="pov"        label="__" /> 作为 __ 视角锚定。
<reference id="__" kind="image" role="color-card" label="__" /> 作为整段画面色卡锚定，所有色彩严格按色卡执行。
<reference id="__" kind="image" role="environment" label="__" /> 作为环境视角锚定。
<reference id="__" kind="image" role="character"  label="__" /> 作为 __ 视觉锚定。
<reference id="__" kind="audio" role="voice"      label="__" /> 作为 __ 音色锚定。

音轨
<持续环境底声；动作触发音效按因果发生；对白位于前景、清晰可懂；BGM 有无。>

第 1 镜，约 X 秒。<景别/机位>。<主体起始状态> → <单一可见变化与运镜> → <结束状态>。
第 2 镜，约 X 秒。<从第 1 镜结束状态承接>。<……> → <……> → <结束状态>。
（段落切换默认 HARD CUT）

[负面约束]
<具体对象 4–6 类；通用：无文字/字幕/签名/水印/UI/图标/电量/时间>
```

## 提交形态（resolver 输出）

正文里的 `<reference>` 在提交时被改写为组内编号别名：

```text
参考图1 作为执明视角锚定。
参考图2 作为整段画面色卡锚定，所有色彩严格按色卡执行。
参考图3 作为环境视角锚定。
参考图4 作为丹朱视觉锚定。
音频1 仅用于参考执明的音色特征。
```

同时提交 `referenceIds = [a1, a8, a2, a3, a6]`（image 段按编号顺序 + audio 段），顺序与别名编号严格一致。

## 自检清单

- [ ] STYLE LOCK 逐字复用，未被单镜改写
- [ ] 每条引用有 id/kind/role/label，role↔kind 匹配
- [ ] 正文 token 与 referenceIds 顺序一致
- [ ] 每 role 只声明一次，后续以编号复指
- [ ] 每镜一信息变化、一起止状态、一主导运动，HARD CUT 已标
- [ ] 对白逐字，音色「仅作参考」，声音因果正确
- [ ] 负面项具体、约 4–6 类
- [ ] 正文无 ratio/resolution/时长/modeType 等技术参数
- [ ] 无未绑定锚点、无类别式负面词、无空泛质量词

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
