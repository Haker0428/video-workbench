import { useRef, useState } from "react";
import {
  Film,
  ImagePlus,
  Music,
  Video,
  X,
} from "lucide-react";
import { saveFrame, saveRefAudio, saveRefVideo } from "../../api/commands";
import { REF_TAGS, useComposerStore, type RefTag } from "../../stores/composer";
import { readFileBytes } from "../../lib/files";
import { h3videoUrl } from "../../lib/scheme";
import { fmtBytes } from "../../lib/format";
import { ref2vaConnState, useHealthStore } from "../../stores/health";
import type { RefAssetRef } from "../../types";

const IMG_MAX = 16 * 1024 * 1024;
const VIDEO_MAX = 96 * 1024 * 1024;
const AUDIO_MAX = 16 * 1024 * 1024;

function clean(e: unknown): string {
  return String(e).replace(/^.*invalid request:\s*/, "").replace(/^"|"$/g, "");
}

/** Ref2VA 参考素材区：多图（带语义标签）+ 可选视频/音频 */
export function RefAssetsSection() {
  const refImages = useComposerStore((s) => s.refImages);
  const refVideo = useComposerStore((s) => s.refVideo);
  const refVideoName = useComposerStore((s) => s.refVideoName);
  const refAudio = useComposerStore((s) => s.refAudio);
  const refAudioName = useComposerStore((s) => s.refAudioName);
  const attachImage = useComposerStore((s) => s.attachRefImage);
  const detachImage = useComposerStore((s) => s.detachRefImage);
  const setTag = useComposerStore((s) => s.setRefTag);
  const attachVideo = useComposerStore((s) => s.attachRefVideo);
  const detachVideo = useComposerStore((s) => s.detachRefVideo);
  const attachAudio = useComposerStore((s) => s.attachRefAudio);
  const detachAudio = useComposerStore((s) => s.detachRefAudio);

  const health = useHealthStore();
  const refState = ref2vaConnState(health);

  const imgInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const totalBytes =
    refImages.reduce((n, r) => n + r.asset.size, 0) +
    (refVideo?.size ?? 0) +
    (refAudio?.size ?? 0);

  const handleImage = async (file: File) => {
    setError(null);
    if (file.size > IMG_MAX) {
      setError(`图片超过 16MiB（当前 ${fmtBytes(file.size)}）`);
      return;
    }
    setBusy(true);
    try {
      const asset = await saveRefAssetChecked(await readFileBytes(file), "image");
      attachImage(asset, file.name);
    } catch (e) {
      setError(clean(e));
    } finally {
      setBusy(false);
    }
  };

  const handleVideo = async (file: File) => {
    setError(null);
    if (file.size > VIDEO_MAX) {
      setError(`视频超过 96MiB（当前 ${fmtBytes(file.size)}）`);
      return;
    }
    setBusy(true);
    try {
      const asset = await saveRefAssetChecked(await readFileBytes(file), "video");
      attachVideo(asset, file.name);
    } catch (e) {
      setError(clean(e));
    } finally {
      setBusy(false);
    }
  };

  const handleAudio = async (file: File) => {
    setError(null);
    if (file.size > AUDIO_MAX) {
      setError(`音频超过 16MiB（当前 ${fmtBytes(file.size)}）`);
      return;
    }
    setBusy(true);
    try {
      const asset = await saveRefAssetChecked(await readFileBytes(file), "audio");
      attachAudio(asset, file.name);
    } catch (e) {
      setError(clean(e));
    } finally {
      setBusy(false);
    }
  };

  const mediaInput = (
    kind: "image" | "video" | "audio",
    ref: React.RefObject<HTMLInputElement | null>,
  ) => (
    <input
      ref={ref}
      type="file"
      accept={
        kind === "image"
          ? "image/png,image/jpeg,image/webp"
          : kind === "video"
            ? "video/mp4,video/webm"
            : "audio/wav,audio/mpeg,audio/mp4,audio/ogg,audio/flac"
      }
      className="hidden"
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) {
          void (kind === "image"
            ? handleImage(f)
            : kind === "video"
              ? handleVideo(f)
              : handleAudio(f));
        }
        e.target.value = "";
      }}
    />
  );

  return (
    <div className="rounded-lg border border-line bg-surface-2 p-2.5">
      {/* 服务状态行 */}
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs text-ink-2">参考素材</span>
        <ServiceDot state={refState} />
      </div>

      {/* 图片参考 */}
      <div className="flex flex-wrap gap-2">
        {mediaInput("image", imgInput)}
        {refImages.map((r) => (
          <div
            key={r.asset.asset_id}
            className="group relative h-[64px] w-[64px] shrink-0 overflow-hidden rounded-md border border-line"
          >
            <img
              src={h3videoUrl(r.asset.file)}
              alt={r.tag}
              className="h-full w-full object-cover"
              draggable={false}
            />
            {/* 标签选择 */}
            <label className="absolute inset-x-0 bottom-0 cursor-pointer bg-black/60 px-1 py-0.5 text-center text-[9px] text-white">
              {r.tag}
              <select
                value={r.tag}
                onChange={(e) => setTag(r.asset.asset_id, e.target.value as RefTag)}
                className="absolute inset-0 cursor-pointer opacity-0"
              >
                {REF_TAGS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={() => detachImage(r.asset.asset_id)}
              className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded bg-black/60 text-white opacity-0 transition group-hover:opacity-100 hover:bg-danger"
            >
              <X size={10} />
            </button>
          </div>
        ))}
        {refImages.length < 4 && (
          <button
            onClick={() => imgInput.current?.click()}
            className="flex h-[64px] w-[64px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-md border border-dashed border-line text-ink-3 transition hover:border-ink-3 hover:text-ink-2"
            title="添加图片参考（最多 4 张）"
          >
            <ImagePlus size={16} />
            <span className="text-[9px]">{busy ? "…" : "图片"}</span>
          </button>
        )}
      </div>

      {/* 视频参考 */}
      <div className="mt-2">
        {mediaInput("video", videoInput)}
        {refVideo ? (
          <div className="flex items-center gap-2 rounded-md bg-surface px-2 py-1.5">
            <Video size={13} className="shrink-0 text-brand-2" />
            <span className="min-w-0 flex-1 truncate text-[11px] text-ink-2">
              {refVideoName ?? refVideo.file}
            </span>
            <span className="shrink-0 text-[9px] text-ink-3">{fmtBytes(refVideo.size)}</span>
            <button
              onClick={detachVideo}
              className="text-ink-3 transition hover:text-danger"
            >
              <X size={12} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => videoInput.current?.click()}
            className="flex w-full items-center gap-2 rounded-md border border-dashed border-line px-2 py-1.5 text-ink-3 transition hover:border-ink-3 hover:text-ink-2"
          >
            <Video size={13} />
            <span className="text-[11px]">视频参考（可选 · mp4/webm ≤96MiB）</span>
          </button>
        )}
      </div>

      {/* 音频参考 */}
      <div className="mt-2">
        {mediaInput("audio", audioInput)}
        {refAudio ? (
          <div className="flex items-center gap-2 rounded-md bg-surface px-2 py-1.5">
            <Music size={13} className="shrink-0 text-ok" />
            <span className="min-w-0 flex-1 truncate text-[11px] text-ink-2">
              {refAudioName ?? refAudio.file}
            </span>
            <span className="shrink-0 text-[9px] text-ink-3">{fmtBytes(refAudio.size)}</span>
            <button
              onClick={detachAudio}
              className="text-ink-3 transition hover:text-danger"
            >
              <X size={12} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => audioInput.current?.click()}
            className="flex w-full items-center gap-2 rounded-md border border-dashed border-line px-2 py-1.5 text-ink-3 transition hover:border-ink-3 hover:text-ink-2"
          >
            <Music size={13} />
            <span className="text-[11px]">音频参考（可选 · 声音/音色 ≤16MiB）</span>
          </button>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between text-[9px] text-ink-3">
        <span>图片 ≤4 张（每张 16MiB）· 提示词可用 @称呼 指代参考</span>
        {totalBytes > 0 && <span>{fmtBytes(totalBytes)}</span>}
      </div>
      {error && <div className="mt-1 text-[10px] leading-tight text-danger">{error}</div>}
    </div>
  );
}

