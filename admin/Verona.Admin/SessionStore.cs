using System.Collections.Concurrent;
using System.Security.Cryptography;

namespace Verona.Admin;

// A session proves only which Steam account signed in. Role and profile are resolved
// from PostgreSQL on every request so demotion takes effect immediately.
public sealed record SessionIdentity(string SteamId);

public sealed class SessionStore
{
    private sealed record Entry(SessionIdentity Identity, DateTimeOffset Expires);
    private readonly ConcurrentDictionary<string, Entry> _sessions = new();

    public string Create(SessionIdentity identity)
    {
        // The cookie contains only a high-entropy opaque token. Identity and role
        // stay server-side, so a client cannot promote itself or replace SteamID.
        // In-memory storage deliberately means an admin restart logs everyone out.
        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        _sessions[token] = new Entry(identity, DateTimeOffset.UtcNow.AddHours(12));
        return token;
    }

    public SessionIdentity? Get(string? token)
    {
        if (string.IsNullOrEmpty(token) || !_sessions.TryGetValue(token, out var entry)) return null;
        if (entry.Expires > DateTimeOffset.UtcNow) return entry.Identity;
        // Expired entries are removed lazily; a cleanup service would add lifecycle
        // complexity without value at the current single-instance scale.
        _sessions.TryRemove(token, out _);
        return null;
    }

    public void Remove(string? token)
    {
        if (!string.IsNullOrEmpty(token)) _sessions.TryRemove(token, out _);
    }
}
