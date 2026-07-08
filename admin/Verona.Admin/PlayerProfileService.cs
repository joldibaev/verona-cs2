using System.Net.Http.Headers;
using System.Text.Json;
using System.Xml.Linq;
using Microsoft.EntityFrameworkCore;
using Verona.Admin.Persistence;

namespace Verona.Admin;

public sealed class PlayerProfileService(
    IHttpClientFactory clients,
    IConfiguration configuration,
    ILogger<PlayerProfileService> logger,
    IDbContextFactory<VeronaDbContext> contexts)
{
    public async Task Refresh(string steamId, CancellationToken ct)
    {
        var name = $"Player {steamId[^5..]}";
        string? avatar = null;
        string? profileUrl = $"https://steamcommunity.com/profiles/{steamId}";

        try
        {
            // Steam's public profile XML provides persona/avatar without requiring a
            // Web API key. Private profiles may expose less data, so every field is optional.
            var xml = XDocument.Parse(await clients.CreateClient().GetStringAsync($"{profileUrl}?xml=1", ct));
            name = xml.Root?.Element("steamID")?.Value.Trim() is { Length: > 0 } steamName ? steamName : name;
            avatar = xml.Root?.Element("avatarFull")?.Value.Trim();
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception, "Could not refresh public Steam profile for {SteamId}", steamId);
        }

        int? faceitElo = null;
        string? faceitNickname = null;
        var faceitKey = configuration["FaceitApiKey"];
        if (!string.IsNullOrWhiteSpace(faceitKey))
        {
            try
            {
                // FACEIT Data API resolves a CS2 account by SteamID64. Keep the key
                // server-side; browsers only receive the resulting public ELO value.
                using var request = new HttpRequestMessage(HttpMethod.Get,
                    $"https://open.faceit.com/data/v4/players?game=cs2&game_player_id={steamId}");
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", faceitKey);
                using var response = await clients.CreateClient().SendAsync(request, ct);
                if (response.IsSuccessStatusCode)
                {
                    using var json = JsonDocument.Parse(await response.Content.ReadAsStreamAsync(ct));
                    var root = json.RootElement;
                    faceitNickname = root.TryGetProperty("nickname", out var nickname) ? nickname.GetString() : null;
                    if (root.TryGetProperty("games", out var games)
                        && games.TryGetProperty("cs2", out var cs2)
                        && cs2.TryGetProperty("faceit_elo", out var elo)) faceitElo = elo.GetInt32();
                }
            }
            catch (Exception exception)
            {
                logger.LogWarning(exception, "Could not refresh FACEIT profile for {SteamId}", steamId);
            }
        }

        await using var db = await contexts.CreateDbContextAsync(ct);
        var id = decimal.Parse(steamId);
        var player = await db.Players.FindAsync([id], ct);
        if (player is null)
        {
            player = new PlayerEntity { SteamId = id };
            db.Players.Add(player);
        }
        player.Name = name;
        player.AvatarUrl = avatar;
        player.ProfileUrl = profileUrl;
        player.FaceitElo = faceitElo;
        player.FaceitNickname = faceitNickname;
        await db.SaveChangesAsync(ct);
    }
}
