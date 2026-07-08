import type { StickerPlacement } from "../../api";

export interface Weapon { weapon: string; name: string; category: string; image: string; team: "both" | "ct" | "t"; }
export interface CatalogSkin { name: string; weapon: string; paint: number; color: string; image: string; minWear: number; maxWear: number; }
export interface Known { steamId: string; name: string; lastSeenAt: string; avatarUrl?: string | null; profileUrl?: string | null; faceitElo?: number | null; faceitNickname?: string | null; }
export interface Collection { id: number; name: string; active: boolean; count: number; }
export interface CatalogGlove { id: string; name: string; definitionIndex: number; paintKit: number; minWear: number; maxWear: number; color: string; image: string; }
export interface CatalogAgent { id: string; name: string; team: "ct" | "t"; model: string; color: string; image: string; }
export interface CatalogSticker { id: number; name: string; color: string; image: string; effect?: string | null; }
export interface CatalogKeychain { id: number; name: string; color: string; image: string; }
export interface GloveDraft { glove: CatalogGlove | null; wear: number; seed: number; }
export type TeamScope = "both" | "ct" | "t";

export const newSticker = (slot: number, stickerId: number): StickerPlacement => ({ slot, stickerId, wear: 0 });
export const emptyGloveDraft: Record<"ct" | "t", GloveDraft> = { ct: { glove: null, wear: 0.01, seed: 0 }, t: { glove: null, wear: 0.01, seed: 0 } };
export const loadoutGroups = [
  { id: "pistols", label: "Пистолеты", categories: ["csgo_inventory_weapon_category_pistols"] },
  { id: "mid", label: "Среднее", categories: ["csgo_inventory_weapon_category_smgs", "csgo_inventory_weapon_category_heavy"] },
  { id: "rifles", label: "Винтовки", categories: ["csgo_inventory_weapon_category_rifles"] },
];
const rarityRanks: Record<string, number> = { "#b0c3d9": 1, "#5e98d9": 2, "#4b69ff": 3, "#8847ff": 4, "#d32ce6": 5, "#eb4b4b": 6, "#e4ae39": 7 };
export const rarityRank = (color?: string) => (color && rarityRanks[color.toLowerCase()]) || 0;
export const wearName = (wear: number) => wear < 0.07 ? "FN" : wear < 0.15 ? "MW" : wear < 0.38 ? "FT" : wear < 0.45 ? "WW" : "BS";
export const teamIcon: Record<TeamScope, string> = { t: "/img/skins/t-side.svg", both: "/img/skins/both-side.svg", ct: "/img/skins/ct-side.svg" };
