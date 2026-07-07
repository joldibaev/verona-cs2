import { useEffect, useMemo, useState } from "react";
import {
  Prohibit as Ban,
  MagnifyingGlass,
  PaintBrush,
  SignOut,
} from "@phosphor-icons/react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api, type Player } from "../api";
import { faceitLevel } from "../faceit";
import { Badge, Button, Input, Select } from "../components/ui";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";

export default function PlayersView() {
  const [players, setPlayers] = useState<Player[]>([]),
    [search, setSearch] = useState("");
  const navigate = useNavigate();
  const load = () => api<Player[]>("/api/players").then(setPlayers);
  useEffect(() => {
    void load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, []);
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q
      ? players.filter(
          (p) => p.name.toLowerCase().includes(q) || p.steamId.includes(q),
        )
      : players;
  }, [players, search]);
  async function role(p: Player, value: "player" | "admin") {
    try {
      await api(`/api/players/${p.steamId}/role`, {
        method: "PUT",
        body: JSON.stringify({ role: value }),
      });
      toast.success("Роль обновлена");
      await load();
    } catch (e) {
      toast.error(String(e));
    }
  }
  async function kick(p: Player) {
    if (!confirm(`Кикнуть ${p.name}?`)) return;
    await api(`/api/players/${p.steamId}/kick`, {
      method: "POST",
      body: JSON.stringify({ type: "kick", reason: "Removed by admin" }),
    });
    toast.success("Команда отправлена");
  }
  async function ban(p: Player) {
    if (!confirm(`${p.banned ? "Разбанить" : "Забанить"} ${p.name}?`)) return;
    if (p.banned)
      await api(`/api/players/${p.steamId}/ban`, { method: "DELETE" });
    else
      await api(`/api/players/${p.steamId}/ban`, {
        method: "POST",
        body: JSON.stringify({
          reason: "Banned by admin",
          durationMinutes: null,
        }),
      });
    toast.success(p.banned ? "Игрок разбанен" : "Игрок забанен");
    await load();
  }
  return (
    <>
      <header className="page-header">
        <div>
          <p className="kicker">PLAYER DATABASE</p>
          <h1>Игроки</h1>
          <span className="subline">
            {players.length} всего · {players.filter((p) => p.online).length}{" "}
            онлайн
          </span>
        </div>
        <label className="search">
          <MagnifyingGlass />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Имя или SteamID"
          />
        </label>
      </header>
      <section className="data-panel">
        <div className="table-scroll">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Игрок</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>FACEIT</TableHead>
                <TableHead>Роль</TableHead>
                <TableHead>Бан</TableHead>
                <TableHead>Последний визит</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((p) => (
                <TableRow key={p.steamId}>
                  <TableCell>
                    <div className="player-cell">
                      {p.avatarUrl ? (
                        <img src={p.avatarUrl} alt="" />
                      ) : (
                        <span className="avatar-fallback">{p.name[0]}</span>
                      )}
                      <div>
                        <a
                          href={
                            p.profileUrl ??
                            `https://steamcommunity.com/profiles/${p.steamId}`
                          }
                          target="_blank"
                        >
                          {p.name}
                        </a>
                        <small>{p.steamId}</small>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge tone={p.online ? "success" : "neutral"}>
                      {p.online ? "Онлайн" : "Не в сети"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {p.faceitElo ? (
                      <span className="elo-cell">
                        <img
                          src={`/faceit/lvl${faceitLevel(p.faceitElo)}.svg`}
                        />
                        {p.faceitElo}
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Select
                      value={p.role}
                      onChange={(e) =>
                        role(p, e.target.value as "player" | "admin")
                      }
                    >
                      <option value="player">Игрок</option>
                      <option value="admin">Администратор</option>
                    </Select>
                  </TableCell>
                  <TableCell>
                    {p.banned ? (
                      <Badge tone="danger">Забанен</Badge>
                    ) : (
                      <span className="muted">Нет</span>
                    )}
                  </TableCell>
                  <TableCell className="date-cell">
                    {new Date(p.lastSeenAt).toLocaleString("ru-RU")}
                  </TableCell>
                  <TableCell>
                    <div className="row-actions">
                      <Button
                        variant="ghost"
                        title="Скины"
                        onClick={() =>
                          navigate(`/skinchanger?steamId=${p.steamId}`)
                        }
                      >
                        <PaintBrush />
                      </Button>
                      <Button
                        variant="ghost"
                        title="Кикнуть"
                        disabled={!p.online}
                        onClick={() => kick(p)}
                      >
                        <SignOut />
                      </Button>
                      <Button
                        variant="ghost"
                        title={p.banned ? "Разбанить" : "Забанить"}
                        onClick={() => ban(p)}
                      >
                        {p.banned ? <SignOut /> : <Ban />}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!visible.length && <div className="empty">Игроки не найдены</div>}
        </div>
      </section>
    </>
  );
}
