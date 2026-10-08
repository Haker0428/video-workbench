import { useEffect, useRef, useState } from "react";
import {
  Copy,
  Dices,
  FolderOpen,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import type { TaskRecord } from "../../types";
import { h3videoUrl } from "../../lib/scheme";
import { fmtBytes, fmtTime } from "../../lib/format";
import { fillFromRecord, useComposerStore } from "../../stores/composer";
import { useTasksStore } from "../../stores/tasks";
import { deleteTask, revealTaskFiles, saveThumbnail } from "../../api/commands";

interface DrawerProps {
  record: TaskRecord | null;
  onClose: () => void;
}

interface Props {
  record: TaskRecord;
  onClose: () => void;
}

export function DetailDrawer({ record, onClose }: DrawerProps) {
  return (
    <div
      className={`fixed inset-0 z-40 transition ${
        record ? "pointer-events-auto" : "pointer-events-none"
      }`}
    >
      {/* 点击左侧遮罩关闭 */}
      <div
        className={`absolute inset-0 bg-black/40 transition-opacity ${
          record ? "opacity-100" : "opacity-0"
        }`}
        onClick={onClose}
      />
      <aside
        className={`absolute right-0 top-0 flex h-full w-[560px] max-w-[90vw] flex-col border-l border-line bg-surface shadow-2xl transition-transform duration-200 ${
          record ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {record && <DetailBody record={record} onClose={onClose} />}
      </aside>
    </div>
  );
}

function DetailBody({ record, onClose }: Props) {
  const remove = useTasksStore((s) => s.remove);
  const videoRef = useRef<HTMLVideoElement>(null);
  const thumbSaved = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const playable =
    record.status === "completed" && (record.local.archived || !record.poll.lost);
  const videoFile = record.local.video_file ?? record.local.thumb_file;
  const videoUrl = videoFile ? h3videoUrl(videoFile) : null;

  // 自动截帧缩略图：首播成功后 canvas 抓 0.5s 处画面
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !playable || thumbSaved.current || record.local.thumb_file) return;
    const capture = () => {
      if (thumbSaved.current) return;
      thumbSaved.current = true;
      try {
        video.currentTime = Math.min(0.5, video.duration / 2);
        const onSeeked = () => {
          const canvas = document.createElement("canvas");
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext("2d");
          if (!ctx || !canvas.width) return;
          ctx.drawImage(video, 0, 0);
          const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
          void saveThumbnail(record.id, dataUrl).then(() => {
            // 触发记录刷新以拿到 thumb_file
            void useTasksStore.getState().load();
          });
        };
        video.addEventListener("seeked", onSeeked, { once: true });
      } catch {
        // 截帧失败不阻塞
      }
    };
    if (video.readyState >= 2) capture();
    else video.addEventListener("loadeddata", capture, { once: true });
  }, [playable, record.id, record.local.thumb_file]);

  const handleDelete = async () => {
    if (!deleteArmed) {
      setDeleteArmed(true);
      window.setTimeout(() => setDeleteArmed(false), 3000);
      return;
    }
    try {
      await deleteTask(record.id, true);
      remove(record.id);
      onClose();
    } catch (e) {
      setDeleteArmed(false);
      setDeleteError(String(e));
    }
  };

  const meta: [string, string][] = [
    ["任务 ID", record.id],
    ["生成后端", record.backend_label || record.backend_id || "Sol-H3 Spark"],
    ["服务地址", record.service_base_url ?? "-"],
    ["路由", record.routed_task.toUpperCase()],
    ["状态", statusZh(record.status)],
    [
      "任务进度",
      record.server.progress?.phase === "denoising" && record.server.progress.total_steps
        ? `${record.server.progress.current_step ?? 0} / ${record.server.progress.total_steps} 步（${Math.round(record.server.progress.percent ?? 0)}%）`
        : record.server.progress?.phase === "encoding"
          ? "视频编码中"
          : "-",
    ],
    ["Seed", record.request.seed != null ? String(record.request.seed) : "-"],
    [
      "生成参数",
      [
        record.request.width && record.request.height
          ? `${record.request.width}×${record.request.height}`
          : null,
        record.request.duration_s != null ? `${record.request.duration_s}s` : null,
        record.request.steps != null ? `${record.request.steps} 步` : null,
      ]
        .filter(Boolean)
        .join(" · ") || "后端固定",
    ],
    [
      "创建时间",
      `${fmtTime(record.created_at)}`,
    ],
    ["开始时间", fmtTime(record.server.started_at)],
    ["完成时间", fmtTime(record.server.completed_at)],
    ["总耗时", record.server.e2e_s != null ? `${record.server.e2e_s.toFixed(1)}s` : "-"],
    [
      "分阶段",
      [
        record.server.qwen_s != null ? `qwen ${record.server.qwen_s.toFixed(1)}s` : null,
        record.server.stage1_s != null ? `stage1 ${record.server.stage1_s.toFixed(1)}s` : null,
        record.server.stage2_s != null ? `stage2 ${record.server.stage2_s.toFixed(1)}s` : null,
      ]
        .filter(Boolean)
        .join(" · ") || "-",
    ],
    [
      "本地文件",
      record.local.archived
        ? `${fmtBytes(record.local.bytes_total)}（已归档）`
        : record.poll.lost
          ? "文件已丢失"
          : "仅远端",
    ],
    [
      "参考素材",
      record.routed_task === "ref2va" || record.request.ref_images.length > 0
        ? [
            record.request.ref_images.length > 0
              ? `图片×${record.request.ref_images.length}（${record.request.ref_images.map((r) => r.tag).join("/")}）`
            : null,
            record.request.ref_video_id ? "视频×1" : null,
            record.request.ref_audio_id ? "音频×1" : null,
          ]
            .filter(Boolean)
            .join(" · ") || "-"
        : "-",
    ],
  ];

  return (
    <>
      {/* 头部 */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-line px-4">
        <span className="text-sm font-medium">作品详情</span>
        <button
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-md text-ink-3 hover:bg-surface-2 hover:text-ink"
        >
          <X size={15} />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {/* 播放器 / 状态 */}
        {playable && videoUrl ? (
          <video
            ref={videoRef}
            src={videoUrl}
            controls
            autoPlay
            playsInline
            onPlay={() => setPlaying(true)}
            className="w-full rounded-lg border border-line bg-black"
          />
        ) : (
          <div className="flex aspect-video w-full items-center justify-center rounded-lg border border-line bg-surface-2 text-sm text-ink-3">
            {record.status === "failed"
              ? `生成失败：${record.server.error ?? "未知错误"}`
              : record.poll.lost && !record.local.archived
                ? "远端文件已丢失（服务重启后未及时归档）"
                : playing
                  ? "加载中…"
                  : "等待生成完成…"}
          </div>
        )}

        {/* 提示词 */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs text-ink-3">提示词</span>
            <button
              onClick={() => void navigator.clipboard.writeText(record.request.prompt)}
              className="flex items-center gap-1 text-[10px] text-ink-3 transition hover:text-ink-2"
            >
              <Copy size={10} /> 复制
            </button>
          </div>
          <div className="whitespace-pre-wrap rounded-lg border border-line bg-surface-2 p-3 text-xs leading-relaxed text-ink-2">
            {record.request.prompt}
          </div>
          {record.request.audio_desc && (
            <div className="mt-1.5 text-[10px] text-ink-3">
              音频描述：{record.request.audio_desc}
            </div>
          )}
        </div>

        {/* 元数据表 */}
        <div className="overflow-hidden rounded-lg border border-line">
          {meta.map(([k, v], i) => (
            <div
              key={k}
              className={`flex gap-3 px-3 py-1.5 text-xs ${
                i % 2 === 0 ? "bg-surface-2/50" : ""
              }`}
            >
              <span className="w-16 shrink-0 text-ink-3">{k}</span>
              <span className="min-w-0 break-all text-ink-2">{v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 底部操作 */}
      <div className="flex shrink-0 gap-2 border-t border-line p-3">
        <button
          onClick={() => fillFromRecord(record)}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-surface-2 py-2 text-xs text-ink-2 transition hover:bg-surface-3 hover:text-ink"
        >
          <RefreshCw size={13} /> 回填参数
        </button>
        <button
          onClick={() => {
            fillFromRecord(record);
            useComposerStore
              .getState()
              .setSeedInput(String(Math.floor(Math.random() * 2 ** 31)));
          }}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-surface-2 py-2 text-xs text-ink-2 transition hover:bg-surface-3 hover:text-ink"
          title="回填参数并随机新 seed"
        >
          <Dices size={13} /> 换 seed 再生成
        </button>
        <button
          onClick={() => void revealTaskFiles(record.id)}
          className="flex h-[34px] w-[38px] items-center justify-center rounded-lg bg-surface-2 text-ink-2 transition hover:bg-surface-3 hover:text-ink"
          title="打开文件夹"
        >
          <FolderOpen size={14} />
        </button>
        <button
          onClick={handleDelete}
          className={`flex h-[34px] items-center justify-center gap-1.5 rounded-lg px-3 text-xs transition ${
            deleteArmed
              ? "bg-danger text-white"
              : "w-[38px] bg-surface-2 text-danger/80 hover:bg-danger/10 hover:text-danger"
          }`}
          title={deleteError ?? (deleteArmed ? "再次点击确认删除" : "删除")}
        >
          <Trash2 size={14} /> {deleteArmed && "确认删除"}
        </button>
      </div>
    </>
  );
}

function statusZh(status: TaskRecord["status"]): string {
  return { queued: "排队中", running: "生成中", completed: "已完成", failed: "失败" }[status];
}
