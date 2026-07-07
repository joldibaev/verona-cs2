export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) }
  })
  if (response.status === 401) {
    if (location.pathname !== '/login') location.assign('/login')
    throw new Error('Требуется вход')
  }
  if (!response.ok) throw new Error((await response.text()) || `HTTP ${response.status}`)
  // Command endpoints legitimately return no payload. Reading text first avoids
  // JSON.parse('') while preserving JSON decoding for data endpoints.
  if (response.status === 204) return undefined as T
  const body = await response.text()
  return body ? JSON.parse(body) as T : undefined as T
}

export interface Me {
  authenticated: boolean; isAdmin: boolean; steamId: string; name: string
  role: 'player' | 'admin'; avatarUrl: string | null; faceitElo: number | null
  faceitNickname: string | null
}

let cachedMe: Me | null = null
export async function getMe(force = false): Promise<Me | null> {
  if (cachedMe && !force) return cachedMe
  const response = await fetch('/api/auth/me', { credentials: 'same-origin' })
  cachedMe = response.ok ? await response.json() : null
  return cachedMe
}
export function clearMe() { cachedMe = null }

export interface Player {
  steamId: string; name: string; role: 'player' | 'admin'
  avatarUrl: string | null; profileUrl: string | null; faceitElo: number | null
  faceitNickname: string | null
  firstSeenAt: string; lastSeenAt: string; online: boolean; banned: boolean
  banReason: string | null; banExpiresAt: string | null
}

export interface Skin {
  weapon: string
  team: 'both' | 'ct' | 't'
  paintKit: number
  wear: number
  seed: number
}
export interface Glove { team: 'ct' | 't'; definitionIndex: number; paintKit: number; wear: number; seed: number }
export interface Agent { team: 'ct' | 't'; model: string }
export interface CosmeticLoadout { skins: Skin[]; gloves: Glove[]; agents: Agent[] }
