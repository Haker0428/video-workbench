# Sol-H3-Spark HTTP API

本文档对应当前部署目录：

```text
/home/nvidia/models/Sana/models/minimax_h3/Sol-H3-Spark
```

当前 HTTP 服务支持：

- T2VA：纯文本生成视频和同步音频。
- FL2VA：使用首帧、尾帧或首尾帧生成视频和同步音频。
- Hybrid：同一常驻进程自动处理 T2VA 和 FL2VA 请求。

当前 HTTP API **不支持 Ref2VA 多参考输入**。人物参考图、场景参考图、参考视频和参考音频仍需使用 Ref2VA 离线入口，或另行部署 Ref2VA 服务。

## 1. 服务特性

- 模型加载完成后常驻显存/统一内存，后续请求不重复加载权重。
- 启动期间 HTTP 监听已经可用，可通过 `/health` 查看预热进度。
- 单张 Spark GPU 使用一个串行任务队列；可同时提交多个任务，但生成按顺序执行。
- Hybrid 模式下：
  - 不传任何帧字段时，自动路由为 `t2va`。
  - 传入任意首帧或尾帧字段时，自动路由为 `fl2va`。
- 输出为带同步音频的 MP4。

## 2. 启动服务

### 2.1 推荐：Hybrid 模式

```bash
cd /home/nvidia/models/Sana/models/minimax_h3/Sol-H3-Spark
conda activate sol-s1

export SOL_H3_SPARK_RUNTIME_ROOT=/home/nvidia/sol-h3-runtime
export SOL_H3_SPARK_QWEN_IMAGE=sol-h3-spark-qwen

python3 serve.py \
  --paths paths.json \
  --task hybrid \
  --warmup-image /home/nvidia/sol-h3-runtime/inputs/warmup.png \
  --host 127.0.0.1 \
  --port 30010 \
  --output-dir /home/nvidia/sol-h3-runtime/outputs/hybrid-service-001
```

注意：

- `--warmup-image` 必须是服务端存在的图片，用于 FL2VA 启动预热。
- `--output-dir` 必须是尚不存在的新目录，每次重启需要更换名称。
- Hybrid 会依次预热 FL2VA、Stage2 和 T2VA。实测首次冷启动约 `507.84s`，默认 ETA 为 `540s`。

### 2.2 T2VA-only 模式

```bash
python3 serve.py \
  --paths paths.json \
  --task t2va \
  --host 127.0.0.1 \
  --port 30010 \
  --output-dir /home/nvidia/sol-h3-runtime/outputs/t2va-service-001
```

T2VA 模式不能设置 `--warmup-image`，也不接受图片请求字段。

### 2.3 FL2VA-only 模式

```bash
python3 serve.py \
  --paths paths.json \
  --task fl2va \
  --warmup-image /home/nvidia/sol-h3-runtime/inputs/warmup.png \
  --host 127.0.0.1 \
  --port 30010 \
  --output-dir /home/nvidia/sol-h3-runtime/outputs/fl2va-service-001
```

FL2VA 模式的每个生成请求都必须提供首帧、尾帧或两者。

### 2.4 启动参数

| 参数 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `--paths` | 是 | - | 运行时路径配置 JSON。 |
| `--output-dir` | 是 | - | 本次服务的新输出目录，不能覆盖已有目录。 |
| `--host` | 否 | `127.0.0.1` | HTTP 监听地址。 |
| `--port` | 否 | `30010` | HTTP 监听端口。 |
| `--task` | 否 | `t2va` | `t2va`、`fl2va` 或 `hybrid`。 |
| `--api-key` | 否 | 环境变量 | Bearer Token；默认读取 `SOL_H3_SPARK_API_KEY`。 |
| `--warmup-prompt` | 否 | 内置提示词 | 启动预热使用的提示词。 |
| `--warmup-image` | 条件必填 | - | `fl2va` 和 `hybrid` 必填；`t2va` 禁止。 |
| `--startup-estimate-seconds` | 否 | 单模式 `330`、Hybrid `540` | `/health` 显示的启动 ETA。 |

## 3. 鉴权

不设置 API Key 时，接口无需鉴权。设置方式：

```bash
export SOL_H3_SPARK_API_KEY='your-secret'
```

