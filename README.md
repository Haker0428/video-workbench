# H3 视频生成工作台

本地部署的 [Sol-H3-Spark](doc/h3-http-api.md) 视频生成桌面客户端（Tauri 2 + React）。

UI 参考「即梦」：暗色主题，左侧创作面板 + 右侧作品流。服务端 API 见 [doc/h3-http-api.md](doc/h3-http-api.md)。

## 功能

- **侧边栏双模式**（H3 视频分组，后续可扩展图像生成等新分组）：
  - **工作台**：即梦式创作面板 + 作品流（下述功能的主入口）
  - **对话生成**：聊天式输入框（随心输入 + 附件），按附件**自动识别生成模式**——纯文字 → 文生视频、1~2 张图 → 首尾帧、更多素材/视频/音频 → 参考生成；识别结果以标签展示，发送前可点击切换为手动指定。会话历史本地持久化（chats.json），任务以卡片内嵌在对话中实时更新状态
- **服务状态**：顶栏实时轮询 `/health`，展示运行中 / 预热进度（11 个启动阶段中文映射 + 剩余时间）/ 已断开 / 服务异常
- **远端控制**：通过本机现有 SSH 配置启动/停止 Spark 服务；启动后自动轮询 Tailscale API，展示阶段、百分比、已用时间和预计剩余
- **多后端切换**：顶栏选择 Sol-H3 Spark 或 GB10；任务记录提交时的后端与 URL，切换后仍从原服务轮询、播放和归档
- **文生视频（T2VA）**：提示词 + 可选音频描述（自动拼接 `overall_soundscape:`）+ seed（骰子随机 / 沿用上次）
- **首尾帧（FL2VA）**：首帧/尾帧上传（点击或拖拽，png/jpg/webp ≤16MiB，本地落盘内容寻址去重）
- **参考生成（Ref2VA）**：多图参考（≤4 张，可打「人物/场景/风格」标签）+ 可选视频/音频参考；需要独立部署的 Ref2VA 服务（契约提案见 [doc/ref2va-http-api-proposal.md](doc/ref2va-http-api-proposal.md)），在设置中添加服务地址后启用
- **作品流**：任务卡片四态（排队 / 生成中计时 / 完成缩略图 / 失败重试），筛选与搜索，详情抽屉（播放器 + 各阶段耗时元数据）
- **本地归档**：任务完成后自动下载 MP4 到本地（可关），H3 服务重启导致远端文件丢失（410）不影响已归档作品；未归档时播放走远端代理
- **任务历史**：本地 JSON 持久化，重启应用不丢；支持回填参数再次生成、删除记录、打开所在文件夹

## 启动开发环境

```bash
# 1. 启动 mock H3 服务（默认与真实服务同端口 127.0.0.1:30010）
pnpm mock                        # 可加参数：--startup-secs 60 --gen-secs 15 --fail-rate 0.2 --lose-files --fatal
# 如需联调 Ref2VA 模式，再起一个独立实例（对齐真实部署形态）：
node mock/server.mjs --port 30011 --task ref2va

# 2. 启动工作台
pnpm tauri dev
```

然后在应用设置里添加 Ref2VA 服务地址 `http://127.0.0.1:30011`。

联调真实 H3 服务：应用设置里把服务地址改为 GPU 服务器地址（当前 Spark Tailscale 地址为 `http://100.64.52.42:30010`），必要时填 API Key。远端启动配置与 GB10 接入契约见 [doc/backend-control.md](doc/backend-control.md)。

## 构建

```bash
pnpm tauri build   # 产出 .dmg / .app
```

## 架构

```
mock/server.mjs        零依赖 mock H3 服务（开发用，可模拟预热/失败/丢文件）
src/                   React 前端（zustand 状态 + invoke 封装）
src-tauri/src/
  ├── h3/              reqwest H3 客户端（health/submit/query/download）
  ├── store.rs         任务历史 JSON 模型 + 原子持久化（tasks.json）
  ├── archiver.rs      自动归档下载（去重、.part→rename、进度事件）
  ├── protocol.rs      h3video:// 自定义协议（本地 Range 流式 + 远端代理）
  └── commands/        Tauri 命令层（settings/health/tasks）
```

`scripts/remote/sol_h3_service.sh` 是部署到 Spark 的服务管理脚本。它使用 PID 文件和独立进程组管理常驻服务，为每次启动创建唯一输出目录与日志。

数据目录（macOS）：`~/Library/Application Support/com.h3.workbench/`

```
config.json            服务地址 / API Key / 自动归档开关
tasks.json             任务历史（含原始参数，支持重试/再次生成）
chats.json             对话生成模式的会话历史
frames/  refs/  videos/  thumbs/   上传帧、参考素材、归档视频、缩略图
```

### 关键设计

- **播放统一走 `h3video://`**：本地归档文件按 Range/206 流式响应（每次过量供给 ≥1MiB，对抗 WKWebView 碎片请求）；本地缺失时由 Rust 代理转发远端 `/content`，前端无感
- **轮询 fan-out**：单条 `poll_tasks` 命令并发查询所有活跃任务；前端 3s 节奏，终态停轮
- **任务后端快照**：每条任务保存 `backend_id`、后端名称和提交 URL；轮询、播放代理与归档不依赖当前选中的后端
- **代理隔离**：Rust HTTP 客户端不继承系统 HTTP 代理，Tailscale/LAN 地址始终直连
- **原子写**：`tasks.json` / `config.json` 经临时文件 rename 落盘；解析失败自动备份后空库启动
