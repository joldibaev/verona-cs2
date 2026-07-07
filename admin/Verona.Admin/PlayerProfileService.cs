using System.Net.Http.Headers;
using System.Text.Json;
using System.Xml.Linq;
using Npgsql;

namespace Verona.Admin;

public sealed class PlayerProfileService(IHttpClientFactory clients, IConfiguration configuration, ILogger<PlayerProfileService> logger)
{
    public async Task Refresh(string steamId, NpgsqlDataSource db, CancellationToken ct)
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

        await using var command = db.CreateCommand("""
            INSERT INTO players(steam_id,name,avatar_url,profile_url,faceit_elo,faceit_nickname)
            VALUES ($1,$2,$3,$4,$5,$6)
            ON CONFLICT (steam_id) DO UPDATE SET
                name=EXCLUDED.name, avatar_url=EXCLUDED.avatar_url, profile_url=EXCLUDED.profile_url,
                faceit_elo=EXCLUDED.faceit_elo, faceit_nickname=EXCLUDED.faceit_nickname
            """);
        command.Parameters.AddWithValue(decimal.Parse(steamId));
        command.Parameters.AddWithValue(name);
        command.Parameters.AddWithValue((object?)avatar ?? DBNull.Value);
        command.Parameters.AddWithValue((object?)profileUrl ?? DBNull.Value);
        command.Parameters.AddWithValue((object?)faceitElo ?? DBNull.Value);
        command.Parameters.AddWithValue((object?)faceitNickname ?? DBNull.Value);
        await command.ExecuteNonQueryAsync(ct);
    }
}
