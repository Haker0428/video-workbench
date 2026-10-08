import { create } from "zustand";
import type { FrameRef, RefAssetRef, SubmitProgress, TaskRecord } from "../types";
import { submitTask } from "../api/commands";
import { useTasksStore } from "./tasks";
import { useSettingsStore } from "./settings";

export type CreatorMode = "t2va" | "fl2va" | "ref2va";
export type AspectPreset = "landscape" | "portrait" | "square";
export type ResolutionTier = "480p" | "576p" | "768p";

export const RESOLUTION_DIMENSIONS: Record<
  ResolutionTier,
  Record<AspectPreset, { width: number; height: number }>
> = {
  "480p": {
    landscape: { width: 832, height: 480 },
    portrait: { width: 480, height: 832 },
    square: { width: 480, height: 480 },
  },
  "576p": {
    landscape: { width: 1024, height: 576 },
    portrait: { width: 576, height: 1024 },
    square: { width: 576, height: 576 },
  },
  "768p": {
    landscape: { width: 1344, height: 768 },
    portrait: { width: 768, height: 1344 },
    square: { width: 768, height: 768 },
  },
};

export type RefTag = "人物" | "场景" | "风格";
export const REF_TAGS: RefTag[] = ["人物", "场景", "风格"];

export interface RefImageItem {
  asset: RefAssetRef;
  tag: RefTag;
  name: string;
}

interface ComposerState {
  mode: CreatorMode;
  prompt: string;
  audioOpen: boolean;
  audioDesc: string;
  seedInput: string;
  aspectPreset: AspectPreset;
  resolutionTier: ResolutionTier;
  durationSeconds: number;
  steps: number;
  firstFrame: FrameRef | null;
  firstFrameName: string | null;
  lastFrame: FrameRef | null;
  lastFrameName: string | null;
  // Ref2VA
  refImages: RefImageItem[];
  refVideo: RefAssetRef | null;
  refVideoName: string | null;
  refAudio: RefAssetRef | null;
  refAudioName: string | null;
  lastSeed: number | null;
  submitting: boolean;
  submitProgress: SubmitProgress | null;
  error: string | null;
  setMode: (m: CreatorMode) => void;
  setPrompt: (p: string) => void;
  setAudioOpen: (v: boolean) => void;
  setAudioDesc: (v: string) => void;
  setSeedInput: (v: string) => void;
  setAspectPreset: (v: AspectPreset) => void;
  setResolutionTier: (v: ResolutionTier) => void;
  setDurationSeconds: (v: number) => void;
  setSteps: (v: number) => void;
  attachFrame: (slot: "first" | "last", ref: FrameRef, name: string) => void;
  detachFrame: (slot: "first" | "last") => void;
  attachRefImage: (asset: RefAssetRef, name: string) => void;
  detachRefImage: (assetId: string) => void;
  setRefTag: (assetId: string, tag: RefTag) => void;
  attachRefVideo: (asset: RefAssetRef, name: string) => void;
  detachRefVideo: () => void;
  attachRefAudio: (asset: RefAssetRef, name: string) => void;
  detachRefAudio: () => void;
  setSubmitProgress: (progress: SubmitProgress | null) => void;
  /** 校验并提交；成功返回记录，失败返回 null 并设置 error */
  submit: (seed: number | null) => Promise<TaskRecord | null>;
}

const MAX_REF_IMAGES = 4;

