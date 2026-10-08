import { create } from "zustand";
import type { ArchiveProgress, PollItem, TaskRecord } from "../types";
import { listTasks, pollTasks } from "../api/commands";

interface TasksState {
  tasks: TaskRecord[];
  loaded: boolean;
  /** 进行中归档进度（id → progress），done/failed 后移除 */
  archive: Record<string, ArchiveProgress>;
  load: () => Promise<void>;
  upsert: (record: TaskRecord) => void;
  mergePoll: (items: PollItem[]) => void;
  remove: (id: string) => void;
  setArchive: (p: ArchiveProgress) => void;
  activeIds: () => string[];
}

function sortTasks(tasks: TaskRecord[]): TaskRecord[] {
  return [...tasks].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

export const useTasksStore = create<TasksState>((set, get) => ({
  tasks: [],
  loaded: false,
  archive: {},
  load: async () => {
    try {
      const tasks = await listTasks();
      set({ tasks: sortTasks(tasks), loaded: true });
    } catch (e) {
      console.error("list_tasks failed", e);
      set({ loaded: true });
    }
  },
  upsert: (record) => {
    set((s) => {
      const rest = s.tasks.filter((t) => t.id !== record.id);
      return { tasks: sortTasks([record, ...rest]) };
    });
  },
  mergePoll: (items) => {
    set((s) => {
      const map = new Map(s.tasks.map((t) => [t.id, t]));
      let changed = false;
      for (const item of items) {
        if (item.record) {
          map.set(item.id, item.record);
          changed = true;
        }
      }
      return changed ? { tasks: sortTasks([...map.values()]) } : {};
    });
  },
  remove: (id) => set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),
  setArchive: (p) =>
    set((s) => {
      const next = { ...s.archive };
      if (p.state === "downloading") {
        next[p.id] = p;
      } else {
        delete next[p.id];
      }
      return { archive: next };
    }),
  activeIds: () =>
    get()
      .tasks.filter((t) => t.status === "queued" || t.status === "running")
      .map((t) => t.id),
}));

/** 全局轮询器：App 挂载时启动一次；有活跃任务时 3s 一轮。 */
let pollTimer: ReturnType<typeof setInterval> | null = null;

export function startTaskPoller() {
  if (pollTimer) return;
  const tick = async () => {
    const ids = useTasksStore.getState().activeIds();
    if (ids.length === 0) return;
    try {
      const items = await pollTasks(ids);
      useTasksStore.getState().mergePoll(items);
    } catch (e) {
      console.error("poll_tasks failed", e);
    }
  };
  pollTimer = setInterval(tick, 3000);
  void tick();
}
