export async function api(path, init) {
    const response = await fetch(path, {
        ...init,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) }
    });
    if (response.status === 401) {
        if (location.pathname !== '/login')
            location.assign('/login');
        throw new Error('Требуется вход');
    }
    if (!response.ok)
        throw new Error((await response.text()) || `HTTP ${response.status}`);
    // Command endpoints legitimately return no payload. Reading text first avoids
    // JSON.parse('') while preserving JSON decoding for data endpoints.
    if (response.status === 204)
        return undefined;
    const body = await response.text();
    return body ? JSON.parse(body) : undefined;
}
let cachedMe = null;
export async function getMe(force = false) {
    if (cachedMe && !force)
        return cachedMe;
    const response = await fetch('/api/auth/me', { credentials: 'same-origin' });
    cachedMe = response.ok ? await response.json() : null;
    return cachedMe;
}
export function clearMe() { cachedMe = null; }
