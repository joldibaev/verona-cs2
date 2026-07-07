using System.Security.Cryptography;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.SignalR;
using Npgsql;
using Verona.Admin;

const string launchFile = "/config/launch.env";

var builder = WebApplication.CreateBuilder(args);
var connectionString = builder.Configuration.GetConnectionString("Postgres")
    ?? throw new InvalidOperationException("ConnectionStrings:Postgres is required.");

builder.Services.AddSingleton(NpgsqlDataSource.Create(connectionString));
builder.Services.AddSingleton<SessionStore>();
builder.Services.AddSingleton<PlayerRegistry>();
builder.Services.AddSingleton<DockerControl>();
builder.Services.AddSingleton<PlayerProfileService>();
builder.Services.AddHttpClient();
builder.Services.AddSignalR();

var app = builder.Build();
var dataSource = app.Services.GetRequiredService<NpgsqlDataSource>();
await Database.Initialize(dataSource);

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

const string sessionCookie = "verona_session";
var pluginKey = app.Configuration["PluginApiKey"] ?? throw new InvalidOperationException("PluginApiKey is required.");
var adminSteamIds = (app.Configuration["AdminSteamIds"] ?? "")
    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToHashSet();
await Database.BootstrapAdmins(dataSource, adminSteamIds);

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

app.Use(async (context, next) =>
{
    var path = context.Request.Path;
    if (path.StartsWithSegments("/api/plugin"))
    {
        var suppliedHash = SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(context.Request.Headers["X-Verona-Key"].ToString()));
        var expectedHash = SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(pluginKey));
        if (!CryptographicOperations.FixedTimeEquals(suppliedHash, expectedHash))
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return;
        }
    }
    else if ((path.StartsWithSegments("/api") && !path.StartsWithSegments("/api/auth")) || path.StartsWithSegments("/hub"))
    {
        var sessions = context.RequestServices.GetRequiredService<SessionStore>();
        var session = sessions.Get(context.Request.Cookies[sessionCookie]);
        var identity = session is null ? null : await Database.GetIdentity(
            context.RequestServices.GetRequiredService<NpgsqlDataSource>(), session.SteamId);
        if (identity is null)
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return;
        }
        // Steam players get self-service endpoints only; the rest of the API is admin.
        if (!identity.IsAdmin && !path.StartsWithSegments("/api/me"))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return;
        }
        context.Items["identity"] = identity;
    }
    await next();
});

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

var cookieOptions = new CookieOptions
{
    // Secure=false is acceptable only while Compose binds this plain-HTTP panel to
    // loopback. A public/HTTPS deployment must enable Secure and trusted proxy config.
    HttpOnly = true, SameSite = SameSiteMode.Strict, Secure = false, MaxAge = TimeSpan.FromHours(12)
};

app.MapPost("/api/auth/logout", (SessionStore sessions, HttpRequest request, HttpResponse response) =>
{
    sessions.Remove(request.Cookies[sessionCookie]);
    response.Cookies.Delete(sessionCookie);
    return Results.Ok();
});
app.MapGet("/api/auth/me", async (HttpRequest request, SessionStore sessions, NpgsqlDataSource db) =>
{
    var session = sessions.Get(request.Cookies[sessionCookie]);
    var identity = session is null ? null : await Database.GetIdentity(db, session.SteamId);
    return identity is null
        ? Results.Unauthorized()
        : Results.Ok(new { authenticated = true, isAdmin = identity.IsAdmin, steamId = identity.SteamId,
            name = identity.Name, role = identity.Role, avatarUrl = identity.AvatarUrl, faceitElo = identity.FaceitElo, faceitNickname = identity.FaceitNickname });
});

// Steam sign-in uses OpenID 2.0: no API key, Steam just confirms account ownership.
app.MapGet("/api/auth/steam", (HttpRequest request) =>
{
    // Scheme/Host are safe in the direct loopback deployment. Behind a reverse proxy,
    // configure trusted forwarded headers before deriving realm and return_to here.
    var host = $"{request.Scheme}://{request.Host}";
    var query = QueryString.Create(new Dictionary<string, string?>
    {
        ["openid.ns"] = "http://specs.openid.net/auth/2.0",
        ["openid.mode"] = "checkid_setup",
        ["openid.return_to"] = $"{host}/api/auth/steam/return",
        ["openid.realm"] = host,
        ["openid.identity"] = "http://specs.openid.net/auth/2.0/identifier_select",
        ["openid.claimed_id"] = "http://specs.openid.net/auth/2.0/identifier_select"
    });
    return Results.Redirect("https://steamcommunity.com/openid/login" + query);
});
app.MapGet("/api/auth/steam/return", async (HttpRequest request, HttpResponse response, SessionStore sessions,
    NpgsqlDataSource db, IHttpClientFactory httpFactory, PlayerProfileService profiles, CancellationToken ct) =>
{
    // Replay the signed response back to Steam; only Steam can confirm its own signature.
    var form = new Dictionary<string, string>();
    foreach (var (key, value) in request.Query)
        if (key.StartsWith("openid.")) form[key] = value.ToString();
    form["openid.mode"] = "check_authentication";
    var client = httpFactory.CreateClient();
    using var verify = await client.PostAsync("https://steamcommunity.com/openid/login", new FormUrlEncodedContent(form), ct);
    var verdict = await verify.Content.ReadAsStringAsync(ct);
    var claimed = System.Text.RegularExpressions.Regex.Match(
        request.Query["openid.claimed_id"].ToString(), @"^https://steamcommunity\.com/openid/id/(\d{17})$");
    if (!verdict.Contains("is_valid:true") || !claimed.Success) return Results.Unauthorized();
    var steamId = claimed.Groups[1].Value;

    // Profile enrichment happens after Steam proves identity. Failures are tolerated:
    // the service persists a placeholder so authentication itself remains available.
    await profiles.Refresh(steamId, db, ct);
    response.Cookies.Append(sessionCookie, sessions.Create(new SessionIdentity(steamId)), cookieOptions);
    return Results.Redirect("/skinchanger");
});

