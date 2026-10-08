/** 读文件为字节数组（供 save_frame 走 IPC raw body）。 */
export function readFileBytes(file: File): Promise<Uint8Array> {
  return file.arrayBuffer().then((b) => new Uint8Array(b));
}

function drawCover(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const drawnWidth = sourceWidth * scale;
  const drawnHeight = sourceHeight * scale;
  context.drawImage(
    source,
    x + (width - drawnWidth) / 2,
    y + (height - drawnHeight) / 2,
    drawnWidth,
    drawnHeight,
  );
}

/**
 * Convert a keyframe to the selected H3 output canvas without distorting it.
 * Sources with a different aspect ratio are shown in full over a subdued,
 * blurred fill.
 */
export async function prepareKeyframeBytes(
  file: File,
  targetWidth: number,
  targetHeight: number,
): Promise<Uint8Array> {
  if (targetWidth <= 0 || targetHeight <= 0) {
    throw new Error("无效的目标画面尺寸");
  }
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    if (bitmap.width <= 0 || bitmap.height <= 0) {
      throw new Error("无法读取图片尺寸");
    }
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法创建图片处理画布");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";

    const targetRatio = targetWidth / targetHeight;
    const sourceRatio = bitmap.width / bitmap.height;
    if (Math.abs(sourceRatio - targetRatio) < 0.01) {
      context.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
    } else if (
      (sourceRatio < 1) === (targetRatio < 1) &&
      Math.abs(sourceRatio - targetRatio) / targetRatio <= 0.25
    ) {
      // Nearby ratios in the same orientation look cleaner with a small center
      // crop than with duplicated blur bands at the canvas edges.
      drawCover(
        context,
        bitmap,
        bitmap.width,
        bitmap.height,
        0,
        0,
        targetWidth,
        targetHeight,
      );
    } else {
      const bleed = Math.max(24, Math.round(Math.max(targetWidth, targetHeight) * 0.027));
      context.save();
      context.filter = `blur(${Math.max(18, Math.round(bleed * 0.78))}px) brightness(0.62) saturate(0.82)`;
      drawCover(
        context,
        bitmap,
        bitmap.width,
        bitmap.height,
        -bleed,
        -bleed,
        targetWidth + bleed * 2,
        targetHeight + bleed * 2,
      );
      context.restore();

      const scale = Math.min(targetWidth / bitmap.width, targetHeight / bitmap.height);
      const width = Math.round(bitmap.width * scale);
      const height = Math.round(bitmap.height * scale);
      context.drawImage(
        bitmap,
        Math.round((targetWidth - width) / 2),
        Math.round((targetHeight - height) / 2),
        width,
        height,
      );
    }

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (value) => value ? resolve(value) : reject(new Error("图片处理失败")),
        "image/jpeg",
        0.94,
      );
    });
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    bitmap.close();
  }
}

/** 单帧 16MiB、两帧 base64 合计 ≈ 4/3 倍，需 < 24MiB（留 1MiB 余量给 prompt/JSON 结构）。 */
export const FRAME_MAX_BYTES = 16 * 1024 * 1024;
export const BODY_BUDGET_BYTES = 23 * 1024 * 1024;

export function base64Size(bytes: number): number {
  return Math.ceil(bytes / 3) * 4;
}
