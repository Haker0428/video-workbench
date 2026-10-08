# H3 Video Workbench

面向本地或私有化 H3 视频生成服务的桌面工作台。项目基于 **Tauri 2 + React + TypeScript**，提供统一的创作、任务追踪、视频预览和本地归档体验。

> 当前版本：`0.1.0`。本仓库是客户端与开发用 Mock 服务，不包含模型权重或 H3 推理服务。

## 项目亮点

- **三种生成模式**：文生视频（T2VA）、首尾帧生成（FL2VA）和多素材参考生成（Ref2VA）。
- **工作台与对话双入口**：既可使用结构化创作面板，也可在对话中通过提示词和附件发起任务。
- **自动识别任务类型**：根据附件数量与类型推断生成模式，同时允许手动切换。
- **多后端管理**：可在多个 H3 服务之间切换；每个任务保留提交时的后端快照。
- **完整任务生命周期**：展示排队、生成、完成和失败状态，支持搜索、筛选、重试与再次生成。
- **本地可靠归档**：生成完成后可自动下载视频；远端文件失效时仍可播放本地副本。
- **服务状态可视化**：轮询健康状态和预热进度，并展示阶段、耗时与预计剩余时间。
- **开发友好的 Mock 服务**：可模拟预热、生成、失败和远端文件丢失等场景。

## 界面与工作流

```text
输入提示词 / 添加素材
          │
          ▼
自动识别 T2VA / FL2VA / Ref2VA
          │
          ▼
提交到选定的 H3 后端
          │
          ▼
轮询状态 ──► 预览结果 ──► 本地归档
```

任务既可以从“工作台”创建，也可以嵌入“对话生成”的会话流中。会话、任务和设置均保存在本地。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 桌面容器 | Tauri 2 |
| 前端 | React 19、TypeScript、Vite |
| 样式 | Tailwind CSS |
| 状态管理 | Zustand |
| 本地能力 | Rust、Tokio、Reqwest |
| 数据存储 | 本地 JSON 文件 |
| 视频访问 | 自定义 `h3video://` 协议 |

## 快速开始

### 环境要求

- Node.js 22
- pnpm
- Rust stable
- Tauri 对应平台的系统依赖

### 安装依赖

```bash
pnpm install
```

### 使用 Mock 服务开发

先启动开发用 H3 服务：

```bash
pnpm mock
```

另开一个终端启动桌面应用：

```bash
pnpm tauri dev
```

Mock 服务默认监听 `http://127.0.0.1:30010`。可通过参数模拟不同状态：

```bash
node mock/server.mjs \
  --port 30010 \
  --startup-secs 60 \
  --gen-secs 15 \
  --fail-rate 0.2 \
  --lose-files
```

如需联调 Ref2VA，可再启动一个独立实例：

```bash
node mock/server.mjs --port 30011 --task ref2va
```

随后在应用设置中添加 `http://127.0.0.1:30011`。

### 连接真实服务

在应用设置中填写兼容的 H3 HTTP 服务地址，并按需配置 API Key。接口约定见 [H3 HTTP API](doc/h3-http-api.md)；多后端与远端控制说明见 [后端控制设计](doc/backend-control.md)。

请勿将真实 API Key、内网地址或个人配置提交到仓库。

## 构建

前端类型检查与生产构建：

```bash
pnpm build
```

构建桌面安装包：

```bash
pnpm tauri build
```

产物位置由 Tauri 决定，通常位于 `src-tauri/target/release/bundle/`。

## 项目结构

```text
.
├── src/                        React 前端
│   ├── api/                    Tauri 命令与事件封装
│   ├── components/             创作、对话、作品流和设置界面
│   ├── hooks/                  健康检查、归档事件与任务筛选
│   ├── lib/                    文件、格式化与模式识别工具
│   └── stores/                 Zustand 状态
├── src-tauri/
│   ├── src/commands/           设置、健康检查、任务与对话命令
│   ├── src/h3/                 H3 HTTP 客户端
│   ├── src/archiver.rs         自动归档
│   ├── src/protocol.rs         h3video:// 视频协议
│   └── src/store.rs            本地任务存储
├── mock/                       开发用 H3 Mock 服务
├── scripts/remote/             远端服务管理脚本
└── doc/                        API 与后端设计文档
```

## 本地数据

macOS 默认数据目录：

```text
~/Library/Application Support/com.h3.workbench/
├── config.json                 服务地址、API Key 与归档设置
├── tasks.json                  任务历史
├── chats.json                  对话历史
├── frames/                     首尾帧素材
├── refs/                       参考素材
├── videos/                     已归档视频
└── thumbs/                     缩略图
```

## 关键设计

- **统一播放链路**：本地文件和远端内容均通过 `h3video://` 访问；本地视频支持 Range 请求。
- **并发轮询**：单次命令并发查询全部活跃任务，终态任务自动停止轮询。
- **后端快照**：轮询、播放和归档使用任务创建时记录的后端，不受当前选择变化影响。
- **代理隔离**：Rust HTTP 客户端不继承系统代理，便于稳定访问局域网或私有网络服务。
- **原子持久化**：配置和任务文件先写临时文件再替换，解析失败时保留备份。
- **内容寻址**：上传素材按内容去重，减少重复存储。

## 相关文档

- [H3 HTTP API](doc/h3-http-api.md)
- [后端控制与多后端设计](doc/backend-control.md)
- [Ref2VA HTTP API 提案](doc/ref2va-http-api-proposal.md)