function ServiceDot({ state }: { state: ReturnType<typeof ref2vaConnState> }) {
  if (state === "unconfigured")
    return (
      <span className="flex items-center gap-1 text-[10px] text-ink-3">
        <Film size={10} /> 服务未配置
      </span>
    );
  if (state === "ready")
    return (
      <span className="flex items-center gap-1 text-[10px] text-ok">
        <span className="h-1.5 w-1.5 rounded-full bg-ok" /> Ref2VA 就绪
      </span>
    );
  if (state === "loading")
    return (
      <span className="flex items-center gap-1 text-[10px] text-brand">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" />
        预热中 {useHealthStore.getState().ref2vaSnapshot?.startup?.percent ?? 0}%
      </span>
    );
  if (state === "error")
    return (
      <span className="flex items-center gap-1 text-[10px] text-danger">
        <span className="h-1.5 w-1.5 rounded-full bg-danger" /> 服务异常
      </span>
    );
  return (
    <span className="flex items-center gap-1 text-[10px] text-ink-3">
      <span className="h-1.5 w-1.5 rounded-full bg-ink-3" /> 已断开
    </span>
  );
}

async function saveRefAssetChecked(
  bytes: Uint8Array,
  kind: "image" | "video" | "audio",
): Promise<RefAssetRef> {
  if (kind === "video") return saveRefVideo(bytes);
  if (kind === "audio") return saveRefAudio(bytes);
  // 图片复用 save_frame（内容寻址，同一目录）
  const ref = await saveFrame(bytes);
  return { asset_id: ref.frame_id, mime: ref.mime, size: ref.size, file: ref.file };
}
