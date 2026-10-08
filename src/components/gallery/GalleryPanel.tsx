import { Film } from "lucide-react";
import type { TaskRecord } from "../../types";
import { useTasksStore } from "../../stores/tasks";
import { TaskCard } from "./TaskCard";
import { TASK_FILTERS, useTaskFilter } from "../../hooks/useTaskFilter";

interface Props {
  onOpen: (record: TaskRecord) => void;
}

export function GalleryPanel({ onOpen }: Props) {
  const tasks = useTasksStore((s) => s.tasks);
  const loaded = useTasksStore((s) => s.loaded);
  const { filter, setFilter, query, setQuery, shown } = useTaskFilter(tasks);

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      {/* 工具栏 */}
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-line/60 px-4">
        <div className="flex gap-1">
          {TASK_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`rounded-full px-3 py-1 text-xs transition ${
                filter === f.key
                  ? "bg-surface-3 text-ink"
                  : "text-ink-3 hover:bg-surface-2 hover:text-ink-2"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索提示词 / seed / id"
          className="w-56 rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-xs outline-none transition placeholder:text-ink-3 focus:border-brand"
        />
      </div>

      {/* 网格 */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {!loaded ? (
          <div className="flex h-full items-center justify-center text-sm text-ink-3">
            加载中…
          </div>
        ) : shown.length === 0 ? (
          <EmptyState hasTasks={tasks.length > 0} />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3">
            {shown.map((t) => (
              <TaskCard key={t.id} record={t} onOpen={onOpen} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function EmptyState({ hasTasks }: { hasTasks: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-2">
        <Film size={22} className="text-ink-3" />
      </div>
      <div className="text-sm text-ink-2">
        {hasTasks ? "没有匹配的作品" : "还没有作品"}
      </div>
      <div className="max-w-[280px] text-xs leading-relaxed text-ink-3">
        {hasTasks
          ? "换个筛选条件或搜索词试试"
          : "在左侧描述画面（或上传首尾帧），点击「立即生成」开始你的第一条 H3 视频"}
      </div>
    </div>
  );
}