export const useComposerStore = create<ComposerState>((set, get) => ({
  mode: "t2va",
  prompt: "",
  audioOpen: false,
  audioDesc: "",
  seedInput: "",
  aspectPreset: "landscape",
  resolutionTier: "480p",
  durationSeconds: 5,
  steps: 50,
  firstFrame: null,
  firstFrameName: null,
  lastFrame: null,
  lastFrameName: null,
  refImages: [],
  refVideo: null,
  refVideoName: null,
  refAudio: null,
  refAudioName: null,
  lastSeed: null,
  submitting: false,
  submitProgress: null,
  error: null,
  setMode: (mode) => set({ mode }),
  setPrompt: (prompt) => set({ prompt }),
  setAudioOpen: (audioOpen) => set({ audioOpen }),
  setAudioDesc: (audioDesc) => set({ audioDesc }),
  setSeedInput: (seedInput) => set({ seedInput }),
  setAspectPreset: (aspectPreset) =>
    set((s) => {
      if (s.aspectPreset === aspectPreset) return {};
      const hadFrames = Boolean(s.firstFrame || s.lastFrame);
      return {
        aspectPreset,
        firstFrame: null,
        firstFrameName: null,
        lastFrame: null,
        lastFrameName: null,
        error: hadFrames ? "画幅已变化，请按新画幅重新添加首尾帧" : s.error,
      };
    }),
  setResolutionTier: (resolutionTier) =>
    set((s) => {
      if (s.resolutionTier === resolutionTier) return {};
      const hadFrames = Boolean(s.firstFrame || s.lastFrame);
      return {
        resolutionTier,
        firstFrame: null,
        firstFrameName: null,
        lastFrame: null,
        lastFrameName: null,
        error: hadFrames ? "分辨率已变化，请按新尺寸重新添加首尾帧" : s.error,
      };
    }),
  setDurationSeconds: (durationSeconds) => set({ durationSeconds }),
  setSteps: (steps) => set({ steps }),
  attachFrame: (slot, ref, name) =>
    slot === "first"
      ? set({ firstFrame: ref, firstFrameName: name, error: null })
      : set({ lastFrame: ref, lastFrameName: name, error: null }),
  detachFrame: (slot) =>
    slot === "first"
      ? set({ firstFrame: null, firstFrameName: null })
      : set({ lastFrame: null, lastFrameName: null }),
  attachRefImage: (asset, name) =>
    set((s) =>
      s.refImages.length >= MAX_REF_IMAGES
        ? { error: `图片参考最多 ${MAX_REF_IMAGES} 张` }
        : {
            refImages: [
              ...s.refImages,
              { asset, tag: s.refImages.length === 0 ? "人物" : "场景", name },
            ],
          },
    ),
  detachRefImage: (assetId) =>
    set((s) => ({ refImages: s.refImages.filter((r) => r.asset.asset_id !== assetId) })),
  setRefTag: (assetId, tag) =>
    set((s) => ({
      refImages: s.refImages.map((r) =>
        r.asset.asset_id === assetId ? { ...r, tag } : r,
      ),
    })),
  attachRefVideo: (asset, name) => set({ refVideo: asset, refVideoName: name }),
  detachRefVideo: () => set({ refVideo: null, refVideoName: null }),
  attachRefAudio: (asset, name) => set({ refAudio: asset, refAudioName: name }),
  detachRefAudio: () => set({ refAudio: null, refAudioName: null }),
  setSubmitProgress: (submitProgress) => set({ submitProgress }),
  submit: async (seed) => {
    const s = get();
    if (s.submitting) return null;
    set({
      error: null,
      submitting: true,
      submitProgress: { phase: "preparing", percent: 0, detail: "正在准备提交" },
    });
    const isRef = s.mode === "ref2va";
    const backend = useSettingsStore
      .getState()
      .settings?.backends.find(
        (item) => item.id === useSettingsStore.getState().settings?.active_backend_id,
      );
    const supportsCustomParameters = !isRef && backend?.kind === "gb10";
    const dimensions = RESOLUTION_DIMENSIONS[s.resolutionTier][s.aspectPreset];
    try {
      const record = await submitTask({
        prompt: s.prompt.trim(),
        audio_desc: s.audioDesc.trim() || null,
        seed,
        width: supportsCustomParameters ? dimensions.width : null,
        height: supportsCustomParameters ? dimensions.height : null,
        duration_s: supportsCustomParameters ? s.durationSeconds : null,
        steps: supportsCustomParameters ? s.steps : null,
        first_frame_id: isRef ? null : (s.firstFrame?.frame_id ?? null),
        last_frame_id: isRef ? null : (s.lastFrame?.frame_id ?? null),
        ref_images: isRef
          ? s.refImages.map((r) => ({ id: r.asset.asset_id, tag: r.tag }))
          : undefined,
        ref_video_id: isRef ? (s.refVideo?.asset_id ?? null) : null,
        ref_audio_id: isRef ? (s.refAudio?.asset_id ?? null) : null,
      });
      useTasksStore.getState().upsert(record);
      set({ submitting: false, submitProgress: null, lastSeed: record.request.seed ?? null });
      return record;
    } catch (e) {
      set({ submitting: false, submitProgress: null, error: String(e) });
      return null;
    }
  },
}));

