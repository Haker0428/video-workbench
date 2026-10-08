import { useEffect, useState } from "react";
import { Server, X } from "lucide-react";
import { useSettingsStore } from "../stores/settings";
import type { BackendConfig, Settings } from "../types";
import { useHealthStore } from "../stores/health";

interface Props {
  open: boolean;
  onClose: () => void;
}

const inputClass =
  "w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-sm outline-none transition focus:border-brand";

export function SettingsDialog({ open, onClose }: Props) {
  const settings = useSettingsStore((s) => s.settings);
  const runtime = useSettingsStore((s) => s.runtime);
  const save = useSettingsStore((s) => s.save);
  const refreshHealth = useHealthStore((s) => s.refresh);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && settings) {
      setDraft({ ...settings, backends: settings.backends.map((b) => ({ ...b, modes: [...b.modes] })) });
    }
  }, [open, settings]);

  if (!open || !draft) return null;

  const updateBackend = (id: string, patch: Partial<BackendConfig>) => {
    setDraft({
      ...draft,
      backends: draft.backends.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const sol = draft.backends.find((b) => b.id === "sol_h3");
      const next = sol
        ? { ...draft, base_url: sol.base_url, api_key: sol.api_key }
        : draft;
      await save(next);
      useHealthStore.setState({ snapshot: null, offlineError: null, controlError: null });
      await refreshHealth();
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div
        className="flex max-h-[86vh] w-[720px] flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold">服务设置</h2>
            <p className="mt-0.5 text-[11px] text-ink-3">配置生成后端、远端启动方式与本地归档</p>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-ink-3 hover:bg-surface-2 hover:text-ink"
            title="关闭"
          >
            <X size={15} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5">
          {draft.backends.map((backend) => (
            <section key={backend.id} className="border-b border-line py-5 last:border-b-0">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Server size={15} className="text-brand" />
                  <div>
                    <div className="text-sm font-medium">{backend.label}</div>
                    <div className="text-[10px] uppercase text-ink-3">{backend.kind}</div>
                  </div>
                </div>
                <label className="flex items-center gap-2 text-xs text-ink-2">
                  <input
                    type="radio"
                    name="active-backend"
                    checked={draft.active_backend_id === backend.id}
                    onChange={() => setDraft({ ...draft, active_backend_id: backend.id })}
                    className="accent-[var(--color-brand)]"
                  />
                  当前使用
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="col-span-2 block">
                  <span className="mb-1 block text-xs text-ink-2">API 地址</span>
                  <input
                    value={backend.base_url}
                    onChange={(e) => updateBackend(backend.id, { base_url: e.target.value })}
                    placeholder={backend.id === "sol_h3" ? "http://100.64.52.42:30010" : "尚未配置"}
                    className={inputClass}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-ink-2">API Key</span>
                  <input
                    type="password"
                    value={backend.api_key ?? ""}
                    onChange={(e) => updateBackend(backend.id, { api_key: e.target.value || null })}
                    placeholder="可选"
                    className={inputClass}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-ink-2">SSH 目标</span>
                  <input
                    value={backend.ssh_target ?? ""}
                    onChange={(e) => updateBackend(backend.id, { ssh_target: e.target.value || null })}
                    placeholder="例如 spark"
                    className={inputClass}
                  />
                </label>
                <label className="col-span-2 block">
                  <span className="mb-1 block text-xs text-ink-2">启动命令</span>
                  <textarea
                    value={backend.start_command ?? ""}
                    onChange={(e) => updateBackend(backend.id, { start_command: e.target.value || null })}
                    rows={3}
                    placeholder="在远端通过 SSH 执行；GB10 server 确认后填入"
                    className={`${inputClass} resize-y font-mono text-[11px] leading-relaxed`}
                  />
                </label>
                <label className="col-span-2 block">
                  <span className="mb-1 block text-xs text-ink-2">停止命令</span>
                  <input
                    value={backend.stop_command ?? ""}
                    onChange={(e) => updateBackend(backend.id, { stop_command: e.target.value || null })}
                    placeholder="可选"
                    className={`${inputClass} font-mono text-[11px]`}
                  />
                </label>
              </div>
            </section>
          ))}

          <section className="border-t border-line py-5">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">Ref2VA 独立服务</div>
                <div className="mt-0.5 text-[10px] text-ink-3">人物、场景和风格参考；当前仍作为独立模型分区</div>
              </div>
              <button
                onClick={() =>
                  setDraft({
                    ...draft,
                    ref2va_base_url: draft.ref2va_base_url ? null : "http://100.64.52.42:30011",
                  })
                }
                className="text-xs text-brand hover:text-ink"
              >
                {draft.ref2va_base_url ? "移除" : "添加"}
              </button>
            </div>
            {draft.ref2va_base_url && (
              <div className="grid grid-cols-2 gap-3">
                <input
                  value={draft.ref2va_base_url}
                  onChange={(e) => setDraft({ ...draft, ref2va_base_url: e.target.value })}
                  className={inputClass}
                />
                <input
                  type="password"
                  value={draft.ref2va_api_key ?? ""}
                  onChange={(e) => setDraft({ ...draft, ref2va_api_key: e.target.value || null })}
                  placeholder="专用 API Key；留空沿用 Sol-H3"
                  className={inputClass}
                />
              </div>
            )}
          </section>

          <section className="border-t border-line py-5">
            <label className="flex cursor-pointer items-center justify-between">
              <div>
                <div className="text-sm">自动归档</div>
                <div className="mt-0.5 text-xs text-ink-3">任务完成后下载到本地，切换或重启服务不会丢失成片</div>
              </div>
              <button
                role="switch"
                aria-checked={draft.auto_archive}
                onClick={() => setDraft({ ...draft, auto_archive: !draft.auto_archive })}
                className={`relative h-5 w-9 shrink-0 rounded-full transition ${
                  draft.auto_archive ? "bg-brand" : "bg-surface-3"
                }`}
              >
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
                    draft.auto_archive ? "left-[18px]" : "left-0.5"
                  }`}
                />
              </button>
            </label>
            {runtime && (
              <div className="mt-3 text-[10px] leading-relaxed text-ink-3">
                本地数据：{runtime.data_dir}<br />版本：v{runtime.version}
              </div>
            )}
          </section>
        </div>

        <div className="shrink-0 border-t border-line px-5 py-4">
          {error && <div className="mb-3 text-xs text-danger">{error}</div>}
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="rounded-md px-4 py-2 text-sm text-ink-2 hover:bg-surface-2">
              取消
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "保存中…" : "保存设置"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
