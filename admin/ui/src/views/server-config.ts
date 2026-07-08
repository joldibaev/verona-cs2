export interface InstallProgress {
  step: string;
  progress: number;
  downloading: boolean;
  downloadPercent: number | null;
  downloadedBytes: number | null;
  totalBytes: number | null;
}

export interface ServerStatus {
  container: { running: boolean; status: string };
  configured: boolean;
  phase: "empty" | "stopped" | "starting" | "ready";
  ready: boolean;
  currentMap: string;
  online: number;
  lastHeartbeat: string;
  install: InstallProgress | null;
}

export interface LaunchConfig {
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
  serverHostname: string;
  passwordProtected: boolean;
  steamcmdValidate: boolean;
  hibernateWhenEmpty: boolean;
  matchPreset: string;
  customCheats: boolean;
  customRoundTime: number;
  customFreezeTime: number;
  customWarmupTime: number;
  customBuyTime: number;
  customStartMoney: number;
  customMaxMoney: number;
  customBuyAnywhere: boolean;
  customAutoBalance: boolean;
  customLimitTeams: number;
  customAllTalk: boolean;
  customRespawn: boolean;
  customDeathDropGun: boolean;
  customShowImpacts: boolean;
  customGrenadeTrajectory: boolean;
  customGrenadeLimit: number;
}

export interface GameMode {
  label: string;
  hint: string;
  gameType: number;
  gameMode: number;
  maps: string[];
}

export const mapNames: Record<string, string> = {
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

const mapPool = Object.keys(mapNames);
const wingmanMaps = ["de_inferno", "de_nuke", "de_overpass", "de_vertigo"];

export const gameModes: GameMode[] = [
  {
    label: "Casual",
    hint: "Свободный вход без рейтинговых ограничений",
    gameType: 0,
    gameMode: 0,
    maps: mapPool,
  },
  {
    label: "Competitive",
    hint: "Классический соревновательный режим 5×5",
    gameType: 0,
    gameMode: 1,
    maps: mapPool,
  },
  {
    label: "Wingman",
    hint: "Компактный соревновательный режим 2×2",
    gameType: 0,
    gameMode: 2,
    maps: wingmanMaps,
  },
  {
    label: "Deathmatch",
    hint: "Мгновенное возрождение и непрерывный бой",
    gameType: 1,
    gameMode: 2,
    maps: mapPool,
  },
];

export type ServerTone = "success" | "warning" | "danger";

export function serverStatusBadge(status: ServerStatus | null): { tone: ServerTone; label: string } {
  if (status?.phase === "ready") return { tone: "success", label: "Сервер готов" };
  if (status?.phase === "starting")
    return { tone: "warning", label: status.install?.downloading ? "Скачивание данных" : "Подготовка" };
  return { tone: "danger", label: "Остановлен" };
}

export function resolveServerMap(status: ServerStatus | null, launch: LaunchConfig | null): string {
  if (status?.ready && status.currentMap !== "unknown") return status.currentMap;
  if (launch?.workshopMapId) return `Workshop ${launch.workshopMapId}`;
  return launch?.map ?? "de_dust2";
}

export const formatGb = (bytes: number) => (bytes / 1_073_741_824).toFixed(1);

export function findGameMode(config: { gameType: number; gameMode: number }) {
  return (
    gameModes.find(
      (mode) =>
        mode.gameType === config.gameType && mode.gameMode === config.gameMode,
    ) ?? gameModes[0]
  );
}
