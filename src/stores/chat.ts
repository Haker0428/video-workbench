import { create } from "zustand";
import type { ChatAttachment, ChatMessage, ChatSession } from "../types";
import { deleteChat as apiDeleteChat, listChats, saveChat, submitTask } from "../api/commands";
import { buildParams, detectMode, type AutoMode } from "../lib/detect";
import { useTasksStore } from "./tasks";

/** 视图模式：工作室（创作面板+作品流）| 对话生成 */
export type AppView = "studio" | "chat";

interface ChatState {
  view: AppView;
  sessions: ChatSession[];
  activeId: string | null;
  loaded: boolean;
  sending: boolean;
  error: string | null;
  setView: (v: AppView) => void;
  load: () => Promise<void>;
  newChat: () => void;
  openChat: (id: string) => void;
  removeChat: (id: string) => Promise<void>;
  /**
   * 对话发送：自动判定（或用户指定）模式 → 提交 → 双消息入会话并持久化。
   */
  send: (args: {
    text: string;
    attachments: ChatAttachment[];
    /** "auto" 或显式模式 */
    modeSelection: "auto" | AutoMode;
    seed: number | null;
  }) => Promise<void>;
}

function genId(prefix: string): string {
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  return `${prefix}-${Date.now().toString(36)}-${Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export const useChatStore = create<ChatState>((set, get) => ({
  view: "studio",
  sessions: [],
  activeId: null,
  loaded: false,
  sending: false,
  error: null,
  setView: (view) => set({ view }),
  load: async () => {
    try {
      const sessions = await listChats();
      set({ sessions, loaded: true });
    } catch (e) {
      console.error("list_chats failed", e);
      set({ loaded: true });
    }
  },
  newChat: () => set({ activeId: null, error: null }),
  openChat: (id) => set({ activeId: id }),
  removeChat: async (id) => {
    await apiDeleteChat(id);
    set((s) => ({
      sessions: s.sessions.filter((c) => c.id !== id),
      activeId: s.activeId === id ? null : s.activeId,
    }));
  },
  send: async ({ text, attachments, modeSelection, seed }) => {
    const s = get();
    if (s.sending || !text.trim()) return;
    set({ error: null, sending: true });

    const mode: AutoMode =
      modeSelection === "auto" ? detectMode(attachments) : modeSelection;

    const userMsg: ChatMessage = {
      id: genId("m"),
      role: "user",
      text: text.trim(),
      mode,
      mode_selection: modeSelection,
      task_id: null,
      attachments,
      created_at: new Date().toISOString(),
    };

    // 立即上屏（含乐观的 assistant 占位）
    let session =
      s.activeId != null ? s.sessions.find((c) => c.id === s.activeId) : undefined;
    const isNew = !session;
    session = session ?? {
      id: genId("c"),
      title: text.trim().slice(0, 20),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      messages: [],
    };
    const placeholderId = genId("m");
    const placeholder: ChatMessage = {
      id: placeholderId,
      role: "assistant",
      text: null,
      mode,
      task_id: null,
      attachments: [],
      created_at: new Date().toISOString(),
    };
    session = {
      ...session,
      messages: [...session.messages, userMsg, placeholder],
      updated_at: new Date().toISOString(),
    };
    set((st) => ({
      activeId: session!.id,
      sessions: isNew
        ? [session!, ...st.sessions]
        : st.sessions.map((c) => (c.id === session!.id ? session! : c)),
    }));

    try {
      const params = buildParams(text, attachments, mode, seed, null);
      const record = await submitTask(params);
      useTasksStore.getState().upsert(record);

      const done = {
        ...session,
        messages: session.messages.map((m) =>
          m.id === placeholderId ? { ...m, task_id: record.id } : m,
        ),
        updated_at: new Date().toISOString(),
      };
      set((st) => ({
        sessions: st.sessions.map((c) => (c.id === done.id ? done : c)),
      }));
      await saveChat(done);
      set({ sending: false });
    } catch (e) {
      // 提交失败：占位消息改为错误文本
      const failed = {
        ...session,
        messages: session.messages.map((m) =>
          m.id === placeholderId ? { ...m, text: `提交失败：${String(e)}` } : m,
        ),
      };
      set((st) => ({
        sending: false,
        error: String(e),
        sessions: st.sessions.map((c) => (c.id === failed.id ? failed : c)),
      }));
      await saveChat(failed).catch(() => {});
    }
  },
}));

