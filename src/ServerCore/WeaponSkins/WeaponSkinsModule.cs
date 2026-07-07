using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Modules.Extensions;
using CounterStrikeSharp.API.Modules.Memory.DynamicFunctions;
using Microsoft.Extensions.Logging;
using System.Text.Json;
using System.Collections.Concurrent;

namespace Verona.WeaponSkins;

public sealed class WeaponSkinsModule
{
    // CS2 represents knife models as subclasses of the knife entity. The stable
    // item-definition indices come from Valve's item schema; keeping the small
    // allow-list here also prevents arbitrary ChangeSubclass input from the API.
    private static readonly IReadOnlyDictionary<string, ushort> KnifeDefinitionIndexes =
        new Dictionary<string, ushort>(StringComparer.OrdinalIgnoreCase)
        {
            ["weapon_bayonet"] = 500,
            ["weapon_knife_css"] = 503,
            ["weapon_knife_flip"] = 505,
            ["weapon_knife_gut"] = 506,
            ["weapon_knife_karambit"] = 507,
            ["weapon_knife_m9_bayonet"] = 508,
            ["weapon_knife_tactical"] = 509,
            ["weapon_knife_falchion"] = 512,
            ["weapon_knife_survival_bowie"] = 514,
            ["weapon_knife_butterfly"] = 515,
            ["weapon_knife_push"] = 516,
            ["weapon_knife_cord"] = 517,
            ["weapon_knife_canis"] = 518,
            ["weapon_knife_ursus"] = 519,
            ["weapon_knife_gypsy_jackknife"] = 520,
            ["weapon_knife_outdoor"] = 521,
            ["weapon_knife_stiletto"] = 522,
            ["weapon_knife_widowmaker"] = 523,
            ["weapon_knife_skeleton"] = 525,
            ["weapon_knife_kukri"] = 526
        };
    private readonly ILogger _logger;
    private readonly string _configurationPath;
    private readonly MemoryFunctionVoid<nint, string, float> _setOrAddAttribute;
    private readonly ConcurrentDictionary<ulong, IReadOnlyDictionary<string, SkinDefinition>> _remoteSkins = new();
    private readonly ConcurrentDictionary<ulong, IReadOnlyDictionary<string, GloveDefinition>> _remoteGloves = new();
    private readonly ConcurrentDictionary<ulong, IReadOnlyDictionary<string, AgentDefinition>> _remoteAgents = new();
    private SkinCatalog _catalog = SkinCatalog.Empty;
    private ulong _nextItemId = 65_578;

    public WeaponSkinsModule(ILogger logger, string configurationPath)
    {
        _logger = logger;
        _configurationPath = configurationPath;
        // The signature lives in addons/counterstrikesharp/gamedata/verona.json.
        // CounterStrikeSharp resolves the platform-specific address at plugin load time.
        _setOrAddAttribute = new MemoryFunctionVoid<nint, string, float>(
            GameData.GetSignature("CAttributeList_SetOrAddAttributeValueByName"));
    }

    public void Reload()
    {
        try
        {
            _catalog = SkinCatalog.Load(
                _configurationPath,
                message => _logger.LogWarning("WeaponSkins configuration: {Message}", message));
            _logger.LogInformation("Loaded weapon skin configuration for {PlayerCount} player(s) from {Path}", _catalog.PlayerCount, _configurationPath);
        }
        catch (Exception exception) when (exception is IOException or JsonException or InvalidDataException or UnauthorizedAccessException)
        {
            // Never keep an older assignment silently after an invalid reload: the admin
            // should see a loud error, and the safe behavior is to stop modifying weapons.
            _catalog = SkinCatalog.Empty;
            _logger.LogError(exception, "Could not load weapon skin configuration from {Path}; no skins will be applied", _configurationPath);
        }
    }

    public void ApplyAll(CCSPlayerController? player)
    {
        if (!CanApply(player))
        {
            return;
        }

        ApplyAgent(player!);
        ApplyGloves(player);

        var weaponServices = player.PlayerPawn.Value?.WeaponServices;
        if (weaponServices is null)
        {
            return;
        }

        foreach (var weaponHandle in weaponServices.MyWeapons)
        {
            // Source entity handles can become invalid independently of the collection,
            // so resolve and null-check every handle instead of trusting the snapshot.
            var weapon = weaponHandle.Value;
            if (weapon is not null)
            {
                Apply(player, weapon);
            }
        }

    }

