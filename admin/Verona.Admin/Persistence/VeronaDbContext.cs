using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Verona.Admin.Persistence;

public sealed class VeronaDbContext(DbContextOptions<VeronaDbContext> options) : DbContext(options)
{
    public DbSet<PlayerEntity> Players => Set<PlayerEntity>();
    public DbSet<BanEntity> Bans => Set<BanEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<PlayerEntity>(entity =>
        {
            entity.ToTable("players");
            entity.HasKey(player => player.SteamId);
            entity.Property(player => player.SteamId).HasColumnName("steam_id").HasColumnType("numeric(20,0)").ValueGeneratedNever();
            entity.Property(player => player.Name).HasColumnName("name").IsRequired();
            entity.Property(player => player.Role).HasColumnName("role").HasMaxLength(16).HasDefaultValue("player");
            entity.Property(player => player.AvatarUrl).HasColumnName("avatar_url");
            entity.Property(player => player.ProfileUrl).HasColumnName("profile_url");
            entity.Property(player => player.FaceitElo).HasColumnName("faceit_elo");
            entity.Property(player => player.FaceitNickname).HasColumnName("faceit_nickname");
            entity.Property(player => player.FirstSeenAt).HasColumnName("first_seen_at").HasDefaultValueSql("now()");
            entity.Property(player => player.LastSeenAt).HasColumnName("last_seen_at").HasDefaultValueSql("now()");
        });

        modelBuilder.Entity<BanEntity>(entity =>
        {
            entity.ToTable("bans");
            entity.HasKey(ban => ban.SteamId);
            entity.Property(ban => ban.SteamId).HasColumnName("steam_id").HasColumnType("numeric(20,0)").ValueGeneratedNever();
            entity.Property(ban => ban.Reason).HasColumnName("reason").IsRequired();
            entity.Property(ban => ban.ExpiresAt).HasColumnName("expires_at");
            entity.Property(ban => ban.CreatedAt).HasColumnName("created_at").HasDefaultValueSql("now()");
            entity.Property(ban => ban.RevokedAt).HasColumnName("revoked_at");
        });
    }
}

public sealed class PlayerEntity
{
    public decimal SteamId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Role { get; set; } = "player";
    public string? AvatarUrl { get; set; }
    public string? ProfileUrl { get; set; }
    public int? FaceitElo { get; set; }
    public string? FaceitNickname { get; set; }
    public DateTimeOffset FirstSeenAt { get; set; }
    public DateTimeOffset LastSeenAt { get; set; }
}

public sealed class BanEntity
{
    public decimal SteamId { get; set; }
    public string Reason { get; set; } = string.Empty;
    public DateTimeOffset? ExpiresAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? RevokedAt { get; set; }
}

public sealed class VeronaDbContextFactory : IDesignTimeDbContextFactory<VeronaDbContext>
{
    public VeronaDbContext CreateDbContext(string[] args)
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__Postgres")
            ?? "Host=localhost;Database=verona;Username=verona;Password=verona";
        var options = new DbContextOptionsBuilder<VeronaDbContext>().UseNpgsql(connectionString).Options;
        return new VeronaDbContext(options);
    }
}
