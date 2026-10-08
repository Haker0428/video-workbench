import { useEffect } from "react";
import { useHealthStore } from "../stores/health";

/** 每 5s 轮询 /health；挂载时立即打一发。 */
export function useHealthPoll(intervalMs = 5000) {
  const refresh = useHealthStore((s) => s.refresh);
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), intervalMs);
    return () => clearInterval(t);
  }, [refresh, intervalMs]);
}
