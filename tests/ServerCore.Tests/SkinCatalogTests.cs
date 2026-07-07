using Verona.WeaponSkins;
using System.Globalization;
using Xunit;

namespace Verona.Tests;

public sealed class SkinCatalogTests
{
    [Fact]
    public void Load_ReadsValidSkin()
    {
        using var file = TempJson("""
        { "76561198000000000": { "weapon_ak47": { "paintKit": 600, "wear": 0.01, "seed": 42 } } }
        """);

        var catalog = SkinCatalog.Load(file.Path);

        Assert.True(catalog.TryGetSkin(76561198000000000, "weapon_ak47", out var skin));
        Assert.Equal(new SkinDefinition(600, 0.01f, 42), skin);
    }

    [Fact]
    public void Load_SkipsInvalidEntriesButKeepsValidOnes()
    {
        using var file = TempJson("""
        {
          "not-a-steamid": { "weapon_m4a1": { "paintKit": 1, "wear": 0.1, "seed": 1 } },
          "76561198000000000": {
            "weapon_ak47": { "paintKit": 600, "wear": 0.01, "seed": 42 },
            "weapon_awp": { "paintKit": 0, "wear": 2, "seed": -1 },
            "bad name": { "paintKit": 1, "wear": 0.1, "seed": 1 }
          }
        }
        """);
        var warnings = new List<string>();

        var catalog = SkinCatalog.Load(file.Path, warnings.Add);

        Assert.True(catalog.TryGetSkin(76561198000000000, "weapon_ak47", out _));
        Assert.False(catalog.TryGetSkin(76561198000000000, "weapon_awp", out _));
        Assert.True(warnings.Count >= 3);
    }

    [Theory]
    [InlineData(-0.01)]
    [InlineData(1.01)]
    public void Load_RejectsWearOutsideRange(double wear)
    {
        using var file = TempJson($$"""
        { "76561198000000000": { "weapon_ak47": { "paintKit": 600, "wear": {{wear.ToString(CultureInfo.InvariantCulture)}}, "seed": 42 } } }
        """);

        var catalog = SkinCatalog.Load(file.Path);

        Assert.False(catalog.TryGetSkin(76561198000000000, "weapon_ak47", out _));
    }

    [Fact]
    public void TryGetSkin_ReturnsFalseForUnknownPlayerOrWeapon()
    {
        using var file = TempJson("{ \"76561198000000000\": {} }");
        var catalog = SkinCatalog.Load(file.Path);

        Assert.False(catalog.TryGetSkin(76561198000000001, "weapon_ak47", out _));
        Assert.False(catalog.TryGetSkin(76561198000000000, "weapon_ak47", out _));
    }

    [Fact]
    public void Load_RejectsNonObjectRoot()
    {
        using var file = TempJson("[]");
        Assert.Throws<InvalidDataException>(() => SkinCatalog.Load(file.Path));
    }

    private static TempFile TempJson(string json) => new(json);

    private sealed class TempFile : IDisposable
    {
        public TempFile(string content)
        {
            Path = System.IO.Path.GetTempFileName();
            File.WriteAllText(Path, content);
        }

        public string Path { get; }
        public void Dispose() => File.Delete(Path);
    }
}