/** 参数回填（再次生成 / 重试） */
export function fillFromRecord(record: TaskRecord) {
  const s = useComposerStore.getState();
  const hasFrames = record.request.first_frame_id || record.request.last_frame_id;
  const hasRefs =
    record.request.ref_images.length > 0 ||
    record.request.ref_video_id ||
    record.request.ref_audio_id;
  s.setMode(hasRefs ? "ref2va" : hasFrames ? "fl2va" : "t2va");
  s.setPrompt(record.request.prompt);
  s.setAudioDesc(record.request.audio_desc ?? "");
  s.setAudioOpen(Boolean(record.request.audio_desc));
  s.setSeedInput(record.request.seed != null ? String(record.request.seed) : "");
  const aspectPreset: AspectPreset =
    record.request.width != null &&
    record.request.height != null &&
    record.request.width < record.request.height
      ? "portrait"
      : record.request.width != null && record.request.width === record.request.height
        ? "square"
        : "landscape";
  s.setAspectPreset(aspectPreset);
  const longestSide = Math.max(record.request.width ?? 0, record.request.height ?? 0);
  s.setResolutionTier(longestSide > 1024 ? "768p" : longestSide > 832 ? "576p" : "480p");
  s.setDurationSeconds(record.request.duration_s ?? 5);
  s.setSteps(record.request.steps ?? 50);
  // 帧回填：文件仍在 frames/ 下（内容寻址），直接引用相对路径
  if (record.request.first_frame_id) {
    s.attachFrame(
      "first",
      {
        frame_id: record.request.first_frame_id,
        mime: "image/*",
        size: 0,
        file: record.request.first_frame_file ?? "",
      },
      "历史帧",
    );
  }
  if (record.request.last_frame_id) {
    s.attachFrame(
      "last",
      {
        frame_id: record.request.last_frame_id,
        mime: "image/*",
        size: 0,
        file: record.request.last_frame_file ?? "",
      },
      "历史帧",
    );
  }
  // Ref2VA 参考回填
  useComposerStore.setState({
    refImages: record.request.ref_images.map((r, i) => ({
      asset: { asset_id: r.id, mime: "image/*", size: 0, file: r.file },
      tag: (REF_TAGS.includes(r.tag as RefTag) ? r.tag : "场景") as RefTag,
      name: `历史参考 ${i + 1}`,
    })),
    refVideo:
      record.request.ref_video_id != null
        ? {
            asset_id: record.request.ref_video_id,
            mime: "video/*",
            size: 0,
            file: record.request.ref_video_file ?? "",
          }
        : null,
    refVideoName: record.request.ref_video_id ? "历史视频参考" : null,
    refAudio:
      record.request.ref_audio_id != null
        ? {
            asset_id: record.request.ref_audio_id,
            mime: "audio/*",
            size: 0,
            file: record.request.ref_audio_file ?? "",
          }
        : null,
    refAudioName: record.request.ref_audio_id ? "历史音频参考" : null,
  });
}

export { MAX_REF_IMAGES };
