import { useEffect, useMemo, useState } from "react";
import {
  DownloadSimple,
  MagnifyingGlass,
  Plus,
  ShareNetwork,
  Trash,
} from "@phosphor-icons/react";
import { SteamIcon as SteamLogo } from "../components/brand-icons";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  api,
  getMe,
  type Agent,
  type CosmeticLoadout,
  type Glove,
  type Me,
  type Skin,
} from "../api";
import { faceitLevel } from "../faceit";
import {
  Badge,
  Button,
  Dialog,
  Input,
  Select,
  Switch,
  Textarea,
} from "../components/ui";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs";
interface Weapon {
  weapon: string;
  name: string;
  category: string;
  image: string;
  team: "both" | "ct" | "t";
}
interface CatalogSkin {
  name: string;
  weapon: string;
  paint: number;
  color: string;
  image: string;
  minWear: number;
  maxWear: number;
}
interface Known {
  steamId: string;
  name: string;
  lastSeenAt: string;
  avatarUrl?: string | null;
  profileUrl?: string | null;
  faceitElo?: number | null;
  faceitNickname?: string | null;
}
interface Collection {
  id: number;
  name: string;
  active: boolean;
  count: number;
}
interface CatalogGlove {
  id: string;
  name: string;
  definitionIndex: number;
  paintKit: number;
  minWear: number;
  maxWear: number;
  color: string;
  image: string;
}
interface CatalogAgent {
  id: string;
  name: string;
  team: "ct" | "t";
  model: string;
  color: string;
  image: string;
}
interface GloveDraft {
  glove: CatalogGlove | null;
  wear: number;
  seed: number;
}
const emptyGloveDraft: Record<"ct" | "t", GloveDraft> = {
  ct: { glove: null, wear: 0.01, seed: 0 },
  t: { glove: null, wear: 0.01, seed: 0 },
};
const categories = [
  ["all", "Всё"],
  ["sfui_invpanel_filter_melee", "Ножи"],
  ["csgo_inventory_weapon_category_pistols", "Пистолеты"],
  ["csgo_inventory_weapon_category_rifles", "Винтовки"],
  ["csgo_inventory_weapon_category_smgs", "SMG"],
  ["csgo_inventory_weapon_category_heavy", "Тяжёлое"],
  ["loadoutslot_equipment", "Zeus"],
  ["gloves", "Перчатки"],
  ["agents", "Агенты"],
];
// CS2 rarity tiers, lowest → highest. Used to sort the picker so the rarest skins
// surface first, mirroring the in-game inventory ordering.
const RARITY_RANK: Record<string, number> = {
  "#b0c3d9": 1,
  "#5e98d9": 2,
  "#4b69ff": 3,
  "#8847ff": 4,
  "#d32ce6": 5,
  "#eb4b4b": 6,
  "#e4ae39": 7,
};
const rarityRank = (color?: string) =>
  (color && RARITY_RANK[color.toLowerCase()]) || 0;
// Standard CS2 wear buckets; only the abbreviation is shown next to the float.
const wearName = (wear: number) =>
  wear < 0.07 ? "FN" : wear < 0.15 ? "MW" : wear < 0.38 ? "FT" : wear < 0.45 ? "WW" : "BS";
