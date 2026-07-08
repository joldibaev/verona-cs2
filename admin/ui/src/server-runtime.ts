import { useCallback, useEffect, useState } from "react";
import { HubConnectionBuilder } from "@microsoft/signalr";
import { api } from "./api";

export interface ReadinessCheck { id: string; label: string; ready: boolean; detail: string; }
export interface ServerRuntime {
  phase: "stopped" | "starting" | "ready";
  step: string; progress: number; checks: ReadinessCheck[]; logs: string[]; checkedAt: string;
}

export function useServerRuntime() {
  const [runtime, setRuntime] = useState<ServerRuntime | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => api<ServerRuntime>("/api/server/runtime")
    .then((value) => { setRuntime(value); setError(null); })
    .catch((reason) => setError(String(reason))), []);
  useEffect(() => {
    const hub = new HubConnectionBuilder().withUrl("/hub").withAutomaticReconnect().build();
    void refresh();
    const timer = window.setInterval(refresh, 2000);
    hub.on("serverChanged", refresh);
    void hub.start().catch(() => undefined);
    return () => { clearInterval(timer); void hub.stop(); };
  }, [refresh]);
  return { runtime, error };
}
