namespace Verona.WeaponSkins;

public sealed record SkinDefinition(int PaintKit, float Wear, int Seed);
public sealed record GloveDefinition(ushort DefinitionIndex, int PaintKit, float Wear, int Seed);
public sealed record AgentDefinition(string Model);