app.MapGet("/api/server/status", async (DockerControl docker, PlayerRegistry registry, CancellationToken ct) =>
{
    var container = await docker.GetStatus(ct);
    var runGame = false;
    if (File.Exists(launchFile))
    {
        foreach (var line in File.ReadAllLines(launchFile))
        {
            if (line.Split('=', 2) is ["RUN_GAME", var value] && value.Trim() == "1")
            {
                runGame = true;
                break;
            }
        }
    }
    var isRunning = container.Running && runGame;
    container = container with { Running = isRunning, Status = isRunning ? container.Status : "stopped" };
    var ready = isRunning && registry.LastHeartbeat > DateTimeOffset.UtcNow.AddSeconds(-10);
    var phase = !isRunning ? "stopped" : ready ? "ready" : "starting";
    return Results.Ok(new { container, phase, ready, registry.CurrentMap, registry.LastHeartbeat, online = registry.GetPlayers().Count });
});
// Container env cannot change after creation, so launch parameters travel through
// /config/launch.env which the cs2 entrypoint sources on every boot.
var allowedModes = new HashSet<(int Type, int Mode)> { (0, 0), (0, 1), (0, 2), (1, 2) };
app.MapGet("/api/server/launch", () =>
{
    var values = new Dictionary<string, string>();
    if (File.Exists(launchFile))
        foreach (var line in File.ReadAllLines(launchFile))
            if (line.Split('=', 2) is [var key, var value]) values[key] = value;
    int Number(string key, int fallback) => int.TryParse(values.GetValueOrDefault(key), out var n) ? n : fallback;
    bool Flag(string key, bool fallback = false) => values.TryGetValue(key, out var s) ? s == "1" : fallback;
    return Results.Ok(new
    {
        map = values.GetValueOrDefault("START_MAP", "de_dust2"),
        workshopMapId = values.GetValueOrDefault("WORKSHOP_MAP_ID", ""),
        gameType = Number("GAME_TYPE", 0),
        gameMode = Number("GAME_MODE", 0),
        maxPlayers = Number("MAX_PLAYERS", 10),
        insecure = Flag("VAC_INSECURE"),
        botsEnabled = Flag("BOTS_ENABLED", true),
        botQuota = Number("BOT_QUOTA", 5),
        botDifficulty = Number("BOT_DIFFICULTY", 1),
        practice = Flag("PRACTICE"),
        infiniteAmmo = Flag("INFINITE_AMMO"),
        friendlyFire = Flag("FRIENDLY_FIRE")
    });
});
app.MapPost("/api/server/start", async (StartInput input, DockerControl docker, PlayerRegistry registry, CancellationToken ct) =>
{
    var workshop = input.WorkshopMapId?.Trim() ?? "";
    var mapValid = workshop.Length > 0
        ? System.Text.RegularExpressions.Regex.IsMatch(workshop, "^[0-9]{1,20}$")
        : System.Text.RegularExpressions.Regex.IsMatch(input.Map ?? "", "^[a-z0-9_]{1,64}$");
    if (!mapValid || !allowedModes.Contains((input.GameType, input.GameMode))
        || input.MaxPlayers is < 2 or > 32 || input.BotQuota is < 0 or > 12 || input.BotDifficulty is < 0 or > 3)
        return Results.BadRequest();
    // entrypoint loads this file as shell syntax. Every interpolated value must remain
    // a bounded number/boolean or strict token; never add unvalidated free text here.
    await File.WriteAllTextAsync(launchFile, $"""
        START_MAP={input.Map}
        WORKSHOP_MAP_ID={workshop}
        GAME_TYPE={input.GameType}
        GAME_MODE={input.GameMode}
        MAX_PLAYERS={input.MaxPlayers}
        VAC_INSECURE={(input.Insecure ? 1 : 0)}
        BOTS_ENABLED={(input.BotsEnabled ? 1 : 0)}
        BOT_QUOTA={input.BotQuota}
        BOT_DIFFICULTY={input.BotDifficulty}
        PRACTICE={(input.Practice ? 1 : 0)}
        INFINITE_AMMO={(input.InfiniteAmmo ? 1 : 0)}
        FRIENDLY_FIRE={(input.FriendlyFire ? 1 : 0)}
        RUN_GAME=1
        """, ct);
    registry.Reset();
    try
    {
        await docker.Restart(ct);
        return Results.NoContent();
    }
    catch (Exception)
    {
        return Results.Content("Не удалось запустить сервер: контейнер 'verona-server' не найден или Docker недоступен.", contentType: "text/plain", statusCode: 500);
    }
});
app.MapPost("/api/server/stop", async (DockerControl docker, PlayerRegistry registry, CancellationToken ct) =>
{
    try
    {
        if (File.Exists(launchFile))
        {
            var lines = await File.ReadAllLinesAsync(launchFile, ct);
            var updated = lines.Select(line => line.StartsWith("RUN_GAME=") ? "RUN_GAME=0" : line).ToList();
            if (!updated.Any(line => line.StartsWith("RUN_GAME="))) updated.Add("RUN_GAME=0");
            await File.WriteAllLinesAsync(launchFile, updated, ct);
        }
        using var response = await docker.Stop(ct);
        registry.Reset();
        return Results.NoContent();
    }
    catch (Exception)
    {
        return Results.Content("Не удалось остановить сервер: контейнер 'verona-server' не найден или Docker недоступен.", contentType: "text/plain", statusCode: 500);
    }
});
app.MapPost("/api/server/restart", async (DockerControl docker, PlayerRegistry registry, CancellationToken ct) =>
{
    try
    {
        if (File.Exists(launchFile))
        {
            var lines = await File.ReadAllLinesAsync(launchFile, ct);
            var updated = lines.Select(line => line.StartsWith("RUN_GAME=") ? "RUN_GAME=1" : line).ToList();
            if (!updated.Any(line => line.StartsWith("RUN_GAME="))) updated.Add("RUN_GAME=1");
            await File.WriteAllLinesAsync(launchFile, updated, ct);
        }
        registry.Reset();
        await docker.Restart(ct);
        return Results.NoContent();
    }
    catch (Exception)
    {
        return Results.Content("Не удалось перезапустить сервер: контейнер 'verona-server' не найден или Docker недоступен.", contentType: "text/plain", statusCode: 500);
    }
});
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
app.MapPost("/api/players/{steamId}/ban", async (string steamId, BanInput input, NpgsqlDataSource db) =>
{
    var expires = input.DurationMinutes is > 0 ? DateTimeOffset.UtcNow.AddMinutes(input.DurationMinutes.Value) : (DateTimeOffset?)null;
    await using var command = db.CreateCommand("""
        INSERT INTO bans(steam_id, reason, expires_at) VALUES ($1, $2, $3)
        ON CONFLICT (steam_id) DO UPDATE SET reason=EXCLUDED.reason, expires_at=EXCLUDED.expires_at, revoked_at=NULL, created_at=now()
        """);
    command.Parameters.AddWithValue(decimal.Parse(steamId));
    command.Parameters.AddWithValue(input.Reason ?? "");
    command.Parameters.AddWithValue((object?)expires ?? DBNull.Value);
    await command.ExecuteNonQueryAsync();
    await Database.Enqueue(db, new CommandInput("ban", steamId, input.DurationMinutes?.ToString(), input.Reason));
    return Results.Accepted();
});
app.MapDelete("/api/players/{steamId}/ban", async (string steamId, NpgsqlDataSource db) =>
{
    await using var command = db.CreateCommand("UPDATE bans SET revoked_at=now() WHERE steam_id=$1 AND revoked_at IS NULL");
    command.Parameters.AddWithValue(decimal.Parse(steamId));
    await command.ExecuteNonQueryAsync();
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

app.MapGet("/api/players/{steamId}/skins", async (string steamId, NpgsqlDataSource db) =>
{
    var skins = new List<SkinInput>();
    await using var command = db.CreateCommand("SELECT weapon, team, paint_kit, wear, seed, stat_trak, name_tag FROM player_weapon_skins WHERE steam_id=$1 ORDER BY weapon,team");
    command.Parameters.AddWithValue(decimal.Parse(steamId));
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync()) skins.Add(ReadSkin(reader));
    return Results.Ok(skins);
});
app.MapPut("/api/players/{steamId}/skins/{weapon}", async (string steamId, string weapon, SkinInput input, NpgsqlDataSource db) =>
{
    if (!ValidSkin(weapon, input, weaponTeams)) return Results.BadRequest();
    if (input.Team == "both")
    {
        await using var clearOverrides = db.CreateCommand("DELETE FROM player_weapon_skins WHERE steam_id=$1 AND weapon=$2 AND team<>'both'");
        clearOverrides.Parameters.AddWithValue(decimal.Parse(steamId)); clearOverrides.Parameters.AddWithValue(weapon); await clearOverrides.ExecuteNonQueryAsync();
    }
    if (IsKnifeWeapon(weapon))
    {
        // A player owns one knife slot. Remove another selected model before the
        // upsert so the game plugin never has to guess between multiple knives.
        await using var clearKnives = db.CreateCommand("DELETE FROM player_weapon_skins WHERE steam_id=$1 AND (team=$3 OR $3='both') AND weapon<>$2 AND (weapon LIKE 'weapon_knife_%' OR weapon='weapon_bayonet')");
        clearKnives.Parameters.AddWithValue(decimal.Parse(steamId)); clearKnives.Parameters.AddWithValue(weapon); clearKnives.Parameters.AddWithValue(input.Team);
        await clearKnives.ExecuteNonQueryAsync();
    }
    await using var command = db.CreateCommand("""
        INSERT INTO player_weapon_skins(steam_id, weapon, team, paint_kit, wear, seed, stat_trak, name_tag) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (steam_id,weapon,team) DO UPDATE SET paint_kit=EXCLUDED.paint_kit, wear=EXCLUDED.wear, seed=EXCLUDED.seed, stat_trak=EXCLUDED.stat_trak, name_tag=EXCLUDED.name_tag, updated_at=now()
        """);
    command.Parameters.AddWithValue(decimal.Parse(steamId)); command.Parameters.AddWithValue(weapon);
    command.Parameters.AddWithValue(input.Team); command.Parameters.AddWithValue(input.PaintKit); command.Parameters.AddWithValue(input.Wear); command.Parameters.AddWithValue(input.Seed);
    command.Parameters.AddWithValue(input.StatTrak); command.Parameters.AddWithValue(NameTagValue(input.NameTag));
    await command.ExecuteNonQueryAsync();
    await Database.Enqueue(db, new CommandInput("refresh_skins", steamId));
    return Results.NoContent();
});
app.MapDelete("/api/players/{steamId}/skins/{weapon}/{team}", async (string steamId, string weapon, string team, NpgsqlDataSource db) =>
{
    if (!ValidTeamScope(team)) return Results.BadRequest();
    await using var command = db.CreateCommand("DELETE FROM player_weapon_skins WHERE steam_id=$1 AND weapon=$2 AND team=$3");
    command.Parameters.AddWithValue(decimal.Parse(steamId)); command.Parameters.AddWithValue(weapon); command.Parameters.AddWithValue(team);
    await command.ExecuteNonQueryAsync();
    await Database.Enqueue(db, new CommandInput("refresh_skins", steamId));
    return Results.NoContent();
});

// Self-service skinchanger: a Steam player edits only their own loadout.
app.MapGet("/api/me/collections", async (HttpContext context, NpgsqlDataSource db) =>
{
    if (context.Items["identity"] is not RequestIdentity identity) return Results.BadRequest();
    var result = new List<object>();
    await using var command = db.CreateCommand("""
        SELECT c.id,c.name,c.active,count(i.weapon)::int FROM skin_collections c
        LEFT JOIN skin_collection_items i ON i.collection_id=c.id
        WHERE c.steam_id=$1 GROUP BY c.id ORDER BY c.created_at
        """);
    command.Parameters.AddWithValue(decimal.Parse(identity.SteamId));
    await using var reader = await command.ExecuteReaderAsync();
    while(await reader.ReadAsync()) result.Add(new { id=reader.GetInt64(0),name=reader.GetString(1),active=reader.GetBoolean(2),count=reader.GetInt32(3) });
    return Results.Ok(result);
});
app.MapPost("/api/me/collections", async (HttpContext context, CollectionInput input, NpgsqlDataSource db) =>
{
    if (context.Items["identity"] is not RequestIdentity identity || string.IsNullOrWhiteSpace(input.Name) || input.Name.Trim().Length>48) return Results.BadRequest();
    await using var connection = await db.OpenConnectionAsync();
    await using var tx = await connection.BeginTransactionAsync();
    long id;
    await using (var command = connection.CreateCommand())
    {
        command.CommandText = "INSERT INTO skin_collections(steam_id,name,active) VALUES($1,$2,NOT EXISTS(SELECT 1 FROM skin_collections WHERE steam_id=$1)) RETURNING id";
        command.Transaction = tx;
        command.Parameters.AddWithValue(decimal.Parse(identity.SteamId));
        command.Parameters.AddWithValue(input.Name.Trim());
        id = (long)(await command.ExecuteScalarAsync())!;
    }
    if (input.Skins != null && input.Skins.Count > 0)
    {
        foreach (var skin in input.Skins)
        {
            if (!ValidSkin(skin.Weapon, skin, weaponTeams)) continue;
            await using var itemCmd = connection.CreateCommand();
            itemCmd.CommandText = "INSERT INTO skin_collection_items(collection_id,weapon,team,paint_kit,wear,seed,stat_trak,name_tag) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING";
            itemCmd.Transaction = tx;
            itemCmd.Parameters.AddWithValue(id);
            itemCmd.Parameters.AddWithValue(skin.Weapon);
            itemCmd.Parameters.AddWithValue(skin.Team);
            itemCmd.Parameters.AddWithValue(skin.PaintKit);
            itemCmd.Parameters.AddWithValue(skin.Wear);
            itemCmd.Parameters.AddWithValue(skin.Seed);
            itemCmd.Parameters.AddWithValue(skin.StatTrak);
            itemCmd.Parameters.AddWithValue(NameTagValue(skin.NameTag));
            await itemCmd.ExecuteNonQueryAsync();
        }
    }
    else
    {
        await using var copy = connection.CreateCommand();
        copy.CommandText = "INSERT INTO skin_collection_items(collection_id,weapon,team,paint_kit,wear,seed,stat_trak,name_tag) SELECT $1,weapon,team,paint_kit,wear,seed,stat_trak,name_tag FROM player_weapon_skins WHERE steam_id=$2";
        copy.Transaction = tx;
        copy.Parameters.AddWithValue(id);
        copy.Parameters.AddWithValue(decimal.Parse(identity.SteamId));
        await copy.ExecuteNonQueryAsync();
        await using var copyGloves = connection.CreateCommand();
        copyGloves.CommandText = "INSERT INTO skin_collection_gloves(collection_id,team,definition_index,paint_kit,wear,seed) SELECT $1,team,definition_index,paint_kit,wear,seed FROM player_gloves WHERE steam_id=$2";
        copyGloves.Transaction = tx; copyGloves.Parameters.AddWithValue(id); copyGloves.Parameters.AddWithValue(decimal.Parse(identity.SteamId)); await copyGloves.ExecuteNonQueryAsync();
        await using var copyAgents = connection.CreateCommand();
        copyAgents.CommandText = "INSERT INTO skin_collection_agents(collection_id,team,model) SELECT $1,team,model FROM player_agents WHERE steam_id=$2";
        copyAgents.Transaction = tx; copyAgents.Parameters.AddWithValue(id); copyAgents.Parameters.AddWithValue(decimal.Parse(identity.SteamId)); await copyAgents.ExecuteNonQueryAsync();
    }
    await tx.CommitAsync();
    return Results.Ok(new { id });
});
app.MapGet("/api/me/collections/{id:long}/skins", async (HttpContext context, long id, NpgsqlDataSource db) =>
{
    if (context.Items["identity"] is not RequestIdentity identity) return Results.BadRequest();
    await using var check = db.CreateCommand("SELECT count(*) FROM skin_collections WHERE id=$1 AND steam_id=$2");
    check.Parameters.AddWithValue(id);
    check.Parameters.AddWithValue(decimal.Parse(identity.SteamId));
    if (Convert.ToInt32(await check.ExecuteScalarAsync()) == 0) return Results.NotFound();
    var skins = new List<object>();
    await using var command = db.CreateCommand("SELECT weapon, team, paint_kit, wear, seed, stat_trak, name_tag FROM skin_collection_items WHERE collection_id=$1 ORDER BY weapon,team");
    command.Parameters.AddWithValue(id);
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync()) skins.Add(new { weapon = reader.GetString(0), team = reader.GetString(1), paintKit = reader.GetInt32(2), wear = reader.GetFloat(3), seed = reader.GetInt32(4), statTrak = reader.GetBoolean(5), nameTag = reader.IsDBNull(6) ? null : reader.GetString(6) });
    return Results.Ok(skins);
});
app.MapPost("/api/me/collections/{id:long}/activate", async (HttpContext context,long id,NpgsqlDataSource db) =>
{
    if (context.Items["identity"] is not RequestIdentity identity) return Results.BadRequest();
    await using var connection=await db.OpenConnectionAsync();
    await using var tx=await connection.BeginTransactionAsync();
    await using(var own=connection.CreateCommand()){own.CommandText="SELECT count(*) FROM skin_collections WHERE id=$1 AND steam_id=$2";own.Transaction=tx;own.Parameters.AddWithValue(id);own.Parameters.AddWithValue(decimal.Parse(identity.SteamId));if(Convert.ToInt32(await own.ExecuteScalarAsync())==0)return Results.NotFound();}
    // Two statements are intentional: PostgreSQL may evaluate the target row
    // before clearing the old one in a single UPDATE, briefly violating the
    // partial unique index that permits one active collection per player.
    await using(var deactivate=connection.CreateCommand()){deactivate.CommandText="UPDATE skin_collections SET active=false WHERE steam_id=$1 AND active";deactivate.Transaction=tx;deactivate.Parameters.AddWithValue(decimal.Parse(identity.SteamId));await deactivate.ExecuteNonQueryAsync();}
    await using(var activate=connection.CreateCommand()){activate.CommandText="UPDATE skin_collections SET active=true WHERE id=$1 AND steam_id=$2";activate.Transaction=tx;activate.Parameters.AddWithValue(id);activate.Parameters.AddWithValue(decimal.Parse(identity.SteamId));await activate.ExecuteNonQueryAsync();}
    await using(var clear=connection.CreateCommand()){clear.CommandText="DELETE FROM player_weapon_skins WHERE steam_id=$1";clear.Transaction=tx;clear.Parameters.AddWithValue(decimal.Parse(identity.SteamId));await clear.ExecuteNonQueryAsync();}
    await using(var copy=connection.CreateCommand()){copy.CommandText="INSERT INTO player_weapon_skins(steam_id,weapon,team,paint_kit,wear,seed,stat_trak,name_tag) SELECT $1,weapon,team,paint_kit,wear,seed,stat_trak,name_tag FROM skin_collection_items WHERE collection_id=$2";copy.Transaction=tx;copy.Parameters.AddWithValue(decimal.Parse(identity.SteamId));copy.Parameters.AddWithValue(id);await copy.ExecuteNonQueryAsync();}
    await using(var clear=connection.CreateCommand()){clear.CommandText="DELETE FROM player_gloves WHERE steam_id=$1";clear.Transaction=tx;clear.Parameters.AddWithValue(decimal.Parse(identity.SteamId));await clear.ExecuteNonQueryAsync();}
    await using(var clear=connection.CreateCommand()){clear.CommandText="DELETE FROM player_agents WHERE steam_id=$1";clear.Transaction=tx;clear.Parameters.AddWithValue(decimal.Parse(identity.SteamId));await clear.ExecuteNonQueryAsync();}
    await using(var copy=connection.CreateCommand()){copy.CommandText="INSERT INTO player_gloves(steam_id,team,definition_index,paint_kit,wear,seed) SELECT $1,team,definition_index,paint_kit,wear,seed FROM skin_collection_gloves WHERE collection_id=$2";copy.Transaction=tx;copy.Parameters.AddWithValue(decimal.Parse(identity.SteamId));copy.Parameters.AddWithValue(id);await copy.ExecuteNonQueryAsync();}
    await using(var copy=connection.CreateCommand()){copy.CommandText="INSERT INTO player_agents(steam_id,team,model) SELECT $1,team,model FROM skin_collection_agents WHERE collection_id=$2";copy.Transaction=tx;copy.Parameters.AddWithValue(decimal.Parse(identity.SteamId));copy.Parameters.AddWithValue(id);await copy.ExecuteNonQueryAsync();}
    await tx.CommitAsync(); await Database.Enqueue(db,new CommandInput("refresh_skins",identity.SteamId)); return Results.NoContent();
});
app.MapDelete("/api/me/collections/{id:long}", async (HttpContext context, long id, NpgsqlDataSource db) =>
{
    if (context.Items["identity"] is not RequestIdentity identity) return Results.BadRequest();
    await using var connection = await db.OpenConnectionAsync();
    await using var tx = await connection.BeginTransactionAsync();
    bool isActive = false;
    await using (var check = connection.CreateCommand())
    {
        check.CommandText = "SELECT active FROM skin_collections WHERE id=$1 AND steam_id=$2";
        check.Transaction = tx;
        check.Parameters.AddWithValue(id);
        check.Parameters.AddWithValue(decimal.Parse(identity.SteamId));
        var res = await check.ExecuteScalarAsync();
        if (res == null) return Results.NotFound();
        isActive = (bool)res;
    }
    await using (var delete = connection.CreateCommand())
    {
        delete.CommandText = "DELETE FROM skin_collections WHERE id=$1 AND steam_id=$2";
        delete.Transaction = tx;
        delete.Parameters.AddWithValue(id);
        delete.Parameters.AddWithValue(decimal.Parse(identity.SteamId));
        await delete.ExecuteNonQueryAsync();
    }
    if (isActive)
    {
        long? nextId = null;
        await using (var findNext = connection.CreateCommand())
        {
            findNext.CommandText = "SELECT id FROM skin_collections WHERE steam_id=$1 ORDER BY created_at DESC LIMIT 1";
            findNext.Transaction = tx;
            findNext.Parameters.AddWithValue(decimal.Parse(identity.SteamId));
            var nextVal = await findNext.ExecuteScalarAsync();
            if (nextVal != null) nextId = (long)nextVal;
        }
        await using (var clear = connection.CreateCommand())
        {
            clear.CommandText = "DELETE FROM player_weapon_skins WHERE steam_id=$1";
            clear.Transaction = tx;
            clear.Parameters.AddWithValue(decimal.Parse(identity.SteamId));
            await clear.ExecuteNonQueryAsync();
        }
        await using (var clearCosmetics = connection.CreateCommand())
        {
            clearCosmetics.CommandText = "DELETE FROM player_gloves WHERE steam_id=$1";
            clearCosmetics.Transaction = tx; clearCosmetics.Parameters.AddWithValue(decimal.Parse(identity.SteamId)); await clearCosmetics.ExecuteNonQueryAsync();
        }
        await using (var clearAgents = connection.CreateCommand())
        {
            clearAgents.CommandText = "DELETE FROM player_agents WHERE steam_id=$1";
            clearAgents.Transaction = tx; clearAgents.Parameters.AddWithValue(decimal.Parse(identity.SteamId)); await clearAgents.ExecuteNonQueryAsync();
        }
        if (nextId.HasValue)
        {
            await using (var activate = connection.CreateCommand())
            {
                activate.CommandText = "UPDATE skin_collections SET active=true WHERE id=$1";
                activate.Transaction = tx;
                activate.Parameters.AddWithValue(nextId.Value);
                await activate.ExecuteNonQueryAsync();
            }
            await using (var copy = connection.CreateCommand())
            {
                copy.CommandText = "INSERT INTO player_weapon_skins(steam_id,weapon,team,paint_kit,wear,seed,stat_trak,name_tag) SELECT $1,weapon,team,paint_kit,wear,seed,stat_trak,name_tag FROM skin_collection_items WHERE collection_id=$2";
                copy.Transaction = tx;
                copy.Parameters.AddWithValue(decimal.Parse(identity.SteamId));
                copy.Parameters.AddWithValue(nextId.Value);
                await copy.ExecuteNonQueryAsync();
            }
            await using (var copyCosmetics = connection.CreateCommand())
            {
                copyCosmetics.CommandText = "INSERT INTO player_gloves(steam_id,team,definition_index,paint_kit,wear,seed) SELECT $1,team,definition_index,paint_kit,wear,seed FROM skin_collection_gloves WHERE collection_id=$2";
                copyCosmetics.Transaction = tx; copyCosmetics.Parameters.AddWithValue(decimal.Parse(identity.SteamId)); copyCosmetics.Parameters.AddWithValue(nextId.Value); await copyCosmetics.ExecuteNonQueryAsync();
            }
            await using (var copyAgents = connection.CreateCommand())
            {
                copyAgents.CommandText = "INSERT INTO player_agents(steam_id,team,model) SELECT $1,team,model FROM skin_collection_agents WHERE collection_id=$2";
                copyAgents.Transaction = tx; copyAgents.Parameters.AddWithValue(decimal.Parse(identity.SteamId)); copyAgents.Parameters.AddWithValue(nextId.Value); await copyAgents.ExecuteNonQueryAsync();
            }
        }
    }
    await tx.CommitAsync();
    await Database.Enqueue(db, new CommandInput("refresh_skins", identity.SteamId));
    return Results.NoContent();
});
app.MapGet("/api/me/skins", async (HttpContext context, NpgsqlDataSource db) =>
{
    if (context.Items["identity"] is not RequestIdentity { SteamId: { } steamId }) return Results.BadRequest();
    var skins = new List<SkinInput>();
    await using var command = db.CreateCommand("SELECT weapon, team, paint_kit, wear, seed, stat_trak, name_tag FROM player_weapon_skins WHERE steam_id=$1 ORDER BY weapon,team");
    command.Parameters.AddWithValue(decimal.Parse(steamId));
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync()) skins.Add(ReadSkin(reader));
    return Results.Ok(skins);
});
app.MapPut("/api/me/skins/{weapon}", async (HttpContext context, string weapon, SkinInput input, NpgsqlDataSource db) =>
{
    if (context.Items["identity"] is not RequestIdentity { SteamId: { } steamId }) return Results.BadRequest();
    if (!ValidSkin(weapon, input, weaponTeams)) return Results.BadRequest();
    if (input.Team == "both")
    {
        await using var clearOverrides = db.CreateCommand("DELETE FROM player_weapon_skins WHERE steam_id=$1 AND weapon=$2 AND team<>'both'");
        clearOverrides.Parameters.AddWithValue(decimal.Parse(steamId)); clearOverrides.Parameters.AddWithValue(weapon); await clearOverrides.ExecuteNonQueryAsync();
        await using var clearCollectionOverrides = db.CreateCommand("DELETE FROM skin_collection_items WHERE weapon=$2 AND team<>'both' AND collection_id IN(SELECT id FROM skin_collections WHERE steam_id=$1 AND active)");
        clearCollectionOverrides.Parameters.AddWithValue(decimal.Parse(steamId)); clearCollectionOverrides.Parameters.AddWithValue(weapon); await clearCollectionOverrides.ExecuteNonQueryAsync();
    }
    if (IsKnifeWeapon(weapon))
    {
        await using var clearKnives = db.CreateCommand("DELETE FROM player_weapon_skins WHERE steam_id=$1 AND (team=$3 OR $3='both') AND weapon<>$2 AND (weapon LIKE 'weapon_knife_%' OR weapon='weapon_bayonet')");
        clearKnives.Parameters.AddWithValue(decimal.Parse(steamId)); clearKnives.Parameters.AddWithValue(weapon); clearKnives.Parameters.AddWithValue(input.Team);
        await clearKnives.ExecuteNonQueryAsync();
        await using var clearCollectionKnives = db.CreateCommand("DELETE FROM skin_collection_items WHERE (team=$3 OR $3='both') AND weapon<>$2 AND (weapon LIKE 'weapon_knife_%' OR weapon='weapon_bayonet') AND collection_id IN(SELECT id FROM skin_collections WHERE steam_id=$1 AND active)");
        clearCollectionKnives.Parameters.AddWithValue(decimal.Parse(steamId)); clearCollectionKnives.Parameters.AddWithValue(weapon); clearCollectionKnives.Parameters.AddWithValue(input.Team);
        await clearCollectionKnives.ExecuteNonQueryAsync();
    }
    await using var command = db.CreateCommand("""
        INSERT INTO player_weapon_skins(steam_id, weapon, team, paint_kit, wear, seed, stat_trak, name_tag) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (steam_id,weapon,team) DO UPDATE SET paint_kit=EXCLUDED.paint_kit, wear=EXCLUDED.wear, seed=EXCLUDED.seed, stat_trak=EXCLUDED.stat_trak, name_tag=EXCLUDED.name_tag, updated_at=now()
        """);
    command.Parameters.AddWithValue(decimal.Parse(steamId)); command.Parameters.AddWithValue(weapon);
    command.Parameters.AddWithValue(input.Team); command.Parameters.AddWithValue(input.PaintKit); command.Parameters.AddWithValue(input.Wear); command.Parameters.AddWithValue(input.Seed);
    command.Parameters.AddWithValue(input.StatTrak); command.Parameters.AddWithValue(NameTagValue(input.NameTag));
    await command.ExecuteNonQueryAsync();
    await using var collection=db.CreateCommand("""
        INSERT INTO skin_collection_items(collection_id,weapon,team,paint_kit,wear,seed,stat_trak,name_tag)
        SELECT id,$2,$3,$4,$5,$6,$7,$8 FROM skin_collections WHERE steam_id=$1 AND active
        ON CONFLICT(collection_id,weapon,team) DO UPDATE SET paint_kit=EXCLUDED.paint_kit,wear=EXCLUDED.wear,seed=EXCLUDED.seed,stat_trak=EXCLUDED.stat_trak,name_tag=EXCLUDED.name_tag
        """);
    collection.Parameters.AddWithValue(decimal.Parse(steamId));collection.Parameters.AddWithValue(weapon);collection.Parameters.AddWithValue(input.Team);collection.Parameters.AddWithValue(input.PaintKit);collection.Parameters.AddWithValue(input.Wear);collection.Parameters.AddWithValue(input.Seed);collection.Parameters.AddWithValue(input.StatTrak);collection.Parameters.AddWithValue(NameTagValue(input.NameTag));await collection.ExecuteNonQueryAsync();
    await Database.Enqueue(db, new CommandInput("refresh_skins", steamId));
    return Results.NoContent();
});
app.MapDelete("/api/me/skins/{weapon}/{team}", async (HttpContext context, string weapon, string team, NpgsqlDataSource db) =>
{
    if (context.Items["identity"] is not RequestIdentity { SteamId: { } steamId } || !ValidTeamScope(team)) return Results.BadRequest();
    await using var command = db.CreateCommand("DELETE FROM player_weapon_skins WHERE steam_id=$1 AND weapon=$2 AND team=$3");
    command.Parameters.AddWithValue(decimal.Parse(steamId)); command.Parameters.AddWithValue(weapon); command.Parameters.AddWithValue(team);
    await command.ExecuteNonQueryAsync();
    await using var collection=db.CreateCommand("DELETE FROM skin_collection_items WHERE weapon=$2 AND team=$3 AND collection_id IN(SELECT id FROM skin_collections WHERE steam_id=$1 AND active)");
    collection.Parameters.AddWithValue(decimal.Parse(steamId));collection.Parameters.AddWithValue(weapon);collection.Parameters.AddWithValue(team);await collection.ExecuteNonQueryAsync();
    await Database.Enqueue(db, new CommandInput("refresh_skins", steamId));
    return Results.NoContent();
});

