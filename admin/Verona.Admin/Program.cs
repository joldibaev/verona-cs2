using System.Security.Cryptography;
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
    await using var command = db.CreateCommand("SELECT weapon, paint_kit, wear, seed FROM player_weapon_skins WHERE steam_id=$1 ORDER BY weapon");
    command.Parameters.AddWithValue(decimal.Parse(steamId));
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync()) skins.Add(new(reader.GetString(0), reader.GetInt32(1), reader.GetFloat(2), reader.GetInt32(3)));
    return Results.Ok(skins);
});
app.MapPut("/api/players/{steamId}/skins/{weapon}", async (string steamId, string weapon, SkinInput input, NpgsqlDataSource db) =>
{
    if (input.PaintKit <= 0 || input.Wear is < 0 or > 1 || input.Seed is < 0 or > 1000 || !weapon.StartsWith("weapon_")) return Results.BadRequest();
    if (IsKnifeWeapon(weapon))
    {
        // A player owns one knife slot. Remove another selected model before the
        // upsert so the game plugin never has to guess between multiple knives.
        await using var clearKnives = db.CreateCommand("DELETE FROM player_weapon_skins WHERE steam_id=$1 AND weapon<>$2 AND (weapon LIKE 'weapon_knife_%' OR weapon='weapon_bayonet')");
        clearKnives.Parameters.AddWithValue(decimal.Parse(steamId)); clearKnives.Parameters.AddWithValue(weapon);
        await clearKnives.ExecuteNonQueryAsync();
    }
    await using var command = db.CreateCommand("""
        INSERT INTO player_weapon_skins(steam_id, weapon, paint_kit, wear, seed) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (steam_id,weapon) DO UPDATE SET paint_kit=EXCLUDED.paint_kit, wear=EXCLUDED.wear, seed=EXCLUDED.seed, updated_at=now()
        """);
    command.Parameters.AddWithValue(decimal.Parse(steamId)); command.Parameters.AddWithValue(weapon);
    command.Parameters.AddWithValue(input.PaintKit); command.Parameters.AddWithValue(input.Wear); command.Parameters.AddWithValue(input.Seed);
    await command.ExecuteNonQueryAsync();
    await Database.Enqueue(db, new CommandInput("refresh_skins", steamId));
    return Results.NoContent();
});
app.MapDelete("/api/players/{steamId}/skins/{weapon}", async (string steamId, string weapon, NpgsqlDataSource db) =>
{
    await using var command = db.CreateCommand("DELETE FROM player_weapon_skins WHERE steam_id=$1 AND weapon=$2");
    command.Parameters.AddWithValue(decimal.Parse(steamId)); command.Parameters.AddWithValue(weapon);
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
            if (skin.PaintKit <= 0 || skin.Wear is < 0 or > 1 || skin.Seed is < 0 or > 1000 || !skin.Weapon.StartsWith("weapon_")) continue;
            await using var itemCmd = connection.CreateCommand();
            itemCmd.CommandText = "INSERT INTO skin_collection_items(collection_id,weapon,paint_kit,wear,seed) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING";
            itemCmd.Transaction = tx;
            itemCmd.Parameters.AddWithValue(id);
            itemCmd.Parameters.AddWithValue(skin.Weapon);
            itemCmd.Parameters.AddWithValue(skin.PaintKit);
            itemCmd.Parameters.AddWithValue(skin.Wear);
            itemCmd.Parameters.AddWithValue(skin.Seed);
            await itemCmd.ExecuteNonQueryAsync();
        }
    }
    else
    {
        await using var copy = connection.CreateCommand();
        copy.CommandText = "INSERT INTO skin_collection_items(collection_id,weapon,paint_kit,wear,seed) SELECT $1,weapon,paint_kit,wear,seed FROM player_weapon_skins WHERE steam_id=$2";
        copy.Transaction = tx;
        copy.Parameters.AddWithValue(id);
        copy.Parameters.AddWithValue(decimal.Parse(identity.SteamId));
        await copy.ExecuteNonQueryAsync();
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
    await using var command = db.CreateCommand("SELECT weapon, paint_kit, wear, seed FROM skin_collection_items WHERE collection_id=$1 ORDER BY weapon");
    command.Parameters.AddWithValue(id);
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync()) skins.Add(new { weapon = reader.GetString(0), paintKit = reader.GetInt32(1), wear = reader.GetFloat(2), seed = reader.GetInt32(3) });
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
    await using(var copy=connection.CreateCommand()){copy.CommandText="INSERT INTO player_weapon_skins(steam_id,weapon,paint_kit,wear,seed) SELECT $1,weapon,paint_kit,wear,seed FROM skin_collection_items WHERE collection_id=$2";copy.Transaction=tx;copy.Parameters.AddWithValue(decimal.Parse(identity.SteamId));copy.Parameters.AddWithValue(id);await copy.ExecuteNonQueryAsync();}
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
                copy.CommandText = "INSERT INTO player_weapon_skins(steam_id,weapon,paint_kit,wear,seed) SELECT $1,weapon,paint_kit,wear,seed FROM skin_collection_items WHERE collection_id=$2";
                copy.Transaction = tx;
                copy.Parameters.AddWithValue(decimal.Parse(identity.SteamId));
                copy.Parameters.AddWithValue(nextId.Value);
                await copy.ExecuteNonQueryAsync();
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
    await using var command = db.CreateCommand("SELECT weapon, paint_kit, wear, seed FROM player_weapon_skins WHERE steam_id=$1 ORDER BY weapon");
    command.Parameters.AddWithValue(decimal.Parse(steamId));
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync()) skins.Add(new(reader.GetString(0), reader.GetInt32(1), reader.GetFloat(2), reader.GetInt32(3)));
    return Results.Ok(skins);
});
app.MapPut("/api/me/skins/{weapon}", async (HttpContext context, string weapon, SkinInput input, NpgsqlDataSource db) =>
{
    if (context.Items["identity"] is not RequestIdentity { SteamId: { } steamId }) return Results.BadRequest();
    if (input.PaintKit <= 0 || input.Wear is < 0 or > 1 || input.Seed is < 0 or > 1000 || !weapon.StartsWith("weapon_")) return Results.BadRequest();
    if (IsKnifeWeapon(weapon))
    {
        await using var clearKnives = db.CreateCommand("DELETE FROM player_weapon_skins WHERE steam_id=$1 AND weapon<>$2 AND (weapon LIKE 'weapon_knife_%' OR weapon='weapon_bayonet')");
        clearKnives.Parameters.AddWithValue(decimal.Parse(steamId)); clearKnives.Parameters.AddWithValue(weapon);
        await clearKnives.ExecuteNonQueryAsync();
        await using var clearCollectionKnives = db.CreateCommand("DELETE FROM skin_collection_items WHERE weapon<>$2 AND (weapon LIKE 'weapon_knife_%' OR weapon='weapon_bayonet') AND collection_id IN(SELECT id FROM skin_collections WHERE steam_id=$1 AND active)");
        clearCollectionKnives.Parameters.AddWithValue(decimal.Parse(steamId)); clearCollectionKnives.Parameters.AddWithValue(weapon);
        await clearCollectionKnives.ExecuteNonQueryAsync();
    }
    await using var command = db.CreateCommand("""
        INSERT INTO player_weapon_skins(steam_id, weapon, paint_kit, wear, seed) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (steam_id,weapon) DO UPDATE SET paint_kit=EXCLUDED.paint_kit, wear=EXCLUDED.wear, seed=EXCLUDED.seed, updated_at=now()
        """);
    command.Parameters.AddWithValue(decimal.Parse(steamId)); command.Parameters.AddWithValue(weapon);
    command.Parameters.AddWithValue(input.PaintKit); command.Parameters.AddWithValue(input.Wear); command.Parameters.AddWithValue(input.Seed);
    await command.ExecuteNonQueryAsync();
    await using var collection=db.CreateCommand("""
        INSERT INTO skin_collection_items(collection_id,weapon,paint_kit,wear,seed)
        SELECT id,$2,$3,$4,$5 FROM skin_collections WHERE steam_id=$1 AND active
        ON CONFLICT(collection_id,weapon) DO UPDATE SET paint_kit=EXCLUDED.paint_kit,wear=EXCLUDED.wear,seed=EXCLUDED.seed
        """);
    collection.Parameters.AddWithValue(decimal.Parse(steamId));collection.Parameters.AddWithValue(weapon);collection.Parameters.AddWithValue(input.PaintKit);collection.Parameters.AddWithValue(input.Wear);collection.Parameters.AddWithValue(input.Seed);await collection.ExecuteNonQueryAsync();
    await Database.Enqueue(db, new CommandInput("refresh_skins", steamId));
    return Results.NoContent();
});
app.MapDelete("/api/me/skins/{weapon}", async (HttpContext context, string weapon, NpgsqlDataSource db) =>
{
    if (context.Items["identity"] is not RequestIdentity { SteamId: { } steamId }) return Results.BadRequest();
    await using var command = db.CreateCommand("DELETE FROM player_weapon_skins WHERE steam_id=$1 AND weapon=$2");
    command.Parameters.AddWithValue(decimal.Parse(steamId)); command.Parameters.AddWithValue(weapon);
    await command.ExecuteNonQueryAsync();
    await using var collection=db.CreateCommand("DELETE FROM skin_collection_items WHERE weapon=$2 AND collection_id IN(SELECT id FROM skin_collections WHERE steam_id=$1 AND active)");
    collection.Parameters.AddWithValue(decimal.Parse(steamId));collection.Parameters.AddWithValue(weapon);await collection.ExecuteNonQueryAsync();
    await Database.Enqueue(db, new CommandInput("refresh_skins", steamId));
    return Results.NoContent();
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
    await using var command = db.CreateCommand("SELECT weapon,paint_kit,wear,seed FROM player_weapon_skins WHERE steam_id=$1");
    command.Parameters.AddWithValue(decimal.Parse(steamId));
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync()) skins.Add(new(reader.GetString(0), reader.GetInt32(1), reader.GetFloat(2), reader.GetInt32(3)));
    return Results.Ok(skins);
});

static bool IsKnifeWeapon(string weapon) =>
    weapon.Equals("weapon_bayonet", StringComparison.OrdinalIgnoreCase)
    || weapon.StartsWith("weapon_knife_", StringComparison.OrdinalIgnoreCase);

app.MapHub<AdminHub>("/hub");
app.UseDefaultFiles();
app.UseStaticFiles();
app.MapFallbackToFile("index.html");
app.Run();
