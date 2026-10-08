# Ref2VA HTTP API 契约提案（工作台客户端视角）

> 状态：**提案**。当前 Sol-H3-Spark 的 HTTP API 不支持 Ref2VA（见 h3-http-api.md 第 10 节限制）。
> 本文档从客户端出发，提出与现有 T2VA/FL2VA 契约**最大程度复用**的 Ref2VA 接口形态，
> 供服务端部署侧实现时参考。工作台已按本契约完成客户端实现（对 mock 联调）。

## 设计原则

1. **任务生命周期零新增**：提交/查询/下载/健康检查完全复用 `/v1/videos`、`/v1/videos/{id}`、`/v1/videos/{id}/content`、`/health`。客户端的轮询、归档、播放链路按 task-id 寻址，与生成模式无关。
2. **独立部署**：Ref2VA 需要独立模型分区（LightX2V Ref2VA 4-step LoRA），建议独立进程/端口部署，客户端通过设置中的第二个服务地址指向。
3. **帧字段与参考字段互斥**：同一请求不得混用 `first_frame_*`/`last_frame_*` 与 `ref_*`。

## POST /v1/videos

```jsonc
{
  "prompt": "让 @人物 在 @场景 中走过并回头看镜头。",
  "seed": 42,

  // 多图参考（有序）。与 first_frame_base64 的 Data URL 约定一致：
  "ref_image_base64": [
    "data:image/png;base64,…",      // 客户端会为其维护语义标签（人物/场景/风格），标签仅存客户端
    "data:image/jpeg;base64,…"
  ],
  // 或服务端本地路径变体： "ref_image_path": ["/abs/a.png", "/abs/b.jpg"]

  // 可选视频参考（动作/运镜参考）：
  "ref_video_base64": "data:video/mp4;base64,…",
  // 可选音频参考（声音/音色参考）：
  "ref_audio_base64": "data:audio/wav;base64,…"
}
```

### 字段与限制（提案值）

| 字段 | 类型 | 必填 | 限制 |
| --- | --- | --- | --- |
| `prompt` | string | 是 | 非空 |
| `seed` | integer | 否 | 同现有契约 |
| `ref_image_base64` / `ref_image_path` | array | 否* | 最多 4 张；每张解码后 1B..16MiB；png/jpeg/webp |
| `ref_video_base64` / `ref_video_path` | string | 否 | 解码后 1B..96MiB；mp4/webm |
| `ref_audio_base64` / `ref_audio_path` | string | 否 | 解码后 1B..16MiB；wav/mp3/m4a/ogg/flac |
| `first_frame_*` / `last_frame_*` | - | 禁止 | 与 ref 字段混用返回 400 |

\* 至少提供一类参考（图片/视频/音频），否则 400。

### 请求体上限

建议上限提升到 **96MiB**（4×16MiB 图 + 16MiB 视频 + 16MiB 音频的合理组合）。
若沿用 24MiB，客户端将按 24MiB 做预算校验（当前实现按 96MiB，可配置）。

### 响应

与现有契约完全一致，`task` 固定返回 `"ref2va"`：

```json
{ "id": "…32hex…", "status": "queued", "task": "ref2va", "seed": 42, "created_at": "…" }
```

## GET /v1/videos/{id}、GET /v1/videos/{id}/content、GET /health

零改动，直接复用现有契约。`/health` 的 `task` 字段返回 `"ref2va"`。

## 客户端已实现的行为约定

- 语义标签（人物/场景/风格）仅存客户端任务记录，不随请求发送；提示词用 `@称呼` 自行指代。
- 参考素材在客户端按内容寻址（sha256 前 16 hex）落盘，可重放提交。
- 服务未配置/未就绪时，客户端禁用提交并给出引导，不打无效请求。
