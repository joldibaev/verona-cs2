import { useEffect, useState } from "react";
import {
  ArrowLeft,
  CheckCircle,
  Copy,
  DownloadSimple,
  MapPin,
  Power,
  SpinnerGap,
  Trash,
  UsersThree,
  WarningCircle,
} from "@phosphor-icons/react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { api, type Player } from "../api";
import { Badge, Button } from "../components/ui";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { useServerStatus } from "../server-status";
import { useServerRuntime } from "../server-runtime";
import {
  findGameMode,
  formatGb,
  mapNames,
  resolveServerMap,
  serverStatusBadge,
} from "./server-config";

export default function ServerDetailView() {
  const { id = "1" } = useParams();
  const navigate = useNavigate();
  const { status, launch, reload } = useServerStatus();
  const { runtime, error } = useServerRuntime();
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const running = status?.container.running ?? false;
  const installing = status?.phase === "starting";
  const install = status?.install ?? null;
  const mode = launch ? findGameMode(launch) : null;
  const map = resolveServerMap(status, launch);
  const badge = serverStatusBadge(status);

  if (status && !status.configured) return <Navigate to="/servers" replace />;

  async function action(name: "stop" | "restart") {
    setBusy(true);
    try {
      await api(`/api/server/${name}`, { method: "POST" });
      await reload();
      toast.success(name === "stop" ? "Сервер остановлен" : "Перезапуск начат");
    } catch (err) {
      toast.error(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setDeleting(true);
    try {
      await api("/api/server/delete", { method: "POST" });
      toast.success("Сервер удалён");
      navigate("/servers");
    } catch (err) {
      toast.error(String(err));
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  const facts: [string, string][] = [
    ["Режим", mode?.label ?? "CS2"],
    ["Карта", mapNames[map] ?? map],
    ["Слотов", `${launch?.maxPlayers ?? 10}`],
    ["Боты", launch?.botsEnabled ? `${launch.botQuota} · сложность ${launch.botDifficulty}` : "Выключены"],
    ["VAC", launch?.insecure ? "Отключён (insecure)" : "Включён"],
    ["Адрес", "localhost:27015"],
  ];

  return (
    <>
      <header className="page-header create-server-header">
        <div>
          <Button asChild variant="ghost" size="sm" className="back-link">
            <Link to="/servers"><ArrowLeft /> Серверы</Link>
          </Button>
          <p className="kicker">SERVER INSTANCE</p>
          <h1>VERONA CS2 #{id}</h1>
          <span className="subline">{mode?.label ?? "CS2"} · {mapNames[map] ?? map}</span>
        </div>
        <div className="server-actions">
          {status?.phase === "ready" ? (
            <>
              <Button variant="secondary" disabled={busy} onClick={() => action("restart")}>Перезапустить</Button>
              <Button variant="danger" disabled={busy} onClick={() => action("stop")}><Power /> Остановить</Button>
            </>
          ) : installing ? (
            <Button variant="danger" disabled={busy} onClick={() => action("stop")}><Power /> Прервать</Button>
          ) : (
            <Button asChild><Link to="/servers/new"><Power /> Настроить и запустить</Link></Button>
          )}
          <Button variant="ghost" size="icon" disabled={busy} onClick={() => setConfirmDelete(true)} aria-label="Удалить сервер">
            <Trash />
          </Button>
        </div>
      </header>

      <section
        className={`server-hero server-list-card${installing ? " is-installing" : ""}`}
        style={{
          "--map": `url(/maps/${status?.currentMap || launch?.map || "de_dust2"}.png)`,
        } as React.CSSProperties}
      >
        <div className="server-hero-shade" />
        <div className="server-top">
          <span className="server-number">{id.padStart(2, "0")}</span>
          <div>
            <h2>VERONA CS2 #{id}</h2>
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
                первичная установка данных CS2, это может занять время
              </small>
            ) : (
              <small className="server-progress-note">Автоматическая подготовка сервера…</small>
            )}
          </div>
        ) : null}

        <div className="server-bottom">
          <span><UsersThree /> {status?.online ?? 0}/{launch?.maxPlayers ?? 10}</span>
          <span><MapPin /> {mapNames[map] ?? map}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void navigator.clipboard.writeText("localhost:27015");
              toast.success("Адрес скопирован");
            }}
          >
            <Copy /> localhost:27015
          </Button>
        </div>
      </section>

      <Tabs defaultValue="overview" className="detail-tabs">
        <TabsList>
          <TabsTrigger value="overview">Обзор</TabsTrigger>
          <TabsTrigger value="logs">Логи</TabsTrigger>
          <TabsTrigger value="players">Игроки{status?.online ? ` · ${status.online}` : ""}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="detail-panel">
            <div className="server-facts">
              {facts.map(([label, value]) => (
                <div key={label}><span>{label}</span><b>{value}</b></div>
              ))}
            </div>
            {runtime && runtime.checks.length > 0 ? (
              <div className="readiness-grid">
                {runtime.checks.map((check) => (
                  <article key={check.id} className={check.ready ? "is-ready" : "is-waiting"}>
                    {check.ready ? <CheckCircle weight="fill" /> : <WarningCircle weight="fill" />}
                    <div><b>{check.label}</b><small>{check.detail}</small></div>
                  </article>
                ))}
              </div>
            ) : null}
          </div>
        </TabsContent>

        <TabsContent value="logs">
          <div className="live-console" aria-live="polite">
            <header><span>LIVE LOGS</span><small>обновление каждые 2 сек.</small></header>
            <pre>{error ? error : runtime?.logs.length ? runtime.logs.join("\n") : "Логи контейнера пока пусты."}</pre>
          </div>
        </TabsContent>

        <TabsContent value="players">
          <PlayersTab running={running} />
        </TabsContent>
      </Tabs>

      <AlertDialog open={confirmDelete} onOpenChange={(open) => { if (!open && !deleting) setConfirmDelete(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-destructive/10 text-destructive"><Trash /></AlertDialogMedia>
            <AlertDialogTitle>Удалить сервер?</AlertDialogTitle>
            <AlertDialogDescription>
              Конфигурация сервера будет удалена, а контейнер остановлен. Загруженные игровые
              данные CS2 сохранятся — при повторном создании сервера скачивать ~70&nbsp;ГБ заново не придётся.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Отмена</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={deleting}
              onClick={(event) => { event.preventDefault(); void remove(); }}>
              {deleting ? "Удаляем…" : "Удалить"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function PlayersTab({ running }: { running: boolean }) {
  const [players, setPlayers] = useState<Player[] | null>(null);

  useEffect(() => {
    let active = true;
    const load = () =>
      api<Player[]>("/api/players")
        .then((all) => { if (active) setPlayers(all.filter((p) => p.online)); })
        .catch(() => undefined);
    void load();
    const timer = window.setInterval(load, 3000);
    return () => { active = false; clearInterval(timer); };
  }, []);

  if (!running) return <div className="detail-panel detail-empty">Сервер не запущен — игроки появятся после старта.</div>;
  if (players === null) return <div className="detail-panel detail-empty">Загрузка списка игроков…</div>;
  if (players.length === 0) return <div className="detail-panel detail-empty">На сервере пока нет игроков.</div>;

  return (
    <div className="detail-panel">
      <div className="players-list">
        {players.map((player) => (
          <Link key={player.steamId} to={`/players`} className="player-cell">
            {player.avatarUrl
              ? <img src={player.avatarUrl} alt="" />
              : <span className="avatar-fallback">{player.name.charAt(0).toUpperCase()}</span>}
            <div>
              <b>{player.name}</b>
              <small>{player.role === "admin" ? "Администратор" : "Игрок"}</small>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
