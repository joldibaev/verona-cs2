import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle,
  Copy,
  DownloadSimple,
  Eye,
  EyeSlash,
  Key,
  MapPin,
  Play,
  Power,
  SpinnerGap,
  Trash,
  UsersThree,
  WarningCircle,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { api, type Player } from "../api";
import { Badge, Button, Input, Switch } from "../components/ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
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
import { useServerStatus } from "../server-status";
import { useServerRuntime } from "../server-runtime";
import {
  findGameMode,
  formatGb,
  gameModes,
  mapNames,
  resolveServerMap,
  serverStatusBadge,
  type GameMode,
  type LaunchConfig,
} from "./server-config";

const publicAddress = "109.94.174.241:27015";
const defaultServerName = "Verona CS2";

type MatchPresetKey = "competitive" | "wingman" | "duel" | "grenades" | "custom";

const matchPresets: Array<{
  key: MatchPresetKey;
  label: string;
  hint: string;
  gameType: number;
  gameMode: number;
  source: "official" | "workshop";
  map: string;
  workshop: string;
  practice: boolean;
  ammo: boolean;
  vac: boolean;
  friendly: boolean;
}> = [
  {
    key: "competitive",
    label: "Соревновательный 5x5",
    hint: "Классический матч, без ограничений по слотам",
    gameType: 0,
    gameMode: 1,
    source: "official",
    map: "de_mirage",
    workshop: "",
    practice: false,
    ammo: false,
    vac: false,
    friendly: false,
  },
  {
    key: "wingman",
    label: "Напарник 2x2",
    hint: "Компактный формат, но слоты не режутся",
    gameType: 0,
    gameMode: 2,
    source: "official",
    map: "de_inferno",
    workshop: "",
    practice: false,
    ammo: false,
    vac: false,
    friendly: false,
  },
  {
    key: "duel",
    label: "1x1",
    hint: "Workshop aim-карта для дуэлей",
    gameType: 0,
    gameMode: 1,
    source: "workshop",
    map: "de_mirage",
    workshop: "3070587166",
    practice: false,
    ammo: false,
    vac: false,
    friendly: false,
  },
  {
    key: "grenades",
    label: "Раскидки",
    hint: "Smokes, flashes, траектории и тренировка гранат",
    gameType: 0,
    gameMode: 1,
    source: "official",
    map: "de_mirage",
    workshop: "",
    practice: false,
    ammo: true,
    vac: false,
    friendly: false,
  },
  {
    key: "custom",
    label: "Кастомный",
    hint: "Открывает карту, режим и ручные правила",
    gameType: 0,
    gameMode: 1,
    source: "official",
    map: "de_mirage",
    workshop: "",
    practice: false,
    ammo: false,
    vac: false,
    friendly: false,
  },
];

