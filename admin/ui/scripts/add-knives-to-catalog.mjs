import { readFile, writeFile } from 'node:fs/promises'

const catalogPath = new URL('../public/skins-catalog.json', import.meta.url)
const apiRoot = 'https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en'
const knifeCategory = 'sfui_invpanel_filter_melee'

const [catalog, allSkins, baseWeapons] = await Promise.all([
  readFile(catalogPath, 'utf8').then(JSON.parse),
  fetch(`${apiRoot}/skins.json`).then(response => response.json()),
  fetch(`${apiRoot}/base_weapons.json`).then(response => response.json())
])

// CSGO-API also contains legacy HUD aliases. Only canonical weapon_* classnames
// are valid configuration keys and can safely cross the Verona API boundary.
const knives = allSkins.filter(item =>
  item.category?.id === knifeCategory && item.weapon?.id?.startsWith('weapon_'))
const baseByClassname = new Map(baseWeapons.map(item =>
  [item.id.replace('base_weapon-', ''), item]))

catalog.weapons = catalog.weapons.filter(item => item.category !== knifeCategory)
catalog.skins = catalog.skins.filter(item => item.category !== knifeCategory)

for (const group of Map.groupBy(knives, item => item.weapon.id).values()) {
  const first = group[0]
  const base = baseByClassname.get(first.weapon.id)
  catalog.weapons.push({ weapon: first.weapon.id, name: first.weapon.name,
    category: knifeCategory, image: base?.image ?? first.image })

  // Phase-only duplicates cannot be represented by the current paint-kit schema,
  // so retain one deterministic catalog row for every functional paint index.
  const uniquePaints = new Map()
  for (const item of group) {
    const paint = Number(item.paint_index)
    if (!Number.isInteger(paint) || paint <= 0 || uniquePaints.has(paint)) continue
    uniquePaints.set(paint, { name:item.name, weapon:item.weapon.id,
      weaponName:item.weapon.name, category:knifeCategory, paint,
      color:item.rarity?.color ?? '#eb4b4b', image:item.image,
      minWear:item.min_float ?? 0, maxWear:item.max_float ?? 1 })
  }
  catalog.skins.push(...uniquePaints.values())
}

await writeFile(catalogPath, JSON.stringify(catalog))
console.log(`Catalog updated: ${catalog.weapons.filter(x => x.category === knifeCategory).length} knives`)
