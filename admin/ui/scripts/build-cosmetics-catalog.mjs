import { writeFile } from 'node:fs/promises'

const root = 'https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en'
const [skins, agents] = await Promise.all([
  fetch(`${root}/skins.json`).then(r => r.json()),
  fetch(`${root}/agents.json`).then(r => r.json())
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
