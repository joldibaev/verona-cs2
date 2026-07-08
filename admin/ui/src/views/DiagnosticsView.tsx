import { ServerRuntimePanel } from "../components/ServerRuntimePanel";

export default function DiagnosticsView() {
  return <><header className="page-header"><div><p className="kicker">CONTROL PLANE</p><h1>Диагностика</h1><span className="subline">Docker, PostgreSQL, конфигурация, каталоги и игровой плагин.</span></div></header><ServerRuntimePanel diagnostics /></>;
}