也可以在启动时传入：

```bash
python3 serve.py ... --api-key 'your-secret'
```

除 `/health` 外，所有 `/v1/videos` 接口都需要：

```http
Authorization: Bearer your-secret
```

下文示例省略鉴权头；启用 API Key 后，在每条 `/v1/videos` 请求中增加：

```bash
-H "Authorization: Bearer $SOL_H3_SPARK_API_KEY"
```

## 4. 健康检查与预热进度

### `GET /health`

该接口不需要鉴权。

```bash
curl --noproxy '*' -sS http://127.0.0.1:30010/health
```

启动中的响应示例：

```json
{
  "status": "loading",
  "task": "hybrid",
  "created_at": "2026-09-30T06:06:32.082493+00:00",
  "queue_depth": 0,
  "startup": {
    "phase": "running_stage2_warmup",
    "percent": 72,
    "detail": "Compiling and running the three-update LTX warmup",
    "started_at": "2026-09-30T06:06:32.082500+00:00",
    "completed_at": null,
    "elapsed_s": 290.822,
    "estimated_total_s": 540.0,
    "estimated_remaining_s": 249.178
  },
  "error": null
}
```

可接收请求时：

```json
{
  "status": "ready",
  "task": "hybrid",
  "queue_depth": 0,
  "startup": {
    "phase": "ready",
    "percent": 100,
    "detail": "All model workers are resident and ready",
    "elapsed_s": 507.84,
    "estimated_total_s": 540.0,
    "estimated_remaining_s": 0.0
  },
  "error": null
}
```

主要启动阶段：

| `phase` | 进度 | 含义 |
| --- | ---: | --- |
| `waiting` | 0 | 等待开始加载。 |
| `loading_stage1` | 5 | 加载 MiniMax-H3 Stage1。 |
| `loading_warmup_qwen` | 18 | 加载临时 Qwen worker。 |
| `encoding_warmup_prompt` | 25 | 编码预热提示词。 |
| `running_stage1_warmup` | 32 | 执行 Stage1 预热。 |
| `loading_stage2` | 56 | 加载 LTX Stage2。 |
| `preparing_stage2` | 68 | 准备 Stage2 固定形状请求。 |
| `running_stage2_warmup` | 72 | 编译并执行 Stage2 预热。 |
| `loading_resident_qwen` | 94 | 加载常驻 Qwen。 |
| `running_t2va_warmup` | 96 | Hybrid 专用：预热无图片 T2VA 路径。 |
| `ready` | 100 | 模型常驻并可接收任务。 |
| `failed` | 当前值 | 启动失败，原因见 `error` 和 `detail`。 |

HTTP 状态码：

- `200`：服务正在加载或已经就绪。
- `503`：服务启动失败、停止中或已停止。

## 5. 提交生成任务

### `POST /v1/videos`

请求头：

```http
Content-Type: application/json
```

请求体必须是 JSON 对象，最大 `24 MiB`。

### 5.1 T2VA 请求

Hybrid 或 T2VA-only 服务均可使用：

```bash
curl --noproxy '*' --fail-with-body -sS \
  -X POST http://127.0.0.1:30010/v1/videos \
  -H 'Content-Type: application/json' \
  --data '{
    "prompt": "A cinematic city street at night in heavy rain. The camera slowly moves forward. overall_soundscape: Rain, distant traffic and footsteps.",
    "seed": 42
  }'
```

### 5.2 FL2VA：服务端本地图片

图片路径必须是 Spark 服务器上的绝对路径，且文件必须存在。

仅首帧：

```bash
curl --noproxy '*' --fail-with-body -sS \
  -X POST http://127.0.0.1:30010/v1/videos \
  -H 'Content-Type: application/json' \
  --data '{
    "prompt": "The camera slowly approaches the subject while the person turns toward the lens.",
    "seed": 42,
    "first_frame_path": "/home/nvidia/sol-h3-runtime/inputs/first.png"
  }'
```

首尾帧：

