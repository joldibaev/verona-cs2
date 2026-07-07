using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Modules.Timers;
using Microsoft.Extensions.Logging;
using Verona.WeaponSkins;

namespace Verona.Admin;

public sealed class AdminApiClient : IDisposable
{
    private static readonly Regex SafeMap = new("^[a-z0-9_]+$", RegexOptions.Compiled);
    private readonly BasePlugin _plugin;
    private readonly WeaponSkinsModule _skins;
    private readonly ILogger _logger;
    private readonly HttpClient _http;
    private bool _syncInProgress;

    public AdminApiClient(BasePlugin plugin, WeaponSkinsModule skins, ILogger logger)
    {
        _plugin = plugin;
        _skins = skins;
        _logger = logger;
        var baseUrl = Environment.GetEnvironmentVariable("VERONA_ADMIN_URL") ?? "http://admin:8080";
        var key = Environment.GetEnvironmentVariable("VERONA_PLUGIN_API_KEY") ?? string.Empty;
        _http = new HttpClient { BaseAddress = new Uri(baseUrl), Timeout = TimeSpan.FromSeconds(5) };
        _http.DefaultRequestHeaders.Add("X-Verona-Key", key);
    }

    public void Start()
    {
        // Capture Source entities before the first await; all entity access must remain
        // on the game thread. Network responses are marshalled back with NextFrame.
        _plugin.AddTimer(2f, () =>
        {
            if (_syncInProgress) return;
            var heartbeat = CaptureHeartbeat();
            _ = SyncAsync(heartbeat);
        }, TimerFlags.REPEAT);
    }

    public void RefreshPlayerSkins(CCSPlayerController? player)
    {
        if (player is not { IsValid: true, IsBot: false }) return;
        var steamId = player.SteamID;
        _ = RefreshPlayerSkinsAsync(steamId, () => _skins.ApplyAll(player));
    }

    private Heartbeat CaptureHeartbeat()
    {
        var players = Utilities.GetPlayers()
            .Where(p => p is { IsValid: true, IsBot: false })
            .Select(p => new PlayerDto(p.SteamID.ToString(), p.PlayerName, p.Slot, p.Team.ToString(), p.IpAddress ?? string.Empty))
            .ToArray();
        return new Heartbeat("local", Server.MapName, players);
    }

    private async Task SyncAsync(Heartbeat heartbeat)
    {
        _syncInProgress = true;
        try
        {
            using var heartbeatResponse = await _http.PostAsJsonAsync("/api/plugin/heartbeat", heartbeat);
            heartbeatResponse.EnsureSuccessStatusCode();
            var commands = await _http.GetFromJsonAsync<ServerCommandDto[]>("/api/plugin/commands") ?? [];
            if (commands.Length > 0) Server.NextFrame(() => ExecuteCommands(commands));
        }
        catch (Exception exception)
        {
            _logger.LogDebug("Verona Admin is not available yet: {Message}", exception.Message);
        }
        finally
        {
            _syncInProgress = false;
        }
    }

    private void ExecuteCommands(IEnumerable<ServerCommandDto> commands)
    {
        foreach (var command in commands)
        {
            switch (command.Type)
            {
                case "change_map" when command.Value is not null && SafeMap.IsMatch(command.Value):
                    Server.ExecuteCommand($"changelevel {command.Value}");
                    break;
                case "kick":
                    WithPlayer(command.SteamId, player => Server.ExecuteCommand($"kickid {player.UserId} {Sanitize(command.Reason)}"));
                    break;
                case "ban":
                    WithPlayer(command.SteamId, player => Server.ExecuteCommand($"banid {ParseMinutes(command.Value)} {player.UserId} kick"));
                    break;
                case "refresh_skins":
                    WithPlayer(command.SteamId, RefreshPlayerSkins);
                    break;
            }
        }
    }

    private async Task RefreshPlayerSkinsAsync(ulong steamId, Action afterUpdate)
    {
        try
        {
            var loadout = await _http.GetFromJsonAsync<LoadoutDto>($"/api/plugin/players/{steamId}/loadout")
                ?? new([], [], []);
            Server.NextFrame(() =>
            {
                _skins.UpdatePlayerLoadout(
                    steamId,
                    loadout.Skins.Select(x => new KeyValuePair<string, SkinDefinition>($"{x.Team}:{x.Weapon}", new(
                        x.PaintKit, x.Wear, x.Seed, x.StatTrak, x.NameTag,
                        x.Stickers?.Select(s => new StickerDefinition(s.Slot, s.StickerId, s.Wear, s.Scale, s.Rotation, s.OffsetX, s.OffsetY)).ToArray(),
                        x.KeychainId, x.KeychainSeed))),
                    loadout.Gloves.Select(x => new KeyValuePair<string, GloveDefinition>(x.Team, new((ushort)x.DefinitionIndex, x.PaintKit, x.Wear, x.Seed))),
                    loadout.Agents.Select(x => new KeyValuePair<string, AgentDefinition>(x.Team, new(x.Model))));
                afterUpdate();
            });
        }
        catch (Exception exception)
        {
            _logger.LogDebug("Could not load remote skins for {SteamId}: {Message}", steamId, exception.Message);
        }
    }

    private static void WithPlayer(string? steamId, Action<CCSPlayerController> action)
    {
        if (!ulong.TryParse(steamId, out var value)) return;
        var player = Utilities.GetPlayers().FirstOrDefault(p => p.IsValid && p.SteamID == value);
        if (player is not null) action(player);
    }

    private static string Sanitize(string? value) => Regex.Replace(value ?? "Removed by admin", "[^a-zA-Z0-9 _.-]", string.Empty);
    private static int ParseMinutes(string? value) => int.TryParse(value, out var minutes) && minutes > 0 ? minutes : 0;
    public void Dispose() => _http.Dispose();

    private sealed record Heartbeat(string ServerId, string Map, IReadOnlyList<PlayerDto> Players);
    private sealed record PlayerDto(string SteamId, string Name, int Slot, string Team, string IpAddress);
    private sealed record ServerCommandDto(long Id, string Type, string? SteamId, string? Value, string? Reason);
    private sealed record StickerDto(int Slot, int StickerId, float Wear = 0, float Scale = 1, float Rotation = 0, float OffsetX = 0, float OffsetY = 0);
    private sealed record SkinDto(
        string Weapon, string Team, int PaintKit, float Wear, int Seed,
        bool StatTrak = false, string? NameTag = null,
        StickerDto[]? Stickers = null, int? KeychainId = null, int KeychainSeed = 0);
    private sealed record GloveDto(string Team, int DefinitionIndex, int PaintKit, float Wear, int Seed);
    private sealed record AgentDto(string Team, string Model);
    private sealed record LoadoutDto(SkinDto[] Skins, GloveDto[] Gloves, AgentDto[] Agents);
}
