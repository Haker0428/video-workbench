import { create } from "zustand";
import type { RuntimeInfo, Settings } from "../types";
import { getRuntimeInfo, getSettings, setSettings } from "../api/commands";

interface SettingsState {
  settings: Settings | null;
  runtime: RuntimeInfo | null;
  load: () => Promise<void>;
  save: (s: Settings) => Promise<void>;
  setActiveBackend: (id: string) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: null,
  runtime: null,
  load: async () => {
    try {
      const [settings, runtime] = await Promise.all([getSettings(), getRuntimeInfo()]);
      set({ settings, runtime });
    } catch (e) {
      console.error("load settings failed", e);
    }
  },
  save: async (s) => {
    const saved = await setSettings(s);
    set({ settings: saved });
  },
  setActiveBackend: async (id) => {
    const current = useSettingsStore.getState().settings;
    if (!current || current.active_backend_id === id) return;
    const saved = await setSettings({ ...current, active_backend_id: id });
    set({ settings: saved });
  },
}));
