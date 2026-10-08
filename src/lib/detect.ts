import type { ChatAttachment, SubmitParams } from "../types";

export type AutoMode = "t2va" | "fl2va" | "ref2va";

export const MODE_LABEL: Record<AutoMode, string> = {
  t2va: "文生视频",
  fl2va: "首尾帧",
  ref2va: "参考生成",
};

/**
 * 按附件资源自动判定生成模式：
 * - 含视频/音频参考，或图片 >2 张 → ref2va
 * - 图片 1..2 张 → fl2va（第 1 张为首帧、第 2 张为尾帧）
 * - 无附件 → t2va
 */
export function detectMode(attachments: ChatAttachment[]): AutoMode {
  const images = attachments.filter((a) => a.kind === "image");
  const hasMedia = attachments.some((a) => a.kind === "video" || a.kind === "audio");
  if (hasMedia || images.length > 2) return "ref2va";
  if (images.length >= 1) return "fl2va";
  return "t2va";
}

/** 按判定的模式把附件映射进 SubmitParams。 */
export function buildParams(
  prompt: string,
  attachments: ChatAttachment[],
  mode: AutoMode,
  seed: number | null,
  audioDesc?: string | null,
): SubmitParams {
  const images = attachments.filter((a) => a.kind === "image");
  const video = attachments.find((a) => a.kind === "video");
  const audio = attachments.find((a) => a.kind === "audio");
  const base: SubmitParams = {
    prompt: prompt.trim(),
    audio_desc: audioDesc?.trim() || null,
    seed,
  };
  if (mode === "t2va") return base;
  if (mode === "fl2va") {
    return {
      ...base,
      first_frame_id: images[0]?.asset_id ?? null,
      last_frame_id: images[1]?.asset_id ?? null,
    };
  }
  // ref2va：图片默认按 人物→场景→风格 轮转打标
  const defaultTags = ["人物", "场景", "风格", "场景"];
  return {
    ...base,
    ref_images: images.map((a, i) => ({ id: a.asset_id, tag: defaultTags[i % defaultTags.length] })),
    ref_video_id: video?.asset_id ?? null,
    ref_audio_id: audio?.asset_id ?? null,
  };
}