    public void ApplyNamed(CCSPlayerController? player, string eventWeaponName)
    {
        if (!CanApply(player))
        {
            return;
        }

        var expectedName = NormalizeWeaponName(eventWeaponName);
        var weaponServices = player!.PlayerPawn.Value?.WeaponServices;
        if (weaponServices is null)
        {
            return;
        }

        foreach (var weaponHandle in weaponServices.MyWeapons)
        {
            var weapon = weaponHandle.Value;
            if (weapon is not null &&
                (string.Equals(weapon.GetWeaponName(), expectedName, StringComparison.OrdinalIgnoreCase)
                 || IsKnifeName(expectedName) && IsKnifeName(weapon.GetWeaponName())))
            {
                Apply(player, weapon);
            }
        }
    }

    public void UpdatePlayerSkins(ulong steamId, IEnumerable<KeyValuePair<string, SkinDefinition>> skins)
    {
        _remoteSkins[steamId] = skins.ToDictionary(x => x.Key, x => x.Value, StringComparer.OrdinalIgnoreCase);
    }

    public void UpdatePlayerLoadout(
        ulong steamId,
        IEnumerable<KeyValuePair<string, SkinDefinition>> skins,
        IEnumerable<KeyValuePair<string, GloveDefinition>> gloves,
        IEnumerable<KeyValuePair<string, AgentDefinition>> agents)
    {
        _remoteSkins[steamId] = skins.ToDictionary(x => x.Key, x => x.Value, StringComparer.OrdinalIgnoreCase);
        _remoteGloves[steamId] = gloves.ToDictionary(x => x.Key, x => x.Value, StringComparer.OrdinalIgnoreCase);
        _remoteAgents[steamId] = agents.ToDictionary(x => x.Key, x => x.Value, StringComparer.OrdinalIgnoreCase);
    }

    private void ApplyGloves(CCSPlayerController player)
    {
        var team = TeamKey(player);
        var pawn = player.PlayerPawn.Value;
        if (team is null || pawn is not { IsValid: true }
            || !_remoteGloves.TryGetValue(player.SteamID, out var values)
            || !values.TryGetValue(team, out var glove)) return;

        try
        {
            var item = pawn.EconGloves;
            item.ItemDefinitionIndex = glove.DefinitionIndex;
            item.EntityQuality = 3;
            var itemId = _nextItemId++;
            item.ItemID = itemId;
            item.ItemIDLow = (uint)(itemId & uint.MaxValue);
            item.ItemIDHigh = (uint)(itemId >> 32);
            item.AccountID = (uint)player.SteamID;
            SetTextureAttributes(item.NetworkedDynamicAttributes.Handle, new(glove.PaintKit, glove.Wear, glove.Seed));
            SetTextureAttributes(item.AttributeList.Handle, new(glove.PaintKit, glove.Wear, glove.Seed));
            item.Initialized = true;

            // Toggling the first/third-person bodygroup forces the client to rebuild
            // glove models and avoids the stock gloves overlapping the selected pair.
            pawn.AcceptInput("SetBodygroup", value: "first_or_third_person,0");
            Server.NextFrame(() =>
            {
                if (pawn.IsValid) pawn.AcceptInput("SetBodygroup", value: "first_or_third_person,1");
            });
        }
        catch (Exception exception)
        {
            _logger.LogWarning(exception, "Could not apply gloves for SteamID64 {SteamId} ({Team})", player.SteamID, team);
        }
    }

    private void ApplyAgent(CCSPlayerController player)
    {
        var team = TeamKey(player);
        var pawn = player.PlayerPawn.Value;
        if (team is null || pawn is not { IsValid: true }
            || !_remoteAgents.TryGetValue(player.SteamID, out var values)
            || !values.TryGetValue(team, out var agent)) return;
        try
        {
            pawn.SetModel(agent.Model);
        }
        catch (Exception exception)
        {
            _logger.LogWarning(exception, "Could not apply agent model {Model} for SteamID64 {SteamId}", agent.Model, player.SteamID);
        }
    }

