// 与 src-tauri 的 serde 模型一一对应

export interface Settings {
  base_url: string;
  api_key: string | null;
  auto_archive: boolean;
  ref2va_base_url: string | null;
  ref2va_api_key: string | null;
  active_backend_id: string;
  backends: BackendConfig[];
}

export interface BackendConfig {
  id: string;
  label: string;
  kind: "sol_h3" | "gb10" | string;
  base_url: string;
  api_key: string | null;
  ssh_target: string | null;
  start_command: string | null;
  stop_command: string | null;
  modes: string[];
}

export interface BackendControlResult {
  backend_id: string;
  action: "start" | "stop";
  state: string;
  message: string;
}

export interface StartupInfo {
  phase: string;
  percent?: number;
  detail?: string;
  elapsed_s?: number;
  estimated_total_s?: number;
  estimated_remaining_s?: number;
}

export interface HealthSnapshot {
  status: string;
  task?: string;
  queue_depth?: number;
  active_task_id?: string | null;
  startup?: StartupInfo | null;
  error?: string | null;
}

export type ConnState = "ready" | "loading" | "error" | "offline";

export type TaskStatus = "queued" | "running" | "completed" | "failed";

export interface RequestParams {
  prompt: string;
  audio_desc?: string | null;
  composed_prompt: string;
  seed?: number | null;
  width?: number | null;
  height?: number | null;
  duration_s?: number | null;
  steps?: number | null;
  first_frame_id?: string | null;
  last_frame_id?: string | null;
  first_frame_file?: string | null;
  last_frame_file?: string | null;
  ref_images: RefImage[];
  ref_video_id?: string | null;
  ref_video_file?: string | null;
  ref_audio_id?: string | null;
  ref_audio_file?: string | null;
}

/** Ref2VA 图片参考（tag: 人物/场景/风格，仅客户端记录） */
export interface RefImage {
  id: string;
  tag: string;
  file: string;
}

export interface ServerInfo {
  started_at?: string | null;
  completed_at?: string | null;
  e2e_s?: number | null;
  qwen_s?: number | null;
  stage1_s?: number | null;
  stage2_s?: number | null;
  progress?: GenerationProgress | null;
  error?: string | null;
}

export interface GenerationProgress {
  phase: string;
  current_step?: number | null;
  total_steps?: number | null;
  percent?: number | null;
}

export interface LocalInfo {
  video_file?: string | null;
  archived: boolean;
  bytes_total?: number | null;
  thumb_file?: string | null;
}

export interface PollInfo {
  last_polled_at?: string | null;
  lost: boolean;
  lost_reason?: string | null;
}

export interface TaskRecord {
  id: string;
  created_at: string;
  backend_id: string;
  backend_label: string;
  service_base_url?: string | null;
  request: RequestParams;
  routed_task: string;
  status: TaskStatus;
  server: ServerInfo;
  local: LocalInfo;
  poll: PollInfo;
}

export interface PollItem {
  id: string;
  record?: TaskRecord;
  offline?: string;
  error?: string;
}

export interface FrameRef {
  frame_id: string;
  mime: string;
  size: number;
  /** 相对 app_data_dir 的路径 */
  file: string;
}

export interface ArchiveProgress {
  id: string;
  state: "downloading" | "done" | "failed";
  received?: number;
  total?: number;
  error?: string;
}

export interface SubmitParams {
  prompt: string;
  audio_desc?: string | null;
  seed?: number | null;
  width?: number | null;
  height?: number | null;
  duration_s?: number | null;
  steps?: number | null;
  first_frame_id?: string | null;
  last_frame_id?: string | null;
  ref_images?: SubmitRefImage[];
  ref_video_id?: string | null;
  ref_audio_id?: string | null;
}

export interface SubmitRefImage {
  id: string;
  tag: string;
}

export interface SubmitProgress {
  phase: string;
  percent: number;
  detail: string;
}

export interface RefAssetRef {
  asset_id: string;
  mime: string;
  size: number;
  file: string;
}

export interface RuntimeInfo {
  data_dir: string;
  version: string;
  now: string;
}

// ---------- 对话生成模式 ----------

export interface ChatAttachment {
  asset_id: string;
  file: string;
  kind: "image" | "video" | "audio";
  name?: string | null;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text?: string | null;
  /** 该消息生成任务实际使用的模式 */
  mode?: string | null;
  /** 用户的选择："auto" 或显式模式 */
  mode_selection?: string | null;
  task_id?: string | null;
  attachments: ChatAttachment[];
  created_at: string;
}

export interface ChatSession {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  messages: ChatMessage[];
}