```bash
curl --noproxy '*' --fail-with-body -sS \
  -X POST http://127.0.0.1:30010/v1/videos \
  -H 'Content-Type: application/json' \
  --data '{
    "prompt": "The character walks across the room and stops beside the window.",
    "seed": 42,
    "first_frame_path": "/home/nvidia/sol-h3-runtime/inputs/first.png",
    "last_frame_path": "/home/nvidia/sol-h3-runtime/inputs/last.png"
  }'
```

也可以仅提供 `last_frame_path`。

### 5.3 FL2VA：Base64 图片

远程客户端可以传原始 Base64 字符串或 Data URL：

```json
{
  "prompt": "Animate the supplied frame with subtle natural motion.",
  "seed": 42,
  "first_frame_base64": "data:image/png;base64,iVBORw0KGgoAAA..."
}
```

支持的 Data URL MIME 类型：

- `image/png`
- `image/jpeg`
- `image/webp`

每张图片 Base64 解码后的大小必须在 `1 byte` 到 `16 MiB` 之间。

同一位置不能同时传路径和 Base64，例如以下组合非法：

```json
{
  "first_frame_path": "/path/first.png",
  "first_frame_base64": "..."
}
```

### 5.4 请求字段

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `prompt` | string | 是 | 非空生成提示词。 |
| `seed` | integer | 否 | 默认 `42`；范围 `0 <= seed < 2^63`。 |
| `first_frame_path` | string | 否 | 服务端首帧绝对路径。 |
| `last_frame_path` | string | 否 | 服务端尾帧绝对路径。 |
| `first_frame_base64` | string | 否 | 首帧 Base64 或 Data URL。 |
| `last_frame_base64` | string | 否 | 尾帧 Base64 或 Data URL。 |

字段限制：

- T2VA-only 服务只接受 `prompt`、`seed`。
- FL2VA-only 服务接受帧字段，并要求至少提供一张首帧或尾帧。
- Hybrid 服务接受全部字段，根据是否存在帧字段自动选择 T2VA/FL2VA。
- 未声明的字段会返回 `400 unsupported fields`。

### 5.5 提交响应

成功提交返回 `202 Accepted`：

```json
{
  "id": "c4a744a803054f9799e696e31223e17d",
  "status": "queued",
  "task": "fl2va",
  "seed": 42,
  "created_at": "2026-09-30T04:53:23.873946+00:00"
}
```

`task` 是服务实际选择的路由。在 Hybrid 模式中应检查该字段确认请求走的是 `t2va` 还是 `fl2va`。

## 6. 查询任务状态

### `GET /v1/videos/{id}`

```bash
TASK_ID='c4a744a803054f9799e696e31223e17d'

curl --noproxy '*' --fail-with-body -sS \
  "http://127.0.0.1:30010/v1/videos/$TASK_ID"
```

任务状态：

| 状态 | 含义 |
| --- | --- |
| `queued` | 已进入队列，等待前面的任务完成。 |
| `running` | 正在生成。 |
| `completed` | MP4 已生成，可以下载。 |
| `failed` | 生成失败，查看 `error`。 |

运行中示例：

```json
{
  "id": "c4a744a803054f9799e696e31223e17d",
  "status": "running",
  "task": "t2va",
  "seed": 42,
  "created_at": "2026-09-30T04:53:23.873946+00:00",
  "started_at": "2026-09-30T04:53:24.018112+00:00"
}
```

完成示例：

```json
{
  "id": "c4a744a803054f9799e696e31223e17d",
  "status": "completed",
  "task": "t2va",
  "seed": 42,
  "created_at": "2026-09-30T04:53:23.873946+00:00",
  "started_at": "2026-09-30T04:53:24.018112+00:00",
  "completed_at": "2026-09-30T04:54:31.225300+00:00",
  "e2e_s": 67.207,
  "qwen_s": 2.1,
  "stage1_s": 18.4,
  "stage2_s": 46.3,
  "output_url": "/v1/videos/c4a744a803054f9799e696e31223e17d/content"
}
```

失败示例：

```json
{
  "id": "c4a744a803054f9799e696e31223e17d",
  "status": "failed",
  "task": "fl2va",
  "seed": 42,
  "created_at": "2026-09-30T04:53:23.873946+00:00",
  "started_at": "2026-09-30T04:53:24.018112+00:00",
  "completed_at": "2026-09-30T04:53:30.110000+00:00",
  "error": "RuntimeError: ..."
}
```