export default function ServerDetailView() {
  const { status, launch, reload } = useServerStatus();
  const { runtime, error } = useServerRuntime();
  const [busy, setBusy] = useState(false);
  const [consoleBusy, setConsoleBusy] = useState(false);
  const [consoleCommand, setConsoleCommand] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // When true, show the launch configuration form even if server is configured (reconfigure)
  const [showConfig, setShowConfig] = useState(false);

  const configured = status?.configured ?? false;
  const running = status?.container.running ?? false;
  const installing = status?.phase === "starting";
  const install = status?.install ?? null;
  const mode = launch ? findGameMode(launch) : null;
  const map = resolveServerMap(status, launch);
  const badge = serverStatusBadge(status);
  const serverName = launch?.serverHostname || defaultServerName;
  const connectCommand = `connect ${publicAddress}`;

  // When server is not actively running (empty/stopped) the detail hero is useless,
  // so show the launch form as the default view. Detail is only for starting/ready.
  const showLaunchForm = status && !running && !installing || showConfig;

  if (!status) {
    return (
      <>
        <header className="page-header">
          <div>
            <p className="kicker">GAME SERVER</p>
            <h1>Сервер</h1>
            <span className="subline">Получение состояния…</span>
          </div>
        </header>
        <section className="server-empty">
          <div className="server-empty-icon"><SpinnerGap className="spin" /></div>
          <p>Получение состояния…</p>
        </section>
      </>
    );
  }

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
      setConfirmDelete(false);
      setDeleting(false);
      setShowConfig(false);
    } catch (err) {
      toast.error(String(err));
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  async function sendConsoleCommand(event: FormEvent) {
    event.preventDefault();
    const command = consoleCommand.trim();
    if (!command) return;
    if (command.length > 200 || /[;\r\n]/.test(command)) {
      toast.warning("Отправьте одну команду без ; и переносов");
      return;
    }
    setConsoleBusy(true);
    try {
      await api("/api/server/console", {
        method: "POST",
        body: JSON.stringify({ command }),
      });
      setConsoleCommand("");
      toast.success("Команда отправлена");
    } catch (error) {
      toast.error(String(error));
    } finally {
      setConsoleBusy(false);
    }
  }

  if (showLaunchForm) {
    return (
      <>
        <header className="page-header create-server-header">
          <div>
            <p className="kicker">GAME SERVER</p>
            <h1>Сервер</h1>
            <span className="subline">Настройте игровой режим и параметры следующего запуска</span>
          </div>
          {configured && (
            <Button variant="ghost" size="icon" disabled={busy} onClick={() => setConfirmDelete(true)} aria-label="Удалить сервер">
              <Trash />
            </Button>
          )}
        </header>
        <LaunchForm
          initialConfig={launch}
          onStarted={() => {
            setShowConfig(false);
            toast.success("Сервер запускается");
          }}
          onCancel={showConfig && (running || installing) ? () => setShowConfig(false) : undefined}
        />

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

  const facts: [string, string][] = [
    ["Название", serverName],
    ["Режим", mode?.label ?? "CS2"],
    ["Карта", mapNames[map] ?? map],
    ["VAC", launch?.insecure ? "Отключён (insecure)" : "Включён"],
    ["Доступ", "Приватный"],
    ["Пароль", launch?.passwordProtected ? "Задан" : "Нет"],
    ["Адрес", publicAddress],
  ];

  return (
    <>
      <header className="page-header create-server-header">
        <div>
          <p className="kicker">GAME SERVER</p>
          <h1>{serverName}</h1>
          <span className="subline">{mode?.label ?? "CS2"} · {mapNames[map] ?? map}</span>
        </div>
        <div className="server-actions">
          {status.phase === "ready" ? (
            <>
              <Button variant="secondary" disabled={busy} onClick={() => setShowConfig(true)}>Настроить</Button>
              <Button variant="secondary" disabled={busy} onClick={() => action("restart")}>Перезапустить</Button>
              <Button variant="danger" disabled={busy} onClick={() => action("stop")}><Power /> Остановить</Button>
            </>
          ) : (
            <Button variant="danger" disabled={busy} onClick={() => action("stop")}><Power /> Прервать</Button>
          )}
          {configured && (
            <Button variant="ghost" size="icon" disabled={busy} onClick={() => setConfirmDelete(true)} aria-label="Удалить сервер">
              <Trash />
            </Button>
          )}
        </div>
      </header>

      <section
        className={`server-hero server-list-card${installing ? " is-installing" : ""}`}
        style={{
          "--map": `url(/maps/${status.currentMap || launch?.map || "de_dust2"}.png)`,
        } as React.CSSProperties}
      >
        <div className="server-hero-shade" />
        <div className="server-top">
          <div>
            <h2>{serverName}</h2>
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
          <span><UsersThree /> {status.online}</span>
          <span><MapPin /> {mapNames[map] ?? map}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void navigator.clipboard.writeText(connectCommand);
              toast.success("Connect-команда скопирована");
            }}
          >
            <Copy /> {connectCommand}
          </Button>
        </div>
      </section>

      <Tabs defaultValue="overview" className="detail-tabs">
        <TabsList>
          <TabsTrigger value="overview">Обзор</TabsTrigger>
          <TabsTrigger value="logs">Логи</TabsTrigger>
          <TabsTrigger value="players">Игроки{status.online ? ` · ${status.online}` : ""}</TabsTrigger>
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
            <header>
              <span>LIVE LOGS</span>
              <small>обновление каждые 2 сек.</small>
            </header>
            <form className="console-command" onSubmit={sendConsoleCommand}>
              <Input
                value={consoleCommand}
                onChange={(event) => setConsoleCommand(event.target.value)}
                placeholder="mp_restartgame 1"
                maxLength={200}
                disabled={!running || consoleBusy}
              />
              <Button disabled={!running || consoleBusy || !consoleCommand.trim()} type="submit">
                {consoleBusy ? "Отправка..." : "Выполнить"}
              </Button>
            </form>
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

// ─── Launch Configuration Form ──────────────────────────────────────────────

function LaunchForm({
  initialConfig,
  onStarted,
  onCancel,
}: {
  initialConfig: LaunchConfig | null;
  onStarted: () => void;
  onCancel?: () => void;
}) {
  const initialized = useRef(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<GameMode>(gameModes[1] ?? gameModes[0]);
  const [map, setMap] = useState("de_mirage");
  const [source, setSource] = useState<"official" | "workshop">("official");
  const [workshop, setWorkshop] = useState("");
  const [serverHostname, setServerHostname] = useState(defaultServerName);
  const [serverPassword, setServerPassword] = useState("");
  const [showServerPassword, setShowServerPassword] = useState(false);
  const [vac, setVac] = useState(false);
  const [preset, setPreset] = useState<MatchPresetKey>("competitive");
  const [ammo, setAmmo] = useState(false);
  const [friendly, setFriendly] = useState(false);
  const [customCheats, setCustomCheats] = useState(false);
  const [customRoundTime, setCustomRoundTime] = useState(2);
  const [customFreezeTime, setCustomFreezeTime] = useState(10);
  const [customWarmupTime, setCustomWarmupTime] = useState(0);
  const [customBuyTime, setCustomBuyTime] = useState(90);
  const [customStartMoney, setCustomStartMoney] = useState(800);
  const [customMaxMoney, setCustomMaxMoney] = useState(16000);
  const [customBuyAnywhere, setCustomBuyAnywhere] = useState(false);
  const [customAutoBalance, setCustomAutoBalance] = useState(false);
  const [customLimitTeams, setCustomLimitTeams] = useState(0);
  const [customAllTalk, setCustomAllTalk] = useState(false);
  const [customRespawn, setCustomRespawn] = useState(false);
  const [customDeathDropGun, setCustomDeathDropGun] = useState(true);
  const [customShowImpacts, setCustomShowImpacts] = useState(false);
  const [customGrenadeTrajectory, setCustomGrenadeTrajectory] = useState(false);
  const [customGrenadeLimit, setCustomGrenadeLimit] = useState(4);

  function applyPreset(next: MatchPresetKey) {
    const selected = findPreset(next);
    setPreset(selected.key);
    setMode(findGameMode({
      gameType: selected.gameType,
      gameMode: selected.gameMode,
    }));
    setSource(selected.source);
    setMap(selected.map);
    setWorkshop(selected.workshop);
    setAmmo(selected.ammo);
    setVac(selected.vac);
    setFriendly(selected.friendly);
  }

  useEffect(() => {
    if (!initialConfig || initialized.current) return;
    initialized.current = true;
    const savedPreset = toPreset(initialConfig.matchPreset);
    if (savedPreset === "custom") {
      const savedMode = findGameMode(initialConfig);
      setMode(savedMode);
      setMap(savedMode.maps.includes(initialConfig.map) ? initialConfig.map : savedMode.maps[0]);
      setWorkshop(initialConfig.workshopMapId);
      setSource(initialConfig.workshopMapId ? "workshop" : "official");
    } else {
      const selected = findPreset(savedPreset);
      setMode(findGameMode({
        gameType: selected.gameType,
        gameMode: selected.gameMode,
      }));
      setMap(selected.map);
      setWorkshop(selected.workshop);
      setSource(selected.source);
    }
    setServerHostname(initialConfig.serverHostname || defaultServerName);
    setVac(false);
    setAmmo(savedPreset === "custom" ? initialConfig.infiniteAmmo : findPreset(savedPreset).ammo);
    setFriendly(savedPreset === "custom" ? initialConfig.friendlyFire : findPreset(savedPreset).friendly);
    setCustomCheats(initialConfig.customCheats);
    setCustomRoundTime(initialConfig.customRoundTime);
    setCustomFreezeTime(initialConfig.customFreezeTime);
    setCustomWarmupTime(initialConfig.customWarmupTime);
    setCustomBuyTime(initialConfig.customBuyTime);
    setCustomStartMoney(initialConfig.customStartMoney);
    setCustomMaxMoney(initialConfig.customMaxMoney);
    setCustomBuyAnywhere(initialConfig.customBuyAnywhere);
    setCustomAutoBalance(initialConfig.customAutoBalance);
    setCustomLimitTeams(initialConfig.customLimitTeams);
    setCustomAllTalk(initialConfig.customAllTalk);
    setCustomRespawn(initialConfig.customRespawn);
    setCustomDeathDropGun(initialConfig.customDeathDropGun);
    setCustomShowImpacts(initialConfig.customShowImpacts);
    setCustomGrenadeTrajectory(initialConfig.customGrenadeTrajectory);
    setCustomGrenadeLimit(initialConfig.customGrenadeLimit);
    setPreset(savedPreset);
  }, [initialConfig]);

  useEffect(() => {
    if (!mode.maps.includes(map)) setMap(mode.maps[0]);
  }, [mode, map]);

  useEffect(() => {
    if (ammo) setVac(false);
  }, [ammo]);

  async function start() {
    const workshopId = normalizeWorkshopId(workshop);
    if (source === "workshop" && !workshopId) {
      toast.warning("Укажите Workshop ID или ссылку Steam Workshop");
      return;
    }
    if (!isCfgValue(serverHostname.trim(), 80) || !isCfgValue(serverPassword.trim(), 64)) {
      toast.warning("Название и пароль не должны содержать кавычки, обратный слэш или переносы строк");
      return;
    }
    setBusy(true);
    try {
      await api("/api/server/start", {
        method: "POST",
        body: JSON.stringify({
          map: source === "official" ? map : null,
          workshopMapId: source === "workshop" ? workshopId : "",
          gameType: mode.gameType,
          gameMode: mode.gameMode,
          serverHostname: serverHostname.trim(),
          serverPassword: initialConfig?.passwordProtected && !serverPassword.trim() ? null : serverPassword.trim(),
          steamcmdValidate: false,
          hibernateWhenEmpty: false,
          matchPreset: preset,
          insecure: !vac,
          botsEnabled: false,
          botQuota: 0,
          botDifficulty: 1,
          practice: false,
          infiniteAmmo: ammo,
          friendlyFire: friendly,
          customCheats,
          customRoundTime,
          customFreezeTime,
          customWarmupTime,
          customBuyTime,
          customStartMoney,
          customMaxMoney,
          customBuyAnywhere,
          customAutoBalance,
          customLimitTeams,
          customAllTalk,
          customRespawn,
          customDeathDropGun,
          customShowImpacts,
          customGrenadeTrajectory,
          customGrenadeLimit,
        }),
      });
      onStarted();
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
      ["Бесконечные патроны", "sv_infinite_ammo 1", ammo, setAmmo],
      ["sv_cheats", "Консольные тренировочные команды", customCheats, setCustomCheats],
      ["Покупка везде", "mp_buy_anywhere", customBuyAnywhere, setCustomBuyAnywhere],
      ["Автобаланс", "mp_autoteambalance", customAutoBalance, setCustomAutoBalance],
      ["Общий voice", "sv_alltalk", customAllTalk, setCustomAllTalk],
      ["Респавн после смерти", "mp_respawn_on_death_*", customRespawn, setCustomRespawn],
      ["Дроп оружия после смерти", "mp_death_drop_gun", customDeathDropGun, setCustomDeathDropGun],
      ["Показывать попадания", "sv_showimpacts", customShowImpacts, setCustomShowImpacts],
      ["Траектории гранат", "sv_grenade_trajectory_prediction", customGrenadeTrajectory, setCustomGrenadeTrajectory],
    ] as const,
    [vac, friendly, ammo, customCheats, customBuyAnywhere, customAutoBalance, customAllTalk, customRespawn, customDeathDropGun, customShowImpacts, customGrenadeTrajectory],
  );

  const selectedMap = source === "workshop" ? `Workshop ${normalizeWorkshopId(workshop) || "ID"}` : mapNames[map];
  const passwordSuffix = serverPassword.trim() ? `; password "${serverPassword.trim()}"` : "";
  const connectCommand = `connect ${publicAddress}${passwordSuffix}`;

  return (
    <section className="launch-console create-server-form">
      <div className="launch-summary">
        <div className="launch-summary-main">
          <span>Следующий запуск</span>
          <b>{serverHostname.trim() || defaultServerName}</b>
          <small>{mode.label} · {selectedMap}</small>
        </div>
        <div className="launch-summary-meta">
          <Badge tone="neutral">Приватный</Badge>
          <Badge tone={vac ? "success" : "warning"}>{vac ? "VAC" : "INSECURE"}</Badge>
          {serverPassword.trim() || initialConfig?.passwordProtected ? <Badge tone="warning"><Key /> Пароль</Badge> : null}
        </div>
        <Button
          variant="secondary"
          onClick={() => {
            void navigator.clipboard.writeText(connectCommand);
            toast.success("Connect-команда скопирована");
          }}
        >
          <Copy /> {connectCommand}
        </Button>
      </div>

      <div className="config-block config-block-first">
        <label>Профиль сервера</label>
        <div className="server-profile-grid">
          <label className="field">
            <span>Название</span>
            <Input
              value={serverHostname}
              onChange={(event) => setServerHostname(event.target.value)}
              placeholder={defaultServerName}
              maxLength={80}
            />
          </label>
          <label className="field">
            <span>Пароль сервера</span>
            <div className="secret-input">
              <Input
                value={serverPassword}
                onChange={(event) => setServerPassword(event.target.value)}
                placeholder={initialConfig?.passwordProtected ? "Задан, введите новый для замены" : "Без пароля"}
                type={showServerPassword ? "text" : "password"}
                maxLength={64}
              />
              <Button
                variant="ghost"
                size="icon"
                type="button"
                onClick={() => setShowServerPassword((value) => !value)}
                aria-label={showServerPassword ? "Скрыть пароль" : "Показать пароль"}
              >
                {showServerPassword ? <EyeSlash /> : <Eye />}
              </Button>
            </div>
          </label>
        </div>
      </div>

      <div className="config-block">
        <label>Пресет правил</label>
        <div className="preset-grid">
          {matchPresets.map((item) => (
            <button
              type="button"
              key={item.key}
              className={preset === item.key ? "selected" : ""}
              onClick={() => applyPreset(item.key)}
            >
              <b>{item.label}</b>
              <span>{item.hint}</span>
            </button>
          ))}
        </div>
      </div>

      {preset === "custom" ? (
        <div className="config-block">
          <label>Режим игры</label>
          <Tabs value={mode.label} onValueChange={(value) => setMode(gameModes.find((item) => item.label === value) ?? gameModes[0])}>
            <TabsList>
              {gameModes.map((item) => <TabsTrigger value={item.label} key={item.label}>{item.label}</TabsTrigger>)}
            </TabsList>
          </Tabs>
          <small>{mode.hint}</small>
        </div>
      ) : (
        <div className="preset-lock">
          <b>Режим задан пресетом</b>
          <span>{mode.label}</span>
        </div>
      )}

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
          <Input
            value={workshop}
            onChange={(event) => setWorkshop(event.target.value)}
            placeholder="Workshop ID или ссылка Steam Workshop"
            inputMode="url"
          />
        )}
      </div>
      {preset === "custom" ? (
        <div className="config-block">
          <label>Правила сервера</label>
          <div className="settings-grid">
            {settings.map(([title, hint, value, setter]) => (
              <Setting key={title} title={title} hint={hint}><Switch checked={value} onCheckedChange={setter} /></Setting>
            ))}
          </div>
          <div className="number-settings-grid">
            <NumberSetting title="Длительность раунда" hint="mp_roundtime, минуты" value={customRoundTime} min={1} max={60} onChange={setCustomRoundTime} />
            <NumberSetting title="Freeze time" hint="mp_freezetime, секунды" value={customFreezeTime} min={0} max={30} onChange={setCustomFreezeTime} />
            <NumberSetting title="Разминка" hint="mp_warmuptime, секунды" value={customWarmupTime} min={0} max={600} onChange={setCustomWarmupTime} />
            <NumberSetting title="Время покупки" hint="mp_buytime, секунды" value={customBuyTime} min={0} max={9999} onChange={setCustomBuyTime} />
            <NumberSetting title="Стартовые деньги" hint="mp_startmoney" value={customStartMoney} min={0} max={customMaxMoney} onChange={setCustomStartMoney} />
            <NumberSetting title="Лимит денег" hint="mp_maxmoney" value={customMaxMoney} min={800} max={60000} onChange={(value) => {
              setCustomMaxMoney(value);
              if (customStartMoney > value) setCustomStartMoney(value);
            }} />
            <NumberSetting title="Разница команд" hint="mp_limitteams" value={customLimitTeams} min={0} max={20} onChange={setCustomLimitTeams} />
            <NumberSetting title="Лимит гранат" hint="ammo_grenade_limit_total" value={customGrenadeLimit} min={0} max={10} onChange={setCustomGrenadeLimit} />
          </div>
        </div>
      ) : null}

      <div className="create-server-footer">
        <p>Конфигурация будет проверена backend и записана перед стартом контейнера.</p>
        <div style={{ display: "flex", gap: 8 }}>
          {onCancel && <Button variant="secondary" onClick={onCancel}>Отмена</Button>}
          <Button disabled={busy} onClick={start}><Play weight="fill" /> {busy ? "Запускаем…" : "Запустить сервер"}</Button>
        </div>
      </div>
    </section>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isCfgValue(value: string, maxLength: number) {
  return value.length <= maxLength && !/["\\\r\n\t]/.test(value);
}

function normalizeWorkshopId(value: string) {
  const text = value.trim();
  if (/^\d{1,20}$/.test(text)) return text;
  const match = text.match(/[?&]id=(\d{1,20})(?:[&#]|$)/i);
  return match?.[1] ?? "";
}

function toPreset(value: string | undefined): MatchPresetKey {
  return matchPresets.some((item) => item.key === value) ? (value as MatchPresetKey) : "competitive";
}

function findPreset(value: MatchPresetKey) {
  return matchPresets.find((item) => item.key === value) ?? matchPresets[0];
}

function Setting({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return <div className="setting"><div><b>{title}</b><small>{hint}</small></div>{children}</div>;
}

function NumberSetting({
  title,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  title: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="number-setting">
      <span><b>{title}</b><small>{hint}</small></span>
      <Input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(event) => onChange(clampNumber(Number(event.target.value), min, max))}
      />
    </label>
  );
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
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
