import { CheckCircle, WarningCircle } from "@phosphor-icons/react";
import { useServerRuntime } from "../server-runtime";

export function ServerRuntimePanel({ diagnostics = false }: { diagnostics?: boolean }) {
  const { runtime, error } = useServerRuntime();
  const checks = diagnostics ? runtime?.checks ?? [] : runtime?.checks.filter((x) => !x.ready) ?? [];
  return <section className={`runtime-panel ${diagnostics ? "runtime-diagnostics" : ""}`}>
    <div className="runtime-head"><div><p className="kicker">{diagnostics ? "SYSTEM READINESS" : "SERVER RUNTIME"}</p><h2>{runtime?.step ?? "Получение состояния…"}</h2></div><b>{runtime?.progress ?? 0}%</b></div>
    <div className="runtime-progress"><i style={{ width: `${runtime?.progress ?? 0}%` }} /></div>
    {error ? <p className="runtime-error">{error}</p> : null}
    {checks.length > 0 ? <div className="readiness-grid">{checks.map((check) => <article key={check.id} className={check.ready ? "is-ready" : "is-waiting"}>{check.ready ? <CheckCircle weight="fill" /> : <WarningCircle weight="fill" />}<div><b>{check.label}</b><small>{check.detail}</small></div></article>)}</div> : null}
    <div className="live-console" aria-live="polite"><header><span>LIVE LOGS</span><small>обновление каждые 2 сек.</small></header><pre>{runtime?.logs.length ? runtime.logs.join("\n") : "Логи контейнера пока пусты."}</pre></div>
  </section>;
}
