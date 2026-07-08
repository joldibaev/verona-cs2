import {
  ArrowRight,
  DownloadSimple,
  HardDrives,
  MapPin,
  Plus,
  SpinnerGap,
  UsersThree,
} from "@phosphor-icons/react";
import { Link } from "react-router-dom";
import { Badge, Button } from "../components/ui";
import { useServerStatus } from "../server-status";
import {
  findGameMode,
  formatGb,
  mapNames,
  resolveServerMap,
  serverStatusBadge,
} from "./server-config";

export default function DashboardView() {
  const { status, launch } = useServerStatus();

  const configured = status?.configured ?? false;
  const running = status?.container.running ?? false;
  const installing = status?.phase === "starting";
  const install = status?.install ?? null;
  const mode = launch ? findGameMode(launch) : null;
  const map = resolveServerMap(status, launch);
  const badge = serverStatusBadge(status);

  const availability = status?.ready ? "Online" : installing ? "Подготовка" : "Offline";

  return (
    <>
      <header className="page-header">
        <div>
          <p className="kicker">SERVER NETWORK</p>
          <h1>Серверы</h1>
          <span className="subline">Состояние и управление игровыми инстансами</span>
        </div>
        <Button asChild>
          <Link to="/servers/new">
            <Plus weight="bold" /> Создать сервер
          </Link>
        </Button>
      </header>

      <div className="server-list-summary" aria-label="Сводка по серверам">
        <div><span>Всего</span><b>{configured ? 1 : 0}</b></div>
        <div><span>Активных</span><b>{running ? 1 : 0}</b></div>
        <div><span>Игроков</span><b>{status?.online ?? 0}</b></div>
        <div><span>Доступность</span><b>{availability}</b></div>
      </div>

      {!status ? (
        <section className="server-empty">
          <div className="server-empty-icon"><SpinnerGap className="spin" /></div>
          <p>Получение состояния…</p>
        </section>
      ) : !configured ? (
        <section className="server-empty">
          <div className="server-empty-icon"><HardDrives weight="duotone" /></div>
          <h2>Серверов пока нет</h2>
          <p>
            Создайте первый игровой сервер — выберите режим и карту. При первом запуске
            автоматически загрузятся игровые данные CS2 (~70&nbsp;ГБ), прогресс будет виден здесь.
          </p>
          <Button asChild>
            <Link to="/servers/new"><Plus weight="bold" /> Создать сервер</Link>
          </Button>
        </section>
      ) : (
        <section
          className={`server-hero server-list-card${installing ? " is-installing" : ""}`}
          style={{
            "--map": `url(/maps/${status.currentMap || launch?.map || "de_dust2"}.png)`,
          } as React.CSSProperties}
        >
          <div className="server-hero-shade" />
          <div className="server-top">
            <span className="server-number">01</span>
            <div>
              <h2>VERONA CS2 #1</h2>
              <p>{mode?.label ?? "CS2"} · {mapNames[map] ?? map}</p>
            </div>
            <Badge tone={badge.tone}>
              {installing && <SpinnerGap className="spin" />}
              {badge.label}
            </Badge>
          </div>

          {installing && install ? (
            <div className="server-progress">
              <div className="server-progress-head">
                <span>
                  {install.downloading ? <DownloadSimple /> : <SpinnerGap className="spin" />}
                  {install.step}
                </span>
                <b>{install.progress}%</b>
              </div>
              <div className="runtime-progress"><i style={{ width: `${install.progress}%` }} /></div>
              {install.downloading && install.totalBytes ? (
                <small className="server-progress-note">
                  {formatGb(install.downloadedBytes ?? 0)} / {formatGb(install.totalBytes)} ГБ ·
                  первичная установка данных CS2
                </small>
              ) : (
                <small className="server-progress-note">Автоматическая подготовка сервера…</small>
              )}
            </div>
          ) : null}

          <div className="server-bottom">
            <span><UsersThree /> {status.online}/{launch?.maxPlayers ?? 10}</span>
            <span><MapPin /> {mapNames[map] ?? map}</span>
            <span className="server-address">localhost:27015</span>
            <Button asChild variant="secondary" size="sm" className="server-details-link">
              <Link to="/servers/1">Подробнее <ArrowRight weight="bold" /></Link>
            </Button>
          </div>
        </section>
      )}
    </>
  );
}
