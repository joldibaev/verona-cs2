using Microsoft.EntityFrameworkCore;
using Npgsql;
using Verona.Admin.Persistence;

namespace Verona.Admin.Features.Players;

public static class PlayerEndpoints
{
    public static void MapPlayerEndpoints(this WebApplication app)
    {
        app.MapGet("/api/players", async (PlayerRegistry registry, NpgsqlDataSource db) =>
        {
            var online = registry.GetPlayers().Select(x => x.SteamId).ToHashSet(StringComparer.Ordinal);
            var players = new List<object>();
            await using var command = db.CreateCommand("""
                SELECT p.steam_id::text,p.name,p.role,p.avatar_url,p.profile_url,p.faceit_elo,
                       p.first_seen_at,p.last_seen_at,
                       b.reason,b.expires_at,p.faceit_nickname
                FROM players p
                LEFT JOIN bans b ON b.steam_id=p.steam_id AND b.revoked_at IS NULL
                    AND (b.expires_at IS NULL OR b.expires_at>now())
                ORDER BY p.last_seen_at DESC
                """);
            await using var reader = await command.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                var steamId = reader.GetString(0);
                players.Add(new {
                    steamId, name = reader.GetString(1), role = reader.GetString(2),
                    avatarUrl = reader.IsDBNull(3) ? null : reader.GetString(3),
                    profileUrl = reader.IsDBNull(4) ? null : reader.GetString(4),
                    faceitElo = reader.IsDBNull(5) ? (int?)null : reader.GetInt32(5),
                    firstSeenAt = reader.GetFieldValue<DateTimeOffset>(6), lastSeenAt = reader.GetFieldValue<DateTimeOffset>(7),
                    online = online.Contains(steamId), banned = !reader.IsDBNull(8),
                    banReason = reader.IsDBNull(8) ? null : reader.GetString(8),
                    banExpiresAt = reader.IsDBNull(9) ? (DateTimeOffset?)null : reader.GetFieldValue<DateTimeOffset>(9),
                    faceitNickname = reader.IsDBNull(10) ? null : reader.GetString(10)
                });
            }
            return Results.Ok(players);
        });
        app.MapPost("/api/players/{steamId}/kick", async (string steamId, CommandInput input, NpgsqlDataSource db) =>
        {
            await Database.Enqueue(db, input with { Type = "kick", SteamId = steamId });
            return Results.Accepted();
        });
        app.MapPost("/api/players/{steamId}/ban", async (string steamId, BanInput input, NpgsqlDataSource db,
            IDbContextFactory<VeronaDbContext> contexts) =>
        {
            var expires = input.DurationMinutes is > 0 ? DateTimeOffset.UtcNow.AddMinutes(input.DurationMinutes.Value) : (DateTimeOffset?)null;
            await using (var context = await contexts.CreateDbContextAsync())
            {
                var id = decimal.Parse(steamId);
                var ban = await context.Bans.FindAsync(id);
                if (ban is null)
                {
                    ban = new BanEntity { SteamId = id };
                    context.Bans.Add(ban);
                }
                ban.Reason = input.Reason ?? "";
                ban.ExpiresAt = expires;
                ban.CreatedAt = DateTimeOffset.UtcNow;
                ban.RevokedAt = null;
                await context.SaveChangesAsync();
            }
            await Database.Enqueue(db, new CommandInput("ban", steamId, input.DurationMinutes?.ToString(), input.Reason));
            return Results.Accepted();
        });
        app.MapDelete("/api/players/{steamId}/ban", async (string steamId, IDbContextFactory<VeronaDbContext> contexts) =>
        {
            await using var context = await contexts.CreateDbContextAsync();
            var ban = await context.Bans.FindAsync(decimal.Parse(steamId));
            if (ban is not null && ban.RevokedAt is null)
            {
                ban.RevokedAt = DateTimeOffset.UtcNow;
                await context.SaveChangesAsync();
            }
            return Results.NoContent();
        });
        app.MapPut("/api/players/{steamId}/role", async (string steamId, RoleInput input, NpgsqlDataSource db) =>
        {
            if (input.Role is not ("player" or "admin")) return Results.BadRequest();
            if (input.Role == "player")
            {
                await using var guard = db.CreateCommand("SELECT role,(SELECT count(*) FROM players WHERE role='admin') FROM players WHERE steam_id=$1");
                guard.Parameters.AddWithValue(decimal.Parse(steamId));
                await using var reader = await guard.ExecuteReaderAsync();
                if (!await reader.ReadAsync()) return Results.NotFound();
                if (reader.GetString(0) == "admin" && reader.GetInt64(1) <= 1)
                    return Results.Conflict(new { error = "Нельзя снять роль у последнего администратора" });
            }
            await using var command = db.CreateCommand("UPDATE players SET role=$1 WHERE steam_id=$2");
            command.Parameters.AddWithValue(input.Role); command.Parameters.AddWithValue(decimal.Parse(steamId));
            return await command.ExecuteNonQueryAsync() == 0 ? Results.NotFound() : Results.NoContent();
        });
        
    }
}
