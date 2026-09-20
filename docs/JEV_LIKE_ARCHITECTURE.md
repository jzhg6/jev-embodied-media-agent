# 在这个项目中理解 Jev-like 架构

## 先区分两件事

TypeSafe 没有公开 Jev 模型内部的完整实现。因此，本项目所说的 **Jev-like** 不是复刻 Jev 的私有网络结构或 RLCD 训练过程，而是复刻适合具身智能的公开编程范式：

1. 把环境压缩成结构化 `state`；
2. 在同一次请求中提出多个窄而独立的类型化问题；
3. 接收概率而不是自然语言；
4. 在普通代码里组合概率、执行安全策略和产生副作用；
5. 执行后读取环境，验证动作是否真正生效。

`KonghaYao/laya-jev` 提供 Jev 兼容的 `/v1/systemone` 接口，可以直接替代官方服务。它不是 Jev 的权重，而是本地 Laya checkpoint 的兼容推理服务。

## 本项目的闭环

```text
摄像头帧
  │
  ├─ MediaPipe 手势分类
  └─ FaceLandmarker + 凝视校准
  │
  ▼
结构化 state
  gesture / confidence / stableMs
  gaze / dwellMs / calibrated
  media / paused / playbackRate / ready
  │
  ▼
一次 System One 请求，三个并行判断
  Choice  action                候选动作是什么
  Noul    intentional_control   是否是有意控制
  Score   signal_quality        传感信号是否可靠
  │
  ▼
确定性过滤器（普通 TypeScript）
  动作概率阈值 + 意图阈值 + 信号质量阈值
  + 手势/动作一致性 + 视频状态 + 关闭安全规则
  │
  ▼
执行器 HTMLMediaElement
  pause / play / playbackRate / close session
  │
  ▼
效果验证
  paused 与 playbackRate 是否真的改变
```

这正是“模型做模糊判断，代码做精确控制”。模型不能直接调用 `video.pause()`，也不能绕过关闭页面的本地安全条件。

## 三种类型为什么一起使用

### Choice：选哪个动作

候选集合固定为 `none`、`pause`、`play`、`speed_up`、`slow_down`、`close_page`。模型无法生成集合之外的工具名。

### Noul：是否真的想控制

单帧里出现张开的手不一定是命令，也可能只是自然动作。`intentional_control` 给出 P(true)，由代码设定是否足以自动执行。

### Score：感知信号质量

`signal_quality` 是从“不可靠”到“可靠”的有序量表。它与动作类别分开，让代码能够拒绝“类别看似正确、但证据质量很差”的输入。

## 为什么之前识别到了手掌却没暂停

旧实现有两个脆弱点：

- 在决策请求真正完成前就锁定手势；如果请求正在占用、失败或返回 `none`，同一个持续手势不会再触发。
- 只展示 MediaPipe 的类别和置信度，没有展示稳定时间、模型候选、过滤原因与执行结果，因此无法判断动作在哪一层丢失。

现在使用单槽最新状态队列，同一持续手势每 1.2 秒可重试；MediaPipe 对短暂丢帧有 240 ms 容错；执行器还会验证播放器状态。页面中的四层流水线会显示问题发生在感知、判断、过滤还是执行阶段。

## 连接本地 laya-jev

先按上游仓库说明启动服务，默认地址为 `http://127.0.0.1:8077`。然后在本项目 `.env` 中配置：

```dotenv
DECISION_PROVIDER=jev
TYPESAFE_API_KEY=local
TYPESAFE_BASE_URL=http://127.0.0.1:8077
TYPESAFE_MODEL=jev-latest
```

重新运行 `npm run dev`。界面顶部应显示 `Jev 决策服务在线`，返回的模型名通常会是具体的 `laya-*` checkpoint。

## 如何扩展到更多具身智能任务

不要直接把“照顾人的情绪”写成一个大问题。按闭环拆开：

1. 感知层输出表情、语音韵律、姿态、距离、当前任务和历史；
2. Jev-like 层并行判断情绪类别、是否需要帮助、紧急度、感知质量；
3. 代码层结合权限、环境安全、人的偏好和机器人能力过滤；
4. 执行器只接收白名单动作，例如询问、递水、调暗灯光、呼叫照护人员；
5. 通过新的视觉/语音状态确认动作结果，并记录失败原因。

具身系统里最重要的不是让模型“控制一切”，而是让每个模糊判断都有概率、每个副作用都有代码边界、每次动作都有反馈验证。

## 为什么 Open Palm 使用本地安全反射

暂停是低风险、可逆且具有保护性的动作。如果把它完全依赖于网络请求或模型过滤，服务繁忙和瞬时低置信度都会增加停止延迟。因此浏览器在 `Open_Palm` 稳定约 220 ms 后直接暂停，同时把相同状态送入 System One 做概率判断和记录。这与机器人里的急停/避障层类似：快速保护动作由本地反射保证，上层模型负责更模糊、更需要语义判断的决策。

界面的“关闭摄像头”按钮会停止所有 `MediaStreamTrack`、销毁 MediaPipe 模型并禁用凝视校准；再次启动时会重新创建视觉运行时。
