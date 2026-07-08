import { useEffect, useMemo, useState } from "react";
import { HubConnectionBuilder } from "@microsoft/signalr";
import {
  Copy,
  GameController,
  MapPin,
  Play,
  Power,
  SpinnerGap,
  UsersThree,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import { api } from "../api";
import { Badge, Button, Input, Select, Slider, Switch } from "../components/ui";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs";

interface Status {
  container: { running: boolean; status: string };
  phase: "stopped" | "starting" | "ready";
  ready: boolean;
  currentMap: string;
  online: number;
  lastHeartbeat: string;
}
interface Launch {
  map: string;
  workshopMapId: string;
  gameType: number;
  gameMode: number;
  maxPlayers: number;
  insecure: boolean;
  botsEnabled: boolean;
  botQuota: number;
  botDifficulty: number;
  practice: boolean;
  infiniteAmmo: boolean;
  friendlyFire: boolean;
}
interface Mode {
  label: string;
  hint: string;
  gameType: number;
  gameMode: number;
  maps: string[];
}
const names: Record<string, string> = {
  de_dust2: "Dust II",
  de_mirage: "Mirage",
  de_inferno: "Inferno",
  de_nuke: "Nuke",
  de_ancient: "Ancient",
  de_anubis: "Anubis",
  de_train: "Train",
  de_overpass: "Overpass",
  de_vertigo: "Vertigo",
};
const pool = Object.keys(names),
  wingman = ["de_inferno", "de_nuke", "de_overpass", "de_vertigo"];
const modes: Mode[] = [
  {
    label: "Casual",
    hint: "Свободный вход без рейтинговых ограничений",
    gameType: 0,
    gameMode: 0,
    maps: pool,
  },
  {
    label: "Competitive",
    hint: "Классический соревновательный режим 5×5",
    gameType: 0,
    gameMode: 1,
    maps: pool,
  },
  {
    label: "Wingman",
    hint: "Компактный соревновательный режим 2×2",
    gameType: 0,
    gameMode: 2,
    maps: wingman,
  },
  {
    label: "Deathmatch",
    hint: "Мгновенное возрождение и непрерывный бой",
    gameType: 1,
    gameMode: 2,
    maps: pool,
  },
];

export default function DashboardView() {
  const [status, setStatus] = useState<Status | null>(null),
    [busy, setBusy] = useState(false),
    [mode, setMode] = useState(modes[0]),
    [map, setMap] = useState("de_dust2"),
    [source, setSource] = useState<"official" | "workshop">("official"),
    [workshop, setWorkshop] = useState(""),
    [maxPlayers, setMaxPlayers] = useState(10),
    [vac, setVac] = useState(true),
    [bots, setBots] = useState(true),
    [botQuota, setBotQuota] = useState(5),
    [difficulty, setDifficulty] = useState(1),
    [practice, setPractice] = useState(false),
    [ammo, setAmmo] = useState(false),
    [friendly, setFriendly] = useState(false);
  const load = () => api<Status>("/api/server/status").then(setStatus);
  useEffect(() => {
    let timer = 0,
      active = true;
    const hub = new HubConnectionBuilder()
      .withUrl("/hub")
      .withAutomaticReconnect()
      .build();
    void Promise.all([
      load(),
      api<Launch>("/api/server/launch").then((x) => {
        if (!active) return;
        const m =
          modes.find(
            (v) => v.gameType === x.gameType && v.gameMode === x.gameMode,
          ) ?? modes[0];
        setMode(m);
        setMap(m.maps.includes(x.map) ? x.map : m.maps[0]);
        setWorkshop(x.workshopMapId);
        setSource(x.workshopMapId ? "workshop" : "official");
        setMaxPlayers(x.maxPlayers);
        setVac(!x.insecure);
        setBots(x.botsEnabled);
        setBotQuota(x.botQuota);
        setDifficulty(x.botDifficulty);
        setPractice(x.practice);
        setAmmo(x.infiniteAmmo);
        setFriendly(x.friendlyFire);
      }),
    ]).then(() => {
      if (!active) return;
      timer = window.setInterval(load, 2000);
      hub.on("serverChanged", load);
      void hub.start().catch(() => {});
    });
    return () => {
      active = false;
      clearInterval(timer);
      void hub.stop();
    };
  }, []);
  useEffect(() => {
    if (!mode.maps.includes(map)) setMap(mode.maps[0]);
  }, [mode, map]);
  useEffect(() => {
    if (practice || ammo) setVac(false);
  }, [practice, ammo]);
  const display =
      status?.ready && status.currentMap !== "unknown"
        ? status.currentMap
        : map,
    phase =
      status?.phase === "ready"
        ? "Сервер готов"
        : status?.phase === "starting"
          ? "Запускается"
          : "Остановлен";
  async function action(name: "start" | "stop" | "restart") {
    if (
      name === "start" &&
      source === "workshop" &&
      !/^\d{1,20}$/.test(workshop.trim())
    ) {
      toast.warning("Укажите числовой Workshop ID");
      return;
    }
    setBusy(true);
    try {
      await api(`/api/server/${name}`, {
        method: "POST",
        body:
          name === "start"
            ? JSON.stringify({
                map: source === "official" ? map : null,
                workshopMapId: source === "workshop" ? workshop.trim() : "",
                gameType: mode.gameType,
                gameMode: mode.gameMode,
                maxPlayers,
                insecure: !vac,
                botsEnabled: bots,
                botQuota,
                botDifficulty: difficulty,
                practice,
                infiniteAmmo: ammo,
                friendlyFire: friendly,
              })
            : undefined,
      });
      await load();
      toast.success("Команда отправлена");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  }
  const settings = useMemo(
    () =>
      [
        ["VAC", "Защита от читов", vac, setVac],
        ["Огонь по своим", "mp_friendlyfire", friendly, setFriendly],
        ["Practice", "Расширенный тренировочный режим", practice, setPractice],
        ["Бесконечные патроны", "sv_infinite_ammo 1", ammo, setAmmo],
      ] as const,
    [vac, friendly, practice, ammo],
  );
  return (
    <>
      <header className="page-header">
        <div>
          <p className="kicker">SERVER NETWORK</p>
          <h1>Серверы</h1>
        </div>
        <div className="headline-stat">
          <i />
          <b>{status?.online ?? 0}</b> игроков онлайн
        </div>
      </header>
      <section
        className="server-hero"
        style={{ "--map": `url(/maps/${display}.png)` } as React.CSSProperties}
      >
        <div className="server-hero-shade" />
        <div className="server-top">
          <span className="server-number">01</span>
          <div>
            <h2>VERONA CS2 #1</h2>
            <p>
              {mode.label} · {names[display] ?? display}
            </p>
          </div>
          <Badge
            tone={
              status?.phase === "ready"
                ? "success"
                : status?.phase === "starting"
                  ? "warning"
                  : "danger"
            }
          >
            {status?.phase === "starting" && <SpinnerGap className="spin" />}
            {phase}
          </Badge>
        </div>
        <div className="server-bottom">
          <span>
            <UsersThree /> {status?.online ?? 0}/{maxPlayers}
          </span>
          <span>
            <MapPin /> {names[display] ?? display}
          </span>
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
          {status?.container.running ? (
            <div className="server-actions">
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => action("restart")}
              >
                Перезапустить
              </Button>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => action("stop")}
              >
                <Power /> Остановить
              </Button>
            </div>
          ) : null}
        </div>
      </section>
      {!status?.container.running && (
        <section className="launch-console">
          <div className="section-head">
            <div>
              <p className="kicker">LAUNCH CONFIGURATION</p>
              <h2>Новый запуск</h2>
              <p>Параметры применятся при старте контейнера.</p>
            </div>
            <Button disabled={busy} onClick={() => action("start")}>
              <Play weight="fill" /> Запустить сервер
            </Button>
          </div>
          <div className="config-block">
            <label>Режим игры</label>
            <Tabs
              value={mode.label}
              onValueChange={(value) =>
                setMode(modes.find((item) => item.label === value) ?? modes[0])
              }
            >
              <TabsList>
                {modes.map((item) => (
                  <TabsTrigger value={item.label} key={item.label}>
                    {item.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <small>{mode.hint}</small>
          </div>
          <div className="config-block">
            <div className="config-title">
              <label>Карта</label>
              <Tabs
                value={source}
                onValueChange={(value) =>
                  setSource(value as "official" | "workshop")
                }
              >
                <TabsList>
                  <TabsTrigger value="official">Официальные</TabsTrigger>
                  <TabsTrigger value="workshop">Workshop</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            {source === "official" ? (
              <div className="map-grid">
                {mode.maps.map((m) => (
                  <button
                    key={m}
                    className={map === m ? "selected" : ""}
                    onClick={() => setMap(m)}
                  >
                    <img src={`/maps/${m}.png`} alt="" />
                    <span>{names[m]}</span>
                  </button>
                ))}
              </div>
            ) : (
              <Input
                value={workshop}
                onChange={(e) => setWorkshop(e.target.value)}
                placeholder="Workshop ID, например 3070284539"
              />
            )}
          </div>
          <div className="config-block">
            <label>Игроки и боты</label>
            <div className="settings-grid">
              <Setting
                title={`Максимум игроков: ${maxPlayers}`}
                hint="2–32 слота"
              >
                <Slider
                  value={[maxPlayers]}
                  onValueChange={(v) => setMaxPlayers(v[0])}
                  min={2}
                  max={32}
                />
              </Setting>
              <Setting title="Боты" hint="Заполняют сервер до квоты">
                <Switch checked={bots} onCheckedChange={setBots} />
              </Setting>
              <Setting title={`Количество ботов: ${botQuota}`} hint="bot_quota">
                <Slider
                  value={[botQuota]}
                  onValueChange={(v) => setBotQuota(v[0])}
                  min={0}
                  max={12}
                  disabled={!bots}
                />
              </Setting>
              <Setting title="Сложность" hint="Уровень AI">
                <Select
                  value={difficulty}
                  onChange={(e) => setDifficulty(+e.target.value)}
                  disabled={!bots}
                >
                  <option value={0}>Лёгкие</option>
                  <option value={1}>Средние</option>
                  <option value={2}>Сложные</option>
                  <option value={3}>Эксперт</option>
                </Select>
              </Setting>
            </div>
          </div>
          <div className="config-block">
            <label>Правила сервера</label>
            <div className="settings-grid">
              {settings.map(([t, h, v, s]) => (
                <Setting key={t} title={t} hint={h}>
                  <Switch checked={v} onCheckedChange={s} />
                </Setting>
              ))}
            </div>
          </div>
        </section>
      )}
    </>
  );
}
function Setting({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="setting">
      <div>
        <b>{title}</b>
        <small>{hint}</small>
      </div>
      {children}
    </div>
  );
}
