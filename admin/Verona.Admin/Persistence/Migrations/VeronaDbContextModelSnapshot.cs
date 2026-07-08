using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;

namespace Verona.Admin.Persistence.Migrations;

[DbContext(typeof(VeronaDbContext))]
public sealed class VeronaDbContextModelSnapshot : ModelSnapshot
{
    protected override void BuildModel(ModelBuilder modelBuilder)
    {
        modelBuilder.HasAnnotation("ProductVersion", "10.0.9");

        modelBuilder.Entity("Verona.Admin.Persistence.PlayerEntity", entity =>
        {
            entity.Property<decimal>("SteamId").HasColumnType("numeric(20,0)").HasColumnName("steam_id");
            entity.Property<string>("Name").IsRequired().HasColumnType("text").HasColumnName("name");
            entity.Property<string>("Role").IsRequired().HasMaxLength(16).HasColumnType("character varying(16)").HasColumnName("role").HasDefaultValue("player");
            entity.Property<string>("AvatarUrl").HasColumnType("text").HasColumnName("avatar_url");
            entity.Property<string>("ProfileUrl").HasColumnType("text").HasColumnName("profile_url");
            entity.Property<int?>("FaceitElo").HasColumnType("integer").HasColumnName("faceit_elo");
            entity.Property<string>("FaceitNickname").HasColumnType("text").HasColumnName("faceit_nickname");
            entity.Property<DateTimeOffset>("FirstSeenAt").ValueGeneratedOnAdd().HasColumnType("timestamp with time zone").HasColumnName("first_seen_at").HasDefaultValueSql("now()");
            entity.Property<DateTimeOffset>("LastSeenAt").ValueGeneratedOnAdd().HasColumnType("timestamp with time zone").HasColumnName("last_seen_at").HasDefaultValueSql("now()");
            entity.HasKey("SteamId");
            entity.ToTable("players");
        });

        modelBuilder.Entity("Verona.Admin.Persistence.BanEntity", entity =>
        {
            entity.Property<decimal>("SteamId").HasColumnType("numeric(20,0)").HasColumnName("steam_id");
            entity.Property<string>("Reason").IsRequired().HasColumnType("text").HasColumnName("reason");
            entity.Property<DateTimeOffset?>("ExpiresAt").HasColumnType("timestamp with time zone").HasColumnName("expires_at");
            entity.Property<DateTimeOffset>("CreatedAt").ValueGeneratedOnAdd().HasColumnType("timestamp with time zone").HasColumnName("created_at").HasDefaultValueSql("now()");
            entity.Property<DateTimeOffset?>("RevokedAt").HasColumnType("timestamp with time zone").HasColumnName("revoked_at");
            entity.HasKey("SteamId");
            entity.ToTable("bans");
        });
    }
}
