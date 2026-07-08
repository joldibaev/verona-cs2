namespace Verona.Admin.Features.ServerLifecycle;

using Npgsql;

public static class ServerLifecycleEndpoints
{
    private const string LaunchFile = "/config/launch.env";
    private static readonly HashSet<(int Type, int Mode)> AllowedModes = [(0, 0), (0, 1), (0, 2), (1, 2)];

    public static void MapServerLifecycleEndpoints(this WebApplication app)
    {
        app.MapGet("/api/server/status", GetStatus);
        app.MapGet("/api/server/launch", GetLaunch);
        app.MapGet("/api/server/runtime", GetRuntime);
        app.MapPost("/api/server/start", Start);
        app.MapPost("/api/server/stop", Stop);
        app.MapPost("/api/server/restart", Restart);
    }

    private static async Task<IResult> GetRuntime(
        DockerControl docker, PlayerRegistry registry, NpgsqlDataSource db, IWebHostEnvironment environment, CancellationToken ct)
    {
        var container = await docker.GetStatus(ct);
        var runRequested = ReadValues().GetValueOrDefault("RUN_GAME") == "1";
        var running = container.Running && runRequested;
        var heartbeatFresh = registry.LastHeartbeat > DateTimeOffset.UtcNow.AddSeconds(-10);
        var startedAt = DateTimeOffset.TryParse(container.StartedAt, out var parsedStartedAt) ? parsedStartedAt : (DateTimeOffset?)null;
        var logs = await docker.GetLogs(180, startedAt, ct);
        var databaseReady = true;
        string? databaseError = null;
        try
        {
            await using var command = db.CreateCommand("SELECT 1");
            await command.ExecuteScalarAsync(ct);
        }
        catch (Exception exception) { databaseReady = false; databaseError = exception.Message; }

        bool CatalogExists(string name) => File.Exists(Path.Combine(environment.WebRootPath ?? "wwwroot", name))
            || File.Exists(Path.GetFullPath(Path.Combine(environment.ContentRootPath, "..", "ui", "public", name)));
        var catalogsReady = CatalogExists("skins-catalog.json") && CatalogExists("cosmetics-catalog.json");
        var configReady = File.Exists(LaunchFile);
        var phase = !running ? "stopped" : heartbeatFresh ? "ready" : "starting";
        var (step, progress) = LaunchProgress(phase, logs);
        var checks = new[]
        {
            new { id = "docker", label = "Docker Engine", ready = container.Exists && container.Error is null,
                detail = container.Error ?? container.Status },
            new { id = "database", label = "PostgreSQL", ready = databaseReady,
                detail = databaseError ?? "Подключение установлено" },
            new { id = "config", label = "Конфигурация запуска", ready = configReady,
                detail = configReady ? "launch.env доступен" : "launch.env не найден" },
            new { id = "catalogs", label = "Каталоги косметики", ready = catalogsReady,
                detail = catalogsReady ? "Каталоги загружены" : "Один или несколько каталогов отсутствуют" },
            new { id = "plugin", label = "Плагин Verona", ready = heartbeatFresh,
                detail = heartbeatFresh ? $"Heartbeat {registry.LastHeartbeat:O}" : running ? "Ожидание heartbeat" : "Сервер остановлен" }
        };
        return Results.Ok(new { phase, step, progress, checks, logs, checkedAt = DateTimeOffset.UtcNow });
    }

    private static (string Step, int Progress) LaunchProgress(string phase, IReadOnlyList<string> logs)
    {
        if (phase == "ready") return ("Сервер готов", 100);
        if (phase == "stopped") return ("Сервер остановлен", 0);
        var text = string.Join('\n', logs.TakeLast(80));
        if (text.Contains("Verona", StringComparison.OrdinalIgnoreCase)) return ("Загрузка плагина Verona", 90);
        if (text.Contains("CounterStrikeSharp", StringComparison.OrdinalIgnoreCase)) return ("Загрузка CounterStrikeSharp", 78);
        if (text.Contains("Metamod", StringComparison.OrdinalIgnoreCase)) return ("Загрузка Metamod", 65);
        if (text.Contains("SteamCMD", StringComparison.OrdinalIgnoreCase)
            || text.Contains("update", StringComparison.OrdinalIgnoreCase)) return ("Проверка файлов через SteamCMD", 28);
        if (text.Contains("Starting CS2", StringComparison.OrdinalIgnoreCase)
            || text.Contains("cs2", StringComparison.OrdinalIgnoreCase)) return ("Запуск игрового процесса", 52);
        return ("Подготовка контейнера", 12);
    }

