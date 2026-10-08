import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Image as ImageIcon,
  Loader2,
  Music,
  Plus,
  Send,
  Sparkles,
  Trash2,
  Video,
} from "lucide-react";
import type { ChatAttachment, ChatMessage, ChatSession, TaskRecord } from "../../types";
import { MODE_LABEL, detectMode, type AutoMode } from "../../lib/detect";
import { useChatStore } from "../../stores/chat";
import { useTasksStore } from "../../stores/tasks";
import { WorksRail } from "../gallery/WorksRail";
import { saveFrame, saveRefAudio, saveRefVideo } from "../../api/commands";
import { h3videoUrl } from "../../lib/scheme";
import { parseSeed } from "../../lib/seed";

interface Props {
  onOpenTask: (record: TaskRecord) => void;
}

export function ChatView({ onOpenTask }: Props) {
  const sessions = useChatStore((s) => s.sessions);
  const activeId = useChatStore((s) => s.activeId);
  const loaded = useChatStore((s) => s.loaded);
  const removeChat = useChatStore((s) => s.removeChat);

  const active: ChatSession | null = useMemo(
    () => sessions.find((c) => c.id === activeId) ?? null,
    [sessions, activeId],
  );

  return (
    <div className="flex min-w-0 flex-1">
      {/* 对话列 */}
      <main className="relative flex min-w-0 flex-1 flex-col">
        {/* 会话头部 */}
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-line/60 px-4">
          <span className="text-xs text-ink-2">对话生成</span>
          <span className="rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[10px] text-ink-3">
            自动识别模式 · H3
          </span>
          <div className="flex-1" />
          {active && (
            <button
              onClick={() => void removeChat(active.id)}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-ink-3 transition hover:bg-danger/10 hover:text-danger"
              title="删除当前会话"
            >
              <Trash2 size={11} /> 删除会话
            </button>
          )}
        </div>

        {/* 消息线程 / 空状态 */}
        {!loaded ? (
          <div className="flex flex-1 items-center justify-center text-sm text-ink-3">加载中…</div>
        ) : !active || active.messages.length === 0 ? (
          <ChatEmpty />
        ) : (
          <Thread session={active} onOpenTask={onOpenTask} />
        )}

        {/* 底部输入 */}
        <ChatComposer />
      </main>

      {/* 作品栏（与工作台作品流同源，窄栏列表形态） */}
      <WorksRail onOpen={onOpenTask} />
    </div>
  );
}

function ChatEmpty() {
  const [seedPrompt, setSeedPrompt] = useState<string | null>(null);
  const suggestions = [
    "雨夜的霓虹街头，镜头缓缓推进，雨声与远处的车流",
    "让这只机械狗在草地上奔跑，阳光洒在身上",
    "一杯咖啡从倒出到热气升腾的特写过程",
  ];
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand/20 to-brand-2/20">
        <Sparkles size={22} className="text-brand" />
      </div>
      <div className="text-center">
        <div className="text-sm text-ink-2">随心描述，或附上参考素材</div>
        <div className="mt-1 text-xs leading-relaxed text-ink-3">
          纯文字 → 文生视频 · 1~2 张图 → 首尾帧 · 更多素材 → 参考生成
          <br />
          模式自动识别，发送前可点击标签修改
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        {suggestions.map((s) => (
          <button
            key={s}
            onClick={() => setSeedPrompt(s)}
            className="rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-left text-xs text-ink-2 transition hover:border-ink-3/50 hover:text-ink"
          >
            {s}
          </button>
        ))}
      </div>
      {/* 预填到 composer */}
      {seedPrompt && <PromptBridge text={seedPrompt} onDone={() => setSeedPrompt(null)} />}
    </div>
  );
}

/** 把建议词灌进 composer 的桥（composer 状态独立，通过事件传递） */
function PromptBridge({ text, onDone }: { text: string; onDone: () => void }) {
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("h3:chat-prefill", { detail: text }));
    onDone();
  }, [text, onDone]);
  return null;
}