    private void Apply(CCSPlayerController player, CBasePlayerWeapon weapon)
    {
        var weaponName = weapon.GetWeaponName();
        if (string.IsNullOrWhiteSpace(weaponName))
        {
            return;
        }

        SkinDefinition? skin = null;
        string? configuredWeaponName = null;
        if (_remoteSkins.TryGetValue(player.SteamID, out var remote))
        {
            // Once the API answered for a player, PostgreSQL is authoritative—even an
            // empty response intentionally means that no skin is configured.
            var team = TeamKey(player);
            var exactKey = team is null ? null : $"{team}:{weaponName}";
            var sharedKey = $"both:{weaponName}";
            if (exactKey is not null && remote.TryGetValue(exactKey, out skin))
            {
                configuredWeaponName = weaponName;
            }
            else if (remote.TryGetValue(sharedKey, out skin))
            {
                configuredWeaponName = weaponName;
            }
            else if (IsKnifeName(weaponName))
            {
                // A stock CT/T knife reports weapon_knife(_t), while the selected
                // model is stored under its canonical classname. Only one knife
                // entry is allowed by the loadout's primary key semantics.
                var knife = remote.FirstOrDefault(x => exactKey is not null
                    && x.Key.StartsWith($"{team}:", StringComparison.OrdinalIgnoreCase)
                    && KnifeDefinitionIndexes.ContainsKey(x.Key[(x.Key.IndexOf(':') + 1)..]));
                if (string.IsNullOrEmpty(knife.Key))
                    knife = remote.FirstOrDefault(x => x.Key.StartsWith("both:", StringComparison.OrdinalIgnoreCase)
                        && KnifeDefinitionIndexes.ContainsKey(x.Key[(x.Key.IndexOf(':') + 1)..]));
                if (!string.IsNullOrEmpty(knife.Key))
                {
                    configuredWeaponName = knife.Key[(knife.Key.IndexOf(':') + 1)..];
                    skin = knife.Value;
                }
            }
        }
        else
        {
            // JSON remains a startup/offline fallback until the first API response.
            _catalog.TryGetSkin(player.SteamID, weaponName, out skin);
        }
        if (skin is null) return;

        try
        {
            if (configuredWeaponName is not null
                && KnifeDefinitionIndexes.TryGetValue(configuredWeaponName, out var definitionIndex))
            {
                var knifeItem = weapon.AttributeManager.Item;
                if (knifeItem.ItemDefinitionIndex != definitionIndex)
                {
                    // ChangeSubclass refreshes the world/view model. Updating only
                    // ItemDefinitionIndex would paint the stock knife model.
                    weapon.AcceptInput("ChangeSubclass", value: definitionIndex.ToString());
                    knifeItem.ItemDefinitionIndex = definitionIndex;
                }
                knifeItem.EntityQuality = 3; // Valve's quality value for unusual knives.
            }

            // Fallback fields change only the rendered economy item. They do not grant a
            // weapon or alter ammo/economy, which is an explicit v1 product boundary.
            weapon.FallbackPaintKit = skin.PaintKit;
            weapon.FallbackSeed = skin.Seed;
            weapon.FallbackWear = skin.Wear;

            // Give the modified view its own economy ID. Reusing the stock item ID lets
            // the client replace our values with its cached inventory representation.
            var item = weapon.AttributeManager.Item;
            var itemId = _nextItemId++;
            item.ItemID = itemId;
            item.ItemIDLow = (uint)(itemId & uint.MaxValue);
            item.ItemIDHigh = (uint)(itemId >> 32);
            item.AccountID = (uint)player.SteamID;

            // Current CS2 clients read texture data from economy attribute lists. Keep
            // fallback fields as well, but update both lists through the engine function.
            SetTextureAttributes(item.NetworkedDynamicAttributes.Handle, skin);
            SetTextureAttributes(item.AttributeList.Handle, skin);

            // Assigning schema refs changes server memory, but SetStateChanged is required
            // for CounterStrikeSharp to replicate each value to connected clients.
            Utilities.SetStateChanged(weapon, "CEconEntity", "m_nFallbackPaintKit");
            Utilities.SetStateChanged(weapon, "CEconEntity", "m_nFallbackSeed");
            Utilities.SetStateChanged(weapon, "CEconEntity", "m_flFallbackWear");
        }
        catch (Exception exception)
        {
            _logger.LogWarning(exception, "Could not apply skin to {Weapon} for SteamID64 {SteamId}", weaponName, player.SteamID);
        }
    }

    private void SetTextureAttributes(nint attributeList, SkinDefinition skin)
    {
        _setOrAddAttribute.Invoke(attributeList, "set item texture prefab", skin.PaintKit);
        _setOrAddAttribute.Invoke(attributeList, "set item texture seed", skin.Seed);
        _setOrAddAttribute.Invoke(attributeList, "set item texture wear", skin.Wear);
    }

    // Bots are intentionally excluded because skins.json is keyed by persistent SteamID64.
    private static bool CanApply(CCSPlayerController? player) =>
        player is { IsValid: true, IsBot: false } && player.PlayerPawn.IsValid;

    private static string NormalizeWeaponName(string name) =>
        name.StartsWith("weapon_", StringComparison.OrdinalIgnoreCase)
            ? name.ToLowerInvariant()
            : $"weapon_{name.ToLowerInvariant()}";

    private static bool IsKnifeName(string? name) =>
        name?.Contains("knife", StringComparison.OrdinalIgnoreCase) == true
        || name?.Contains("bayonet", StringComparison.OrdinalIgnoreCase) == true;

    private static string? TeamKey(CCSPlayerController player) => player.TeamNum switch
    {
        2 => "t",
        3 => "ct",
        _ => null
    };
}
