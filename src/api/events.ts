import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ArchiveProgress } from "../types";

export const ARCHIVE_EVENT = "h3://archive-progress";

export function onArchiveProgress(
  handler: (p: ArchiveProgress) => void,
): Promise<UnlistenFn> {
  return listen<ArchiveProgress>(ARCHIVE_EVENT, (e) => handler(e.payload));
}
