namespace Verona.WeaponSkins;

public sealed record StickerDefinition(int Slot, int StickerId, float Wear);
public sealed record SkinDefinition(
    int PaintKit, float Wear, int Seed, bool StatTrak = false, string? NameTag = null,
    IReadOnlyList<StickerDefinition>? Stickers = null, int? KeychainId = null, int KeychainSeed = 0);
public sealed record GloveDefinition(ushort DefinitionIndex, int PaintKit, float Wear, int Seed);
public sealed record AgentDefinition(string Model);
