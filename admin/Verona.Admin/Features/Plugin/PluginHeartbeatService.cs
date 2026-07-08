using Microsoft.AspNetCore.SignalR;
using Npgsql;

namespace Verona.Admin.Features.Plugin;

public sealed class PluginHeartbeatService(
    PlayerRegistry registry,
    NpgsqlDataSource db,
    IHubContext<AdminHub> hub)
{
    public async Task Process(HeartbeatRequest heartbeat, CancellationToken ct)
    {
        registry.Replace(heartbeat);
        foreach (var player in heartbeat.Players)
        {
            await using var command = db.CreateCommand("""
                INSERT INTO players(steam_id,name) VALUES ($1,$2)
                ON CONFLICT (steam_id) DO UPDATE SET name=EXCLUDED.name,last_seen_at=now()
                """);
            command.Parameters.AddWithValue(decimal.Parse(player.SteamId));
            command.Parameters.AddWithValue(player.Name);
            await command.ExecuteNonQueryAsync(ct);

            await using var banCheck = db.CreateCommand("""
                SELECT reason, CASE WHEN expires_at IS NULL THEN NULL
                    ELSE GREATEST(1, CEIL(EXTRACT(EPOCH FROM (expires_at-now()))/60))::int END
                FROM bans WHERE steam_id=$1 AND revoked_at IS NULL
                    AND (expires_at IS NULL OR expires_at>now())
                """);
            banCheck.Parameters.AddWithValue(decimal.Parse(player.SteamId));
            await using var banReader = await banCheck.ExecuteReaderAsync(ct);
            if (!await banReader.ReadAsync(ct)) continue;
            var reason = banReader.GetString(0);
            var minutes = banReader.IsDBNull(1) ? null : banReader.GetInt32(1).ToString();
            await banReader.DisposeAsync();
            await Database.Enqueue(db, new CommandInput("ban", player.SteamId, minutes, reason));
        }
        await hub.Clients.All.SendAsync("serverChanged", cancellationToken: ct);
    }
}