function Thread({
  session,
  onOpenTask,
}: {
  session: ChatSession;
  onOpenTask: (record: TaskRecord) => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [session.messages.length]);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        {session.messages.map((m) => (
          <MessageRow key={m.id} message={m} onOpenTask={onOpenTask} />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function MessageRow({
  message,
  onOpenTask,
}: {
  message: ChatMessage;
  onOpenTask: (record: TaskRecord) => void;
}) {
  if (message.role === "user") {
    return (
      <div className="flex flex-col items-end gap-1.5">
        {message.attachments.length > 0 && (
          <div className="flex flex-wrap justify-end gap-1.5">
            {message.attachments.map((a) => (
              <AttachmentThumb key={a.asset_id} att={a} />
            ))}
          </div>
        )}
        <div className="max-w-[80%] rounded-2xl rounded-br-md bg-gradient-to-br from-brand to-brand-2 px-3.5 py-2 text-sm leading-relaxed text-white">
          {message.text}
        </div>
        {message.mode && (
          <ModeChip mode={message.mode} selection={message.mode_selection} />
        )}
      </div>
    );
  }
  // assistant：任务卡
  return <AssistantTaskSlot message={message} onOpenTask={onOpenTask} />;
}

function ModeChip({ mode, selection }: { mode: string; selection?: string | null }) {
  const auto = selection === "auto" || selection == null;
  return (
    <span className="text-[9px] text-ink-3">
      {auto ? "自动识别 · " : "手动指定 · "}
      {MODE_LABEL[mode as AutoMode] ?? mode}
    </span>
  );
}

function AttachmentThumb({ att }: { att: ChatAttachment }) {
  const Icon = att.kind === "image" ? ImageIcon : att.kind === "video" ? Video : Music;
  return (
    <div className="h-16 w-16 overflow-hidden rounded-lg border border-line bg-surface-2">
      {att.kind === "image" ? (
        <img src={h3videoUrl(att.file)} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-0.5 text-ink-3">
          <Icon size={14} />
          <span className="max-w-full truncate px-1 text-[8px]">{att.name ?? att.kind}</span>
        </div>
      )}
    </div>
  );
}

function AssistantTaskSlot({
  message,
  onOpenTask,
}: {
  message: ChatMessage;
  onOpenTask: (record: TaskRecord) => void;
}) {
  const task = useTasksStore((s) =>
    message.task_id ? s.tasks.find((t) => t.id === message.task_id) : undefined,
  );
  if (message.text) {
    // 提交失败等错误文本
    return (
      <div className="flex max-w-[85%] items-start gap-2 rounded-2xl rounded-bl-md border border-danger/30 bg-danger/10 px-3.5 py-2 text-xs text-danger">
        <AlertCircle size={13} className="mt-0.5 shrink-0" />
        {message.text}
      </div>
    );
  }
  if (!task) {
    return (
      <div className="flex items-center gap-2 text-xs text-ink-3">
        <Loader2 size={13} className="animate-spin" /> 正在提交…
      </div>
    );
  }
  return <ChatTaskCard task={task} onOpen={onOpenTask} />;
}

/** 会话内嵌的任务卡：状态实时跟随任务轮询。 */
function ChatTaskCard({ task, onOpen }: { task: TaskRecord; onOpen: (r: TaskRecord) => void }) {
  const archive = useTasksStore((s) => s.archive[task.id]);
  const thumbUrl = useMemo(() => {
    if (task.local.thumb_file) return h3videoUrl(task.local.thumb_file);
    if (task.request.first_frame_file) return h3videoUrl(task.request.first_frame_file);
    if (task.request.ref_images.length > 0) return h3videoUrl(task.request.ref_images[0].file);
    return null;
  }, [task]);

  return (
    <button
      onClick={() => onOpen(task)}
      className="group flex w-[320px] max-w-full gap-3 rounded-xl border border-line bg-surface-2 p-2.5 text-left transition hover:border-ink-3/50"
    >
      <div className="relative h-[72px] w-[128px] shrink-0 overflow-hidden rounded-lg bg-surface-3">
        {task.status === "completed" && thumbUrl ? (
          <img src={thumbUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            {task.status === "failed" ? (
              <AlertCircle size={16} className="text-danger" />
            ) : (
              <Loader2 size={16} className="animate-spin text-brand" />
            )}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1 py-0.5">
        <div className="truncate text-xs text-ink-2">{task.request.prompt}</div>
        <div className="mt-1.5 flex items-center gap-1.5 text-[10px]">
          <span
            className={`rounded px-1.5 py-0.5 ${
              task.status === "completed"
                ? "bg-ok/15 text-ok"
                : task.status === "failed"
                  ? "bg-danger/15 text-danger"
                  : "bg-brand/15 text-brand"
            }`}
          >
            {task.status === "queued"
              ? "排队中"
              : task.status === "running"
                ? "生成中"
                : task.status === "completed"
                  ? "已完成"
                  : "失败"}
          </span>
          <span className="text-ink-3">
            {MODE_LABEL[task.routed_task as AutoMode] ?? task.routed_task}
          </span>
          {archive && <span className="text-ink-3">· 归档中</span>}
          {task.status === "failed" && (
            <span className="truncate text-danger/80">· {task.server.error}</span>
          )}
        </div>
      </div>
    </button>
  );
}

// ---------- 底部输入区（随心输入） ----------

function ChatComposer() {
  const send = useChatStore((s) => s.send);
  const sending = useChatStore((s) => s.sending);
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [modeSelection, setModeSelection] = useState<"auto" | AutoMode>("auto");
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const imgRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // 空状态建议词预填
  useEffect(() => {
    const handler = (e: Event) => {
      setText((e as CustomEvent<string>).detail);
      taRef.current?.focus();
    };
    window.addEventListener("h3:chat-prefill", handler);
    return () => window.removeEventListener("h3:chat-prefill", handler);
  }, []);

  const detected = detectMode(attachments);
  const effMode: AutoMode = modeSelection === "auto" ? detected : modeSelection;

  const addFile = async (file: File, kind: "image" | "video" | "audio") => {
    setError(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const ref =
        kind === "image"
          ? await saveFrame(bytes)
          : kind === "video"
            ? await saveRefVideo(bytes)
            : await saveRefAudio(bytes);
      const assetId = "asset_id" in ref ? ref.asset_id : ref.frame_id;
      setAttachments((a) => [
        ...a,
        { asset_id: assetId, file: ref.file, kind, name: file.name },
      ]);
    } catch (e) {
      setError(String(e).replace(/^.*invalid request:\s*/, "").replace(/^"|"$/g, ""));
    }
  };

  const handleSend = async () => {
    if (sending || !text.trim()) return;
    const payload = { text, attachments, modeSelection, seed: parseSeed("") };
    setText("");
    setAttachments([]);
    setModeSelection("auto");
    await send(payload);
  };

  const iconBtn =
    "flex h-8 w-8 items-center justify-center rounded-full text-ink-3 transition hover:bg-surface-2 hover:text-ink-2";

  return (
    <div className="shrink-0 px-6 pb-5">
      <div className="mx-auto max-w-3xl">
        {/* 附件预览条 */}
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((a) => (
              <div key={a.asset_id} className="group relative">
                <AttachmentThumb att={a} />
                <button
                  onClick={() =>
                    setAttachments((list) => list.filter((x) => x.asset_id !== a.asset_id))
                  }
                  className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-danger text-white opacity-0 transition group-hover:opacity-100"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="rounded-2xl border border-line bg-surface-2 p-3 shadow-lg focus-within:border-brand/60">
          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder="随心输入"
            rows={2}
            className="max-h-40 w-full resize-none bg-transparent text-sm leading-relaxed outline-none placeholder:text-ink-3"
          />
          <div className="mt-2 flex items-center gap-1">
            {/* + 附件菜单 */}
            <div className="relative">
              <button className={iconBtn} onClick={() => setMenuOpen(!menuOpen)} title="添加附件">
                <Plus size={16} />
              </button>
              {menuOpen && (
                <div
                  className="absolute bottom-9 left-0 z-10 w-36 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-xl"
                  onMouseLeave={() => setMenuOpen(false)}
                >
                  {(
                    [
                      ["image", "图片（首尾帧/参考）", imgRef],
                      ["video", "视频参考", videoRef],
                      ["audio", "音频参考", audioRef],
                    ] as const
                  ).map(([kind, label, ref]) => (
                    <button
                      key={kind}
                      onClick={() => {
                        ref.current?.click();
                        setMenuOpen(false);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-ink-2 transition hover:bg-surface-2 hover:text-ink"
                    >
                      {kind === "image" ? (
                        <ImageIcon size={13} />
                      ) : kind === "video" ? (
                        <Video size={13} />
                      ) : (
                        <Music size={13} />
                      )}
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <input
              ref={imgRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void addFile(f, "image");
                e.target.value = "";
              }}
            />
            <input
              ref={videoRef}
              type="file"
              accept="video/mp4,video/webm"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void addFile(f, "video");
                e.target.value = "";
              }}
            />
            <input
              ref={audioRef}
              type="file"
              accept="audio/wav,audio/mpeg,audio/mp4,audio/ogg,audio/flac"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void addFile(f, "audio");
                e.target.value = "";
              }}
            />

            <div className="flex-1" />

            {/* 模式标签：自动识别结果，可点击切换 */}
            <button
              onClick={() => {
                const order: ("auto" | AutoMode)[] = ["auto", "t2va", "fl2va", "ref2va"];
                const i = order.indexOf(modeSelection);
                setModeSelection(order[(i + 1) % order.length]);
              }}
              title="点击切换：自动 / 指定模式"
              className={`rounded-full border px-2.5 py-1 text-[10px] transition ${
                modeSelection === "auto"
                  ? "border-brand/40 bg-brand/10 text-brand"
                  : "border-line bg-surface text-ink-2"
              }`}
            >
              {modeSelection === "auto" ? "自动 · " : ""}
              {MODE_LABEL[effMode]}
            </button>

            {/* 发送 */}
            <button
              onClick={() => void handleSend()}
              disabled={sending || !text.trim()}
              className={`ml-1 flex h-9 w-9 items-center justify-center rounded-full transition ${
                sending || !text.trim()
                  ? "cursor-not-allowed bg-surface-3 text-ink-3"
                  : "bg-gradient-to-br from-brand to-brand-2 text-white hover:opacity-90"
              }`}
            >
              {sending ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Send size={15} />
              )}
            </button>
          </div>
        </div>
        {error && <div className="mt-1.5 text-xs text-danger">{error}</div>}
      </div>
    </div>
  );
}
