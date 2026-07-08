namespace Verona.Admin.Features.ServerLifecycle;

using System.Globalization;
using System.Text.RegularExpressions;
using Npgsql;

public static class ServerLifecycleEndpoints
{
    private const string LaunchFile = "/config/launch.env";
    private const string DefaultHostname = "Verona CS2";
    private static readonly Regex ConsoleCommandRegex = new(@"^[A-Za-z][A-Za-z0-9_]*(?:\s+[^\r\n;]{1,180})?$", RegexOptions.Compiled);
    private static readonly HashSet<string> BlockedConsoleCommands = ["quit", "exit", "_restart", "rcon_password", "sv_password"];
    private static readonly HashSet<(int Type, int Mode)> AllowedModes = [(0, 0), (0, 1), (0, 2), (1, 2)];
    private static readonly HashSet<string> AllowedPresets = ["competitive", "wingman", "duel", "grenades", "custom"];

    public static void MapServerLifecycleEndpoints(this WebApplication app)
    {
        app.MapGet("/api/server/status", GetStatus);
        app.MapGet("/api/server/launch", GetLaunch);
        app.MapGet("/api/server/runtime", GetRuntime);
        app.MapPost("/api/server/start", Start);
        app.MapPost("/api/server/stop", Stop);
        app.MapPost("/api/server/restart", Restart);
        app.MapPost("/api/server/delete", Delete);
        app.MapPost("/api/server/console", Console);
    }

    private static async Task<IResult> Console(ConsoleCommandInput input, NpgsqlDataSource db)
    {
        var command = input.Command.Trim();
        if (!IsSafeConsoleCommand(command)) return Results.BadRequest();
        await Database.Enqueue(db, new CommandInput("console", Value: command));
        return Results.Accepted();
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
        var install = phase switch
        {
            "ready" => new InstallState("Сервер готов", 100, false, null, null, null),
            "stopped" => new InstallState("Сервер остановлен", 0, false, null, null, null),
            _ => Analyze(logs),
        };
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
        return Results.Ok(new { phase, step = install.Step, progress = install.Progress,
            downloading = install.Downloading, downloadPercent = install.DownloadPercent,
            downloadedBytes = install.DownloadedBytes, totalBytes = install.TotalBytes,
            checks, logs, checkedAt = DateTimeOffset.UtcNow });
    }

