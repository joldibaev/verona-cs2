namespace Verona.WeaponSkins;

public sealed record SkinDefinition(int PaintKit, float Wear, int Seed, bool StatTrak = false, string? NameTag = null);
public sealed record GloveDefinition(ushort DefinitionIndex, int PaintKit, float Wear, int Seed);
public sealed record AgentDefinition(string Model);
