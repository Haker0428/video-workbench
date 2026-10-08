import { useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { saveFrame } from "../../api/commands";
import { RESOLUTION_DIMENSIONS, useComposerStore } from "../../stores/composer";
import { useSettingsStore } from "../../stores/settings";
import { FRAME_MAX_BYTES, prepareKeyframeBytes } from "../../lib/files";
import { h3videoUrl } from "../../lib/scheme";
import { fmtBytes } from "../../lib/format";
import type { FrameRef } from "../../types";

interface Props {
  slot: "first" | "last";
}

const LABEL = { first: "首帧", last: "尾帧" } as const;

export function FrameSlot({ slot }: Props) {
  const frame = useComposerStore((s) => (slot === "first" ? s.firstFrame : s.lastFrame));
  const name = useComposerStore((s) => (slot === "first" ? s.firstFrameName : s.lastFrameName));
  const attach = useComposerStore((s) => s.attachFrame);
  const detach = useComposerStore((s) => s.detachFrame);
  const aspectPreset = useComposerStore((s) => s.aspectPreset);
  const resolutionTier = useComposerStore((s) => s.resolutionTier);
  const settings = useSettingsStore((s) => s.settings);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const backend = settings?.backends.find((item) => item.id === settings.active_backend_id);
  const dimensions = backend?.kind === "gb10"
    ? RESOLUTION_DIMENSIONS[resolutionTier][aspectPreset]
    : RESOLUTION_DIMENSIONS["768p"].landscape;
  const previewStyle = { aspectRatio: `${dimensions.width} / ${dimensions.height}` };

  const handleFile = async (file: File) => {
    setError(null);
    if (file.size > FRAME_MAX_BYTES) {
      setError(`图片超过 16MiB（当前 ${fmtBytes(file.size)}）`);
      return;
    }
    setLoading(true);
    try {
      const bytes = await prepareKeyframeBytes(file, dimensions.width, dimensions.height);
      const ref: FrameRef = await saveFrame(bytes);
      attach(slot, ref, file.name);
    } catch (e) {
      setError(String(e).replace(/^.*invalid request:\s*/, ""));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-w-0 flex-1">
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
          e.target.value = "";
        }}
      />
      {frame && frame.file ? (
        <div
          className="group relative overflow-hidden rounded-lg border border-line bg-surface-2"
          style={previewStyle}
        >
          <img
            src={h3videoUrl(frame.file)}
            alt={LABEL[slot]}
            className="h-full w-full object-cover"
            draggable={false}
          />
          <div className="absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
            {LABEL[slot]}
            {name && name !== "历史帧" ? ` · ${name}` : name ? ` · ${name}` : ""}
          </div>
          <div className="absolute bottom-1.5 right-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] tabular-nums text-white">
            {dimensions.width}×{dimensions.height}
          </div>
          <button
            onClick={() => detach(slot)}
            className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded bg-black/60 text-white opacity-0 transition group-hover:opacity-100 hover:bg-danger"
            title="移除"
          >
            <X size={13} />
          </button>
        </div>
      ) : (
        <button
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void handleFile(f);
          }}
          style={previewStyle}
          className={`flex w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed transition ${
            dragOver
              ? "border-brand bg-brand/10"
              : "border-line bg-surface-2 hover:border-ink-3 hover:bg-surface-3"
          }`}
        >
          <ImagePlus size={20} className="text-ink-3" />
          <span className="text-xs text-ink-2">
            {loading ? "适配画面中…" : `添加${LABEL[slot]}`}
          </span>
          <span className="text-[10px] text-ink-3">点击或拖拽 · png/jpg/webp ≤16MiB</span>
        </button>
      )}
      {error && <div className="mt-1 text-[10px] leading-tight text-danger">{error}</div>}
    </div>
  );
}
