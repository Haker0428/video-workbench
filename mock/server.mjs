#!/usr/bin/env node
// 零依赖 mock Sol-H3-Spark 服务：无 GPU 环境下开发/验证工作台全流程。
// 用法：node mock/server.mjs [--port 30010] [--startup-secs 60] [--gen-secs 15]
//                      [--fail-rate 0] [--lose-files] [--fatal] [--queue 0]
// 端点行为对齐 doc/h3-http-api.md：/health、POST /v1/videos、
// GET /v1/videos/{id}、GET /v1/videos/{id}/content（支持 Range/206）。

import http from "node:http";
import crypto from "node:crypto";
import { readFileSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// ---------- CLI 参数 ----------
const argv = process.argv.slice(2);
function argOf(name, fallback) {
  const i = argv.indexOf(name);
  if (i >= 0 && argv[i + 1] !== undefined) return argv[i + 1];
  return fallback;
}
const hasFlag = (name) => argv.includes(name);

const HOST = argOf("--host", "127.0.0.1");
const PORT = Number(argOf("--port", 30010));
const STARTUP_SECS = Number(argOf("--startup-secs", 60)); // 0 = 立即 ready
const GEN_SECS = Number(argOf("--gen-secs", 15)); // 任务 queued→completed 总时长
const RUNNING_AFTER_SECS = 2; // queued 持续时长
const FAIL_RATE = Number(argOf("--fail-rate", 0));
const LOSE_FILES = hasFlag("--lose-files");
const FATAL = hasFlag("--fatal");
const QUEUE_DEPTH = Number(argOf("--queue", 0));
// 服务模式：t2va/fl2va/hybrid/ref2va（ref2va 为独立部署形态，只接受 ref 请求）
const TASK_MODE = argOf("--task", "hybrid");

const SAMPLE_MP4 = path.join(path.dirname(fileURLToPath(import.meta.url)), "assets", "sample.mp4");
const SAMPLE_BYTES = readFileSync(SAMPLE_MP4);
const SAMPLE_LEN = SAMPLE_BYTES.length;

// Ref2VA 参考素材可能很大，body 上限提到 96MiB（见 doc/ref2va-http-api-proposal.md）
const MAX_BODY = 96 * 1024 * 1024;
const FRAME_MIMES = new Set(["image/png", "image/jpeg", "image/webp"]);
const VIDEO_MIMES = new Set(["video/mp4", "video/webm"]);
const AUDIO_MIMES = new Set(["audio/wav", "audio/mpeg", "audio/mp4", "audio/ogg", "audio/flac", "audio/x-wav", "audio/x-m4a"]);
const ALLOWED_FIELDS = new Set([
  "prompt", "seed",
  "first_frame_path", "last_frame_path",
  "first_frame_base64", "last_frame_base64",
  // Ref2VA（提案契约）
  "ref_image_path", "ref_image_base64",
  "ref_video_path", "ref_video_base64",
  "ref_audio_path", "ref_audio_base64",
]);

// ---------- /health 预热阶段（对齐真实服务的 phase/percent 表） ----------
const PHASES = [
  ["waiting", 0, "等待开始加载"],
  ["loading_stage1", 5, "加载 MiniMax-H3 Stage1"],
  ["loading_warmup_qwen", 18, "加载临时 Qwen worker"],
  ["encoding_warmup_prompt", 25, "编码预热提示词"],
  ["running_stage1_warmup", 32, "执行 Stage1 预热"],
  ["loading_stage2", 56, "加载 LTX Stage2"],
  ["preparing_stage2", 68, "准备 Stage2 固定形状请求"],
  ["running_stage2_warmup", 72, "编译并运行 Stage2 预热"],
  ["loading_resident_qwen", 94, "加载常驻 Qwen"],
  ["running_t2va_warmup", 96, "预热无图片 T2VA 路径"],
  ["ready", 100, "All model workers are resident and ready"],
];

const BOOTED_AT = Date.now();

function healthPayload() {
  const now = new Date().toISOString();
  const elapsed = (Date.now() - BOOTED_AT) / 1000;
  if (FATAL) {
    return {
      status: "error",
      task: TASK_MODE,
      queue_depth: 0,
      startup: null,
      error: "RuntimeError: mock fatal error in generation pipeline",
      created_at: new Date(BOOTED_AT).toISOString(),
    };
  }
  if (elapsed >= STARTUP_SECS) {
    return {
      status: "ready",
      task: TASK_MODE,
      queue_depth: QUEUE_DEPTH,
      startup: {
        phase: "ready", percent: 100, detail: PHASES.at(-1)[2],
        started_at: new Date(BOOTED_AT).toISOString(),
        completed_at: new Date(BOOTED_AT + STARTUP_SECS * 1000).toISOString(),
        elapsed_s: round3(elapsed),
        estimated_total_s: STARTUP_SECS,
        estimated_remaining_s: 0,
      },
      error: null,
      created_at: new Date(BOOTED_AT).toISOString(),
    };
  }
  const percent = Math.min(99, Math.floor((elapsed / STARTUP_SECS) * 100));
  let phase = PHASES[0];
  for (const p of PHASES) { if (percent >= p[1]) phase = p; }
  return {
    status: "loading",
    task: TASK_MODE,
    queue_depth: QUEUE_DEPTH,
    startup: {
      phase: phase[0], percent,
      detail: phase[0] === "waiting" ? "Waiting for startup" : `${phase[2]}（mock）`,
      started_at: new Date(BOOTED_AT).toISOString(),
      completed_at: null,
      elapsed_s: round3(elapsed),
      estimated_total_s: STARTUP_SECS,
      estimated_remaining_s: round3(Math.max(0, STARTUP_SECS - elapsed)),
    },
    error: null,
    created_at: new Date(BOOTED_AT).toISOString(),
  };
}

const round3 = (n) => Math.round(n * 1000) / 1000;

// ---------- 任务状态机 ----------
const tasks = new Map(); // id → task record

function genId() {
  return crypto.randomBytes(16).toString("hex");
}

function taskView(t) {
  const view = {
    id: t.id,
    status: t.status,
    task: t.task,
    seed: t.seed,
    created_at: t.created_at,
  };
  if (t.started_at) view.started_at = t.started_at;
  if (t.status === "completed") {
    view.completed_at = t.completed_at;
    view.e2e_s = t.e2e_s;
    view.qwen_s = round3(t.e2e_s * 0.03);
    view.stage1_s = round3(t.e2e_s * 0.27);
    view.stage2_s = round3(t.e2e_s * 0.69);
    view.output_url = `/v1/videos/${t.id}/content`;
  }
  if (t.status === "failed") {
    view.completed_at = t.completed_at;
    view.error = t.error;
  }
  return view;
}

function advanceTasks() {
  const now = Date.now();
  for (const t of tasks.values()) {
    if (t.status !== "queued" && t.status !== "running") continue;
    const age = (now - t.submit_ms) / 1000;
    if (t.status === "queued" && age >= RUNNING_AFTER_SECS) {
      t.status = "running";
      t.started_at = new Date(now).toISOString();
    } else if (t.status === "running" && age >= GEN_SECS) {
      if (t.willFail) {
        t.status = "failed";
        t.error = "RuntimeError: mock injected failure (--fail-rate)";
      } else {
        t.status = "completed";
      }
      t.completed_at = new Date(now).toISOString();
      t.e2e_s = round3(age);
    }
  }
}

// ---------- 请求校验（模拟真实服务的 400 行为） ----------
function decodeBase64Size(v, allowedMimes = FRAME_MIMES) {
  // 接受 Data URL 或裸 Base64，返回解码后字节数；非法返回 -1
  let b64 = v;
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(v);
  if (m) {
    if (!allowedMimes.has(m[1]) && !allowedMimes.has(m[1].split("/")[0] + "/*")) {
      return -1;
    }
    b64 = m[2];
  }
  try {
    const buf = Buffer.from(b64, "base64");
    if (buf.toString("base64").replace(/=+$/, "") !== b64.replace(/=+$/, "")) return -1;
    return buf.length;
  } catch {
    return -1;
  }
}

function validateBody(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return "request body must be a JSON object";
  }
  for (const k of Object.keys(body)) {
    if (!ALLOWED_FIELDS.has(k)) return `unsupported fields: ${k}`;
  }
  if (typeof body.prompt !== "string" || body.prompt.trim() === "") {
    return "prompt must be a non-empty string";
  }
  if (body.seed !== undefined) {
    if (!Number.isInteger(body.seed) || body.seed < 0 || body.seed >= 2 ** 63) {
      return "seed out of range";
    }
  }
  const hasFrame =
    body.first_frame_path !== undefined ||
    body.last_frame_path !== undefined ||
    body.first_frame_base64 !== undefined ||
    body.last_frame_base64 !== undefined;
  const hasRef =
    body.ref_image_path !== undefined ||
    body.ref_image_base64 !== undefined ||
    body.ref_video_path !== undefined ||
    body.ref_video_base64 !== undefined ||
    body.ref_audio_path !== undefined ||
    body.ref_audio_base64 !== undefined;
  if (hasFrame && hasRef) {
    return "frame fields and ref fields are mutually exclusive";
  }

  for (const slot of ["first", "last"]) {
    const p = body[`${slot}_frame_path`];
    const b = body[`${slot}_frame_base64`];
    if (p !== undefined && b !== undefined) {
      return `only one of ${slot}_frame_path and ${slot}_frame_base64 is allowed`;
    }
    if (b !== undefined) {
      const size = decodeBase64Size(b);
      if (size < 0) return `${slot}_frame_base64 is not a valid image payload`;
      if (size < 1 || size > 16 * 1024 * 1024) {
        return `${slot}_frame image size out of range (1B..16MiB)`;
      }
    }
    if (typeof p === "string" && !existsSync(p)) {
      return `${slot}_frame_path does not exist on server`;
    }
  }

  // Ref2VA 校验
  if (body.ref_image_base64 !== undefined || body.ref_image_path !== undefined) {
    const imgs = body.ref_image_base64 ?? [];
    const paths = body.ref_image_path ?? [];
    if (!Array.isArray(imgs) || !Array.isArray(paths)) {
      return "ref_image fields must be arrays";
    }
    if (imgs.length > 4 || paths.length > 4) {
      return "at most 4 ref images are allowed";
    }
    for (const img of imgs) {
      const size = decodeBase64Size(img);
      if (size < 0) return "ref_image_base64 contains an invalid image payload";
      if (size < 1 || size > 16 * 1024 * 1024) {
        return "ref image size out of range (1B..16MiB)";
      }
    }
    for (const p of paths) {
      if (typeof p === "string" && !existsSync(p)) {
        return "ref_image_path does not exist on server";
      }
    }
  }
  if (body.ref_video_base64 !== undefined) {
    const size = decodeBase64Size(body.ref_video_base64, VIDEO_MIMES);
    if (size < 0) return "ref_video_base64 is not a valid video payload";
    if (size < 1 || size > 96 * 1024 * 1024) {
      return "ref video size out of range (1B..96MiB)";
    }
  }
  if (body.ref_video_path !== undefined && !existsSync(body.ref_video_path)) {
    return "ref_video_path does not exist on server";
  }
  if (body.ref_audio_base64 !== undefined) {
    const size = decodeBase64Size(body.ref_audio_base64, AUDIO_MIMES);
    if (size < 0) return "ref_audio_base64 is not a valid audio payload";
    if (size < 1 || size > 16 * 1024 * 1024) {
      return "ref audio size out of range (1B..16MiB)";
    }
  }
  if (body.ref_audio_path !== undefined && !existsSync(body.ref_audio_path)) {
    return "ref_audio_path does not exist on server";
  }
  if (
    hasRef &&
    !hasFrame &&
    body.ref_image_base64 === undefined &&
    body.ref_image_path === undefined &&
    body.ref_video_base64 === undefined &&
    body.ref_video_path === undefined &&
    body.ref_audio_base64 === undefined &&
    body.ref_audio_path === undefined
  ) {
    return "at least one reference is required";
  }
  return null;
}

