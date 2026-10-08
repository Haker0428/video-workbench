import { useMemo, useState } from "react";
import type { TaskRecord } from "../types";

export type TaskFilter = "all" | "active" | "completed" | "failed";

export const TASK_FILTERS: { key: TaskFilter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "active", label: "生成中" },
  { key: "completed", label: "已完成" },
  { key: "failed", label: "失败" },
];

/** 作品流筛选（工作台网格与对话侧栏共用同一数据源与筛选逻辑）。 */
export function useTaskFilter(tasks: TaskRecord[]) {
  const [filter, setFilter] = useState<TaskFilter>("all");
  const [query, setQuery] = useState("");

  const shown = useMemo(() => {
    let list = tasks;
    if (filter === "active")
      list = list.filter((t) => t.status === "queued" || t.status === "running");
    else if (filter !== "all") list = list.filter((t) => t.status === filter);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(
        (t) =>
          t.request.prompt.toLowerCase().includes(q) ||
          t.id.includes(q) ||
          String(t.request.seed ?? "").includes(q),
      );
    }
    return list;
  }, [tasks, filter, query]);

  return { filter, setFilter, query, setQuery, shown };
}