// Gloves and agents are loadout cosmetics, not weapon entities. They deliberately
// use separate tables and routes while sharing the skinchanger authorization model.
app.MapGet("/api/me/cosmetics", async (HttpContext context, NpgsqlDataSource db) =>
{
    if (context.Items["identity"] is not RequestIdentity identity) return Results.BadRequest();
    return Results.Ok(await ReadLoadout(db, identity.SteamId));
});
app.MapPut("/api/me/gloves/{team}", async (HttpContext context, string team, GloveInput input, NpgsqlDataSource db) =>
{
    if (context.Items["identity"] is not RequestIdentity identity || !ValidGlove(team, input)) return Results.BadRequest();
    await SaveGlove(db, identity.SteamId, team, input);
    await SyncActiveCollectionGlove(db, identity.SteamId, team, input);
    await Database.Enqueue(db, new CommandInput("refresh_skins", identity.SteamId));
    return Results.NoContent();
});
app.MapDelete("/api/me/gloves/{team}", async (HttpContext context, string team, NpgsqlDataSource db) =>
{
    if (context.Items["identity"] is not RequestIdentity identity || !ValidTeam(team)) return Results.BadRequest();
    await DeleteCosmetic(db, "player_gloves", identity.SteamId, team);
    await DeleteActiveCollectionCosmetic(db, "skin_collection_gloves", identity.SteamId, team);
    await Database.Enqueue(db, new CommandInput("refresh_skins", identity.SteamId));
    return Results.NoContent();
});
app.MapPut("/api/me/agents/{team}", async (HttpContext context, string team, AgentInput input, NpgsqlDataSource db) =>
{
    if (context.Items["identity"] is not RequestIdentity identity || !ValidAgent(team, input, agentModels)) return Results.BadRequest();
    await SaveAgent(db, identity.SteamId, team, input.Model);
    await SyncActiveCollectionAgent(db, identity.SteamId, team, input.Model);
    await Database.Enqueue(db, new CommandInput("refresh_skins", identity.SteamId));
    return Results.NoContent();
});
app.MapDelete("/api/me/agents/{team}", async (HttpContext context, string team, NpgsqlDataSource db) =>
{
    if (context.Items["identity"] is not RequestIdentity identity || !ValidTeam(team)) return Results.BadRequest();
    await DeleteCosmetic(db, "player_agents", identity.SteamId, team);
    await DeleteActiveCollectionCosmetic(db, "skin_collection_agents", identity.SteamId, team);
    await Database.Enqueue(db, new CommandInput("refresh_skins", identity.SteamId));
    return Results.NoContent();
});

