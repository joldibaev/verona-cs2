import { type ReactNode, useEffect, useRef, useState } from "react";
import type { CatalogSkin, TeamScope, Weapon } from "./model";
import { teamIcon } from "./model";

export function FloatBar({ value, min, max, disabled, onChange }: { value: number; min: number; max: number; disabled?: boolean; onChange: (value: number) => void; }) {
  const clamp = (value: number) => Math.min(Math.max(value, min), max);
  return <div className={`float-bar ${disabled ? "is-disabled" : ""}`}><div className="float-track" />{min > 0 ? <span className="float-lock" style={{ left: 0, width: `${min * 100}%` }} /> : null}{max < 1 ? <span className="float-lock" style={{ left: `${max * 100}%`, width: `${(1 - max) * 100}%` }} /> : null}<input className="range-slider float-input" type="range" min={0} max={1} step={0.0001} value={value} disabled={disabled} onChange={(event) => onChange(clamp(+event.target.value))} /></div>;
}
export function TeamSelect({ options, value, onChange }: { options: TeamScope[]; value: string; onChange: (team: TeamScope) => void; }) {
  return <div className="team-select">{options.map((team) => <button type="button" key={team} className={`team-opt ${value === team ? "active" : ""}`} onClick={() => onChange(team)} title={team.toUpperCase()} aria-label={team.toUpperCase()}><img src={teamIcon[team]} alt="" /></button>)}</div>;
}
export function LazyImage({ src, alt }: { src: string; alt?: string }) { const [loadedSrc, setLoadedSrc] = useState<string | null>(null); useEffect(() => { const timer = setTimeout(() => setLoadedSrc(src), 100); return () => clearTimeout(timer); }, [src]); return loadedSrc ? <img src={loadedSrc} alt={alt} loading="lazy" /> : <div style={{ height: 74, width: "100%", background: "#1a1d24", borderRadius: 6 }} />; }
export function WeaponLoadoutCard({ weapon, skin, onOpen }: { weapon: Weapon; skin: CatalogSkin | null; onOpen: (weapon: Weapon) => void; }) { return <button className="weapon-card loadout-slot" style={{ "--rarity": skin?.color ?? "#30343d" } as React.CSSProperties} onClick={() => onOpen(weapon)} type="button"><img className={!skin ? "vanilla" : ""} src={skin?.image ?? weapon.image} /><b>{weapon.name}</b><span>{skin?.name.split("| ")[1] ?? "Добавить скин"}</span></button>; }
export function VirtualGrid<T>({ items, renderItem, rowHeight = 132, itemWidth = 145, gap = 8, refreshKey }: { items: T[]; renderItem: (item: T) => ReactNode; rowHeight?: number; itemWidth?: number; gap?: number; refreshKey?: unknown; }) {
  const gridRef = useRef<HTMLDivElement>(null); const [viewport, setViewport] = useState({ top: 0, height: 600, width: 800 });
  useEffect(() => { const parent = gridRef.current?.parentElement; if (!parent) return; const update = () => setViewport({ top: parent.scrollTop, height: parent.clientHeight, width: parent.clientWidth }); const observer = new ResizeObserver(update); parent.addEventListener("scroll", update, { passive: true }); observer.observe(parent); update(); return () => { parent.removeEventListener("scroll", update); observer.disconnect(); }; }, [refreshKey]);
  const columns = Math.max(1, Math.floor((viewport.width + gap) / (itemWidth + gap))); const rows = Math.ceil(items.length / columns); const start = Math.max(0, Math.floor(viewport.top / rowHeight) - 2); const end = Math.min(rows, Math.ceil((viewport.top + viewport.height) / rowHeight) + 2);
  return <div ref={gridRef} className="skin-grid" style={{ position: "relative" }}>{start > 0 ? <div style={{ height: start * rowHeight, gridColumn: "1 / -1" }} /> : null}{items.slice(start * columns, end * columns).map(renderItem)}{end < rows ? <div style={{ height: (rows - end) * rowHeight, gridColumn: "1 / -1" }} /> : null}</div>;
}
