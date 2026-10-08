import { useEffect, useState } from "react";
import {
  ChevronDown,
  MessageSquare,
  PanelLeft,
  PanelLeftClose,
  PanelLeftOpen,
  Settings2,
  Image as ImageIcon,
  Plus,
} from "lucide-react";
import { useChatStore } from "../stores/chat";

const COLLAPSE_KEY = "h3.sidebar.collapsed";
const VIDEO_GROUP_KEY = "h3.sidebar.videoGroupOpen";

function initialCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

function initialVideoGroupOpen(): boolean {
  try {
    return localStorage.getItem(VIDEO_GROUP_KEY) !== "0";
  } catch {
    return true;
  }
}

interface Props {
  onOpenSettings: () => void;
}

export function SideBar({ onOpenSettings }: Props) {
  const view = useChatStore((s) => s.view);
  const setView = useChatStore((s) => s.setView);
  const newChat = useChatStore((s) => s.newChat);
  const [collapsed, setCollapsed] = useState<boolean>(initialCollapsed);
  const [videoOpen, setVideoOpen] = useState<boolean>(initialVideoGroupOpen);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
    } catch {
      // 隐私模式等场景下持久化失败不影响功能
    }
  }, [collapsed]);

  useEffect(() => {
    try {
      localStorage.setItem(VIDEO_GROUP_KEY, videoOpen ? "1" : "0");
    } catch {
      // 同上
    }
  }, [videoOpen]);

  // ⌘B / Ctrl+B 折叠切换
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setCollapsed((c) => !c);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const toggle = () => setCollapsed((c) => !c);

  return (
    <nav
      className={`flex shrink-0 flex-col gap-1 border-r border-line bg-surface py-3 transition-[width] duration-150 ${
        collapsed ? "w-14 items-center" : "w-44 items-stretch px-2.5"
      }`}
    >
      {/* Logo 行（展开时带标题 + 折叠按钮；收起时仅 logo，折叠按钮沉底） */}
      {collapsed ? (
        <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand to-brand-2 text-[13px] font-bold text-white">
          H3
        </div>
      ) : (
        <div className="mb-3 flex items-center gap-2 px-1">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand to-brand-2 text-[13px] font-bold text-white">
            H3
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-semibold">H3 工作台</div>
            <div className="text-[9px] leading-tight text-ink-3">视频生成</div>
          </div>
        </div>
      )}

      {/* H3 分组 */}
      {collapsed ? (
        <div className="mb-1 h-px w-8 bg-line" />
      ) : (
        <button
          onClick={() => setVideoOpen((v) => !v)}
          className="mt-1 flex items-center gap-1 px-2 text-[9px] font-medium uppercase tracking-wider text-ink-3 transition hover:text-ink-2"
          title={videoOpen ? "收起视频分组" : "展开视频分组"}
        >
          视频
          <ChevronDown
            size={10}
            className={`transition-transform ${videoOpen ? "" : "-rotate-90"}`}
          />
        </button>
      )}
      {(collapsed || videoOpen) && (
        <>
          <RailItem
            collapsed={collapsed}
            icon={<PanelLeft size={17} />}
            label="工作台"
            active={view === "studio"}
            onClick={() => setView("studio")}
          />
          <RailItem
            collapsed={collapsed}
            icon={<MessageSquare size={17} />}
            label="对话生成"
            active={view === "chat"}
            onClick={() => {
              newChat();
              setView("chat");
            }}
          />
        </>
      )}

      <Divider collapsed={collapsed} />
      {/* 未来扩展占位：图像生成等 */}
      <RailItem collapsed={collapsed} icon={<ImageIcon size={17} />} label="图像生成" disabled />
      <RailItem collapsed={collapsed} icon={<Plus size={17} />} label="即将推出" disabled />

      <div className="flex-1" />

      <RailItem collapsed={collapsed} icon={<Settings2 size={17} />} label="设置" onClick={onOpenSettings} />
      <RailItem
        collapsed={collapsed}
        icon={collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
        label={collapsed ? "展开侧边栏 ⌘B" : "收起侧边栏 ⌘B"}
        onClick={toggle}
      />
    </nav>
  );
}

function Divider({ collapsed }: { collapsed: boolean }) {
  if (collapsed) return <div className="my-1 h-px w-8 bg-line" />;
  return <div className="my-1.5 h-px bg-line" />;
}

function RailItem({
  collapsed,
  icon,
  label,
  active,
  disabled,
  onClick,
}: {
  collapsed: boolean;
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  if (disabled) {
    return (
      <div
        title={`${label}（即将推出）`}
        className={`flex cursor-not-allowed items-center rounded-lg text-ink-3/40 opacity-50 ${
          collapsed ? "h-10 w-10 justify-center" : "h-9 gap-2.5 px-2.5"
        }`}
      >
        {icon}
        {!collapsed && <span className="text-xs">{label}</span>}
      </div>
    );
  }
  return (
    <button
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={`relative flex items-center rounded-lg transition ${
        collapsed ? "h-10 w-10 justify-center" : "h-9 gap-2.5 px-2.5"
      } ${
        active
          ? "bg-surface-3 text-ink"
          : "text-ink-3 hover:bg-surface-2 hover:text-ink-2"
      }`}
    >
      {active && (
        <span
          className={`absolute rounded-full bg-gradient-to-b from-brand to-brand-2 ${
            collapsed ? "left-[-8px] h-4 w-[3px]" : "left-0 h-5 w-[3px]"
          }`}
        />
      )}
      <span className="flex shrink-0">{icon}</span>
      {!collapsed && <span className="min-w-0 truncate text-xs">{label}</span>}
    </button>
  );
}