app.MapGet("/api/players/{steamId}/cosmetics", async (string steamId, NpgsqlDataSource db) =>
    Results.Ok(await ReadLoadout(db, steamId)));
app.MapPut("/api/players/{steamId}/gloves/{team}", async (string steamId, string team, GloveInput input, NpgsqlDataSource db) =>
{
    if (!ValidSteamId(steamId) || !ValidGlove(team, input)) return Results.BadRequest();
    await SaveGlove(db, steamId, team, input); await Database.Enqueue(db, new CommandInput("refresh_skins", steamId)); return Results.NoContent();
});
app.MapDelete("/api/players/{steamId}/gloves/{team}", async (string steamId, string team, NpgsqlDataSource db) =>
{
    if (!ValidSteamId(steamId) || !ValidTeam(team)) return Results.BadRequest();
    await DeleteCosmetic(db, "player_gloves", steamId, team); await Database.Enqueue(db, new CommandInput("refresh_skins", steamId)); return Results.NoContent();
});
app.MapPut("/api/players/{steamId}/agents/{team}", async (string steamId, string team, AgentInput input, NpgsqlDataSource db) =>
{
    if (!ValidSteamId(steamId) || !ValidAgent(team, input, agentModels)) return Results.BadRequest();
    await SaveAgent(db, steamId, team, input.Model); await Database.Enqueue(db, new CommandInput("refresh_skins", steamId)); return Results.NoContent();
});
app.MapDelete("/api/players/{steamId}/agents/{team}", async (string steamId, string team, NpgsqlDataSource db) =>
{
    if (!ValidSteamId(steamId) || !ValidTeam(team)) return Results.BadRequest();
    await DeleteCosmetic(db, "player_agents", steamId, team); await Database.Enqueue(db, new CommandInput("refresh_skins", steamId)); return Results.NoContent();
});

