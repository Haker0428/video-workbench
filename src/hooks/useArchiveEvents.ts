import { useEffect } from "react";
import { onArchiveProgress } from "../api/events";
import { useTasksStore } from "../stores/tasks";
import { pollTasks } from "../api/commands";

/** 订阅归档进度事件；完成后刷新对应记录（拿 archived/bytes_total）。 */
export function useArchiveEvents() {
  const setArchive = useTasksStore((s) => s.setArchive);
  const upsert = useTasksStore((s) => s.upsert);
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let disposed = false;
    void onArchiveProgress(async (p) => {
      setArchive(p); // downloading → 更新进度；done/failed → 从 map 移除
      if (p.state === "downloading") return;
      // 终态：拉一次该任务记录（archived/bytes_total 落在 Rust 侧 store）
      try {
        const items = await pollTasks([p.id]);
        for (const item of items) {
          if (item.record) upsert(item.record);
        }
      } catch {
        // 记录刷新失败不影响主流程
      }
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [setArchive, upsert]);
}
