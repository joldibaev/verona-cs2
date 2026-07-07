namespace Verona.Admin;

// SteamID64 must cross JSON as text: JavaScript numbers cannot safely represent all 64-bit IDs.
public sealed record PlayerSnapshot(string SteamId, string Name, int Slot, string Team, string IpAddress);
public sealed record HeartbeatRequest(string ServerId, string Map, IReadOnlyList<PlayerSnapshot> Players);
public sealed record SkinInput(string Weapon, string Team, int PaintKit, float Wear, int Seed);
public sealed record GloveInput(string Team, int DefinitionIndex, int PaintKit, float Wear, int Seed);
public sealed record AgentInput(string Team, string Model);
public sealed record PlayerLoadout(IReadOnlyList<SkinInput> Skins, IReadOnlyList<GloveInput> Gloves, IReadOnlyList<AgentInput> Agents);
public sealed record CommandInput(string Type, string? SteamId = null, string? Value = null, string? Reason = null);
public sealed record ServerCommand(long Id, string Type, string? SteamId, string? Value, string? Reason);
public sealed record MapInput(string Map);
public sealed record StartInput(
    string? Map, string? WorkshopMapId, int GameType, int GameMode, int MaxPlayers,
    bool Insecure, bool BotsEnabled, int BotQuota, int BotDifficulty,
    bool Practice, bool InfiniteAmmo, bool FriendlyFire);
public sealed record BanInput(string? Reason, int? DurationMinutes);
public sealed record RoleInput(string Role);
public sealed record CollectionInput(
    string Name,
    IReadOnlyList<SkinInput>? Skins = null,
    IReadOnlyList<GloveInput>? Gloves = null,
    IReadOnlyList<AgentInput>? Agents = null);
public sealed record RequestIdentity(string SteamId, string Name, string Role, string? AvatarUrl, int? FaceitElo, string? FaceitNickname)
{
    public bool IsAdmin => Role == "admin";
}
public sealed record ContainerStatus(bool Exists, string Status, bool Running, string? StartedAt = null, string? Error = null);