// Every account the server has ever seen, for the admin skinchanger player picker.
app.MapGet("/api/players/known", async (NpgsqlDataSource db) =>
{
    var players = new List<object>();
    await using var command = db.CreateCommand("SELECT steam_id::text,name,last_seen_at,avatar_url,profile_url,faceit_elo,faceit_nickname FROM players ORDER BY last_seen_at DESC LIMIT 500");
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync()) players.Add(new {
        steamId = reader.GetString(0), name = reader.GetString(1), lastSeenAt = reader.GetFieldValue<DateTimeOffset>(2),
        avatarUrl = reader.IsDBNull(3) ? null : reader.GetString(3), profileUrl = reader.IsDBNull(4) ? null : reader.GetString(4),
        faceitElo = reader.IsDBNull(5) ? (int?)null : reader.GetInt32(5),
        faceitNickname = reader.IsDBNull(6) ? null : reader.GetString(6)
    });
    return Results.Ok(players);
});

app.MapPost("/api/plugin/heartbeat", async (HeartbeatRequest heartbeat, PlayerRegistry registry, NpgsqlDataSource db, IHubContext<AdminHub> hub) =>
{
    registry.Replace(heartbeat);
    foreach (var player in heartbeat.Players)
    {
        await using var command = db.CreateCommand("""
            INSERT INTO players(steam_id,name) VALUES ($1,$2)
            ON CONFLICT (steam_id) DO UPDATE SET name=EXCLUDED.name,last_seen_at=now()
            """);
        command.Parameters.AddWithValue(decimal.Parse(player.SteamId)); command.Parameters.AddWithValue(player.Name);
        await command.ExecuteNonQueryAsync();

        await using var banCheck = db.CreateCommand("""
            SELECT reason, CASE WHEN expires_at IS NULL THEN NULL ELSE GREATEST(1, CEIL(EXTRACT(EPOCH FROM (expires_at-now()))/60))::int END
            FROM bans WHERE steam_id=$1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now())
            """);
        banCheck.Parameters.AddWithValue(decimal.Parse(player.SteamId));
        await using var banReader = await banCheck.ExecuteReaderAsync();
        if (await banReader.ReadAsync())
        {
            var reason = banReader.GetString(0);
            var minutes = banReader.IsDBNull(1) ? null : banReader.GetInt32(1).ToString();
            await banReader.DisposeAsync();
            await Database.Enqueue(db, new CommandInput("ban", player.SteamId, minutes, reason));
        }
    }
    await hub.Clients.All.SendAsync("serverChanged");
    return Results.Ok();
});
app.MapGet("/api/plugin/commands", async (NpgsqlDataSource db) =>
{
    var result = new List<ServerCommand>();
    // Claim and return atomically. SKIP LOCKED prevents duplicate claims if polls
    // overlap; delivered_at means the current v1 does not retry after this point.
    await using var command = db.CreateCommand("""
        UPDATE server_commands SET delivered_at=now()
        WHERE id IN (SELECT id FROM server_commands WHERE delivered_at IS NULL ORDER BY id LIMIT 50 FOR UPDATE SKIP LOCKED)
        RETURNING id,type,steam_id::text,value,reason
        """);
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync()) result.Add(new(reader.GetInt64(0), reader.GetString(1), reader.IsDBNull(2) ? null : reader.GetString(2), reader.IsDBNull(3) ? null : reader.GetString(3), reader.IsDBNull(4) ? null : reader.GetString(4)));
    return Results.Ok(result);
});
app.MapGet("/api/plugin/players/{steamId}/skins", async (string steamId, NpgsqlDataSource db) =>
{
    var skins = new List<SkinInput>();
    await using var command = db.CreateCommand("SELECT weapon,team,paint_kit,wear,seed,stat_trak,name_tag FROM player_weapon_skins WHERE steam_id=$1");
    command.Parameters.AddWithValue(decimal.Parse(steamId));
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync()) skins.Add(ReadSkin(reader));
    return Results.Ok(skins);
});
app.MapGet("/api/plugin/players/{steamId}/loadout", async (string steamId, NpgsqlDataSource db) =>
    ValidSteamId(steamId) ? Results.Ok(await ReadLoadout(db, steamId)) : Results.BadRequest());

