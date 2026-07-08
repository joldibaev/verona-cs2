import { CheckCircle, WarningCircle } from "@phosphor-icons/react";
import { useServerRuntime } from "../server-runtime";
import { formatGb } from "../views/server-config";

export function ServerRuntimePanel({ showLogs = true }: { showLogs?: boolean }) {
  const { runtime, error } = useServerRuntime();
  const checks = runtime?.checks.filter((x) => !x.ready) ?? [];
  return <section className="runtime-panel">
    <div className="runtime-head"><div><p className="kicker">SERVER RUNTIME</p><h2>{runtime?.step ?? "Получение состояния…"}</h2></div><b>{runtime?.progress ?? 0}%</b></div>
    <div className="runtime-progress"><i style={{ width: `${runtime?.progress ?? 0}%` }} /></div>
    {runtime?.downloading && runtime.totalBytes ? <p className="runtime-download">{formatGb(runtime.downloadedBytes ?? 0)} / {formatGb(runtime.totalBytes)} ГБ · первичная установка данных CS2, это может занять время</p> : null}
    {error ? <p className="runtime-error">{error}</p> : null}
    {checks.length > 0 ? <div className="readiness-grid">{checks.map((check) => <article key={check.id} className={check.ready ? "is-ready" : "is-waiting"}>{check.ready ? <CheckCircle weight="fill" /> : <WarningCircle weight="fill" />}<div><b>{check.label}</b><small>{check.detail}</small></div></article>)}</div> : null}
    {showLogs ? <div className="live-console" aria-live="polite"><header><span>LIVE LOGS</span><small>обновление каждые 2 сек.</small></header><pre>{runtime?.logs.length ? runtime.logs.join("\n") : "Логи контейнера пока пусты."}</pre></div> : null}
  </section>;
}
