import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ImagePlay,
  Loader2,
  Play,
  Settings2,
  Square,
  Type,
  Wand2,
  WifiOff,
} from "lucide-react";
import {
  connState,
  phaseZh,
  ref2vaConnState,
  useHealthStore,
} from "../stores/health";
import { useSettingsStore } from "../stores/settings";
import { useComposerStore, type CreatorMode } from "../stores/composer";
import { fmtDuration } from "../lib/format";

interface Props {
  onOpenSettings: () => void;
}

function friendlyServiceError(error: string | null | undefined): string {
  if (!error) return "服务运行异常";
  if (error.includes("FailOnRecompileLimitHit") || error.includes("recompile limit")) {
    return "Stage1 编译缓存耗尽，需要重启服务";
  }
  if (error.includes("Forward execution thread failed")) {
    return "模型执行线程失败，需要重启服务";
  }
  const firstLine = error.split("\n", 1)[0].replace(/^RuntimeError:\s*/, "");
  return firstLine.length > 120 ? `${firstLine.slice(0, 117)}…` : firstLine;
}

export function TopStatusBar({ onOpenSettings }: Props) {
  const snapshot = useHealthStore((s) => s.snapshot);
  const ref2vaSnapshot = useHealthStore((s) => s.ref2vaSnapshot);
  const offlineError = useHealthStore((s) => s.offlineError);
  const controlling = useHealthStore((s) => s.controlling);
  const controlError = useHealthStore((s) => s.controlError);
  const control = useHealthStore((s) => s.control);
  const refresh = useHealthStore((s) => s.refresh);
  const settings = useSettingsStore((s) => s.settings);
  const setActiveBackend = useSettingsStore((s) => s.setActiveBackend);
  const mode = useComposerStore((s) => s.mode);
  const setMode = useComposerStore((s) => s.setMode);
  const [switching, setSwitching] = useState(false);
  const [hybridSwitching, setHybridSwitching] = useState(false);
  const [hybridError, setHybridError] = useState<string | null>(null);

  const backend = settings?.backends.find((b) => b.id === settings.active_backend_id);
  const state = connState(snapshot, offlineError);
  const refState = useHealthStore(ref2vaConnState);
  const startup = snapshot?.startup ?? null;
  const refStartup = ref2vaSnapshot?.startup ?? null;
  const canStart = Boolean(backend?.ssh_target && backend?.start_command && backend?.base_url);
  const serviceModes = snapshot?.task === "hybrid"
    ? ["t2va", "fl2va"]
    : snapshot?.task
      ? [snapshot.task]
      : backend?.modes ?? [];
  const supportsFl2va = serviceModes.includes("fl2va");
  const needsHybrid = mode === "fl2va" && state === "ready" && !supportsFl2va;

  useEffect(() => {
    if (hybridSwitching && state === "ready" && supportsFl2va) {
      setHybridSwitching(false);
    }
  }, [hybridSwitching, state, supportsFl2va]);

  const switchBackend = async (id: string) => {
    setSwitching(true);
    useHealthStore.setState({ snapshot: null, offlineError: null, controlError: null });
    try {
      await setActiveBackend(id);
      await refresh();
    } finally {
      setSwitching(false);
    }
  };

  const runControl = async (action: "start" | "stop") => {
    try {
      await control(action);
    } catch {
      // The store exposes the actionable error in the status area.
    }
  };

  const selectMode = (next: CreatorMode) => {
    setHybridError(null);
    setMode(next);
  };

  const enableHybrid = async () => {
    if ((snapshot?.queue_depth ?? 0) > 0 || hybridSwitching) return;
    setHybridError(null);
    setHybridSwitching(true);
    try {
      await control("stop");
      await control("start");
    } catch (e) {
      setHybridSwitching(false);
      setHybridError(String(e));
    }
  };

  return (
    <header className="flex min-h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
      <div className="flex min-w-[174px] items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-brand text-[12px] font-bold text-white">
          H3
        </div>
        <div>
          <div className="text-sm font-semibold">H3 工作台</div>
          <div className="text-[10px] text-ink-3">视频生成控制台</div>
        </div>
      </div>

      <div className="flex shrink-0 items-center rounded-md border border-line bg-surface-2 p-0.5">
        {[
          { id: "t2va" as const, label: "文生", icon: <Type size={13} /> },
          { id: "fl2va" as const, label: "首尾帧", icon: <ImagePlay size={13} /> },
          { id: "ref2va" as const, label: "参考", icon: <Wand2 size={13} /> },
        ].map((item) => (
          <button
            key={item.id}
            onClick={() => selectMode(item.id)}
            className={`flex h-7 items-center gap-1.5 rounded px-2.5 text-[11px] transition ${
              mode === item.id
                ? "bg-surface-3 text-ink shadow-sm"
                : "text-ink-3 hover:text-ink-2"
            }`}
            title={
              item.id === "ref2va"
                ? "使用独立参考生成服务"
                : item.id === "fl2va" && !supportsFl2va
                  ? "当前主服务需要切换为 Hybrid 并预热"
                  : "切换后无需重新预热"
            }
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-center">
        {state === "ready" && (
          <div className="flex min-w-0 items-center gap-2 text-xs">
            <span className="h-2 w-2 shrink-0 rounded-full bg-ok" />
            <span className="font-medium text-ok">主服务就绪</span>
            <span className="truncate text-ink-3">{backend?.base_url}</span>
            <span className="text-ink-2">
              {snapshot?.task === "hybrid"
                ? "文生 + 首尾帧"
                : snapshot?.task === "fl2va"
                  ? "首尾帧"
                  : snapshot?.task === "t2va"
                    ? "仅文生"
                    : snapshot?.task?.toUpperCase()}
            </span>
            {(snapshot?.queue_depth ?? 0) > 0 && (
              <span className="text-warn">队列 {snapshot?.queue_depth}</span>
            )}
            <span className="mx-1 h-3 w-px bg-line" />
            <span
              className={
                refState === "ready"
                  ? "text-ok"
                  : refState === "loading"
                    ? "text-brand"
                    : "text-ink-3"
              }
              title={settings?.ref2va_base_url ?? "未配置 Ref2VA 服务"}
            >
              {refState === "ready"
                ? "参考服务就绪"
                : refState === "loading"
                  ? "参考服务预热中"
                  : refState === "unconfigured"
                    ? "参考服务未配置"
                    : "参考服务未连接"}
            </span>
            {refState === "loading" && refStartup && (
              <div className="flex items-center gap-1.5">
                <div className="h-1 w-16 overflow-hidden rounded-full bg-surface-3">
                  <div
                    className="h-full rounded-full bg-brand transition-all duration-1000"
                    style={{ width: `${refStartup.percent ?? 0}%` }}
                  />
                </div>
                <span className="tabular-nums text-brand">{refStartup.percent ?? 0}%</span>
              </div>
            )}
            {needsHybrid && (
              <button
                onClick={() => void enableHybrid()}
                disabled={
                  !backend?.stop_command ||
                  !backend?.start_command ||
                  hybridSwitching ||
                  controlling !== null ||
                  (snapshot?.queue_depth ?? 0) > 0
                }
                className="ml-1 flex h-7 items-center gap-1.5 rounded-md bg-brand px-2.5 text-[11px] font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-ink-3"
                title={
                  (snapshot?.queue_depth ?? 0) > 0
                    ? "队列中仍有任务，完成后才能切换服务"
                    : "重启主服务为 Hybrid，并显示真实预热进度"
                }
              >
                {hybridSwitching ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                切换并预热
              </button>
            )}
          </div>
        )}

        {state === "loading" && startup && (
          <div className="flex w-full max-w-[720px] items-center gap-3 text-xs">
            <Loader2 size={14} className="shrink-0 animate-spin text-brand" />
            <span className="shrink-0 font-medium text-brand">预热 {startup.percent ?? 0}%</span>
            <div className="h-1.5 min-w-24 flex-1 overflow-hidden rounded-full bg-surface-3">
              <div
                className="h-full rounded-full bg-brand transition-all duration-1000"
                style={{ width: `${startup.percent ?? 0}%` }}
              />
            </div>
            <span className="min-w-0 truncate text-ink-2">{phaseZh(startup.phase)}</span>
            {startup.elapsed_s != null && (
              <span className="shrink-0 tabular-nums text-ink-3">
                已用 {fmtDuration(startup.elapsed_s)}
              </span>
            )}
            {startup.estimated_remaining_s != null && (
              <span className="shrink-0 tabular-nums text-ink-3">
                约剩 {fmtDuration(startup.estimated_remaining_s)}
              </span>
            )}
          </div>
        )}

        {state === "error" && (
          <div className="flex min-w-0 items-center gap-2 text-xs text-danger">
            <AlertTriangle size={14} className="shrink-0" />
            <span className="truncate" title={snapshot?.error ?? "服务运行异常"}>
              {friendlyServiceError(snapshot?.error)}
            </span>
          </div>
        )}

        {state === "offline" && (
          <div className="flex min-w-0 items-center gap-2 text-xs text-ink-3">
            {hybridSwitching ? (
              <>
                <Loader2 size={14} className="shrink-0 animate-spin text-brand" />
                <span className="font-medium text-brand">正在切换到文生 + 首尾帧服务</span>
                <span>等待远端进程启动…</span>
              </>
            ) : (
              <>
                <WifiOff size={14} className="shrink-0" />
                <span>{backend?.base_url ? "服务未连接" : "后端尚未配置"}</span>
                {offlineError && <span className="max-w-64 truncate">{offlineError}</span>}
              </>
            )}
          </div>
        )}

        {controlError && state !== "loading" && (
          <div className="ml-3 max-w-72 truncate text-[10px] text-danger">{controlError}</div>
        )}
        {hybridError && state !== "loading" && (
          <div className="ml-3 max-w-72 truncate text-[10px] text-danger">{hybridError}</div>
        )}
      </div>

      <div className="flex min-w-[330px] items-center justify-end gap-2">
        <div className="relative">
          <select
            value={settings?.active_backend_id ?? ""}
            onChange={(e) => void switchBackend(e.target.value)}
            disabled={!settings || switching || controlling !== null}
            className="h-8 appearance-none rounded-md border border-line bg-surface-2 pl-3 pr-8 text-xs text-ink-2 outline-none transition hover:border-ink-3 focus:border-brand disabled:opacity-50"
            aria-label="选择生成后端"
          >
            {settings?.backends.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}{item.base_url ? "" : "（未配置）"}
              </option>
            ))}
          </select>
          <ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-2.5 text-ink-3" />
        </div>

        {(state === "offline" || state === "error") && (
          <button
            onClick={() => void runControl("start")}
            disabled={!canStart || controlling !== null || switching}
            className="flex h-8 items-center gap-1.5 rounded-md bg-brand px-3 text-xs font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-ink-3"
            title={
              canStart
                ? state === "error"
                  ? "清理异常 worker，重启远端服务并重新预热"
                  : "启动远端服务并开始预热"
                : "请先在设置中配置启动方式"
            }
          >
            {controlling === "start" ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
            {state === "error" ? "重启服务" : "启动服务"}
          </button>
        )}

        {(state === "ready" || state === "loading") && (
          <button
            onClick={() => void runControl("stop")}
            disabled={!backend?.stop_command || controlling !== null}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-line text-ink-3 transition hover:border-danger/60 hover:bg-danger/10 hover:text-danger disabled:opacity-40"
            title="停止远端服务"
          >
            {controlling === "stop" ? <Loader2 size={13} className="animate-spin" /> : <Square size={12} />}
          </button>
        )}

        <button
          onClick={onOpenSettings}
          className="flex h-8 w-8 items-center justify-center rounded-md text-ink-2 transition hover:bg-surface-2 hover:text-ink"
          title="服务与归档设置"
        >
          <Settings2 size={16} />
        </button>
      </div>
    </header>
  );
}