static bool IsKnifeWeapon(string weapon) =>
    weapon.Equals("weapon_bayonet", StringComparison.OrdinalIgnoreCase)
    || weapon.StartsWith("weapon_knife_", StringComparison.OrdinalIgnoreCase);

static bool ValidSteamId(string value) => Regex.IsMatch(value, "^[0-9]{17}$");
static bool ValidTeam(string value) => value is "ct" or "t";
static bool ValidTeamScope(string value) => value is "both" or "ct" or "t";
static bool ValidSkin(string weapon, SkinInput value, IReadOnlyDictionary<string, string> weaponTeams)
{
    if (!string.Equals(weapon, value.Weapon, StringComparison.OrdinalIgnoreCase)
        || value.PaintKit <= 0 || !float.IsFinite(value.Wear) || value.Wear is < 0 or > 1
        || value.Seed is < 0 or > 1000 || !ValidTeamScope(value.Team)
        || (value.NameTag is not null && value.NameTag.Length > 20)
        || !weaponTeams.TryGetValue(weapon, out var availableTo)) return false;
    return availableTo == "both" || availableTo == value.Team;
}

// Empty name tags are stored as SQL NULL so the game plugin never applies a blank label.
static object NameTagValue(string? nameTag) =>
    string.IsNullOrWhiteSpace(nameTag) ? DBNull.Value : nameTag.Trim();

