import { AlertCircle, Film, Loader2 } from "lucide-react";
import { useMemo } from "react";
import type { TaskRecord } from "../../types";
import { useTasksStore } from "../../stores/tasks";
import { TASK_FILTERS, useTaskFilter } from "../../hooks/useTaskFilter";
import { h3videoUrl } from "../../lib/scheme";

interface Props {
  onOpen: (record: TaskRecord) => void;
}

/**
 * 对话模式右侧的作品栏：与工作台作品流同源（tasks store），
 * 采用窄栏友好的横向行卡呈现。
 */
export function WorksRail({ onOpen }: Props) {
  const tasks = useTasksStore((s) => s.tasks);
  const archive = useTasksStore((s) => s.archive);
  const { filter, setFilter, shown } = useTaskFilter(tasks);

  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-l border-line bg-surface">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line/60 px-3">
        <span className="text-xs font-medium text-ink-2">作品</span>
        <span className="rounded-full bg-surface-2 px-1.5 text-[10px] text-ink-3">
          {tasks.length}
        </span>
        <div className="flex-1" />
        <div className="flex gap-0.5">
          {TASK_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`rounded-full px-2 py-0.5 text-[10px] transition ${
                filter === f.key
                  ? "bg-surface-3 text-ink"
                  : "text-ink-3 hover:text-ink-2"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {shown.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <Film size={18} className="text-ink-3" />
            <div className="text-[11px] text-ink-3">
              {tasks.length === 0 ? "还没有作品" : "没有匹配的作品"}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {shown.map((t) => (
              <RailRow
                key={t.id}
                record={t}
                archiving={Boolean(archive[t.id])}
                onOpen={onOpen}
              />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

function RailRow({
  record,
  archiving,
  onOpen,
}: {
  record: TaskRecord;
  archiving: boolean;
  onOpen: (r: TaskRecord) => void;
}) {
  const thumbUrl = useMemo(() => {
    if (record.local.thumb_file) return h3videoUrl(record.local.thumb_file);
    if (record.request.first_frame_file) return h3videoUrl(record.request.first_frame_file);
    if (record.request.ref_images.length > 0)
      return h3videoUrl(record.request.ref_images[0].file);
    return null;
  }, [record]);

  return (
    <button
      onClick={() => onOpen(record)}
      className="group flex items-center gap-2.5 rounded-lg border border-transparent p-1.5 text-left transition hover:border-line hover:bg-surface-2"
    >
      {/* 缩略图 */}
      <div className="relative h-[54px] w-[96px] shrink-0 overflow-hidden rounded-md bg-surface-3">
        {record.status === "completed" && thumbUrl ? (
          <img src={thumbUrl} alt="" className="h-full w-full object-cover" draggable={false} />
        ) : record.status === "failed" ? (
          <div className="flex h-full w-full items-center justify-center">
            <AlertCircle size={14} className="text-danger" />
          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Loader2 size={14} className="animate-spin text-brand" />
          </div>
        )}
      </div>

      {/* 信息 */}
      <div className="min-w-0 flex-1">
        <div className="line-clamp-2 text-[11px] leading-snug text-ink-2">
          {record.request.prompt || "(无提示词)"}
        </div>
        <div className="mt-1 flex items-center gap-1 text-[9px]">
          <StatusDot record={record} archiving={archiving} />
          <span className="uppercase text-ink-3">{record.routed_task}</span>
          <span className="text-ink-3">
            · seed {record.request.seed ?? "-"}
          </span>
        </div>
      </div>
    </button>
  );
}

function StatusDot({ record, archiving }: { record: TaskRecord; archiving: boolean }) {
  if (archiving)
    return (
      <span className="flex items-center gap-0.5 text-brand">
        <Loader2 size={8} className="animate-spin" /> 归档
      </span>
    );
  const map: Record<string, [string, string]> = {
    queued: ["bg-brand", "text-brand"],
    running: ["bg-brand", "text-brand"],
    completed: ["bg-ok", "text-ok"],
    failed: ["bg-danger", "text-danger"],
  };
  const [dot, text] = map[record.status];
  const label =
    record.status === "queued"
      ? "排队"
      : record.status === "running"
        ? "生成中"
        : record.status === "completed"
          ? "完成"
          : "失败";
  return (
    <span className={`flex items-center gap-1 ${text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {label}
      {record.poll.lost && !record.local.archived && <span className="text-warn">· 丢失</span>}
    </span>
  );
}
