import { useState } from "react";
import {
  ChevronDown,
  Copy,
  Dices,
  Minus,
  Monitor,
  Plus,
  Smartphone,
  Sparkles,
  Square,
} from "lucide-react";
import {
  RESOLUTION_DIMENSIONS,
  useComposerStore,
  type AspectPreset,
  type ResolutionTier,
} from "../../stores/composer";
import { useHealthStore, connState, ref2vaConnState } from "../../stores/health";
import { FrameSlot } from "./FrameSlot";
import { RefAssetsSection } from "./RefAssetsSection";
import { parseSeed, randomSeed } from "../../lib/seed";
import { pollTasks } from "../../api/commands";
import { useTasksStore } from "../../stores/tasks";
import { useSettingsStore } from "../../stores/settings";

export function CreatorPanel() {
  const mode = useComposerStore((s) => s.mode);
  const prompt = useComposerStore((s) => s.prompt);
  const setPrompt = useComposerStore((s) => s.setPrompt);
  const audioOpen = useComposerStore((s) => s.audioOpen);
  const setAudioOpen = useComposerStore((s) => s.setAudioOpen);
  const audioDesc = useComposerStore((s) => s.audioDesc);
  const setAudioDesc = useComposerStore((s) => s.setAudioDesc);
  const seedInput = useComposerStore((s) => s.seedInput);
  const setSeedInput = useComposerStore((s) => s.setSeedInput);
  const aspectPreset = useComposerStore((s) => s.aspectPreset);
  const setAspectPreset = useComposerStore((s) => s.setAspectPreset);
  const resolutionTier = useComposerStore((s) => s.resolutionTier);
  const setResolutionTier = useComposerStore((s) => s.setResolutionTier);
  const durationSeconds = useComposerStore((s) => s.durationSeconds);
  const setDurationSeconds = useComposerStore((s) => s.setDurationSeconds);
  const steps = useComposerStore((s) => s.steps);
  const setSteps = useComposerStore((s) => s.setSteps);
  const firstFrame = useComposerStore((s) => s.firstFrame);
  const lastFrame = useComposerStore((s) => s.lastFrame);
  const refImages = useComposerStore((s) => s.refImages);
  const refVideo = useComposerStore((s) => s.refVideo);
  const refAudio = useComposerStore((s) => s.refAudio);
  const lastSeed = useComposerStore((s) => s.lastSeed);
  const submitting = useComposerStore((s) => s.submitting);
  const submitProgress = useComposerStore((s) => s.submitProgress);
  const error = useComposerStore((s) => s.error);
  const submit = useComposerStore((s) => s.submit);

  const snapshot = useHealthStore((s) => s.snapshot);
  const offlineError = useHealthStore((s) => s.offlineError);
  const ref2vaState = useHealthStore(ref2vaConnState);
  const settings = useSettingsStore((s) => s.settings);

  const [copied, setCopied] = useState(false);

  const state = connState(snapshot, offlineError);
  const backend = settings?.backends.find((b) => b.id === settings.active_backend_id);
  const supportsCustomParameters = mode !== "ref2va" && backend?.kind === "gb10";
  const dimensions = RESOLUTION_DIMENSIONS[resolutionTier][aspectPreset];
  const serviceModes = snapshot?.task === "hybrid"
    ? ["t2va", "fl2va"]
    : snapshot?.task
      ? [snapshot.task]
      : backend?.modes ?? [];
  const supportsT2va = serviceModes.includes("t2va");
  const supportsFl2va = serviceModes.includes("fl2va");
  const seed = parseSeed(seedInput);

  // 禁用矩阵
  let disabledReason: string | null = null;
  if (mode === "ref2va") {
    // Ref2VA 依赖独立服务，状态判定与主服务解耦
    if (ref2vaState === "unconfigured") disabledReason = "Ref2VA 服务未配置，请到设置中填写地址";
    else if (ref2vaState === "offline") disabledReason = "Ref2VA 服务未连接";
    else if (ref2vaState === "loading") disabledReason = "Ref2VA 模型预热中";
    else if (ref2vaState === "error") disabledReason = "Ref2VA 服务异常";
  } else if (state === "offline") disabledReason = "H3 服务未连接";
  else if (state === "loading")
    disabledReason = `模型预热中 ${snapshot?.startup?.percent ?? 0}%`;
  else if (state === "error") disabledReason = "服务异常，无法提交";
  else if (mode === "t2va" && !supportsT2va) disabledReason = "当前后端未开放文生视频";
  else if (mode === "fl2va" && !supportsFl2va) disabledReason = "当前服务不是 Hybrid/FL2VA 模式";
  if (disabledReason === null) {
    if (!prompt.trim()) disabledReason = "请输入画面描述";
    else if (mode === "fl2va" && !firstFrame && !lastFrame)
      disabledReason = "首尾帧模式至少需要一帧";
    else if (
      mode === "ref2va" &&
      refImages.length === 0 &&
      !refVideo &&
      !refAudio
    )
      disabledReason = "参考生成至少需要一张图片或一段视频/音频";
    else if (seedInput.trim() && seed == null)
      disabledReason = "seed 需为 0 ~ 2^53 的整数";
  }

  const handleGenerate = async () => {
    if (disabledReason || submitting) return;
    const record = await submit(seed ?? 42);
    if (record) {
      // 立即打一发轮询
      void pollTasks([record.id]).then((items) => useTasksStore.getState().mergePoll(items));
    }
  };

  return (
    <aside className="flex w-[360px] shrink-0 flex-col gap-3 overflow-y-auto border-r border-line bg-surface p-4">
      {/* 帧槽位 */}
      {mode === "fl2va" && (
        <div className="flex gap-2">
          <FrameSlot slot="first" />
          <FrameSlot slot="last" />
        </div>
      )}

      {/* 参考素材（Ref2VA） */}
      {mode === "ref2va" && <RefAssetsSection />}

      {/* prompt */}
      <div className="relative">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="描述你想生成的画面，例如：雨夜的城市街道，镜头缓缓向前推进…"
          rows={6}
          maxLength={8000}
          className="w-full resize-none rounded-lg border border-line bg-surface-2 p-3 text-sm leading-relaxed outline-none transition placeholder:text-ink-3 focus:border-brand"
        />
        <span className="pointer-events-none absolute bottom-2 right-2.5 text-[10px] text-ink-3">
          {prompt.length}
        </span>
      </div>

      {/* 音频描述（折叠） */}
      <div className="rounded-lg border border-line bg-surface-2">
        <button
          onClick={() => setAudioOpen(!audioOpen)}
          className="flex w-full items-center justify-between px-3 py-2 text-xs text-ink-2 hover:text-ink"
        >
          <span>音频描述（可选）</span>
          <ChevronDown
            size={14}
            className={`transition ${audioOpen ? "rotate-180" : ""}`}
          />
        </button>
        {audioOpen && (
          <div className="px-3 pb-2.5">
            <input
              value={audioDesc}
              onChange={(e) => setAudioDesc(e.target.value)}
              placeholder="如：雨声、远处的车流与脚步声"
              className="w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs outline-none transition placeholder:text-ink-3 focus:border-brand"
            />
            <div className="mt-1 text-[10px] text-ink-3">
              以 overall_soundscape 追加到提示词，驱动同步音频生成
            </div>
          </div>
        )}
      </div>

      {/* generation parameters */}
      {mode !== "ref2va" && (
        <div className="space-y-2.5 border-y border-line py-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-ink-2">画幅</span>
            <span className="text-[10px] text-ink-3">
              {supportsCustomParameters
                ? `${dimensions.width} × ${dimensions.height}`
                : "Sol-H3 固定 16:9"}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-1 rounded-md bg-surface-2 p-1">
            {([
              { id: "landscape" as const, label: "16:9", icon: Monitor },
              { id: "portrait" as const, label: "9:16", icon: Smartphone },
              { id: "square" as const, label: "1:1", icon: Square },
            ]).map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => setAspectPreset(item.id as AspectPreset)}
                  disabled={!supportsCustomParameters}
                  className={`flex h-8 items-center justify-center gap-1.5 rounded text-[11px] transition ${
                    (supportsCustomParameters ? aspectPreset : "landscape") === item.id
                      ? "bg-surface-3 text-ink shadow-sm"
                      : "text-ink-3 hover:text-ink-2"
                  } disabled:cursor-not-allowed disabled:opacity-45`}
                  title={`${item.label} 画幅`}
                >
                  <Icon size={13} />
                  {item.label}
                </button>
              );
            })}
          </div>

          <label className="space-y-1">
            <span className="text-[10px] text-ink-3">分辨率档位</span>
            <select
              value={supportsCustomParameters ? resolutionTier : "768p"}
              onChange={(event) => setResolutionTier(event.target.value as ResolutionTier)}
              disabled={!supportsCustomParameters}
              className="h-8 w-full rounded-md border border-line bg-surface-2 px-2 text-xs tabular-nums outline-none focus:border-brand disabled:cursor-not-allowed disabled:opacity-45"
            >
              <option value="480p">480P · 快速</option>
              <option value="576p">576P · 均衡</option>
              <option value="768p">768P · 高质量</option>
            </select>
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="text-[10px] text-ink-3">时长</span>
              <select
                value={supportsCustomParameters ? durationSeconds : 5}
                onChange={(event) => setDurationSeconds(Number(event.target.value))}
                disabled={!supportsCustomParameters}
                className="h-8 w-full rounded-md border border-line bg-surface-2 px-2 text-xs tabular-nums outline-none focus:border-brand disabled:cursor-not-allowed disabled:opacity-45"
              >
                {[5, 8, 10, 12, 14].map((value) => (
                  <option key={value} value={value}>
                    {value} 秒
                  </option>
                ))}
              </select>
            </label>

            <div className="space-y-1">
              <span className="text-[10px] text-ink-3">步数</span>
              <div className="flex h-8 items-center rounded-md border border-line bg-surface-2">
                <button
                  onClick={() => setSteps(Math.max(1, steps - 5))}
                  disabled={!supportsCustomParameters || steps <= 1}
                  className="flex h-full w-8 items-center justify-center text-ink-3 hover:text-ink disabled:cursor-not-allowed disabled:opacity-35"
                  title="减少 5 步"
                >
                  <Minus size={12} />
                </button>
                <input
                  type={supportsCustomParameters ? "number" : "text"}
                  min={1}
                  max={100}
                  value={supportsCustomParameters ? steps : "固定"}
                  onChange={(event) =>
                    setSteps(Math.min(100, Math.max(1, Number(event.target.value) || 1)))
                  }
                  disabled={!supportsCustomParameters}
                  className="min-w-0 flex-1 bg-transparent text-center text-xs tabular-nums outline-none disabled:cursor-not-allowed"
                  aria-label="生成步数"
                />
                <button
                  onClick={() => setSteps(Math.min(100, steps + 5))}
                  disabled={!supportsCustomParameters || steps >= 100}
                  className="flex h-full w-8 items-center justify-center text-ink-3 hover:text-ink disabled:cursor-not-allowed disabled:opacity-35"
                  title="增加 5 步"
                >
                  <Plus size={12} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* seed */}
      <div className="flex items-center gap-2">
        <input
          value={seedInput}
          onChange={(e) => setSeedInput(e.target.value.replace(/[^\d]/g, ""))}
          placeholder="seed（默认 42）"
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs tabular-nums outline-none transition placeholder:text-ink-3 focus:border-brand"
        />
        <button
          onClick={() => setSeedInput(String(randomSeed()))}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-2 text-ink-2 transition hover:border-brand hover:text-ink"
          title="随机 seed"
        >
          <Dices size={15} />
        </button>
        {lastSeed != null && (
          <button
            onClick={() => setSeedInput(String(lastSeed))}
            className="shrink-0 rounded-lg border border-line bg-surface-2 px-2.5 py-2 text-[10px] text-ink-3 transition hover:text-ink-2"
            title="沿用上次 seed"
          >
            上次 {lastSeed}
          </button>
        )}
      </div>

      {/* 生成按钮 */}
      <button
        onClick={handleGenerate}
        disabled={Boolean(disabledReason) || submitting}
        className={`flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium text-white transition ${
          disabledReason || submitting
            ? "cursor-not-allowed bg-surface-3 text-ink-3"
            : "bg-gradient-to-r from-brand to-brand-2 hover:opacity-90"
        }`}
      >
        <Sparkles size={15} />
        {submitting ? (submitProgress?.detail ?? "提交中…") : "立即生成"}
      </button>
      {submitting && submitProgress && (
        <div className="-mt-1.5">
          <div className="h-1 overflow-hidden rounded-full bg-surface-3">
            <div
              className="h-full rounded-full bg-brand transition-all duration-300"
              style={{ width: `${submitProgress.percent}%` }}
            />
          </div>
          <div className="mt-1 text-center text-[10px] tabular-nums text-ink-3">
            {submitProgress.percent}%
          </div>
        </div>
      )}
      {disabledReason && (
        <div className="-mt-1.5 text-center text-[10px] text-ink-3">{disabledReason}</div>
      )}
      {error && (
        <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </div>
      )}

      {/* 快捷：复制完整提示词预览 */}
      {prompt.trim() && (
        <button
          onClick={() => {
            const composed = audioDesc.trim()
              ? `${prompt.trim()} overall_soundscape: ${audioDesc.trim()}`
              : prompt.trim();
            void navigator.clipboard.writeText(composed);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
          className="flex items-center justify-center gap-1 text-[10px] text-ink-3 transition hover:text-ink-2"
        >
          <Copy size={11} /> {copied ? "已复制" : "复制完整提示词"}
        </button>
      )}
    </aside>
  );
}