// Every full skin row selects weapon,team,paint_kit,wear,seed,stat_trak,name_tag in that order.
static SkinInput ReadSkin(NpgsqlDataReader reader) => new(
    reader.GetString(0), reader.GetString(1), reader.GetInt32(2), reader.GetFloat(3), reader.GetInt32(4),
    reader.GetBoolean(5), reader.IsDBNull(6) ? null : reader.GetString(6));
static bool ValidGlove(string team, GloveInput value) => ValidTeam(team) && value.Team == team
    && value.DefinitionIndex is 4725 or 5027 or 5030 or 5031 or 5032 or 5033 or 5034 or 5035 && value.PaintKit > 0
    && float.IsFinite(value.Wear) && value.Wear is >= 0 and <= 1 && value.Seed is >= 0 and <= 1000;
static bool ValidAgent(string team, AgentInput value, IReadOnlySet<string> allowedModels) =>
    ValidTeam(team) && value.Team == team && allowedModels.Contains(value.Model);

static async Task<PlayerLoadout> ReadLoadout(NpgsqlDataSource db, string steamId)
{
    var skins = new List<SkinInput>(); var gloves = new List<GloveInput>(); var agents = new List<AgentInput>();
    await using (var command = db.CreateCommand("SELECT weapon,team,paint_kit,wear,seed,stat_trak,name_tag FROM player_weapon_skins WHERE steam_id=$1 ORDER BY weapon,team"))
    { command.Parameters.AddWithValue(decimal.Parse(steamId)); await using var reader = await command.ExecuteReaderAsync(); while (await reader.ReadAsync()) skins.Add(ReadSkin(reader)); }
    await using (var command = db.CreateCommand("SELECT team,definition_index,paint_kit,wear,seed FROM player_gloves WHERE steam_id=$1 ORDER BY team"))
    { command.Parameters.AddWithValue(decimal.Parse(steamId)); await using var reader = await command.ExecuteReaderAsync(); while (await reader.ReadAsync()) gloves.Add(new(reader.GetString(0),reader.GetInt32(1),reader.GetInt32(2),reader.GetFloat(3),reader.GetInt32(4))); }
    await using (var command = db.CreateCommand("SELECT team,model FROM player_agents WHERE steam_id=$1 ORDER BY team"))
    { command.Parameters.AddWithValue(decimal.Parse(steamId)); await using var reader = await command.ExecuteReaderAsync(); while (await reader.ReadAsync()) agents.Add(new(reader.GetString(0),reader.GetString(1))); }
    return new(skins, gloves, agents);
}
static async Task SaveGlove(NpgsqlDataSource db, string steamId, string team, GloveInput value)
{
    await using var command = db.CreateCommand("INSERT INTO player_gloves(steam_id,team,definition_index,paint_kit,wear,seed) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(steam_id,team) DO UPDATE SET definition_index=EXCLUDED.definition_index,paint_kit=EXCLUDED.paint_kit,wear=EXCLUDED.wear,seed=EXCLUDED.seed,updated_at=now()");
    command.Parameters.AddWithValue(decimal.Parse(steamId)); command.Parameters.AddWithValue(team); command.Parameters.AddWithValue(value.DefinitionIndex); command.Parameters.AddWithValue(value.PaintKit); command.Parameters.AddWithValue(value.Wear); command.Parameters.AddWithValue(value.Seed); await command.ExecuteNonQueryAsync();
}
static async Task SaveAgent(NpgsqlDataSource db, string steamId, string team, string model)
{
    await using var command = db.CreateCommand("INSERT INTO player_agents(steam_id,team,model) VALUES($1,$2,$3) ON CONFLICT(steam_id,team) DO UPDATE SET model=EXCLUDED.model,updated_at=now()");
    command.Parameters.AddWithValue(decimal.Parse(steamId)); command.Parameters.AddWithValue(team); command.Parameters.AddWithValue(model); await command.ExecuteNonQueryAsync();
}
static async Task DeleteCosmetic(NpgsqlDataSource db, string table, string steamId, string team)
{
    var sql = table == "player_gloves" ? "DELETE FROM player_gloves WHERE steam_id=$1 AND team=$2" : "DELETE FROM player_agents WHERE steam_id=$1 AND team=$2";
    await using var command = db.CreateCommand(sql); command.Parameters.AddWithValue(decimal.Parse(steamId)); command.Parameters.AddWithValue(team); await command.ExecuteNonQueryAsync();
}
static async Task SyncActiveCollectionGlove(NpgsqlDataSource db, string steamId, string team, GloveInput value)
{
    await using var command=db.CreateCommand("INSERT INTO skin_collection_gloves(collection_id,team,definition_index,paint_kit,wear,seed) SELECT id,$2,$3,$4,$5,$6 FROM skin_collections WHERE steam_id=$1 AND active ON CONFLICT(collection_id,team) DO UPDATE SET definition_index=EXCLUDED.definition_index,paint_kit=EXCLUDED.paint_kit,wear=EXCLUDED.wear,seed=EXCLUDED.seed");
    command.Parameters.AddWithValue(decimal.Parse(steamId));command.Parameters.AddWithValue(team);command.Parameters.AddWithValue(value.DefinitionIndex);command.Parameters.AddWithValue(value.PaintKit);command.Parameters.AddWithValue(value.Wear);command.Parameters.AddWithValue(value.Seed);await command.ExecuteNonQueryAsync();
}
static async Task SyncActiveCollectionAgent(NpgsqlDataSource db, string steamId, string team, string model)
{
    await using var command=db.CreateCommand("INSERT INTO skin_collection_agents(collection_id,team,model) SELECT id,$2,$3 FROM skin_collections WHERE steam_id=$1 AND active ON CONFLICT(collection_id,team) DO UPDATE SET model=EXCLUDED.model");
    command.Parameters.AddWithValue(decimal.Parse(steamId));command.Parameters.AddWithValue(team);command.Parameters.AddWithValue(model);await command.ExecuteNonQueryAsync();
}
static async Task DeleteActiveCollectionCosmetic(NpgsqlDataSource db, string table, string steamId, string team)
{
    var sql=table=="skin_collection_gloves" ? "DELETE FROM skin_collection_gloves WHERE team=$2 AND collection_id IN(SELECT id FROM skin_collections WHERE steam_id=$1 AND active)" : "DELETE FROM skin_collection_agents WHERE team=$2 AND collection_id IN(SELECT id FROM skin_collections WHERE steam_id=$1 AND active)";
    await using var command=db.CreateCommand(sql);command.Parameters.AddWithValue(decimal.Parse(steamId));command.Parameters.AddWithValue(team);await command.ExecuteNonQueryAsync();
}

app.MapHub<AdminHub>("/hub");
app.UseDefaultFiles();
app.UseStaticFiles();
app.MapFallbackToFile("index.html");
app.Run();
