import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DownloadSimple,
  Key,
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
  type StickerPlacement,
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
import {
  type CatalogAgent, type CatalogGlove, type CatalogKeychain, type CatalogSkin,
  type CatalogSticker, type Collection, type GloveDraft, type Known, type TeamScope,
  type Weapon, emptyGloveDraft, loadoutGroups, newSticker, rarityRank, teamIcon, wearName,
} from "./skinchanger/model";
import { FloatBar, LazyImage, RotationDial, StickerPad, TeamSelect, VirtualGrid, WeaponLoadoutCard } from "./skinchanger/controls";
/* Domain types and reusable picker controls live in ./skinchanger. */
export default function SkinchangerView() {
  const [params] = useSearchParams(),
    [me, setMe] = useState<Me | null>(null),
    [players, setPlayers] = useState<Known[]>([]),
    [targetId, setTargetId] = useState(""),
    [weapons, setWeapons] = useState<Weapon[]>([]),
    [skinMap, setSkinMap] = useState(new Map<string, CatalogSkin[]>()),
    [gloves, setGloves] = useState<CatalogGlove[]>([]),
    [agents, setAgents] = useState<CatalogAgent[]>([]),
    [stickerCatalog, setStickerCatalog] = useState<CatalogSticker[]>([]),
    [keychainCatalog, setKeychainCatalog] = useState<CatalogKeychain[]>([]),
    [loadout, setLoadout] = useState<CosmeticLoadout>({
      skins: [],
      gloves: [],
      agents: [],
    }),
    [collections, setCollections] = useState<Collection[]>([]),
    [search, setSearch] = useState(""),
    [activeTeam, setActiveTeam] = useState<"ct" | "t">("t"),
    [picker, setPicker] = useState<Weapon | null>(null),
    [scope, setScope] = useState<"both" | "ct" | "t">("both"),
    [picked, setPicked] = useState<CatalogSkin | null>(null),
    [wear, setWear] = useState(0.01),
    [seed, setSeed] = useState(0),
    [statTrak, setStatTrak] = useState(false),
    [nameTag, setNameTag] = useState(""),
    // The open weapon's stickers (up to 5, keyed by slot) and keychain are edited as a
    // draft and persisted together with the skin in saveSkin.
    [stickerDraft, setStickerDraft] = useState<StickerPlacement[]>([]),
    [keychainDraft, setKeychainDraft] = useState<{ id: number; seed: number } | null>(
      null,
    ),
    [activeSlot, setActiveSlot] = useState<number | null>(null),
    // Nested picker overlaying the weapon dialog: choose a sticker for a slot or the keychain.
    [stickerPicker, setStickerPicker] = useState<
      { kind: "sticker"; slot: number } | { kind: "keychain" } | null
    >(null),
    [stickerSearch, setStickerSearch] = useState(""),
    [pickerSearch, setPickerSearch] = useState(""),
    [collectionOpen, setCollectionOpen] = useState(false),
    [collectionName, setCollectionName] = useState(""),
    [importOpen, setImportOpen] = useState(false),
    [importCode, setImportCode] = useState(""),
    [cosmetic, setCosmetic] = useState<{
      kind: "gloves" | "agents";
    } | null>(null),
    [cosmeticTeam, setCosmeticTeam] = useState<TeamScope>("t"),
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
    ),
    stickerById = useMemo(
      () => new Map(stickerCatalog.map((s) => [s.id, s])),
      [stickerCatalog],
    ),
    keychainById = useMemo(
      () => new Map(keychainCatalog.map((k) => [k.id, k])),
      [keychainCatalog],
    );
  const cosmeticDisplayTeam: "ct" | "t" = cosmeticTeam === "both" ? activeTeam : cosmeticTeam;
  const getSkin = (w: string, team: "ct" | "t" = activeTeam) => {
      const x = skins[`${w}:${team}`];
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
      const [cat, cos, stk] = await Promise.all([
        fetch("/skins-catalog.json").then((r) => r.json()),
        fetch("/cosmetics-catalog.json").then((r) => r.json()),
        fetch("/stickers-catalog.json").then((r) => r.json()),
      ]);
      if (!active) return;
      setWeapons(cat.weapons);
      setStickerCatalog(stk.stickers);
      setKeychainCatalog(stk.keychains);
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
      (w.team === "both" || w.team === activeTeam) &&
      (!search ||
        w.name.toLowerCase().includes(search.toLowerCase()) ||
        (getSkin(w.weapon, activeTeam)?.name ?? "")
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
    setStickerDraft(set?.stickers ? set.stickers.map((s) => ({ ...s })) : []);
    setKeychainDraft(
      set?.keychainId
        ? { id: set.keychainId, seed: set.keychainSeed ?? 0 }
        : null,
    );
    setActiveSlot(null);
  }
  function openWeapon(w: Weapon) {
    const s = w.team === "both" ? activeTeam : w.team;
    setPicker(w);
    setScope(s);
    loadScope(w, s);
    setPickerSearch("");
  }
  function changeScope(s: string) {
    // Only retarget which side the save applies to — keep the skin, float, pattern,
    // StatTrak and name tag the user is currently configuring instead of reloading
    // the other team's stored loadout and wiping the in-progress selection.
    const next = s as TeamScope;
    setScope(next);
    if (picker && next !== "both") loadScope(picker, next);
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
        stickers: stickerDraft,
        keychainId: keychainDraft?.id ?? null,
        keychainSeed: keychainDraft?.seed ?? 0,
      }),
    });
    await load();
    setPicker(null);
    toast.success("Скин сохранён");
  }
  // Sticker slot helpers operating on the draft; a slot holds at most one sticker.
  const slotSticker = (slot: number) =>
    stickerDraft.find((s) => s.slot === slot) ?? null;
  function applySticker(slot: number, stickerId: number) {
    setStickerDraft((d) => [
      ...d.filter((s) => s.slot !== slot),
      newSticker(slot, stickerId),
    ]);
    setActiveSlot(slot);
  }
  function patchSlot(slot: number, patch: Partial<StickerPlacement>) {
    setStickerDraft((d) =>
      d.map((s) => (s.slot === slot ? { ...s, ...patch } : s)),
    );
  }
  function removeSlot(slot: number) {
    setStickerDraft((d) => d.filter((s) => s.slot !== slot));
    setActiveSlot((a) => (a === slot ? null : a));
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
  function openCosmetic(kind: "gloves" | "agents", team: "ct" | "t" = activeTeam) {
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
  function updateGloveDraft(update: (draft: GloveDraft) => GloveDraft) {
    const teams: ("ct" | "t")[] = cosmeticTeam === "both" ? ["t", "ct"] : [cosmeticTeam];
    setGloveDraft((draft) => {
      const next = { ...draft };
      for (const team of teams) next[team] = update(draft[team]);
      return next;
    });
  }
  async function saveCosmetic() {
    if (!cosmetic) return;
    const teams: ("ct" | "t")[] = cosmeticTeam === "both" ? ["t", "ct"] : [cosmeticTeam];
    await Promise.all(teams.map(async (team) => {
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
    }));
    await load();
    setCosmetic(null);
    toast.success("Loadout сохранён");
  }
  // Clears only the side currently shown, both on the server and in the draft, so the
  // other team's selection is untouched and the dialog stays open for further edits.
  async function resetCosmetic() {
    if (!cosmetic) return;
    const teams: ("ct" | "t")[] = cosmeticTeam === "both" ? ["t", "ct"] : [cosmeticTeam];
    await Promise.all(teams.map((team) => api(`${root}/${cosmetic.kind}/${team}`, { method: "DELETE" })));
    if (cosmetic.kind === "gloves")
      setGloveDraft((draft) => ({
        ct: teams.includes("ct") ? draftFromGlove(undefined) : draft.ct,
        t: teams.includes("t") ? draftFromGlove(undefined) : draft.t,
      }));
    else setAgentDraft((draft) => ({
      ct: teams.includes("ct") ? null : draft.ct,
      t: teams.includes("t") ? null : draft.t,
    }));
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
          <div className="loadout-team-bar">
            <div>
              <span>СТОРОНА LOADOUT</span>
              <b>{activeTeam === "t" ? "TERRORIST" : "COUNTER-TERRORIST"}</b>
            </div>
            <TeamSelect
              options={["t", "ct"]}
              value={activeTeam}
              onChange={(team) => setActiveTeam(team as "ct" | "t")}
            />
          </div>
          <div className="skin-toolbar">
            <span className="arsenal-caption">АРСЕНАЛ КОМАНДЫ</span>
            <label className="search">
              <MagnifyingGlass />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск"
              />
            </label>
          </div>
          <div className="cs2-loadout-board">
              <aside className="cosmetic-rail" aria-label="Экипировка команды">
                {(["agents", "gloves"] as const).map((kind) => {
                  const item = kind === "gloves" ? getGlove(activeTeam) : getAgent(activeTeam);
                  return (
                    <button
                      className="rail-slot"
                      style={{ "--rarity": item?.color ?? "#30343d" } as React.CSSProperties}
                      onClick={() => openCosmetic(kind, activeTeam)}
                      type="button"
                      key={kind}
                    >
                      <img className={!item ? "vanilla" : ""} src={item?.image ?? teamIcon[activeTeam]} />
                      <span>{kind === "gloves" ? "Перчатки" : "Агент"}</span>
                      <b>{item?.name ?? "Не выбран"}</b>
                    </button>
                  );
                })}
                {weapons
                  .filter((weapon) => weapon.category === "loadoutslot_equipment" && (weapon.team === "both" || weapon.team === activeTeam))
                  .map((weapon) => {
                    const skin = getSkin(weapon.weapon, activeTeam);
                    return (
                      <button
                        className="rail-slot rail-zeus"
                        style={{ "--rarity": skin?.color ?? "#30343d" } as React.CSSProperties}
                        onClick={() => openWeapon(weapon)}
                        type="button"
                        key={weapon.weapon}
                      >
                        <img className={!skin ? "vanilla" : ""} src={skin?.image ?? weapon.image} />
                        <span>Экипировка</span>
                        <b>{skin?.name.split("| ")[1] ?? weapon.name}</b>
                      </button>
                    );
                  })}
              </aside>
              <div className="arsenal-columns">
                {loadoutGroups.map((group) => {
                  const items = visible.filter((weapon) => group.categories.includes(weapon.category));
                  return (
                    <section className="arsenal-group" key={group.id}>
                      <header><span>{group.label}</span><b>{items.length}</b></header>
                      <div className="arsenal-grid">
                        {items.map((weapon) => (
                          <WeaponLoadoutCard key={weapon.weapon} weapon={weapon} skin={getSkin(weapon.weapon, activeTeam)} onOpen={openWeapon} />
                        ))}
                      </div>
                    </section>
                  );
                })}
              </div>
              <section className="knife-rack">
                <header><span>Ножи</span><b>Модель и отделка</b></header>
                <div className="knife-strip">
                  {visible.filter((weapon) => weapon.category === "sfui_invpanel_filter_melee").map((weapon) => (
                    <WeaponLoadoutCard key={weapon.weapon} weapon={weapon} skin={getSkin(weapon.weapon, activeTeam)} onOpen={openWeapon} />
                  ))}
                </div>
              </section>
          </div>
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
          <div className="sticker-section">
            <div className="cfg-slider-head">
              <span className="cfg-title">Стикеры и брелок</span>
            </div>
            <div className="sticker-slots">
              {[0, 1, 2, 3, 4].map((slot) => {
                const s = slotSticker(slot);
                const cat = s ? stickerById.get(s.stickerId) : null;
                return (
                  <button
                    type="button"
                    key={slot}
                    className={`sticker-slot ${activeSlot === slot ? "active" : ""} ${s ? "filled" : ""}`}
                    disabled={!picked}
                    onClick={() =>
                      s
                        ? setActiveSlot((a) => (a === slot ? null : slot))
                        : setStickerPicker({ kind: "sticker", slot })
                    }
                    title={cat?.name ?? `Слот ${slot + 1}`}
                  >
                    {cat ? (
                      <img src={cat.image} alt="" />
                    ) : (
                      <Plus className="sticker-slot-icon" />
                    )}
                    {s && (
                      <em
                        className="sticker-slot-x"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeSlot(slot);
                        }}
                      >
                        <Trash />
                      </em>
                    )}
                  </button>
                );
              })}
              {(() => {
                const kc = keychainDraft
                  ? keychainById.get(keychainDraft.id)
                  : null;
                return (
                  <button
                    type="button"
                    className={`sticker-slot keychain ${keychainDraft ? "filled" : ""}`}
                    disabled={!picked}
                    onClick={() => setStickerPicker({ kind: "keychain" })}
                    title={kc?.name ?? "Брелок"}
                  >
                    {kc ? (
                      <img src={kc.image} alt="" />
                    ) : (
                      <Key className="sticker-slot-icon" />
                    )}
                    {keychainDraft && (
                      <em
                        className="sticker-slot-x"
                        onClick={(e) => {
                          e.stopPropagation();
                          setKeychainDraft(null);
                        }}
                      >
                        <Trash />
                      </em>
                    )}
                  </button>
                );
              })()}
            </div>
            {activeSlot !== null &&
              slotSticker(activeSlot) &&
              (() => {
                const s = slotSticker(activeSlot)!;
                const cat = stickerById.get(s.stickerId);
                return (
                  <div className="sticker-editor">
                    <div className="sticker-editor-main">
                      <StickerPad
                        x={s.offsetX}
                        y={s.offsetY}
                        rotation={s.rotation}
                        image={cat?.image}
                        onChange={(x, y) =>
                          patchSlot(activeSlot, { offsetX: x, offsetY: y })
                        }
                      />
                      <RotationDial
                        value={s.rotation}
                        onChange={(deg) =>
                          patchSlot(activeSlot, { rotation: deg })
                        }
                      />
                    </div>
                    <div className="sticker-editor-sliders">
                      <div className="cfg-slider">
                        <div className="cfg-slider-head">
                          <span className="cfg-title">Износ</span>
                          <span className="cfg-value">{s.wear.toFixed(2)}</span>
                        </div>
                        <input
                          className="range-slider pattern-slider"
                          type="range"
                          min={0}
                          max={1}
                          step={0.01}
                          value={s.wear}
                          onChange={(e) =>
                            patchSlot(activeSlot, { wear: +e.target.value })
                          }
                        />
                      </div>
                      <div className="cfg-slider">
                        <div className="cfg-slider-head">
                          <span className="cfg-title">Масштаб</span>
                          <span className="cfg-value">{s.scale.toFixed(2)}</span>
                        </div>
                        <input
                          className="range-slider pattern-slider"
                          type="range"
                          min={0.2}
                          max={3}
                          step={0.05}
                          value={s.scale}
                          onChange={(e) =>
                            patchSlot(activeSlot, { scale: +e.target.value })
                          }
                        />
                      </div>
                    </div>
                  </div>
                );
              })()}
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
        open={!!stickerPicker}
        onOpenChange={(v) => {
          if (!v) {
            setStickerPicker(null);
            setStickerSearch("");
          }
        }}
        title={
          stickerPicker?.kind === "keychain" ? "Выбор брелка" : "Выбор стикера"
        }
        wide
        footer={
          <Button
            variant="ghost"
            onClick={() => {
              setStickerPicker(null);
              setStickerSearch("");
            }}
          >
            Закрыть
          </Button>
        }
      >
        <div className="skin-config">
          <Input
            className="cfg-search"
            value={stickerSearch}
            onChange={(e) => setStickerSearch(e.target.value)}
            placeholder="Поиск по названию"
            autoFocus
          />
        </div>
        {stickerPicker &&
            (() => {
              const q = stickerSearch.toLowerCase();
              if (stickerPicker.kind === "keychain") {
                const filtered = keychainCatalog.filter((k) => k.name.toLowerCase().includes(q));
                const sorted = filtered.slice().sort((a, b) => rarityRank(b.color) - rarityRank(a.color));
                return (
                  <VirtualGrid
                    items={sorted}
                    refreshKey={stickerPicker}
                    renderItem={(k) => (
                      <button
                        key={k.id}
                        type="button"
                        className={`skin-card ${keychainDraft?.id === k.id ? "selected" : ""}`}
                        style={{ "--rarity": k.color } as React.CSSProperties}
                        onClick={() => {
                          setKeychainDraft((kd) => ({
                            id: k.id,
                            seed: kd?.seed ?? 0,
                          }));
                          setStickerPicker(null);
                          setStickerSearch("");
                        }}
                      >
                        <LazyImage src={k.image} />
                        <span>{k.name}</span>
                      </button>
                    )}
                  />
                );
              }
              const slot = stickerPicker.slot;
              const filtered = stickerCatalog.filter((s) => s.name.toLowerCase().includes(q));
              const sorted = filtered.slice().sort((a, b) => rarityRank(b.color) - rarityRank(a.color));
              return (
                <VirtualGrid
                  items={sorted}
                  refreshKey={stickerPicker}
                  renderItem={(s) => (
                    <button
                      key={s.id}
                      type="button"
                      className={`skin-card ${slotSticker(slot)?.stickerId === s.id ? "selected" : ""}`}
                      style={{ "--rarity": s.color } as React.CSSProperties}
                      onClick={() => {
                        applySticker(slot, s.id);
                        setStickerPicker(null);
                        setStickerSearch("");
                      }}
                    >
                      <LazyImage src={s.image} />
                      <span>{s.name}</span>
                    </button>
                  )}
                />
              );
            })()}
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
              options={cosmetic?.kind === "gloves" ? ["t", "both", "ct"] : ["t", "ct"]}
              value={cosmeticTeam}
              onChange={setCosmeticTeam}
            />
            <span className="cfg-side-hint">
              Настраивается{" "}
              <b>{cosmeticTeam === "both" ? "ОБЕ КОМАНДЫ" : cosmeticTeam === "ct" ? "COUNTER-TERRORIST" : "TERRORIST"}</b>
            </span>
          </div>
          {cosmetic?.kind === "gloves" && (
            <>
              <div className="cfg-slider">
                <div className="cfg-slider-head">
                  <span className="cfg-title">
                    Выберите float <i className="cfg-sep">•</i>{" "}
                    <b>{wearName(gloveDraft[cosmeticDisplayTeam].wear)}</b>
                  </span>
                  <span className="cfg-value">
                    {gloveDraft[cosmeticDisplayTeam].wear.toFixed(4)}
                  </span>
                </div>
                <FloatBar
                  value={gloveDraft[cosmeticDisplayTeam].wear}
                  min={gloveDraft[cosmeticDisplayTeam].glove?.minWear ?? 0}
                  max={gloveDraft[cosmeticDisplayTeam].glove?.maxWear ?? 1}
                  disabled={!gloveDraft[cosmeticDisplayTeam].glove}
                  onChange={(v) =>
                    updateGloveDraft((draft) => ({ ...draft, wear: v }))
                  }
                />
              </div>
              <div className="cfg-slider">
                <div className="cfg-slider-head">
                  <span className="cfg-title">Выберите паттерн</span>
                  <span className="cfg-value">
                    {gloveDraft[cosmeticDisplayTeam].seed}
                  </span>
                </div>
                <input
                  className="range-slider pattern-slider"
                  type="range"
                  min={0}
                  max={1000}
                  step={1}
                  value={gloveDraft[cosmeticDisplayTeam].seed}
                  disabled={!gloveDraft[cosmeticDisplayTeam].glove}
                  onChange={(e) =>
                    updateGloveDraft((draft) => ({ ...draft, seed: +e.target.value }))
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
                    className={`skin-card ${gloveDraft[cosmeticDisplayTeam].glove?.id === g.id ? "selected" : ""}`}
                    style={{ "--rarity": g.color } as React.CSSProperties}
                    onClick={() =>
                      updateGloveDraft((draft) => ({
                          glove: g,
                          wear: Math.min(
                            Math.max(draft.wear, g.minWear),
                            g.maxWear,
                          ),
                          seed: draft.seed,
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
                .filter((a) => a.team === cosmeticDisplayTeam)
                .slice()
                .sort((a, b) => rarityRank(b.color) - rarityRank(a.color))
                .map((a) => (
                  <button
                    className={`skin-card agent ${agentDraft[cosmeticDisplayTeam]?.id === a.id ? "selected" : ""}`}
                    style={{ "--rarity": a.color } as React.CSSProperties}
                    onClick={() =>
                      setAgentDraft((d) => ({ ...d, [cosmeticDisplayTeam]: a }))
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
