using System.Collections.Concurrent;

namespace Verona.Admin;

public sealed class PlayerRegistry
{
    private readonly ConcurrentDictionary<string, PlayerSnapshot> _players = new();
    public DateTimeOffset LastHeartbeat { get; private set; } = DateTimeOffset.MinValue;
    public string CurrentMap { get; private set; } = "unknown";

    public void Replace(HeartbeatRequest heartbeat)
    {
        _players.Clear();
        foreach (var player in heartbeat.Players) _players[player.SteamId] = player;
        CurrentMap = heartbeat.Map;
        LastHeartbeat = DateTimeOffset.UtcNow;
    }

    public IReadOnlyList<PlayerSnapshot> GetPlayers() => _players.Values.OrderBy(p => p.Name).ToArray();

    public void Reset()
    {
        // A heartbeat from the previous process must never make a freshly started
        // container look ready while SteamCMD/CS2 are still initializing.
        _players.Clear();
        CurrentMap = "unknown";
        LastHeartbeat = DateTimeOffset.MinValue;
    }
}
