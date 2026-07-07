using System.Collections.ObjectModel;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Verona.WeaponSkins;

public sealed class SkinCatalog
{
    // Intentionally accept only canonical, boring identifiers. Besides catching typos,
    // this prevents arbitrary JSON keys from being treated as engine classnames later.
    private static readonly Regex SteamIdPattern = new("^[0-9]{17}$", RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private static readonly Regex WeaponPattern = new("^weapon_[a-z0-9_]+$", RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private readonly IReadOnlyDictionary<ulong, IReadOnlyDictionary<string, SkinDefinition>> _players;

    private SkinCatalog(Dictionary<ulong, IReadOnlyDictionary<string, SkinDefinition>> players)
    {
        _players = new ReadOnlyDictionary<ulong, IReadOnlyDictionary<string, SkinDefinition>>(players);
    }

    public static SkinCatalog Empty { get; } = new(new());

    public static SkinCatalog Load(string path, Action<string>? warning = null)
    {
        // JsonDocument is deliberate here: whole-model deserialization would reject the
        // complete file when one player's entry is malformed. We validate each leaf instead.
        using var stream = File.OpenRead(path);
        using var document = JsonDocument.Parse(stream, new JsonDocumentOptions
        {
            AllowTrailingCommas = true,
            CommentHandling = JsonCommentHandling.Skip
        });

        if (document.RootElement.ValueKind != JsonValueKind.Object)
        {
            throw new InvalidDataException("The skins configuration root must be a JSON object.");
        }

        // Build mutable dictionaries locally, then expose only read-only snapshots. A
        // reload therefore swaps the catalog atomically instead of mutating live state.
        var players = new Dictionary<ulong, IReadOnlyDictionary<string, SkinDefinition>>();
        foreach (var playerProperty in document.RootElement.EnumerateObject())
        {
            if (!SteamIdPattern.IsMatch(playerProperty.Name) || !ulong.TryParse(playerProperty.Name, out var steamId))
            {
                warning?.Invoke($"Ignoring invalid SteamID64 '{playerProperty.Name}'.");
                continue;
            }

            if (playerProperty.Value.ValueKind != JsonValueKind.Object)
            {
                warning?.Invoke($"Ignoring SteamID64 '{playerProperty.Name}': its value must be an object.");
                continue;
            }

            var weapons = new Dictionary<string, SkinDefinition>(StringComparer.OrdinalIgnoreCase);
            foreach (var weaponProperty in playerProperty.Value.EnumerateObject())
            {
                var weaponName = weaponProperty.Name.ToLowerInvariant();
                if (!WeaponPattern.IsMatch(weaponName))
                {
                    warning?.Invoke($"Ignoring invalid weapon name '{weaponProperty.Name}' for {playerProperty.Name}.");
                    continue;
                }

                if (TryReadSkin(weaponProperty.Value, out var skin, out var error))
                {
                    weapons[weaponName] = skin!;
                }
                else
                {
                    warning?.Invoke($"Ignoring {weaponName} for {playerProperty.Name}: {error}");
                }
            }

            players[steamId] = new ReadOnlyDictionary<string, SkinDefinition>(weapons);
        }

        return new SkinCatalog(players);
    }

    public bool TryGetSkin(ulong steamId, string weaponName, out SkinDefinition? skin)
    {
        skin = null;
        return _players.TryGetValue(steamId, out var weapons)
            && weapons.TryGetValue(weaponName, out skin);
    }

    public int PlayerCount => _players.Count;

    private static bool TryReadSkin(JsonElement element, out SkinDefinition? skin, out string error)
    {
        skin = null;
        if (element.ValueKind != JsonValueKind.Object)
        {
            error = "skin must be an object.";
            return false;
        }

        if (!element.TryGetProperty("paintKit", out var paintElement)
            || !paintElement.TryGetInt32(out var paintKit)
            || paintKit <= 0)
        {
            error = "paintKit must be a positive integer.";
            return false;
        }

        if (!element.TryGetProperty("wear", out var wearElement)
            || !wearElement.TryGetSingle(out var wear)
            || !float.IsFinite(wear)
            || wear is < 0f or > 1f)
        {
            error = "wear must be a finite number from 0.0 to 1.0.";
            return false;
        }

        if (!element.TryGetProperty("seed", out var seedElement)
            || !seedElement.TryGetInt32(out var seed)
            || seed is < 0 or > 1000)
        {
            error = "seed must be an integer from 0 to 1000.";
            return false;
        }

        skin = new SkinDefinition(paintKit, wear, seed);
        error = string.Empty;
        return true;
    }
}
