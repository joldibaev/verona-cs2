using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Core.Attributes;
using CounterStrikeSharp.API.Core.Attributes.Registration;
using Microsoft.Extensions.Logging;
using Verona.WeaponSkins;
using Verona.Admin;

namespace Verona;

// Keep this aligned with the pinned CounterStrikeSharp package and runtime.
// Failing fast is safer than running entity mutations against an older ABI.
[MinimumApiVersion(370)]
public sealed class VeronaPlugin : BasePlugin
{
    private WeaponSkinsModule? _weaponSkins;
    private AdminApiClient? _adminApi;

    public override string ModuleName => "Verona";
    public override string ModuleVersion => "0.2.0";
    public override string ModuleAuthor => "Verona contributors";
    public override string ModuleDescription => "Modular foundation for a custom CS2 server";

    public override void Load(bool hotReload)
    {
        var configPath = Environment.GetEnvironmentVariable("SKINS_CONFIG_PATH");
        if (string.IsNullOrWhiteSpace(configPath))
        {
            // The fallback keeps local/manual plugin installation useful. Docker uses
            // /config/skins.json so user data remains outside the server volume.
            configPath = Path.Combine(ModuleDirectory, "skins.json");
        }

        _weaponSkins = new WeaponSkinsModule(Logger, configPath);
        _weaponSkins.Reload();
        _adminApi = new AdminApiClient(this, _weaponSkins, Logger);
        _adminApi.Start();
        Logger.LogInformation("Verona loaded (hot reload: {HotReload})", hotReload);
    }

    [ListenerHandler<Listeners.OnClientPutInServer>]
    public void OnClientPutInServer(int playerSlot)
    {
        // Reloading on lifecycle events gives administrators a predictable way to
        // apply file edits without adding commands or an unreliable bind-mount watcher.
        _weaponSkins?.Reload();
        var player = Utilities.GetPlayerFromSlot(playerSlot);
        _adminApi?.RefreshPlayerSkins(player);
        // The inventory may not be populated until the event callback finishes.
        Server.NextFrame(() => _weaponSkins?.ApplyAll(player));
    }

    [GameEventHandler]
    public HookResult OnPlayerSpawn(EventPlayerSpawn @event, GameEventInfo info)
    {
        // Never capture the event object itself in NextFrame: CounterStrikeSharp only
        // guarantees event lifetime for the duration of this callback.
        var player = @event.Userid;
        _weaponSkins?.Reload();
        _adminApi?.RefreshPlayerSkins(player);
        Server.NextFrame(() => _weaponSkins?.ApplyAll(player));
        return HookResult.Continue;
    }

    [GameEventHandler]
    public HookResult OnItemPickup(EventItemPickup @event, GameEventInfo info)
    {
        // Copy event values before scheduling work for the same lifetime reason as spawn.
        var player = @event.Userid;
        var item = @event.Item;
        Server.NextFrame(() => _weaponSkins?.ApplyNamed(player, item));
        return HookResult.Continue;
    }

    public override void Unload(bool hotReload)
    {
        _adminApi?.Dispose();
    }
}