    // SteamCMD reports install progress as "progress: 42.11 (31359369216 / 74473259008)".
    // The first two capture groups are the percentage and bytes transferred/total.
    private static readonly Regex ProgressRegex = new(
        @"progress:\s*([0-9]+(?:\.[0-9]+)?)\s*\((\d+)\s*/\s*(\d+)\)",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private readonly record struct InstallState(
        string Step, int Progress, bool Downloading,
        double? DownloadPercent, long? DownloadedBytes, long? TotalBytes);

    // Derives a human phase and 0-100 progress from the container's log tail so the
    // panel can show the long first-time CS2 download (~70 GB) rather than a static badge.
    private static InstallState Analyze(IReadOnlyList<string> logs)
    {
        var recent = logs.Count > 140 ? logs.Skip(logs.Count - 140).ToArray() : logs.ToArray();

        // Prefer the most recent real SteamCMD progress line: it carries an exact percentage.
        for (var i = recent.Length - 1; i >= 0; i--)
        {
            var match = ProgressRegex.Match(recent[i]);
            if (!match.Success) continue;
            var percent = double.Parse(match.Groups[1].Value, CultureInfo.InvariantCulture);
            var done = long.Parse(match.Groups[2].Value, CultureInfo.InvariantCulture);
            var total = long.Parse(match.Groups[3].Value, CultureInfo.InvariantCulture);
            if (total <= 0) break;
            var verifying = recent[i].Contains("verif", StringComparison.OrdinalIgnoreCase)
                || recent[i].Contains("validat", StringComparison.OrdinalIgnoreCase);
            var step = verifying ? "Проверка игровых файлов" : "Скачивание игровых данных CS2";
            // The Steam install dominates a cold start, so it spans most of the bar (8-60%).
            var overall = (int)Math.Clamp(8 + percent * 0.52, 8, 60);
            return new(step, overall, !verifying, Math.Round(percent, 1), done, total);
        }

        var text = string.Join('\n', recent);
        if (text.Contains("Verona", StringComparison.OrdinalIgnoreCase))
            return new("Загрузка плагина Verona", 90, false, null, null, null);
        if (text.Contains("CounterStrikeSharp", StringComparison.OrdinalIgnoreCase))
            return new("Установка CounterStrikeSharp", 78, false, null, null, null);
        if (text.Contains("Metamod", StringComparison.OrdinalIgnoreCase))
            return new("Установка Metamod:Source", 66, false, null, null, null);
        if (text.Contains("Starting CS2", StringComparison.OrdinalIgnoreCase))
            return new("Запуск игрового процесса", 94, false, null, null, null);
        if (text.Contains("SteamCMD", StringComparison.OrdinalIgnoreCase)
            || text.Contains("app_update", StringComparison.OrdinalIgnoreCase)
            || text.Contains("Installing/updating", StringComparison.OrdinalIgnoreCase))
            return new("Проверка файлов через SteamCMD", 6, false, null, null, null);
        return new("Подготовка контейнера", 4, false, null, null, null);
    }

    private static async Task<IResult> GetStatus(DockerControl docker, PlayerRegistry registry, CancellationToken ct)
    {
        // A server "exists" only once the panel has written a real launch selection
        // (START_MAP is present). A bare RUN_GAME idle file does not count, so the
        // dashboard shows an empty state instead of a phantom card on a cold start.
        var values = ReadValues();
        var configured = values.ContainsKey("START_MAP");
        var container = await docker.GetStatus(ct);
        var running = container.Running && values.GetValueOrDefault("RUN_GAME") == "1";
        container = container with { Running = running, Status = running ? container.Status : "stopped" };
        var ready = running && registry.LastHeartbeat > DateTimeOffset.UtcNow.AddSeconds(-10);
        var phase = !configured ? "empty" : !running ? "stopped" : ready ? "ready" : "starting";

        object? install = null;
        if (phase == "starting")
        {
            var startedAt = DateTimeOffset.TryParse(container.StartedAt, out var parsed) ? parsed : (DateTimeOffset?)null;
            var state = Analyze(await docker.GetLogs(200, startedAt, ct));
            install = new { step = state.Step, progress = state.Progress, downloading = state.Downloading,
                downloadPercent = state.DownloadPercent, downloadedBytes = state.DownloadedBytes, totalBytes = state.TotalBytes };
        }

        return Results.Ok(new { container, configured, phase, ready,
            registry.CurrentMap, registry.LastHeartbeat, online = registry.GetPlayers().Count, install });
    }

    private static IResult GetLaunch()
    {
        var values = ReadValues();
        int Number(string key, int fallback) => int.TryParse(values.GetValueOrDefault(key), out var n) ? n : fallback;
        bool Flag(string key, bool fallback = false) => values.TryGetValue(key, out var value) ? value == "1" : fallback;
        return Results.Ok(new { map = values.GetValueOrDefault("START_MAP", "de_dust2"),
            workshopMapId = values.GetValueOrDefault("WORKSHOP_MAP_ID", ""), gameType = Number("GAME_TYPE", 0),
            gameMode = Number("GAME_MODE", 0), maxPlayers = Number("MAX_PLAYERS", 32), insecure = Flag("VAC_INSECURE", true),
            botsEnabled = Flag("BOTS_ENABLED"), botQuota = Number("BOT_QUOTA", 0),
            botDifficulty = Number("BOT_DIFFICULTY", 1), practice = Flag("PRACTICE"),
            infiniteAmmo = Flag("INFINITE_AMMO"), friendlyFire = Flag("FRIENDLY_FIRE"),
            serverHostname = values.GetValueOrDefault("SERVER_HOSTNAME", DefaultHostname),
            passwordProtected = !string.IsNullOrEmpty(values.GetValueOrDefault("SERVER_PASSWORD")),
            steamcmdValidate = Flag("STEAMCMD_VALIDATE"),
            hibernateWhenEmpty = Flag("HIBERNATE_WHEN_EMPTY"),
            matchPreset = values.GetValueOrDefault("MATCH_PRESET", "competitive"),
            customCheats = Flag("CUSTOM_CHEATS"),
            customRoundTime = Number("CUSTOM_ROUNDTIME", 2),
            customFreezeTime = Number("CUSTOM_FREEZETIME", 10),
            customWarmupTime = Number("CUSTOM_WARMUPTIME", 0),
            customBuyTime = Number("CUSTOM_BUYTIME", 90),
            customStartMoney = Number("CUSTOM_STARTMONEY", 800),
            customMaxMoney = Number("CUSTOM_MAXMONEY", 16000),
            customBuyAnywhere = Flag("CUSTOM_BUY_ANYWHERE"),
            customAutoBalance = Flag("CUSTOM_AUTOBALANCE"),
            customLimitTeams = Number("CUSTOM_LIMITTEAMS", 0),
            customAllTalk = Flag("CUSTOM_ALLTALK"),
            customRespawn = Flag("CUSTOM_RESPAWN"),
            customDeathDropGun = Flag("CUSTOM_DEATH_DROP_GUN", true),
            customShowImpacts = Flag("CUSTOM_SHOW_IMPACTS"),
            customGrenadeTrajectory = Flag("CUSTOM_GRENADE_TRAJECTORY"),
            customGrenadeLimit = Number("CUSTOM_GRENADE_LIMIT", 4) });
    }

    private static async Task<IResult> Start(StartInput input, DockerControl docker, PlayerRegistry registry, CancellationToken ct)
    {
        var current = ReadValues();
        var workshopInput = input.WorkshopMapId?.Trim() ?? "";
        var workshop = NormalizeWorkshopId(workshopInput);
        var hostname = string.IsNullOrWhiteSpace(input.ServerHostname) ? DefaultHostname : input.ServerHostname.Trim();
        var serverPassword = input.ServerPassword is null ? current.GetValueOrDefault("SERVER_PASSWORD", "") : input.ServerPassword.Trim();
        var preset = string.IsNullOrWhiteSpace(input.MatchPreset) ? "competitive" : input.MatchPreset.Trim().ToLowerInvariant();
        var mapValid = workshopInput.Length > 0 ? workshop is not null
            : System.Text.RegularExpressions.Regex.IsMatch(input.Map ?? "", "^[a-z0-9_]{1,64}$");
        if (!mapValid || !AllowedModes.Contains((input.GameType, input.GameMode))
            || !AllowedPresets.Contains(preset)
            || input.CustomRoundTime is < 1 or > 60
            || input.CustomFreezeTime is < 0 or > 30
            || input.CustomWarmupTime is < 0 or > 600
            || input.CustomBuyTime is < 0 or > 9999
            || input.CustomStartMoney is < 0 or > 60000
            || input.CustomMaxMoney is < 800 or > 60000
            || input.CustomStartMoney > input.CustomMaxMoney
            || input.CustomLimitTeams is < 0 or > 20
            || input.CustomGrenadeLimit is < 0 or > 10
            || !IsCfgValue(hostname, 80) || !IsCfgValue(serverPassword, 64))
            return Results.BadRequest();
        await File.WriteAllTextAsync(LaunchFile, $"""
            START_MAP={input.Map}
            WORKSHOP_MAP_ID={workshop ?? ""}
            GAME_TYPE={input.GameType}
            GAME_MODE={input.GameMode}
            MAX_PLAYERS=32
            SERVER_HOSTNAME={hostname}
            SERVER_PASSWORD={serverPassword}
            MATCH_PRESET={preset}
            STEAMCMD_VALIDATE={(input.SteamcmdValidate ? 1 : 0)}
            HIBERNATE_WHEN_EMPTY={(input.HibernateWhenEmpty ? 1 : 0)}
            VAC_INSECURE={(input.Insecure ? 1 : 0)}
            BOTS_ENABLED=0
            BOT_QUOTA=0
            BOT_DIFFICULTY=1
            PRACTICE={(input.Practice ? 1 : 0)}
            INFINITE_AMMO={(input.InfiniteAmmo ? 1 : 0)}
            FRIENDLY_FIRE={(input.FriendlyFire ? 1 : 0)}
            CUSTOM_CHEATS={(input.CustomCheats ? 1 : 0)}
            CUSTOM_ROUNDTIME={input.CustomRoundTime}
            CUSTOM_FREEZETIME={input.CustomFreezeTime}
            CUSTOM_WARMUPTIME={input.CustomWarmupTime}
            CUSTOM_BUYTIME={input.CustomBuyTime}
            CUSTOM_STARTMONEY={input.CustomStartMoney}
            CUSTOM_MAXMONEY={input.CustomMaxMoney}
            CUSTOM_BUY_ANYWHERE={(input.CustomBuyAnywhere ? 1 : 0)}
            CUSTOM_AUTOBALANCE={(input.CustomAutoBalance ? 1 : 0)}
            CUSTOM_LIMITTEAMS={input.CustomLimitTeams}
            CUSTOM_ALLTALK={(input.CustomAllTalk ? 1 : 0)}
            CUSTOM_RESPAWN={(input.CustomRespawn ? 1 : 0)}
            CUSTOM_DEATH_DROP_GUN={(input.CustomDeathDropGun ? 1 : 0)}
            CUSTOM_SHOW_IMPACTS={(input.CustomShowImpacts ? 1 : 0)}
            CUSTOM_GRENADE_TRAJECTORY={(input.CustomGrenadeTrajectory ? 1 : 0)}
            CUSTOM_GRENADE_LIMIT={input.CustomGrenadeLimit}
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

    private static async Task<IResult> Delete(DockerControl docker, PlayerRegistry registry, CancellationToken ct)
    {
        // Removing a server discards its launch config so the panel returns to the empty
        // state. The named cs2-data volume is intentionally left intact, so re-creating a
        // server later reuses the already-downloaded game files instead of fetching ~70 GB again.
        try
        {
            try { using var _ = await docker.Stop(ct); } catch { /* container may be idle or absent */ }
            if (File.Exists(LaunchFile)) File.Delete(LaunchFile);
            registry.Reset();
            return Results.NoContent();
        }
        catch { return DockerFailure("удалить"); }
    }

    private static Dictionary<string, string> ReadValues()
    {
        var values = new Dictionary<string, string>();
        if (File.Exists(LaunchFile)) foreach (var line in File.ReadAllLines(LaunchFile))
            if (line.Split('=', 2) is [var key, var value]) values[key] = value;
        return values;
    }

    private static bool IsCfgValue(string value, int maxLength)
    {
        if (value.Length > maxLength) return false;
        foreach (var ch in value)
            if (char.IsControl(ch) || ch is '"' or '\\') return false;
        return true;
    }

    private static bool IsSafeConsoleCommand(string command)
    {
        if (command.Length is 0 or > 200 || !ConsoleCommandRegex.IsMatch(command)) return false;
        var verb = command.Split(' ', 2)[0].ToLowerInvariant();
        return !BlockedConsoleCommands.Contains(verb);
    }

    private static string? NormalizeWorkshopId(string? value)
    {
        var text = value?.Trim() ?? "";
        if (text.Length == 0) return null;
        var direct = Regex.Match(text, @"^\d{1,20}$");
        if (direct.Success) return direct.Value;
        var query = Regex.Match(text, @"(?:[?&]id=|/filedetails/\?id=)(\d{1,20})(?:[&#]|$)", RegexOptions.IgnoreCase);
        return query.Success ? query.Groups[1].Value : null;
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
