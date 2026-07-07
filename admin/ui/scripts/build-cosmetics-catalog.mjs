import { writeFile } from 'node:fs/promises'

const root = 'https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en'
const [skins, agents, stickerList, keychainList] = await Promise.all([
  fetch(`${root}/skins.json`).then(r => r.json()),
  fetch(`${root}/agents.json`).then(r => r.json()),
  fetch(`${root}/stickers.json`).then(r => r.json()),
  fetch(`${root}/keychains.json`).then(r => r.json())
])

const gloves = skins
  .filter(item => item.category?.id === 'sfui_invpanel_filter_gloves')
  .map(item => ({
    id: item.id,
    name: item.name.replace(/^★\s*/, ''),
    definitionIndex: Number(item.weapon.weapon_id),
    paintKit: Number(item.paint_index),
    minWear: item.min_float ?? 0,
    maxWear: item.max_float ?? 1,
    color: item.rarity?.color ?? '#eb4b4b',
    image: item.image
  }))
  .filter(item => Number.isInteger(item.definitionIndex) && Number.isInteger(item.paintKit))

const agentItems = agents.map(item => ({
  id: item.id,
  name: item.name,
  team: item.team?.id === 'counter-terrorists' ? 'ct' : 't',
  model: item.model_player,
  color: item.rarity?.color ?? '#8847ff',
  image: item.image
})).filter(item => /^agents\/models\/[a-z0-9_/-]+\.vmdl$/.test(item.model))

const output = new URL('../public/cosmetics-catalog.json', import.meta.url)
await writeFile(output, JSON.stringify({ gloves, agents: agentItems }, null, 2) + '\n')
console.log(`Wrote ${gloves.length} gloves and ${agentItems.length} agents`)

// Stickers/keychains attach to a weapon by their numeric schema id (def_index),
// which is what CS2 econ attributes expect. Kept in a separate file because the
// sticker list alone is ~10k entries and would bloat the cosmetics catalog.
const toId = value => Number(value)
const stickers = stickerList
  .map(item => ({
    id: toId(item.def_index),
    name: item.name.replace(/^Sticker \| /, ''),
    color: item.rarity?.color ?? '#eb4b4b',
    effect: item.effect ?? null,
    image: item.image
  }))
  .filter(item => Number.isInteger(item.id) && item.id > 0 && item.image)

const keychains = keychainList
  .map(item => ({
    id: toId(item.def_index),
    name: item.name.replace(/^Charm \| /, ''),
    color: item.rarity?.color ?? '#eb4b4b',
    image: item.image
  }))
  .filter(item => Number.isInteger(item.id) && item.id > 0 && item.image)

const stickerOutput = new URL('../public/stickers-catalog.json', import.meta.url)
await writeFile(stickerOutput, JSON.stringify({ stickers, keychains }, null, 2) + '\n')
console.log(`Wrote ${stickers.length} stickers and ${keychains.length} keychains`)