    private static async Task<IResult> GetStatus(DockerControl docker, PlayerRegistry registry, CancellationToken ct)
    {
        var container = await docker.GetStatus(ct);
        var running = container.Running && ReadValues().GetValueOrDefault("RUN_GAME") == "1";
        container = container with { Running = running, Status = running ? container.Status : "stopped" };
        var ready = running && registry.LastHeartbeat > DateTimeOffset.UtcNow.AddSeconds(-10);
        return Results.Ok(new { container, phase = !running ? "stopped" : ready ? "ready" : "starting",
            ready, registry.CurrentMap, registry.LastHeartbeat, online = registry.GetPlayers().Count });
    }

    private static IResult GetLaunch()
    {
        var values = ReadValues();
        int Number(string key, int fallback) => int.TryParse(values.GetValueOrDefault(key), out var n) ? n : fallback;
        bool Flag(string key, bool fallback = false) => values.TryGetValue(key, out var value) ? value == "1" : fallback;
        return Results.Ok(new { map = values.GetValueOrDefault("START_MAP", "de_dust2"),
            workshopMapId = values.GetValueOrDefault("WORKSHOP_MAP_ID", ""), gameType = Number("GAME_TYPE", 0),
            gameMode = Number("GAME_MODE", 0), maxPlayers = Number("MAX_PLAYERS", 10), insecure = Flag("VAC_INSECURE"),
            botsEnabled = Flag("BOTS_ENABLED", true), botQuota = Number("BOT_QUOTA", 5),
            botDifficulty = Number("BOT_DIFFICULTY", 1), practice = Flag("PRACTICE"),
            infiniteAmmo = Flag("INFINITE_AMMO"), friendlyFire = Flag("FRIENDLY_FIRE") });
    }

    private static async Task<IResult> Start(StartInput input, DockerControl docker, PlayerRegistry registry, CancellationToken ct)
    {
        var workshop = input.WorkshopMapId?.Trim() ?? "";
        var mapValid = workshop.Length > 0 ? System.Text.RegularExpressions.Regex.IsMatch(workshop, "^[0-9]{1,20}$")
            : System.Text.RegularExpressions.Regex.IsMatch(input.Map ?? "", "^[a-z0-9_]{1,64}$");
        if (!mapValid || !AllowedModes.Contains((input.GameType, input.GameMode)) || input.MaxPlayers is < 2 or > 32
            || input.BotQuota is < 0 or > 12 || input.BotDifficulty is < 0 or > 3) return Results.BadRequest();
        await File.WriteAllTextAsync(LaunchFile, $"""
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
        try { await docker.Restart(ct); return Results.NoContent(); }
        catch { return DockerFailure("запустить"); }
    }

    private static async Task<IResult> Stop(DockerControl docker, PlayerRegistry registry, CancellationToken ct)
    {
        try { await SetRunGame(false, ct); using var response = await docker.Stop(ct); registry.Reset(); return Results.NoContent(); }
        catch { return DockerFailure("остановить"); }
    }

    private static async Task<IResult> Restart(DockerControl docker, PlayerRegistry registry, CancellationToken ct)
    {
        try { await SetRunGame(true, ct); registry.Reset(); await docker.Restart(ct); return Results.NoContent(); }
        catch { return DockerFailure("перезапустить"); }
    }

    private static Dictionary<string, string> ReadValues()
    {
        var values = new Dictionary<string, string>();
        if (File.Exists(LaunchFile)) foreach (var line in File.ReadAllLines(LaunchFile))
            if (line.Split('=', 2) is [var key, var value]) values[key] = value;
        return values;
    }

    private static async Task SetRunGame(bool enabled, CancellationToken ct)
    {
        var lines = File.Exists(LaunchFile) ? (await File.ReadAllLinesAsync(LaunchFile, ct)).ToList() : [];
        var found = false;
        for (var i = 0; i < lines.Count; i++) if (lines[i].StartsWith("RUN_GAME=")) { lines[i] = $"RUN_GAME={(enabled ? 1 : 0)}"; found = true; }
        if (!found) lines.Add($"RUN_GAME={(enabled ? 1 : 0)}");
        await File.WriteAllLinesAsync(LaunchFile, lines, ct);
    }

    private static IResult DockerFailure(string operation) => Results.Content(
        $"Не удалось {operation} сервер: контейнер 'verona-cs2-server' не найден или Docker недоступен.",
        contentType: "text/plain", statusCode: 500);
}
