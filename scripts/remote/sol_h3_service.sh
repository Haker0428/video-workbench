#!/usr/bin/env bash
set -euo pipefail

PROJECT=/home/nvidia/models/Sana/models/minimax_h3/Sol-H3-Spark
RUNTIME=/home/nvidia/sol-h3-runtime
PYTHON=/home/nvidia/miniconda3/envs/sol-s1/bin/python
PID_FILE="$RUNTIME/workbench-sol-h3.pid"
PORT=30010

process_alive() {
  [[ -f "$PID_FILE" ]] || return 1
  local pid
  pid=$(cat "$PID_FILE")
  [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null
}

health_status() {
  curl --noproxy '*' --silent --max-time 3 "http://127.0.0.1:$PORT/health" 2>/dev/null \
    | "$PYTHON" -c 'import json,sys; print(json.load(sys.stdin).get("status", "unknown"))' \
    2>/dev/null || true
}

stop_service() {
  local pid=""
  if process_alive; then
    pid=$(cat "$PID_FILE")
  else
    pid=$(pgrep -f "$PYTHON serve.py.*--port $PORT" | head -n 1 || true)
  fi
  if [[ -z "$pid" ]]; then
    rm -f "$PID_FILE"
    echo "Sol-H3 is not running"
    return 0
  fi

  kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  for _ in $(seq 1 12); do
    if ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$PID_FILE"
      echo "Sol-H3 stopped"
      return 0
    fi
    sleep 5
  done
  kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
  rm -f "$PID_FILE"
  echo "Sol-H3 force-stopped after timeout"
}

start_service() {
  if process_alive; then
    local status
    status=$(health_status)
    if [[ "$status" == "ready" || "$status" == "loading" ]]; then
      echo "Sol-H3 is already $status with pid $(cat "$PID_FILE")"
      return 0
    fi
    echo "Sol-H3 process is unhealthy (${status:-unreachable}); restarting"
    stop_service
  fi
  local existing
  existing=$(pgrep -f "$PYTHON serve.py.*--port $PORT" | head -n 1 || true)
  if [[ -n "$existing" ]]; then
    echo "$existing" > "$PID_FILE"
    local status
    status=$(health_status)
    if [[ "$status" == "ready" || "$status" == "loading" ]]; then
      echo "Adopted existing Sol-H3 process $existing ($status)"
      return 0
    fi
    echo "Found unhealthy Sol-H3 process $existing (${status:-unreachable}); restarting"
    stop_service
  fi

  mkdir -p "$RUNTIME/logs" "$RUNTIME/outputs" "$RUNTIME/inputs/workbench"
  local run_id output_dir log_file
  run_id=$(date +%Y%m%d-%H%M%S)
  output_dir="$RUNTIME/outputs/workbench-sol-h3-$run_id"
  log_file="$RUNTIME/logs/workbench-sol-h3-$run_id.log"

  cd "$PROJECT"
  export SOL_H3_SPARK_RUNTIME_ROOT="$RUNTIME"
  export SOL_H3_SPARK_QWEN_IMAGE=sol-h3-spark-qwen
  nohup setsid "$PYTHON" serve.py \
    --paths paths.json \
    --task hybrid \
    --warmup-image "$RUNTIME/inputs/workbench/hybrid-warmup.png" \
    --host 100.64.52.42 \
    --port "$PORT" \
    --output-dir "$output_dir" \
    --startup-estimate-seconds 600 \
    > "$log_file" 2>&1 < /dev/null &
  echo $! > "$PID_FILE"
  echo "Started Sol-H3 pid $(cat "$PID_FILE"); log: $log_file"
}

case "${1:-status}" in
  start) start_service ;;
  stop) stop_service ;;
  restart) stop_service; start_service ;;
  status)
    if process_alive; then
      echo "running pid $(cat "$PID_FILE")"
    else
      echo "stopped"
      exit 1
    fi
    ;;
  *) echo "usage: $0 {start|stop|restart|status}" >&2; exit 2 ;;
esac
