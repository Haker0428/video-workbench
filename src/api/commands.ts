import { invoke } from "@tauri-apps/api/core";
import type {
  ArchiveProgress,
  BackendControlResult,
  ChatSession,
  FrameRef,
  HealthSnapshot,
  PollItem,
  RefAssetRef,
  RuntimeInfo,
  Settings,
  SubmitParams,
  TaskRecord,
} from "../types";

export const getSettings = () => invoke<Settings>("get_settings");

export const setSettings = (settings: Settings) =>
  invoke<Settings>("set_settings", { settings });

export const getHealth = (target?: "ref2va" | string) =>
  invoke<HealthSnapshot>("get_health", { target });

export const controlBackend = (action: "start" | "stop", backendId?: string) =>
  invoke<BackendControlResult>("control_backend", { action, backendId });

export const listTasks = () => invoke<TaskRecord[]>("list_tasks");

export const submitTask = (params: SubmitParams) =>
  invoke<TaskRecord>("submit_task", { params });

export const pollTasks = (ids: string[]) => invoke<PollItem[]>("poll_tasks", { ids });

export const deleteTask = (id: string, deleteFiles: boolean) =>
  invoke<void>("delete_task", { id, deleteFiles });

export const saveThumbnail = (id: string, dataUrl: string) =>
  invoke<void>("save_thumbnail", { id, dataUrl });

export const archiveTask = (id: string) => invoke<string>("archive_task", { id });

export const revealTaskFiles = (id: string) => invoke<void>("reveal_task_files", { id });

export const exportTaskVideo = (id: string, dest: string) =>
  invoke<string>("export_task_video", { id, dest });

/** 原始字节经 IPC raw body 传输 */
export const saveFrame = (bytes: Uint8Array) => invoke<FrameRef>("save_frame", bytes);

export const saveRefVideo = (bytes: Uint8Array) =>
  invoke<RefAssetRef>("save_ref_video", bytes);

export const saveRefAudio = (bytes: Uint8Array) =>
  invoke<RefAssetRef>("save_ref_audio", bytes);

export const getRuntimeInfo = () => invoke<RuntimeInfo>("get_runtime_info");

export const listChats = () => invoke<ChatSession[]>("list_chats");

export const saveChat = (session: ChatSession) =>
  invoke<void>("save_chat", { session });

export const deleteChat = (id: string) => invoke<void>("delete_chat", { id });

export type { ArchiveProgress };
