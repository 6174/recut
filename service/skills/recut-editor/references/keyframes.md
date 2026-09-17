# 关键帧（recut.editor）

> 动画 = 关键帧的纯函数（f(t)）。禁止墙钟（rAF/spring/Date.now/performance.now/Math.random）。Preview==Export 逐帧一致的前提。

## 可动画路径

```text
transform.positionX / positionY / positionZ
transform.scaleX / scaleY / rotate
opacity
volume
color
params.<key>          # 组件参数 / graphic 参数
effects.<eid>.params.<key>
```

## D1 提交策略（param 与 transform 的关键帧落点）

`timeline.command { type:"param", payload:{ ref, params, atSec } }`：

- 路径**已有**关键帧（`element.animations[path].keys` 非空）且给 `atSec` → **在 atSec 落/更新关键帧**（插值随当前段）。
- 路径**没有**关键帧 → **写基础值** `params[path]`。
- 缩放不再清关键帧（保留既有关键帧语义）。

## keyframe-upsert

```text
timeline.command {
  type: "keyframe-upsert",
  payload: { ref, path: "opacity", atSec: 0.5, value: 0.3, segmentToNext?: "linear"|"hold"|"bezier" }
}
```

- `atSec` 是**时间线绝对秒数**（与 `insert.startSec`、`split.atSec` 相同），不是元素内秒数；写入器会减去元素 `startSec`，通道里的 `time` 始终保存为相对元素起点的 tick。不得自行换算 tick 或相对秒。
- 在 `atSec` 处插入或更新 `{ value, time }`；同路径 keys 按元素内 `time` 排序。
- `segmentToNext` 缺省 `linear`。

## keyframe-remove

```text
payload: { ref, path, atSec? }   # atSec 缺省 = 删除整条路径
```

## 读取

`element.get` 返回 `element.animations[path] = { keyCount, keys: [{ value, time, segmentToNext, … }] }`（time 为 tick）。

## 示例：标题入场 + 退场

```text
// 假设元素从时间线 4.0s 开始，持续 3.0s。
keyframe-upsert { ref, path: "opacity", atSec: 4.0, value: 0 }
keyframe-upsert { ref, path: "opacity", atSec: 4.5, value: 1 }
keyframe-upsert { ref, path: "opacity", atSec: 6.5, value: 1 }
keyframe-upsert { ref, path: "opacity", atSec: 7.0, value: 0 }
keyframe-upsert { ref, path: "transform.positionY", atSec: 4.0, value: -200 }
keyframe-upsert { ref, path: "transform.positionY", atSec: 7.0, value: 0 }
```