简单轮询脚本：

```bash
TASK_ID='替换为提交响应中的 id'

while true; do
  RESPONSE="$(curl --noproxy '*' --fail-with-body -sS \
    "http://127.0.0.1:30010/v1/videos/$TASK_ID")" || break
  echo "$RESPONSE"
  STATUS="$(printf '%s' "$RESPONSE" | jq -r '.status')"
  case "$STATUS" in
    completed|failed) break ;;
  esac
  sleep 5
done
```

## 7. 下载生成视频

### `GET /v1/videos/{id}/content`

任务状态为 `completed` 后下载：

```bash
curl --noproxy '*' --fail-with-body -sS \
  -o output.mp4 \
  "http://127.0.0.1:30010/v1/videos/$TASK_ID/content"
```

成功响应：

```http
HTTP/1.1 200 OK
Content-Type: video/mp4
Content-Disposition: attachment; filename="TASK_ID.mp4"
```

任务尚未完成时返回 `409 Conflict`：

```json
{"error":"task is running"}
```

## 8. HTTP 状态码

| 状态码 | 场景 |
| ---: | --- |
| `200` | 健康检查、任务查询或视频下载成功。 |
| `202` | 生成任务已进入队列。 |
| `400` | JSON、字段、提示词、seed、图片路径或 Base64 不合法。 |
| `401` | Bearer Token 缺失或不正确。 |
| `404` | 路由不存在或任务 ID 不存在。 |
| `409` | 请求下载尚未完成的任务。 |
| `410` | 任务已完成，但磁盘上的输出文件已丢失。 |
| `503` | 服务尚未 ready、启动失败、停止中，或生成链路发生致命错误。 |

错误响应统一采用：

```json
{"error":"错误描述"}
```

## 9. 完整调用流程

```bash
API_URL='http://127.0.0.1:30010'

# 1. 等待服务 ready
while true; do
  HEALTH="$(curl --noproxy '*' -sS "$API_URL/health")" || exit 1
  echo "$HEALTH"
  STATUS="$(printf '%s' "$HEALTH" | jq -r '.status')"
  [ "$STATUS" = 'ready' ] && break
  [ "$STATUS" = 'error' ] && exit 1
  sleep 5
done

# 2. 提交纯文本任务
SUBMIT="$(curl --noproxy '*' --fail-with-body -sS \
  -X POST "$API_URL/v1/videos" \
  -H 'Content-Type: application/json' \
  --data '{"prompt":"A cinematic sunrise over the ocean.","seed":42}')"
echo "$SUBMIT"
TASK_ID="$(printf '%s' "$SUBMIT" | jq -r '.id')"

# 3. 等待任务完成
while true; do
  RESULT="$(curl --noproxy '*' --fail-with-body -sS \
    "$API_URL/v1/videos/$TASK_ID")" || exit 1
  echo "$RESULT"
  STATUS="$(printf '%s' "$RESULT" | jq -r '.status')"
  [ "$STATUS" = 'completed' ] && break
  [ "$STATUS" = 'failed' ] && exit 1
  sleep 5
done

# 4. 下载 MP4
curl --noproxy '*' --fail-with-body -sS \
  -o "$TASK_ID.mp4" \
  "$API_URL/v1/videos/$TASK_ID/content"
```

## 10. 当前限制

- 没有任务列表接口。
- 没有取消、删除或重试接口。
- 没有 webhook；客户端需要轮询任务状态。
- 一个服务进程内的生成任务串行执行。
- 图片条件仅表示 FL2VA 首帧/尾帧，不是人物或场景语义参考。
- Ref2VA 多图片、视频、音频参考尚未暴露为 HTTP API。
- 任意生成任务发生致命异常后，服务会进入 `error`，后续排队任务会失败，需要排查日志后重启服务。

## 11. 停止服务

前台运行时按 `Ctrl+C`。服务会先关闭 HTTP 监听，再释放 Qwen、Stage1 和 Stage2；模型释放可能需要约数十秒，请等待进程自然退出。

从另一个终端发送终止信号时，先找到服务 PID，再发送 `SIGTERM`：

```bash
ps -ef | grep '[s]erve.py'
kill -TERM <PID>
```

