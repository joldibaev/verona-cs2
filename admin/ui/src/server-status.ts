import { useCallback, useEffect, useState } from "react";
import { HubConnectionBuilder } from "@microsoft/signalr";
import { api } from "./api";
import type { LaunchConfig, ServerStatus } from "./views/server-config";

// Shared polling for the single game server, used by both the server list and the
// server detail page so their status, badge and progress stay in sync.
export function useServerStatus() {
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [launch, setLaunch] = useState<LaunchConfig | null>(null);

  const reload = useCallback(
    () =>
      Promise.all([
        api<ServerStatus>("/api/server/status").then(setStatus),
        api<LaunchConfig>("/api/server/launch").then(setLaunch),
      ]).then(() => undefined),
    [],
  );

  useEffect(() => {
    let active = true;
    const hub = new HubConnectionBuilder().withUrl("/hub").withAutomaticReconnect().build();
    const refresh = () => {
      if (active) void reload();
    };
    refresh();
    const timer = window.setInterval(refresh, 2000);
    hub.on("serverChanged", refresh);
    void hub.start().catch(() => undefined);
    return () => {
      active = false;
      clearInterval(timer);
      void hub.stop();
    };
  }, [reload]);

  return { status, launch, reload };
}
