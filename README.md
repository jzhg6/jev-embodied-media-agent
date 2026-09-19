# Jev Embodied Media Agent

一个隐私优先的人机交互原型：浏览器摄像头在本地识别手势与凝视，Jev 从受限动作空间中选择媒体控制操作。

## 交互

| 输入 | 动作 |
| --- | --- |
| 张开手掌 `Open_Palm` | 暂停 |
| 握拳 `Closed_Fist` | 继续播放 |
| 拇指向上 `Thumb_Up` | 加速 0.25× |
| 拇指向下 `Thumb_Down` | 减速 0.25× |
| 校准后持续凝视右上角 3 秒 | 尝试关闭页面；被浏览器拦截时关闭应用会话 |

关闭操作被设计成两个连续阶段：1.5 秒后进入可见的 armed 状态，继续凝视到 3 秒才允许 Jev 选择 `close_page`；视线移开会立即取消。未经中心与右上角双点校准，关闭动作永远不可用。

## 架构

```text
camera frame (never uploaded)
        │
        ├─ MediaPipe GestureRecognizer ─ gesture + confidence
        └─ MediaPipe FaceLandmarker ──── gaze blendshapes + dwell
                                            │
                                     structured state only
                                            │
                                  POST /api/decision
                                            │
                          Jev / compatible local endpoint
                                            │
                           typed action + probabilities
                                            │
                         local irreversible-action guard
                                            │
                                  HTML media controller
```

`server/jev-client.ts` 调用 TypeSafe 兼容的 `POST /v1/systemone`。没有 API key 时，应用使用 `rule` provider；它不是模型，而是一个离线 Jev 契约模拟器，便于验证完整 UI、传感和安全链路。

## 运行

需要 Node.js 22 或更新版本，以及支持 WebAssembly、WebGL 和摄像头权限的现代浏览器。

```bash
npm install
copy .env.example .env
npm run dev
```

打开 <http://127.0.0.1:5173>，选择本地视频，然后启动摄像头。

首次运行会从 Google MediaPipe 模型存储下载 Gesture Recognizer 和 Face Landmarker。画面只在浏览器本地处理。

## 使用真实 Jev

编辑 `.env`：

```dotenv
DECISION_PROVIDER=jev
TYPESAFE_API_KEY=your-key
TYPESAFE_BASE_URL=https://api.typesafe.ai
TYPESAFE_MODEL=jev-latest
```

也可以指向兼容 `/v1/systemone` 的本地服务：

```dotenv
DECISION_PROVIDER=jev
TYPESAFE_API_KEY=local
TYPESAFE_BASE_URL=http://127.0.0.1:8077
TYPESAFE_MODEL=jev-latest
```

API key 只保存在服务端环境变量中，不会发送到前端。

## 验证

```bash
npm run check
```

测试覆盖手势稳定时间、关闭门控和 Jev 请求动作集合。构建检查同时运行严格 TypeScript 类型检查。

## 设计限制

- MediaPipe 的内置手势类别有限，遮挡、逆光与手离镜头过远都会降低可靠性。
- 凝视是通过双点个体校准后的 blendshape 特征近似，不是医疗或眼动仪级测量。
- 普通网页通常不能关闭不是由脚本打开的标签页，因此应用会调用 `window.close()`，失败后显示“会话已关闭”界面。
- 模型只能在候选动作中选择，但仍可能选错；关闭动作在服务端和浏览器端都重复校验。
- 当前原型只控制用户主动载入的本地视频，不读取或控制其他标签页。

## License

MIT
