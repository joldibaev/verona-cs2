namespace Verona.Admin.Features.Plugin;

public static class PluginEndpoints
{
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
    }
}
