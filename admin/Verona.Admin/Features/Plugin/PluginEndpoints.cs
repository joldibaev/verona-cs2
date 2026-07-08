namespace Verona.Admin.Features.Plugin;

using System.Text.RegularExpressions;
using Npgsql;

public static class PluginEndpoints
{
    private static readonly Regex SteamId64 = new(@"^\d{17}$", RegexOptions.Compiled);

    public static void MapPluginEndpoints(this WebApplication app)
    {
        app.MapPost("/api/plugin/heartbeat", async (HeartbeatRequest heartbeat,
            PluginHeartbeatService service, CancellationToken ct) =>
        {
            await service.Process(heartbeat, ct);
            return Results.Ok();
        });
        app.MapGet("/api/plugin/commands", async (PluginCommandQueue queue, CancellationToken ct) =>
            Results.Ok(await queue.Claim(ct)));
        app.MapPost("/api/plugin/commands/ack", async (IReadOnlyList<CommandAck> acknowledgements,
            PluginCommandQueue queue, CancellationToken ct) =>
        {
            await queue.Acknowledge(acknowledgements, ct);
            return Results.NoContent();
        });
        app.MapGet("/api/plugin/players/{steamId}/admin", async (string steamId, NpgsqlDataSource db, CancellationToken ct) =>
        {
            if (!SteamId64.IsMatch(steamId)) return Results.BadRequest();
            await using var command = db.CreateCommand("SELECT role='admin' FROM players WHERE steam_id=$1");
            command.Parameters.AddWithValue(decimal.Parse(steamId));
            var isAdmin = await command.ExecuteScalarAsync(ct) as bool?;
            return Results.Ok(new { isAdmin = isAdmin == true });
        });
    }
}