type TeamScope = "both" | "ct" | "t";
const TEAM_ICON: Record<TeamScope, string> = {
  t: "/img/skins/t-side.svg",
  both: "/img/skins/both-side.svg",
  ct: "/img/skins/ct-side.svg",
};
// The bar always spans the full 0..1 float scale so the wear-tier colours line up
// at their real boundaries. Regions outside the skin's allowed range are locked out,
// which is how CS2 marketplaces show that a skin only exists in certain conditions.
function FloatBar({
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const clamp = (v: number) => Math.min(Math.max(v, min), max);
  return (
    <div className={`float-bar ${disabled ? "is-disabled" : ""}`}>
      <div className="float-track" />
      {min > 0 && (
        <span className="float-lock" style={{ left: 0, width: `${min * 100}%` }} />
      )}
      {max < 1 && (
        <span
          className="float-lock"
          style={{ left: `${max * 100}%`, width: `${(1 - max) * 100}%` }}
        />
      )}
      <input
        className="range-slider float-input"
        type="range"
        min={0}
        max={1}
        step={0.0001}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(clamp(+e.target.value))}
      />
    </div>
  );
}
function TeamSelect({
  options,
  value,
  onChange,
}: {
  options: TeamScope[];
  value: string;
  onChange: (team: TeamScope) => void;
}) {
  return (
    <div className="team-select">
      {options.map((team) => (
        <button
          type="button"
          key={team}
          className={`team-opt ${value === team ? "active" : ""}`}
          onClick={() => onChange(team)}
          title={team.toUpperCase()}
          aria-label={team.toUpperCase()}
        >
          <img src={TEAM_ICON[team]} alt="" />
        </button>
      ))}
    </div>
  );
}
export default function SkinchangerView() {
  const [params] = useSearchParams(),
    [me, setMe] = useState<Me | null>(null),
    [players, setPlayers] = useState<Known[]>([]),
    [targetId, setTargetId] = useState(""),
    [weapons, setWeapons] = useState<Weapon[]>([]),
    [skinMap, setSkinMap] = useState(new Map<string, CatalogSkin[]>()),
    [gloves, setGloves] = useState<CatalogGlove[]>([]),
    [agents, setAgents] = useState<CatalogAgent[]>([]),
    [loadout, setLoadout] = useState<CosmeticLoadout>({
      skins: [],
      gloves: [],
      agents: [],
    }),
    [collections, setCollections] = useState<Collection[]>([]),
    [category, setCategory] = useState("all"),
    [search, setSearch] = useState(""),
    [picker, setPicker] = useState<Weapon | null>(null),
    [scope, setScope] = useState<"both" | "ct" | "t">("both"),
    [picked, setPicked] = useState<CatalogSkin | null>(null),
    [wear, setWear] = useState(0.01),
    [seed, setSeed] = useState(0),
    [statTrak, setStatTrak] = useState(false),
    [nameTag, setNameTag] = useState(""),
    [pickerSearch, setPickerSearch] = useState(""),
    [collectionOpen, setCollectionOpen] = useState(false),
    [collectionName, setCollectionName] = useState(""),
    [importOpen, setImportOpen] = useState(false),
    [importCode, setImportCode] = useState(""),
    [cosmetic, setCosmetic] = useState<{
      kind: "gloves" | "agents";
    } | null>(null),
    [cosmeticTeam, setCosmeticTeam] = useState<"ct" | "t">("ct"),
    // Each side keeps its own draft so CT and T can be configured independently in a
    // single dialog; switching the team toggle never discards the other side's pick.
    [gloveDraft, setGloveDraft] = useState<Record<"ct" | "t", GloveDraft>>(
      emptyGloveDraft,
    ),
    [agentDraft, setAgentDraft] = useState<Record<"ct" | "t", CatalogAgent | null>>(
      { ct: null, t: null },
    );
  const target = players.find((p) => p.steamId === targetId) ?? null,
    self = !me?.isAdmin || !target || target.steamId === me.steamId,
    root = self ? "/api/me" : `/api/players/${target!.steamId}`,
    profile = self
      ? me && {
          ...me,
          profileUrl: `https://steamcommunity.com/profiles/${me.steamId}`,
        }
      : target;
  const skins = useMemo(
      () =>
        Object.fromEntries(
          loadout.skins.map((s) => [`${s.weapon}:${s.team}`, s]),
        ),
      [loadout],
    ),
    myGloves = useMemo(
      () => Object.fromEntries(loadout.gloves.map((g) => [g.team, g])),
      [loadout],
    ),
    myAgents = useMemo(
      () => Object.fromEntries(loadout.agents.map((a) => [a.team, a])),
      [loadout],
    );
  const getSkin = (w: string) => {
      const x = skins[`${w}:both`] ?? skins[`${w}:ct`] ?? skins[`${w}:t`];
      return x
        ? (skinMap.get(w)?.find((s) => s.paint === x.paintKit) ?? null)
        : null;
    },
    getGlove = (t: "ct" | "t") => {
      const x = myGloves[t];
      return x
        ? (gloves.find(
            (g) =>
              g.definitionIndex === x.definitionIndex &&
              g.paintKit === x.paintKit,
          ) ?? null)
        : null;
    },
    getAgent = (t: "ct" | "t") => {
      const x = myAgents[t];
      return x ? (agents.find((a) => a.model === x.model) ?? null) : null;
    };
  const load = async (path = root) =>
      setLoadout(await api<CosmeticLoadout>(`${path}/cosmetics`)),
    loadCollections = async () => {
      if (self) setCollections(await api<Collection[]>("/api/me/collections"));
    };
  useEffect(() => {
    let active = true;
    void (async () => {
      const identity = await getMe();
      if (!active) return;
      setMe(identity);
      const [cat, cos] = await Promise.all([
        fetch("/skins-catalog.json").then((r) => r.json()),
        fetch("/cosmetics-catalog.json").then((r) => r.json()),
      ]);
      if (!active) return;
      setWeapons(cat.weapons);
      const grouped = new Map<string, CatalogSkin[]>();
      for (const s of cat.skins) {
        const a = grouped.get(s.weapon) ?? [];
        a.push(s);
        grouped.set(s.weapon, a);
      }
      setSkinMap(grouped);
      setGloves(cos.gloves);
      setAgents(cos.agents);
      let path = "/api/me";
      if (identity?.isAdmin) {
        const ps = await api<Known[]>("/api/players/known");
        if (!active) return;
        setPlayers(ps);
        const id = params.get("steamId") ?? identity.steamId;
        setTargetId(id);
        if (id !== identity.steamId) path = `/api/players/${id}`;
      }
      const [nextLoadout, cols] = await Promise.all([
        api<CosmeticLoadout>(`${path}/cosmetics`),
        api<Collection[]>("/api/me/collections"),
      ]);
      if (!active) return;
      setLoadout(nextLoadout);
      if (!cols.length) {
        await api("/api/me/collections", {
          method: "POST",
          body: JSON.stringify({ name: "По умолчанию" }),
        });
        if (active)
          setCollections(await api<Collection[]>("/api/me/collections"));
      } else setCollections(cols);
    })();
    return () => {
      active = false;
    };
  }, []);
  async function retarget(id: string) {
    setTargetId(id);
    const isSelf = id === me?.steamId;
    setLoadout(
      await api<CosmeticLoadout>(
        `${isSelf ? "/api/me" : `/api/players/${id}`}/cosmetics`,
      ),
    );
  }
  const visible = weapons.filter(
    (w) =>
      (category === "all" || w.category === category) &&
      (!search ||
        w.name.toLowerCase().includes(search.toLowerCase()) ||
        (getSkin(w.weapon)?.name ?? "")
          .toLowerCase()
          .includes(search.toLowerCase())),
  );
  function loadScope(w: Weapon, team: "both" | "ct" | "t") {
    const set = skins[`${w.weapon}:${team}`];
    setPicked(
      set
        ? (skinMap.get(w.weapon)?.find((x) => x.paint === set.paintKit) ?? null)
        : null,
    );
    setWear(set?.wear ?? 0.01);
    setSeed(set?.seed ?? 0);
    setStatTrak(set?.statTrak ?? false);
    setNameTag(set?.nameTag ?? "");
  }
  function openWeapon(w: Weapon) {
    const s = w.team === "both" ? "both" : w.team;
    setPicker(w);
    setScope(s);
    loadScope(w, s);
    setPickerSearch("");
  }
  function changeScope(s: string) {
    // Only retarget which side the save applies to — keep the skin, float, pattern,
    // StatTrak and name tag the user is currently configuring instead of reloading
    // the other team's stored loadout and wiping the in-progress selection.
    setScope(s as "both" | "ct" | "t");
  }
  async function saveSkin() {
    if (!picker || !picked) return;
    await api(`${root}/skins/${picker.weapon}`, {
      method: "PUT",
      body: JSON.stringify({
        weapon: picker.weapon,
        team: scope,
        paintKit: picked.paint,
        wear,
        seed,
        statTrak,
        nameTag: nameTag.trim() || null,
      }),
    });
    await load();
    setPicker(null);
    toast.success("Скин сохранён");
  }
  async function resetSkin() {
    if (!picker) return;
    await api(`${root}/skins/${picker.weapon}/${scope}`, { method: "DELETE" });
    await load();
    setPicker(null);
    toast.success("Скин сброшен");
  }
  async function createCollection() {
    if (!collectionName.trim()) return;
    await api("/api/me/collections", {
      method: "POST",
      body: JSON.stringify({ name: collectionName.trim() }),
    });
    setCollectionName("");
    setCollectionOpen(false);
    await loadCollections();
  }
  async function activate(c: Collection) {
    if (c.active) return;
    await api(`/api/me/collections/${c.id}/activate`, { method: "POST" });
    await Promise.all([loadCollections(), load()]);
  }
  async function remove(c: Collection) {
    if (!confirm(`Удалить коллекцию «${c.name}»?`)) return;
    await api(`/api/me/collections/${c.id}`, { method: "DELETE" });
    await Promise.all([loadCollections(), load()]);
  }
  async function share(c: Collection) {
    const list = await api<Skin[]>(`/api/me/collections/${c.id}/skins`);
    const code = btoa(
      unescape(
        encodeURIComponent(JSON.stringify({ name: c.name, skins: list })),
      ),
    );
    await navigator.clipboard.writeText(code);
    toast.success("Код коллекции скопирован");
  }
  async function importCollection() {
    try {
      const data = JSON.parse(
        decodeURIComponent(escape(atob(importCode.trim()))),
      );
      await api("/api/me/collections", {
        method: "POST",
        body: JSON.stringify(data),
      });
      setImportOpen(false);
      setImportCode("");
      await loadCollections();
      toast.success("Коллекция импортирована");
    } catch {
      toast.error("Неверный код коллекции");
    }
  }
  function openCosmetic(kind: "gloves" | "agents", team: "ct" | "t" = "ct") {
    setCosmetic({ kind });
    setCosmeticTeam(team);
    // Seed both teams' drafts from the saved loadout so the dialog opens with the
    // current CT and T selections already in place and either can be edited.
    setGloveDraft({
      ct: draftFromGlove(myGloves["ct"]),
      t: draftFromGlove(myGloves["t"]),
    });
    setAgentDraft({
      ct: myAgents["ct"]
        ? (agents.find((x) => x.model === myAgents["ct"].model) ?? null)
        : null,
      t: myAgents["t"]
        ? (agents.find((x) => x.model === myAgents["t"].model) ?? null)
        : null,
    });
  }
  function draftFromGlove(g?: Glove): GloveDraft {
    const glove = g
      ? (gloves.find(
          (x) =>
            x.definitionIndex === g.definitionIndex && x.paintKit === g.paintKit,
        ) ?? null)
      : null;
    return { glove, wear: g?.wear ?? 0.01, seed: g?.seed ?? 0 };
  }
  async function saveCosmetic() {
    if (!cosmetic) return;
    for (const team of ["ct", "t"] as const) {
      if (cosmetic.kind === "gloves") {
        const d = gloveDraft[team];
        if (d.glove)
          await api(`${root}/gloves/${team}`, {
            method: "PUT",
            body: JSON.stringify({
              team,
              definitionIndex: d.glove.definitionIndex,
              paintKit: d.glove.paintKit,
              wear: d.wear,
              seed: d.seed,
            }),
          });
      } else {
        const a = agentDraft[team];
        if (a)
          await api(`${root}/agents/${team}`, {
            method: "PUT",
            body: JSON.stringify({ team, model: a.model }),
          });
      }
    }
    await load();
    setCosmetic(null);
    toast.success("Loadout сохранён");
  }
  // Clears only the side currently shown, both on the server and in the draft, so the
  // other team's selection is untouched and the dialog stays open for further edits.
  async function resetCosmetic() {
    if (!cosmetic) return;
    await api(`${root}/${cosmetic.kind}/${cosmeticTeam}`, { method: "DELETE" });
    if (cosmetic.kind === "gloves")
      setGloveDraft((d) => ({ ...d, [cosmeticTeam]: draftFromGlove(undefined) }));
    else setAgentDraft((d) => ({ ...d, [cosmeticTeam]: null }));
    await load();
    toast.success(`Слот ${cosmeticTeam.toUpperCase()} сброшен`);
  }
  return (
    <>
      <header className="page-header">
        <div>
          <p className="kicker">LOADOUT LAB</p>
          <h1>Skinchanger</h1>
        </div>
        {me?.isAdmin && (
          <Select value={targetId} onChange={(e) => retarget(e.target.value)}>
            {players.map((p) => (
              <option value={p.steamId} key={p.steamId}>
                {p.name} · {p.steamId}
              </option>
            ))}
          </Select>
        )}
      </header>
      {profile && (
        <section className="profile-bar">
          {profile.avatarUrl ? (
            <img src={profile.avatarUrl} />
          ) : (
            <span className="avatar-fallback">{profile.name[0]}</span>
          )}
          <div>
            <h2>{profile.name}</h2>
            <small>{profile.steamId}</small>
          </div>
          <a
            href={
              profile.profileUrl ??
              `https://steamcommunity.com/profiles/${profile.steamId}`
            }
            target="_blank"
          >
            <SteamLogo /> Steam
          </a>
          {profile.faceitElo && (
            <Badge tone="warning">
              <img src={`/faceit/lvl${faceitLevel(profile.faceitElo)}.svg`} />
              {profile.faceitElo} ELO
            </Badge>
          )}
        </section>
      )}
      <div className="loadout-layout">
        {self && (
          <aside className="collections">
            <div className="aside-head">
              <span>КОЛЛЕКЦИИ</span>
              <b>{collections.length}</b>
            </div>
            {collections.map((c) => (
              <div
                className={`collection ${c.active ? "active" : ""}`}
                key={c.id}
                onClick={() => activate(c)}
              >
                <div>
                  <b>{c.name}</b>
                  <small>{c.count} скинов</small>
                </div>
                <div className="collection-actions">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Поделиться коллекцией ${c.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void share(c);
                    }}
                  >
                    <ShareNetwork />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Удалить коллекцию ${c.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void remove(c);
                    }}
                  >
                    <Trash />
                  </Button>
                </div>
              </div>
            ))}
            <div className="aside-buttons">
              <Button
                variant="secondary"
                onClick={() => setCollectionOpen(true)}
              >
                <Plus /> Создать
              </Button>
              <Button variant="ghost" onClick={() => setImportOpen(true)}>
                <DownloadSimple /> Импорт
              </Button>
            </div>
          </aside>
        )}
        <section className="loadout-main">
          <div className="skin-toolbar">
            <Tabs value={category} onValueChange={setCategory}>
              <TabsList className="h-auto flex-wrap justify-start">
                {categories.map(([id, label]) => (
                  <TabsTrigger key={id} value={id}>
                    {label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <label className="search">
              <MagnifyingGlass />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск"
              />
            </label>
          </div>
          {category === "gloves" || category === "agents" ? (
            <div className="weapon-grid">
              {(["t", "ct"] as const).map((team) => {
                const item =
                  category === "gloves" ? getGlove(team) : getAgent(team);
                return (
                  <button
                    className="weapon-card"
                    style={
                      {
                        "--rarity": item?.color ?? "#30343d",
                      } as React.CSSProperties
                    }
                    onClick={() => openCosmetic(category, team)}
                    key={team}
                    type="button"
                  >
                    <img
                      className={!item ? "vanilla" : ""}
                      src={item?.image ?? TEAM_ICON[team]}
                    />
                    <b>{team === "ct" ? "COUNTER-TERRORIST" : "TERRORIST"}</b>
                    <span>
                      {item?.name ??
                        `Выбрать ${category === "gloves" ? "перчатки" : "агента"}`}
                    </span>
                    <em className="team-tag">
                      <img src={TEAM_ICON[team]} alt="" />
                    </em>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="weapon-grid">
              {visible.map((w) => {
                const skin = getSkin(w.weapon);
                return (
                  <button
                    className="weapon-card"
                    style={
                      {
                        "--rarity": skin?.color ?? "#30343d",
                      } as React.CSSProperties
                    }
                    onClick={() => openWeapon(w)}
                    key={w.weapon}
                  >
                    <img
                      className={!skin ? "vanilla" : ""}
                      src={skin?.image ?? w.image}
                    />
                    <b>{w.name}</b>
                    <span>{skin?.name.split("| ")[1] ?? "Добавить скин"}</span>
                    <em>{w.team.toUpperCase()}</em>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>
      <Dialog
        open={collectionOpen}
        onOpenChange={setCollectionOpen}
        title="Новая коллекция"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCollectionOpen(false)}>
              Отмена
            </Button>
            <Button onClick={createCollection}>Создать</Button>
          </>
        }
      >
        <label className="field">
          Название
          <Input
            value={collectionName}
            onChange={(e) => setCollectionName(e.target.value)}
            autoFocus
          />
        </label>
      </Dialog>
      <Dialog
        open={importOpen}
        onOpenChange={setImportOpen}
        title="Импорт коллекции"
        footer={<Button onClick={importCollection}>Импортировать</Button>}
      >
        <Textarea
          value={importCode}
          onChange={(e) => setImportCode(e.target.value)}
          rows={7}
          placeholder="Вставьте код коллекции"
        />
      </Dialog>
      <Dialog
        open={!!picker}
        onOpenChange={(v) => !v && setPicker(null)}
        title={picker?.name ?? ""}
        wide
        footer={
          <>
            <Button variant="danger" onClick={resetSkin}>
              Сбросить
            </Button>
            <Button variant="ghost" onClick={() => setPicker(null)}>
              Отмена
            </Button>
            <Button disabled={!picked} onClick={saveSkin}>
              Сохранить
            </Button>
          </>
        }
      >
        <div className="skin-config">
          <div className="cfg-head">
            <label className="cfg-stattrak">
              StatTrak™
              <Switch
                checked={statTrak}
                onCheckedChange={setStatTrak}
                disabled={!picked}
              />
            </label>
            {picker && (
              <TeamSelect
                options={
                  picker.team === "both"
                    ? ["t", "both", "ct"]
                    : [picker.team as TeamScope]
                }
                value={scope}
                onChange={changeScope}
              />
            )}
          </div>
          <Input
            className="cfg-nametag"
            value={nameTag}
            maxLength={20}
            onChange={(e) => setNameTag(e.target.value)}
            placeholder="Введите именной ярлык"
            disabled={!picked}
          />
          <div className="cfg-slider">
            <div className="cfg-slider-head">
              <span className="cfg-title">
                Выберите float <i className="cfg-sep">•</i>{" "}
                <b>{wearName(wear)}</b>
              </span>
              <span className="cfg-value">{wear.toFixed(4)}</span>
            </div>
            <FloatBar
              value={wear}
              min={picked?.minWear ?? 0}
              max={picked?.maxWear ?? 1}
              disabled={!picked}
              onChange={setWear}
            />
          </div>
          <div className="cfg-slider">
            <div className="cfg-slider-head">
              <span className="cfg-title">Выберите паттерн</span>
              <span className="cfg-value">{seed}</span>
            </div>
            <input
              className="range-slider pattern-slider"
              type="range"
              min={0}
              max={1000}
              step={1}
              value={seed}
              disabled={!picked}
              onChange={(e) => setSeed(+e.target.value)}
            />
          </div>
          <Input
            className="cfg-search"
            value={pickerSearch}
            onChange={(e) => setPickerSearch(e.target.value)}
            placeholder="Поиск скина"
          />
        </div>
        <div className="skin-grid">
          {(picker ? (skinMap.get(picker.weapon) ?? []) : [])
            .filter((s) =>
              s.name.toLowerCase().includes(pickerSearch.toLowerCase()),
            )
            .slice()
            .sort((a, b) => rarityRank(b.color) - rarityRank(a.color))
            .map((s) => (
              <button
                className={`skin-card ${picked?.paint === s.paint ? "selected" : ""}`}
                style={{ "--rarity": s.color } as React.CSSProperties}
                onClick={() => {
                  setPicked(s);
                  setWear(Math.min(Math.max(wear, s.minWear), s.maxWear));
                }}
                key={s.paint}
                type="button"
              >
                <img src={s.image} />
                <span>{s.name.split("| ")[1] ?? s.name}</span>
              </button>
            ))}
        </div>
      </Dialog>
      <Dialog
        open={!!cosmetic}
        onOpenChange={(v) => !v && setCosmetic(null)}
        title={cosmetic?.kind === "gloves" ? "Перчатки" : "Агенты"}
        wide
        footer={
          <>
            <Button variant="danger" onClick={resetCosmetic}>
              Сбросить
            </Button>
            <Button variant="ghost" onClick={() => setCosmetic(null)}>
              Отмена
            </Button>
            <Button
              disabled={
                cosmetic?.kind === "gloves"
                  ? !gloveDraft.ct.glove && !gloveDraft.t.glove
                  : !agentDraft.ct && !agentDraft.t
              }
              onClick={saveCosmetic}
            >
              Сохранить
            </Button>
          </>
        }
      >
        <div className="skin-config">
          <div className="cfg-head">
            <TeamSelect
              options={["t", "ct"]}
              value={cosmeticTeam}
              onChange={(team) => setCosmeticTeam(team as "ct" | "t")}
            />
            <span className="cfg-side-hint">
              Настраивается{" "}
              <b>{cosmeticTeam === "ct" ? "COUNTER-TERRORIST" : "TERRORIST"}</b>
            </span>
          </div>
          {cosmetic?.kind === "gloves" && (
            <>
              <div className="cfg-slider">
                <div className="cfg-slider-head">
                  <span className="cfg-title">
                    Выберите float <i className="cfg-sep">•</i>{" "}
                    <b>{wearName(gloveDraft[cosmeticTeam].wear)}</b>
                  </span>
                  <span className="cfg-value">
                    {gloveDraft[cosmeticTeam].wear.toFixed(4)}
                  </span>
                </div>
                <FloatBar
                  value={gloveDraft[cosmeticTeam].wear}
                  min={gloveDraft[cosmeticTeam].glove?.minWear ?? 0}
                  max={gloveDraft[cosmeticTeam].glove?.maxWear ?? 1}
                  disabled={!gloveDraft[cosmeticTeam].glove}
                  onChange={(v) =>
                    setGloveDraft((d) => ({
                      ...d,
                      [cosmeticTeam]: { ...d[cosmeticTeam], wear: v },
                    }))
                  }
                />
              </div>
              <div className="cfg-slider">
                <div className="cfg-slider-head">
                  <span className="cfg-title">Выберите паттерн</span>
                  <span className="cfg-value">
                    {gloveDraft[cosmeticTeam].seed}
                  </span>
                </div>
                <input
                  className="range-slider pattern-slider"
                  type="range"
                  min={0}
                  max={1000}
                  step={1}
                  value={gloveDraft[cosmeticTeam].seed}
                  disabled={!gloveDraft[cosmeticTeam].glove}
                  onChange={(e) =>
                    setGloveDraft((d) => ({
                      ...d,
                      [cosmeticTeam]: {
                        ...d[cosmeticTeam],
                        seed: +e.target.value,
                      },
                    }))
                  }
                />
              </div>
            </>
          )}
        </div>
        <div className="skin-grid">
          {cosmetic?.kind === "gloves"
            ? gloves
                .slice()
                .sort((a, b) => rarityRank(b.color) - rarityRank(a.color))
                .map((g) => (
                  <button
                    className={`skin-card ${gloveDraft[cosmeticTeam].glove?.id === g.id ? "selected" : ""}`}
                    style={{ "--rarity": g.color } as React.CSSProperties}
                    onClick={() =>
                      setGloveDraft((d) => ({
                        ...d,
                        [cosmeticTeam]: {
                          glove: g,
                          wear: Math.min(
                            Math.max(d[cosmeticTeam].wear, g.minWear),
                            g.maxWear,
                          ),
                          seed: d[cosmeticTeam].seed,
                        },
                      }))
                    }
                    key={g.id}
                    type="button"
                  >
                    <img src={g.image} />
                    <span>{g.name}</span>
                  </button>
                ))
            : agents
                .filter((a) => a.team === cosmeticTeam)
                .slice()
                .sort((a, b) => rarityRank(b.color) - rarityRank(a.color))
                .map((a) => (
                  <button
                    className={`skin-card agent ${agentDraft[cosmeticTeam]?.id === a.id ? "selected" : ""}`}
                    style={{ "--rarity": a.color } as React.CSSProperties}
                    onClick={() =>
                      setAgentDraft((d) => ({ ...d, [cosmeticTeam]: a }))
                    }
                    key={a.id}
                    type="button"
                  >
                    <img src={a.image} />
                    <span>{a.name}</span>
                  </button>
                ))}
        </div>
      </Dialog>
    </>
  );
}
