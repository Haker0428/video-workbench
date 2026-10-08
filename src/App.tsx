import { useEffect, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { TaskRecord } from "./types";
import type { SubmitProgress } from "./types";
import { useHealthPoll } from "./hooks/useHealthPoll";
import { useArchiveEvents } from "./hooks/useArchiveEvents";
import { startTaskPoller, useTasksStore } from "./stores/tasks";
import { useSettingsStore } from "./stores/settings";
import { useChatStore } from "./stores/chat";
import { SideBar } from "./components/SideBar";
import { TopStatusBar } from "./components/TopStatusBar";
import { CreatorPanel } from "./components/creator/CreatorPanel";
import { GalleryPanel } from "./components/gallery/GalleryPanel";
import { ChatView } from "./components/chat/ChatView";
import { DetailDrawer } from "./components/detail/DetailDrawer";
import { SettingsDialog } from "./components/SettingsDialog";
import { useComposerStore } from "./stores/composer";

export default function App() {
  const [detail, setDetail] = useState<TaskRecord | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const view = useChatStore((s) => s.view);
  const loadTasks = useTasksStore((s) => s.load);
  const loadSettings = useSettingsStore((s) => s.load);
  const loadChats = useChatStore((s) => s.load);

  useHealthPoll();
  useArchiveEvents();

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let disposed = false;
    void listen<SubmitProgress>("submit-progress", (event) => {
      useComposerStore.getState().setSubmitProgress(event.payload);
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    void loadTasks();
    void loadSettings();
    void loadChats();
    startTaskPoller();
  }, [loadTasks, loadSettings, loadChats]);

  // 详情抽屉跟随任务记录更新（轮询合并后引用变化）
  const tasks = useTasksStore((s) => s.tasks);
  useEffect(() => {
    if (!detail) return;
    const fresh = tasks.find((t) => t.id === detail.id);
    if (fresh && fresh !== detail) setDetail(fresh);
  }, [tasks, detail]);

  return (
    <div className="flex h-screen overflow-hidden bg-base text-ink">
      <SideBar onOpenSettings={() => setSettingsOpen(true)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopStatusBar onOpenSettings={() => setSettingsOpen(true)} />
        {view === "studio" ? (
          <div className="flex min-h-0 flex-1">
            <CreatorPanel />
            <GalleryPanel onOpen={setDetail} />
          </div>
        ) : (
          <ChatView onOpenTask={setDetail} />
        )}
      </div>
      <DetailDrawer record={detail} onClose={() => setDetail(null)} />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
