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
  Slider,
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
    [pickerSearch, setPickerSearch] = useState(""),
    [collectionOpen, setCollectionOpen] = useState(false),
    [collectionName, setCollectionName] = useState(""),
    [importOpen, setImportOpen] = useState(false),
    [importCode, setImportCode] = useState(""),
    [cosmetic, setCosmetic] = useState<{
      kind: "gloves" | "agents";
      team: "ct" | "t";
    } | null>(null),
    [pickedGlove, setPickedGlove] = useState<CatalogGlove | null>(null),
    [pickedAgent, setPickedAgent] = useState<CatalogAgent | null>(null),
    [cosmeticWear, setCosmeticWear] = useState(0.01),
    [cosmeticSeed, setCosmeticSeed] = useState(0);
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
  function openWeapon(w: Weapon) {
    const s = w.team === "both" ? "both" : w.team,
      set = skins[`${w.weapon}:${s}`];
    setPicker(w);
    setScope(s);
    setPicked(
      set
        ? (skinMap.get(w.weapon)?.find((x) => x.paint === set.paintKit) ?? null)
        : null,
    );
    setWear(set?.wear ?? 0.01);
    setSeed(set?.seed ?? 0);
    setPickerSearch("");
  }
  function changeScope(s: string) {
    const team = s as "both" | "ct" | "t";
    setScope(team);
    if (!picker) return;
    const set = skins[`${picker.weapon}:${team}`];
    setPicked(
      set
        ? (skinMap.get(picker.weapon)?.find((x) => x.paint === set.paintKit) ??
            null)
        : null,
    );
    setWear(set?.wear ?? 0.01);
    setSeed(set?.seed ?? 0);
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
  function openCosmetic(kind: "gloves" | "agents", team: "ct" | "t") {
    setCosmetic({ kind, team });
    const g = myGloves[team],
      a = myAgents[team];
    setPickedGlove(
      g
        ? (gloves.find(
            (x) =>
              x.definitionIndex === g.definitionIndex &&
              x.paintKit === g.paintKit,
          ) ?? null)
        : null,
    );
    setPickedAgent(
      a ? (agents.find((x) => x.model === a.model) ?? null) : null,
    );
    setCosmeticWear(g?.wear ?? 0.01);
    setCosmeticSeed(g?.seed ?? 0);
  }
  async function saveCosmetic() {
    if (!cosmetic) return;
    if (cosmetic.kind === "gloves" && pickedGlove)
      await api(`${root}/gloves/${cosmetic.team}`, {
        method: "PUT",
        body: JSON.stringify({
          team: cosmetic.team,
          definitionIndex: pickedGlove.definitionIndex,
          paintKit: pickedGlove.paintKit,
          wear: cosmeticWear,
          seed: cosmeticSeed,
        }),
      });
    if (cosmetic.kind === "agents" && pickedAgent)
      await api(`${root}/agents/${cosmetic.team}`, {
        method: "PUT",
        body: JSON.stringify({ team: cosmetic.team, model: pickedAgent.model }),
      });
    await load();
    setCosmetic(null);
    toast.success("Loadout сохранён");
  }
  async function resetCosmetic() {
    if (!cosmetic) return;
    await api(`${root}/${cosmetic.kind}/${cosmetic.team}`, {
      method: "DELETE",
    });
    await load();
    setCosmetic(null);
    toast.success("Слот сброшен");
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
              {(["ct", "t"] as const).map((team) => {
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
                  >
                    {item && <img src={item.image} />}
                    <b>{team === "ct" ? "COUNTER-TERRORIST" : "TERRORIST"}</b>
                    <span>
                      {item?.name ??
                        `Выбрать ${category === "gloves" ? "перчатки" : "агента"}`}
                    </span>
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
        <div className="picker-toolbar">
          {picker && (
            <Tabs value={scope} onValueChange={changeScope}>
              <TabsList>
                {(picker.team === "both"
                  ? ["both", "t", "ct"]
                  : ([picker.team] as const)
                ).map((t) => (
                  <TabsTrigger value={t} key={t}>
                    {t.toUpperCase()}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}
          <Input
            value={pickerSearch}
            onChange={(e) => setPickerSearch(e.target.value)}
            placeholder="Поиск скина"
          />
          <label>
            Wear <b>{wear.toFixed(4)}</b>
            <Slider
              value={[wear]}
              onValueChange={(v) => setWear(v[0])}
              min={picked?.minWear ?? 0}
              max={picked?.maxWear ?? 1}
              step={0.0001}
            />
          </label>
          <label>
            Seed
            <Input
              type="number"
              min={0}
              max={1000}
              value={seed}
              onChange={(e) => setSeed(+e.target.value)}
            />
          </label>
        </div>
        <div className="skin-grid">
          {(picker ? (skinMap.get(picker.weapon) ?? []) : [])
            .filter((s) =>
              s.name.toLowerCase().includes(pickerSearch.toLowerCase()),
            )
            .map((s) => (
              <button
                className={`skin-card ${picked?.paint === s.paint ? "selected" : ""}`}
                style={{ "--rarity": s.color } as React.CSSProperties}
                onClick={() => {
                  setPicked(s);
                  setWear(Math.min(Math.max(wear, s.minWear), s.maxWear));
                }}
                key={s.paint}
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
        title={`${cosmetic?.kind === "gloves" ? "Перчатки" : "Агент"} · ${cosmetic?.team.toUpperCase()}`}
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
                cosmetic?.kind === "gloves" ? !pickedGlove : !pickedAgent
              }
              onClick={saveCosmetic}
            >
              Сохранить
            </Button>
          </>
        }
      >
        {cosmetic?.kind === "gloves" && (
          <div className="picker-toolbar cosmetic-controls">
            <label>
              Wear <b>{cosmeticWear.toFixed(4)}</b>
              <Slider
                value={[cosmeticWear]}
                onValueChange={(v) => setCosmeticWear(v[0])}
                min={pickedGlove?.minWear ?? 0}
                max={pickedGlove?.maxWear ?? 1}
                step={0.0001}
              />
            </label>
            <label>
              Seed
              <Input
                type="number"
                min={0}
                max={1000}
                value={cosmeticSeed}
                onChange={(e) => setCosmeticSeed(+e.target.value)}
              />
            </label>
          </div>
        )}
        <div className="skin-grid">
          {cosmetic?.kind === "gloves"
            ? gloves.map((g) => (
                <button
                  className={`skin-card ${pickedGlove?.id === g.id ? "selected" : ""}`}
                  style={{ "--rarity": g.color } as React.CSSProperties}
                  onClick={() => {
                    setPickedGlove(g);
                    setCosmeticWear(
                      Math.min(Math.max(cosmeticWear, g.minWear), g.maxWear),
                    );
                  }}
                  key={g.id}
                >
                  <img src={g.image} />
                  <span>{g.name}</span>
                </button>
              ))
            : agents
                .filter((a) => a.team === cosmetic?.team)
                .map((a) => (
                  <button
                    className={`skin-card agent ${pickedAgent?.id === a.id ? "selected" : ""}`}
                    style={{ "--rarity": a.color } as React.CSSProperties}
                    onClick={() => setPickedAgent(a)}
                    key={a.id}
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
