import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Play } from "@phosphor-icons/react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api } from "../api";
import { Button, Input, Select, Slider, Switch } from "../components/ui";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs";
import {
  findGameMode,
  gameModes,
  mapNames,
  type GameMode,
  type LaunchConfig,
} from "./server-config";

export default function CreateServerView() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<GameMode>(gameModes[0]);
  const [map, setMap] = useState("de_dust2");
  const [source, setSource] = useState<"official" | "workshop">("official");
  const [workshop, setWorkshop] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(10);
  const [vac, setVac] = useState(true);
  const [bots, setBots] = useState(true);
  const [botQuota, setBotQuota] = useState(5);
  const [difficulty, setDifficulty] = useState(1);
  const [practice, setPractice] = useState(false);
  const [ammo, setAmmo] = useState(false);
  const [friendly, setFriendly] = useState(false);

  useEffect(() => {
    let active = true;
    void api<LaunchConfig>("/api/server/launch").then((config) => {
      if (!active) return;
      const savedMode = findGameMode(config);
      setMode(savedMode);
      setMap(savedMode.maps.includes(config.map) ? config.map : savedMode.maps[0]);
      setWorkshop(config.workshopMapId);
      setSource(config.workshopMapId ? "workshop" : "official");
      setMaxPlayers(config.maxPlayers);
      setVac(!config.insecure);
      setBots(config.botsEnabled);
      setBotQuota(config.botQuota);
      setDifficulty(config.botDifficulty);
      setPractice(config.practice);
      setAmmo(config.infiniteAmmo);
      setFriendly(config.friendlyFire);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!mode.maps.includes(map)) setMap(mode.maps[0]);
  }, [mode, map]);

  useEffect(() => {
    if (practice || ammo) setVac(false);
  }, [practice, ammo]);

  async function start() {
    if (source === "workshop" && !/^\d{1,20}$/.test(workshop.trim())) {
      toast.warning("Укажите числовой Workshop ID");
      return;
    }
    setBusy(true);
    try {
      await api("/api/server/start", {
        method: "POST",
        body: JSON.stringify({
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
        }),
      });
      toast.success("Сервер запускается");
      navigate("/servers");
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBusy(false);
    }
  }

  const settings = useMemo(
    () => [
      ["VAC", "Защита от читов", vac, setVac],
      ["Огонь по своим", "mp_friendlyfire", friendly, setFriendly],
      ["Practice", "Расширенный тренировочный режим", practice, setPractice],
      ["Бесконечные патроны", "sv_infinite_ammo 1", ammo, setAmmo],
    ] as const,
    [vac, friendly, practice, ammo],
  );

  return (
    <>
      <header className="page-header create-server-header">
        <div>
          <Button asChild variant="ghost" size="sm" className="back-link">
            <Link to="/servers"><ArrowLeft /> Серверы</Link>
          </Button>
          <p className="kicker">LAUNCH CONFIGURATION</p>
          <h1>Создание сервера</h1>
          <span className="subline">Настройте игровой режим и параметры следующего запуска</span>
        </div>
        <Button disabled={busy} onClick={start}>
          <Play weight="fill" /> {busy ? "Запускаем…" : "Создать и запустить"}
        </Button>
      </header>

      <section className="launch-console create-server-form">
        <div className="config-block config-block-first">
          <label>Режим игры</label>
          <Tabs value={mode.label} onValueChange={(value) => setMode(gameModes.find((item) => item.label === value) ?? gameModes[0])}>
            <TabsList>
              {gameModes.map((item) => <TabsTrigger value={item.label} key={item.label}>{item.label}</TabsTrigger>)}
            </TabsList>
          </Tabs>
          <small>{mode.hint}</small>
        </div>

        <div className="config-block">
          <div className="config-title">
            <label>Карта</label>
            <Tabs value={source} onValueChange={(value) => setSource(value as "official" | "workshop")}>
              <TabsList>
                <TabsTrigger value="official">Официальные</TabsTrigger>
                <TabsTrigger value="workshop">Workshop</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          {source === "official" ? (
            <div className="map-grid">
              {mode.maps.map((item) => (
                <button type="button" key={item} className={map === item ? "selected" : ""} onClick={() => setMap(item)}>
                  <img src={`/maps/${item}.png`} alt="" />
                  <span>{mapNames[item]}</span>
                </button>
              ))}
            </div>
          ) : (
            <Input value={workshop} onChange={(event) => setWorkshop(event.target.value)} placeholder="Workshop ID, например 3070284539" inputMode="numeric" />
          )}
        </div>

        <div className="config-block">
          <label>Игроки и боты</label>
          <div className="settings-grid">
            <Setting title={`Максимум игроков: ${maxPlayers}`} hint="2–32 слота">
              <Slider value={[maxPlayers]} onValueChange={(value) => setMaxPlayers(value[0])} min={2} max={32} />
            </Setting>
            <Setting title="Боты" hint="Заполняют сервер до квоты"><Switch checked={bots} onCheckedChange={setBots} /></Setting>
            <Setting title={`Количество ботов: ${botQuota}`} hint="bot_quota">
              <Slider value={[botQuota]} onValueChange={(value) => setBotQuota(value[0])} min={0} max={12} disabled={!bots} />
            </Setting>
            <Setting title="Сложность" hint="Уровень AI">
              <Select value={difficulty} onChange={(event) => setDifficulty(+event.target.value)} disabled={!bots}>
                <option value={0}>Лёгкие</option><option value={1}>Средние</option><option value={2}>Сложные</option><option value={3}>Эксперт</option>
              </Select>
            </Setting>
          </div>
        </div>

        <div className="config-block">
          <label>Правила сервера</label>
          <div className="settings-grid">
            {settings.map(([title, hint, value, setter]) => (
              <Setting key={title} title={title} hint={hint}><Switch checked={value} onCheckedChange={setter} /></Setting>
            ))}
          </div>
        </div>

        <div className="create-server-footer">
          <p>Конфигурация будет проверена backend и записана перед стартом контейнера.</p>
          <Button disabled={busy} onClick={start}><Play weight="fill" /> {busy ? "Запускаем…" : "Создать и запустить"}</Button>
        </div>
      </section>
    </>
  );
}

function Setting({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return <div className="setting"><div><b>{title}</b><small>{hint}</small></div>{children}</div>;
}
