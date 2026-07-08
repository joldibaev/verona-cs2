using System.Text.RegularExpressions;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Verona.Admin;
using Verona.Admin.Features.Auth;
using Verona.Admin.Features.Plugin;
using Verona.Admin.Features.Players;
using Verona.Admin.Features.ServerLifecycle;
using Verona.Admin.Features.Skinchanger;
using Verona.Admin.Persistence;

const string launchFile = "/config/launch.env";

var builder = WebApplication.CreateBuilder(args);
var connectionString = builder.Configuration.GetConnectionString("Postgres")
    ?? throw new InvalidOperationException("ConnectionStrings:Postgres is required.");

builder.Services.AddSingleton(NpgsqlDataSource.Create(connectionString));
builder.Services.AddDbContextFactory<VeronaDbContext>(options => options.UseNpgsql(connectionString));
builder.Services.AddSingleton<SessionStore>();
builder.Services.AddSingleton<PlayerRegistry>();
builder.Services.AddSingleton<DockerControl>();
builder.Services.AddSingleton<PlayerProfileService>();
builder.Services.AddSingleton<PluginCommandQueue>();
builder.Services.AddSingleton<PluginHeartbeatService>();
builder.Services.AddHttpClient();
builder.Services.AddSignalR();

var app = builder.Build();
var dataSource = app.Services.GetRequiredService<NpgsqlDataSource>();
var dbContexts = app.Services.GetRequiredService<IDbContextFactory<VeronaDbContext>>();
await using (var migrationContext = await dbContexts.CreateDbContextAsync())
    await migrationContext.Database.MigrateAsync();

// This file is generated from the pinned public catalog during UI development and
// shipped with wwwroot. The browser copy is UX; this server-side set is the engine
// model allow-list and cannot be extended by a crafted request.
var catalogPath = Path.Combine(app.Environment.WebRootPath ?? "wwwroot", "cosmetics-catalog.json");
if (!File.Exists(catalogPath))
    catalogPath = Path.GetFullPath(Path.Combine(app.Environment.ContentRootPath, "..", "ui", "public", "cosmetics-catalog.json"));
using var cosmeticsDocument = System.Text.Json.JsonDocument.Parse(await File.ReadAllTextAsync(catalogPath));
var agentModels = cosmeticsDocument.RootElement.GetProperty("agents").EnumerateArray()
    .Select(x => x.GetProperty("model").GetString()).OfType<string>().ToHashSet(StringComparer.Ordinal);
var skinsCatalogPath = Path.Combine(app.Environment.WebRootPath ?? "wwwroot", "skins-catalog.json");
if (!File.Exists(skinsCatalogPath))
    skinsCatalogPath = Path.GetFullPath(Path.Combine(app.Environment.ContentRootPath, "..", "ui", "public", "skins-catalog.json"));
using var skinsDocument = System.Text.Json.JsonDocument.Parse(await File.ReadAllTextAsync(skinsCatalogPath));
var weaponTeams = skinsDocument.RootElement.GetProperty("weapons").EnumerateArray().ToDictionary(
    x => x.GetProperty("weapon").GetString()!, x => x.GetProperty("team").GetString()!, StringComparer.OrdinalIgnoreCase);
foreach (var fixedTeam in new[] { "t", "ct" })
{
    var weapons = weaponTeams.Where(x => x.Value == fixedTeam).Select(x => x.Key).ToArray();
    var migrationStatements = new[]
    {
        "DELETE FROM player_weapon_skins p WHERE p.team='both' AND p.weapon=ANY($2) AND EXISTS(SELECT 1 FROM player_weapon_skins x WHERE x.steam_id=p.steam_id AND x.weapon=p.weapon AND x.team=$1)",
        "UPDATE player_weapon_skins SET team=$1 WHERE team='both' AND weapon=ANY($2)",
        "DELETE FROM skin_collection_items p WHERE p.team='both' AND p.weapon=ANY($2) AND EXISTS(SELECT 1 FROM skin_collection_items x WHERE x.collection_id=p.collection_id AND x.weapon=p.weapon AND x.team=$1)",
        "UPDATE skin_collection_items SET team=$1 WHERE team='both' AND weapon=ANY($2)"
    };
    foreach (var sql in migrationStatements)
    {
        await using var migrate = dataSource.CreateCommand(sql);
        migrate.Parameters.AddWithValue(fixedTeam); migrate.Parameters.AddWithValue(weapons); await migrate.ExecuteNonQueryAsync();
    }
}

// `both` used to be a persistent fallback row. Materialize it into independent
// CT/T slots so changing one side can never implicitly replace the other.
foreach (var table in new[] { "player_weapon_skins", "skin_collection_items" })
{
    var owner = table == "player_weapon_skins" ? "steam_id" : "collection_id";
    foreach (var team in new[] { "t", "ct" })
    {
        await using var expand = dataSource.CreateCommand($"""
            INSERT INTO {table}({owner},weapon,team,paint_kit,wear,seed,stat_trak,name_tag,keychain_id,keychain_seed,stickers)
            SELECT {owner},weapon,$1,paint_kit,wear,seed,stat_trak,name_tag,keychain_id,keychain_seed,stickers
            FROM {table} WHERE team='both'
            ON CONFLICT ({owner},weapon,team) DO NOTHING
            """);
        expand.Parameters.AddWithValue(team);
        await expand.ExecuteNonQueryAsync();
    }
    await using var removeFallbacks = dataSource.CreateCommand($"DELETE FROM {table} WHERE team='both'");
    await removeFallbacks.ExecuteNonQueryAsync();
}

var pluginKey = app.Configuration["PluginApiKey"] ?? throw new InvalidOperationException("PluginApiKey is required.");
var adminSteamIds = (app.Configuration["AdminSteamIds"] ?? "")
    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToHashSet();
await Database.BootstrapAdmins(dbContexts, adminSteamIds);

// Ensure the game server boots into idle mode on compose stack startup
if (File.Exists(launchFile))
{
    try
    {
        var lines = File.ReadAllLines(launchFile);
        var updated = lines.Select(line => line.StartsWith("RUN_GAME=") ? "RUN_GAME=0" : line).ToList();
        if (!updated.Any(line => line.StartsWith("RUN_GAME="))) updated.Add("RUN_GAME=0");
        File.WriteAllLines(launchFile, updated);
    }
    catch { }
}
else
{
    try { File.WriteAllText(launchFile, "RUN_GAME=0\n"); } catch { }
}

app.UseVeronaAuthorization(pluginKey);

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

app.MapAuthEndpoints();

app.MapServerLifecycleEndpoints();
app.MapPlayerEndpoints();
app.MapPluginEndpoints();
app.MapSkinchangerEndpoints(weaponTeams, agentModels);
app.MapHub<AdminHub>("/hub");
app.UseDefaultFiles();
app.UseStaticFiles();
app.MapFallbackToFile("index.html");
app.Run();
