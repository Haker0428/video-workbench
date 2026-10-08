import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Copy,
  FolderOpen,
  Loader2,
  Play,
  RefreshCw,
  Trash2,
} from "lucide-react";
import type { TaskRecord } from "../../types";
import { h3videoUrl } from "../../lib/scheme";
import { fmtBytes } from "../../lib/format";
import { useTasksStore } from "../../stores/tasks";
import { fillFromRecord } from "../../stores/composer";
import { submitTask } from "../../api/commands";
import { deleteTask, revealTaskFiles } from "../../api/commands";

interface Props {
  record: TaskRecord;
  onOpen: (record: TaskRecord) => void;
}

function elapsedSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 1000;
}

export function TaskCard({ record, onOpen }: Props) {
  const archive = useTasksStore((s) => s.archive[record.id]);
  const remove = useTasksStore((s) => s.remove);
  const [, tick] = useState(0);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // queued/running 时每秒重渲计时
  const active = record.status === "queued" || record.status === "running";
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [active]);

  const thumbUrl = useMemo(() => {
    if (record.local.thumb_file) return h3videoUrl(record.local.thumb_file);
    if (record.request.first_frame_file) return h3videoUrl(record.request.first_frame_file);
    if (record.request.ref_images.length > 0)
      return h3videoUrl(record.request.ref_images[0].file);
    return null;
  }, [record.local.thumb_file, record.request.first_frame_file, record.request.ref_images]);

  const elapsed = elapsedSince(
    record.server.started_at ?? record.created_at,
  );

  const handleRetry = async () => {
    try {
      const created = await submitTask({
        prompt: record.request.prompt,
        audio_desc: record.request.audio_desc ?? null,
        seed: record.request.seed ?? null,
        width: record.request.width ?? null,
        height: record.request.height ?? null,
        duration_s: record.request.duration_s ?? null,
        steps: record.request.steps ?? null,
        first_frame_id: record.request.first_frame_id ?? null,
        last_frame_id: record.request.last_frame_id ?? null,
        ref_images: record.request.ref_images.map((item) => ({ id: item.id, tag: item.tag })),
        ref_video_id: record.request.ref_video_id ?? null,
        ref_audio_id: record.request.ref_audio_id ?? null,
      });
      useTasksStore.getState().upsert(created);
    } catch (e) {
      console.error("retry failed", e);
    }
  };

  const handleRegenerate = async () => {
    fillFromRecord(record);
  };

  const handleDelete = async () => {
    if (!deleteArmed) {
      setDeleteArmed(true);
      window.setTimeout(() => setDeleteArmed(false), 3000);
      return;
    }
    try {
      await deleteTask(record.id, true);
      remove(record.id);
    } catch (e) {
      setDeleteArmed(false);
      setDeleteError(String(e));
    }
  };

  const generation = record.server.progress;
  const progressPercent = Math.max(0, Math.min(100, generation?.percent ?? 0));
  const progressLabel = generation?.phase === "denoising" && generation.total_steps
    ? `第 ${generation.current_step ?? 0} / ${generation.total_steps} 步`
    : generation?.phase === "encoding"
      ? "视频编码中"
      : record.status === "queued"
        ? "排队中"
        : "生成中";

  const iconBtn =
    "flex h-7 w-7 items-center justify-center rounded-md bg-black/50 text-white/90 backdrop-blur transition hover:bg-black/70";

  return (
    <div
      className="group relative cursor-pointer overflow-hidden rounded-xl border border-line bg-surface-2 transition hover:border-ink-3/50"
      onClick={() => onOpen(record)}
    >
      {/* 视觉区 */}
      <div className="relative aspect-video w-full overflow-hidden bg-surface-3">
        {record.status === "completed" && (
          <>
            {thumbUrl ? (
              <img src={thumbUrl} alt="" className="h-full w-full object-cover" draggable={false} />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-surface-3 via-surface-2 to-surface-3">
                <Play size={22} className="text-ink-3" />
              </div>
            )}
            <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover:bg-black/40 group-hover:opacity-100">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white/90 text-black shadow">
                <Play size={18} className="ml-0.5" />
              </div>
            </div>
          </>
        )}
        {(record.status === "queued" || record.status === "running") && (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2">
            <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-surface-3 via-surface-2 to-surface-3" />
            <Loader2 size={20} className="z-10 animate-spin text-brand" />
            <span className="z-10 text-xs text-ink-2">{progressLabel}</span>
            {generation && (
              <div className="z-10 h-1 w-24 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-brand transition-[width] duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            )}
            <span className="z-10 text-[10px] tabular-nums text-ink-3">
              {active ? fmtElapsed(elapsed) : ""}
            </span>
          </div>
        )}
        {record.status === "failed" && (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-danger/5">
            <AlertTriangle size={20} className="text-danger" />
            <span className="max-w-[90%] truncate text-[11px] text-danger/90">
              {record.server.error ?? "生成失败"}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                void handleRetry();
              }}
              className="mt-1 flex items-center gap-1 rounded-md border border-danger/40 px-2.5 py-1 text-[11px] text-danger transition hover:bg-danger/10"
            >
              <RefreshCw size={11} /> 重试
            </button>
          </div>
        )}

        {/* 归档角标 */}
        {record.status === "completed" && (
          <div className="absolute bottom-1.5 left-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white/90 backdrop-blur">
            {archive ? (
              <span className="flex items-center gap-1">
                <Loader2 size={9} className="animate-spin" /> 归档中{" "}
                {archive.total ? Math.round(((archive.received ?? 0) / archive.total) * 100) : ""}%
              </span>
            ) : record.local.archived ? (
              `本地 · ${fmtBytes(record.local.bytes_total)}`
            ) : record.poll.lost ? (
              <span className="text-warn">文件已丢失</span>
            ) : (
              "仅远端"
            )}
          </div>
        )}
      </div>

      {/* 信息区 */}
      <div className="px-2.5 py-2">
        <div className="truncate text-xs text-ink-2" title={record.request.prompt}>
          {record.request.prompt || "(无提示词)"}
        </div>
        <div className="mt-1 flex items-center justify-between text-[10px] text-ink-3">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="uppercase">{record.routed_task}</span>
            <span className="truncate text-ink-3/70">{record.backend_label || record.backend_id}</span>
          </span>
          <span className="tabular-nums">
            seed {record.request.seed ?? "-"} · {fmtElapsedShort(elapsedSince(record.created_at))}
          </span>
        </div>
      </div>

      {/* hover 操作条 */}
      <div
        className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition group-hover:opacity-100"
        onClick={(e) => e.stopPropagation()}
      >
        {record.status === "completed" && (
          <button className={iconBtn} title="播放" onClick={() => onOpen(record)}>
            <Play size={13} />
          </button>
        )}
        <button
          className={iconBtn}
          title="再次生成（回填参数）"
          onClick={handleRegenerate}
        >
          <RefreshCw size={13} />
        </button>
        <button
          className={iconBtn}
          title="复制提示词"
          onClick={() => void navigator.clipboard.writeText(record.request.prompt)}
        >
          <Copy size={13} />
        </button>
        <button className={iconBtn} title="打开文件夹" onClick={() => void revealTaskFiles(record.id)}>
          <FolderOpen size={13} />
        </button>
        <button
          className={`${iconBtn} ${deleteArmed ? "bg-danger text-white hover:bg-danger" : ""}`}
          title={deleteError ?? (deleteArmed ? "再次点击确认删除" : "删除记录")}
          onClick={handleDelete}
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

function fmtElapsed(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function fmtElapsedShort(sec: number): string {
  if (sec < 60) return `${Math.max(0, Math.floor(sec))}s 前`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m 前`;
  return `${Math.floor(sec / 3600)}h 前`;
}