// ---------- HTTP 服务 ----------
function sendJson(res, code, obj) {
  const data = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(data),
  });
  res.end(data);
}

function sendMp4(req, res, id) {
  if (LOSE_FILES) {
    sendJson(res, 410, { error: "output file has been removed" });
    return;
  }
  const range = req.headers.range;
  const baseHeaders = {
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    "Content-Disposition": `attachment; filename="${id}.mp4"`,
  };
  if (!range) {
    res.writeHead(200, { ...baseHeaders, "Content-Length": SAMPLE_LEN });
    res.end(SAMPLE_BYTES);
    return;
  }
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  let start = m && m[1] !== "" ? Number(m[1]) : 0;
  let end = m && m[2] !== "" ? Number(m[2]) : SAMPLE_LEN - 1;
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= SAMPLE_LEN) {
    res.writeHead(416, { "Content-Range": `bytes */${SAMPLE_LEN}` });
    res.end();
    return;
  }
  end = Math.min(end, SAMPLE_LEN - 1);
  res.writeHead(206, {
    ...baseHeaders,
    "Content-Range": `bytes ${start}-${end}/${SAMPLE_LEN}`,
    "Content-Length": end - start + 1,
  });
  res.end(SAMPLE_BYTES.subarray(start, end + 1));
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
  const p = url.pathname;

  try {
    if (req.method === "GET" && p === "/health") {
      advanceTasks();
      sendJson(res, FATAL ? 503 : 200, healthPayload());
      return;
    }

    if (req.method === "POST" && p === "/v1/videos") {
      const h = healthPayload();
      if (h.status === "error") {
        sendJson(res, 503, { error: "service is in error state" });
        return;
      }
      if (h.status === "loading") {
        sendJson(res, 503, { error: "service is not ready yet" });
        return;
      }
      let body;
      try {
        const raw = await readBody(req, MAX_BODY);
        body = JSON.parse(raw.toString("utf8"));
      } catch (e) {
        sendJson(res, e.message === "body too large" ? 413 : 400, {
          error: e.message === "body too large" ? "request body too large" : "invalid JSON body",
        });
        return;
      }
      const err = validateBody(body);
      if (err) {
        sendJson(res, 400, { error: err });
        return;
      }
      const hasFrame =
        body.first_frame_path !== undefined ||
        body.last_frame_path !== undefined ||
        body.first_frame_base64 !== undefined ||
        body.last_frame_base64 !== undefined;
      const hasRef =
        body.ref_image_base64 !== undefined ||
        body.ref_image_path !== undefined ||
        body.ref_video_base64 !== undefined ||
        body.ref_video_path !== undefined ||
        body.ref_audio_base64 !== undefined ||
        body.ref_audio_path !== undefined;
      const routed = hasRef ? "ref2va" : hasFrame ? "fl2va" : "t2va";
      // --task 指定的模式与请求不符时拒绝（对齐真实部署：Ref2VA 独立服务）
      if (TASK_MODE === "ref2va" && !hasRef) {
        sendJson(res, 400, { error: "this service only accepts ref2va requests" });
        return;
      }
      if (TASK_MODE !== "ref2va" && hasRef) {
        sendJson(res, 400, { error: "this service does not support ref2va" });
        return;
      }
      const id = genId();
      const now = new Date();
      tasks.set(id, {
        id,
        status: "queued",
        task: routed,
        seed: body.seed ?? 42,
        created_at: now.toISOString(),
        submit_ms: now.getTime(),
        willFail: FAIL_RATE > 0 && Math.random() < FAIL_RATE,
      });
      sendJson(res, 202, {
        id,
        status: "queued",
        task: routed,
        seed: body.seed ?? 42,
        created_at: now.toISOString(),
      });
      return;
    }

    // /v1/videos/{id} 与 /v1/videos/{id}/content
    const m = /^\/v1\/videos\/([0-9a-f]{32})(\/content)?$/.exec(p);
    if (m) {
      advanceTasks();
      const t = tasks.get(m[1]);
      if (!t) {
        sendJson(res, 404, { error: "task not found" });
        return;
      }
      if (m[2] === "/content") {
        if (t.status === "completed") sendMp4(req, res, t.id);
        else if (t.status === "failed") sendJson(res, 409, { error: "task failed" });
        else sendJson(res, 409, { error: "task is running" });
        return;
      }
      sendJson(res, 200, taskView(t));
      return;
    }

    sendJson(res, 404, { error: "not found" });
  } catch (e) {
    sendJson(res, 500, { error: `mock internal error: ${e.message}` });
  }
});

server.listen(PORT, HOST, () => {
  const flags = [
    STARTUP_SECS > 0 ? `startup ${STARTUP_SECS}s` : "ready now",
    `gen ${GEN_SECS}s`,
    FAIL_RATE > 0 ? `fail-rate ${FAIL_RATE}` : null,
    LOSE_FILES ? "lose-files" : null,
    FATAL ? "FATAL" : null,
  ].filter(Boolean).join(", ");
  console.log(`[mock-h3] listening on http://${HOST}:${PORT} (${flags})`);
  console.log(`[mock-h3] sample.mp4 = ${SAMPLE_MP4} (${SAMPLE_LEN} bytes)`);
});
