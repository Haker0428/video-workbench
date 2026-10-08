import { create } from "zustand";
import type { ConnState, HealthSnapshot } from "../types";
import { getHealth } from "../api/commands";
import { controlBackend } from "../api/commands";
import { useSettingsStore } from "./settings";

interface HealthState {
  snapshot: HealthSnapshot | null;
  /** 最近一次网络错误（非服务错误） */
  offlineError: string | null;
  lastOkAt: number | null;
  /** Ref2VA 独立服务（未配置时 ref2vaState === "unconfigured"） */
  ref2vaSnapshot: HealthSnapshot | null;
  ref2vaOffline: string | null;
  ref2vaConfigured: boolean;
  controlling: "start" | "stop" | null;
  controlError: string | null;
  refresh: () => Promise<void>;
  control: (action: "start" | "stop") => Promise<void>;
}

export const useHealthStore = create<HealthState>((set) => ({
  snapshot: null,
  offlineError: null,
  lastOkAt: null,
  ref2vaSnapshot: null,
  ref2vaOffline: null,
  ref2vaConfigured: false,
  controlling: null,
  controlError: null,
  refresh: async () => {
    // 主服务
    try {
      const snapshot = await getHealth();
      set({ snapshot, offlineError: null, lastOkAt: Date.now() });
    } catch (e) {
      set({ offlineError: String(e) });
    }
    // Ref2VA：仅配置了才轮询
    const configured = Boolean(useSettingsStore.getState().settings?.ref2va_base_url);
    if (!configured) {
      set((s) =>
        s.ref2vaSnapshot || s.ref2vaOffline || s.ref2vaConfigured
          ? { ref2vaSnapshot: null, ref2vaOffline: null, ref2vaConfigured: false }
          : {},
      );
      return;
    }
    try {
      const snapshot = await getHealth("ref2va");
      set({ ref2vaSnapshot: snapshot, ref2vaOffline: null, ref2vaConfigured: true });
    } catch (e) {
      const msg = String(e);
      set({ ref2vaSnapshot: null, ref2vaOffline: msg, ref2vaConfigured: true });
    }
  },
  control: async (action) => {
    const backendId = useSettingsStore.getState().settings?.active_backend_id;
    set({ controlling: action, controlError: null });
    try {
      await controlBackend(action, backendId);
      set({ controlling: null });
      if (action === "stop") {
        set({ snapshot: null, offlineError: "服务正在停止" });
      }
      setTimeout(() => void useHealthStore.getState().refresh(), 1200);
    } catch (e) {
      set({ controlling: null, controlError: String(e) });
      throw e;
    }
  },
}));

export function connState(s: HealthSnapshot | null, offline: string | null): ConnState {
  if (offline) return "offline";
  if (!s) return "offline";
  if (s.status === "ready") return "ready";
  if (s.status === "loading") return "loading";
  return "error"; // 服务启动失败 / 致命错误
}

export function ref2vaConnState(s: HealthState): ConnState | "unconfigured" {
  if (!s.ref2vaConfigured) return "unconfigured";
  return connState(s.ref2vaSnapshot, s.ref2vaOffline);
}

/** 11 个启动 phase 的中文映射 */
const PHASE_ZH: Record<string, string> = {
  waiting: "等待启动",
  loading_stage1: "加载 Stage1 模型",
  loading_warmup_qwen: "加载预热 Qwen worker",
  encoding_warmup_prompt: "编码预热提示词",
  running_stage1_warmup: "执行 Stage1 预热",
  loading_stage2: "加载 Stage2 模型",
  preparing_stage2: "准备 Stage2 预热",
  running_stage2_warmup: "编译执行 Stage2 预热",
  loading_resident_qwen: "加载常驻 Qwen",
  running_t2va_warmup: "预热 T2VA 路径",
  running_fl2va_switchback_warmup: "验证 FL2VA 回切",
  starting: "启动 GB10 运行时",
  loading_transformer: "加载 GB10 FP8 DiT",
  loading_conditioner: "加载 Qwen3-VL 条件模型",
  loading_components: "加载视频与音频 VAE",
  finalizing: "完成常驻管线初始化",
  ready: "就绪",
  failed: "启动失败",
};

export function phaseZh(phase: string | undefined): string {
  if (!phase) return "";
  return PHASE_ZH[phase] ?? phase;
}
