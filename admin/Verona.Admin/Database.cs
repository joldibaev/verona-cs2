using Microsoft.EntityFrameworkCore;
using Npgsql;
using Verona.Admin.Persistence;

namespace Verona.Admin;

public static class Database
{
    // Immutable baseline used only by 202607080001_InitialSchema. Never edit this SQL
    // after release: every later schema change must be a new migration class.
    // PostgreSQL-specific constraints and indexes stay explicit rather than hidden.
    internal const string InitialSchemaSql = """
        CREATE TABLE IF NOT EXISTS players (
            steam_id numeric(20,0) PRIMARY KEY,
            name text NOT NULL,
            role varchar(16) NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'admin')),
            avatar_url text NULL,
            profile_url text NULL,
            faceit_elo integer NULL,
            faceit_nickname text NULL,
            first_seen_at timestamptz NOT NULL DEFAULT now(),
            last_seen_at timestamptz NOT NULL DEFAULT now()
        );
        ALTER TABLE players ADD COLUMN IF NOT EXISTS role varchar(16) NOT NULL DEFAULT 'player';
        ALTER TABLE players ADD COLUMN IF NOT EXISTS avatar_url text NULL;
        ALTER TABLE players ADD COLUMN IF NOT EXISTS profile_url text NULL;
        ALTER TABLE players ADD COLUMN IF NOT EXISTS faceit_elo integer NULL;
        ALTER TABLE players ADD COLUMN IF NOT EXISTS faceit_nickname text NULL;
        CREATE TABLE IF NOT EXISTS player_weapon_skins (
            steam_id numeric(20,0) NOT NULL,
            weapon varchar(64) NOT NULL,
            team varchar(4) NOT NULL DEFAULT 'both' CHECK (team IN ('both', 'ct', 't')),
            paint_kit integer NOT NULL CHECK (paint_kit > 0),
            wear real NOT NULL CHECK (wear >= 0 AND wear <= 1),
            seed integer NOT NULL CHECK (seed >= 0 AND seed <= 1000),
            stat_trak boolean NOT NULL DEFAULT false,
            name_tag varchar(20) NULL,
            keychain_id integer NULL,
            keychain_seed integer NOT NULL DEFAULT 0,
            stickers jsonb NOT NULL DEFAULT '[]',
            updated_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (steam_id, weapon, team)
        );
        ALTER TABLE player_weapon_skins ADD COLUMN IF NOT EXISTS team varchar(4) NOT NULL DEFAULT 'both';
        ALTER TABLE player_weapon_skins ADD COLUMN IF NOT EXISTS stat_trak boolean NOT NULL DEFAULT false;
        ALTER TABLE player_weapon_skins ADD COLUMN IF NOT EXISTS name_tag varchar(20) NULL;
        ALTER TABLE player_weapon_skins ADD COLUMN IF NOT EXISTS keychain_id integer NULL;
        ALTER TABLE player_weapon_skins ADD COLUMN IF NOT EXISTS keychain_seed integer NOT NULL DEFAULT 0;
        ALTER TABLE player_weapon_skins ADD COLUMN IF NOT EXISTS stickers jsonb NOT NULL DEFAULT '[]';
        DO $$ BEGIN
            ALTER TABLE player_weapon_skins ADD CONSTRAINT player_weapon_skins_team_check CHECK (team IN ('both','ct','t'));
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;
        ALTER TABLE player_weapon_skins DROP CONSTRAINT IF EXISTS player_weapon_skins_pkey;
        ALTER TABLE player_weapon_skins ADD CONSTRAINT player_weapon_skins_pkey PRIMARY KEY (steam_id, weapon, team);
        CREATE TABLE IF NOT EXISTS player_gloves (
            steam_id numeric(20,0) NOT NULL,
            team varchar(2) NOT NULL CHECK (team IN ('ct', 't')),
            definition_index integer NOT NULL CHECK (definition_index IN (4725,5027,5030,5031,5032,5033,5034,5035)),
            paint_kit integer NOT NULL CHECK (paint_kit > 0),
            wear real NOT NULL CHECK (wear >= 0 AND wear <= 1),
            seed integer NOT NULL CHECK (seed >= 0 AND seed <= 1000),
            updated_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (steam_id, team)
        );
        CREATE TABLE IF NOT EXISTS player_agents (
            steam_id numeric(20,0) NOT NULL,
            team varchar(2) NOT NULL CHECK (team IN ('ct', 't')),
            model varchar(160) NOT NULL,
            updated_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (steam_id, team)
        );
        CREATE TABLE IF NOT EXISTS bans (
            steam_id numeric(20,0) PRIMARY KEY,
            reason text NOT NULL DEFAULT '',
            expires_at timestamptz NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            revoked_at timestamptz NULL
        );
        CREATE TABLE IF NOT EXISTS server_settings (
            key varchar(64) PRIMARY KEY,
            value text NOT NULL,
            updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS server_commands (
            id bigserial PRIMARY KEY,
            type varchar(32) NOT NULL,
            steam_id numeric(20,0) NULL,
            value text NULL,
            reason text NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            delivered_at timestamptz NULL
        );
        ALTER TABLE server_commands ADD COLUMN IF NOT EXISTS claim_token uuid NULL;
        ALTER TABLE server_commands ADD COLUMN IF NOT EXISTS claimed_at timestamptz NULL;
        ALTER TABLE server_commands ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0;
        ALTER TABLE server_commands ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now();
        ALTER TABLE server_commands ADD COLUMN IF NOT EXISTS completed_at timestamptz NULL;
        ALTER TABLE server_commands ADD COLUMN IF NOT EXISTS failed_at timestamptz NULL;
        ALTER TABLE server_commands ADD COLUMN IF NOT EXISTS last_error text NULL;
        -- Rows handed out by the old no-ack protocol cannot safely be replayed.
        UPDATE server_commands SET completed_at=delivered_at
        WHERE delivered_at IS NOT NULL AND completed_at IS NULL;
        DELETE FROM server_commands newer USING server_commands older
        WHERE newer.id > older.id AND newer.type=older.type AND newer.steam_id=older.steam_id
          AND newer.type='ban'
          AND newer.completed_at IS NULL AND newer.failed_at IS NULL
          AND older.completed_at IS NULL AND older.failed_at IS NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS server_commands_one_active_state_change
            ON server_commands(type, steam_id)
            WHERE type='ban' AND completed_at IS NULL AND failed_at IS NULL;
        CREATE INDEX IF NOT EXISTS server_commands_ready_idx
            ON server_commands(next_attempt_at, id)
            WHERE completed_at IS NULL AND failed_at IS NULL;
        CREATE TABLE IF NOT EXISTS audit_log (
            id bigserial PRIMARY KEY,
            action varchar(64) NOT NULL,
            target text NULL,
            details text NULL,
            created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS skin_collections (
            id bigserial PRIMARY KEY,
            steam_id numeric(20,0) NOT NULL,
            name varchar(48) NOT NULL,
            active boolean NOT NULL DEFAULT false,
            created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS skin_collections_one_active ON skin_collections(steam_id) WHERE active;
        CREATE TABLE IF NOT EXISTS skin_collection_items (
            collection_id bigint NOT NULL REFERENCES skin_collections(id) ON DELETE CASCADE,
            weapon varchar(64) NOT NULL,
            team varchar(4) NOT NULL DEFAULT 'both' CHECK (team IN ('both', 'ct', 't')),
            paint_kit integer NOT NULL,
            wear real NOT NULL,
            seed integer NOT NULL,
            stat_trak boolean NOT NULL DEFAULT false,
            name_tag varchar(20) NULL,
            keychain_id integer NULL,
            keychain_seed integer NOT NULL DEFAULT 0,
            stickers jsonb NOT NULL DEFAULT '[]',
            PRIMARY KEY(collection_id,weapon,team)
        );
        ALTER TABLE skin_collection_items ADD COLUMN IF NOT EXISTS team varchar(4) NOT NULL DEFAULT 'both';
        ALTER TABLE skin_collection_items ADD COLUMN IF NOT EXISTS stat_trak boolean NOT NULL DEFAULT false;
        ALTER TABLE skin_collection_items ADD COLUMN IF NOT EXISTS name_tag varchar(20) NULL;
        ALTER TABLE skin_collection_items ADD COLUMN IF NOT EXISTS keychain_id integer NULL;
        ALTER TABLE skin_collection_items ADD COLUMN IF NOT EXISTS keychain_seed integer NOT NULL DEFAULT 0;
        ALTER TABLE skin_collection_items ADD COLUMN IF NOT EXISTS stickers jsonb NOT NULL DEFAULT '[]';
        DO $$ BEGIN
            ALTER TABLE skin_collection_items ADD CONSTRAINT skin_collection_items_team_check CHECK (team IN ('both','ct','t'));
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;
        ALTER TABLE skin_collection_items DROP CONSTRAINT IF EXISTS skin_collection_items_pkey;
        ALTER TABLE skin_collection_items ADD CONSTRAINT skin_collection_items_pkey PRIMARY KEY (collection_id,weapon,team);
        CREATE TABLE IF NOT EXISTS skin_collection_gloves (
            collection_id bigint NOT NULL REFERENCES skin_collections(id) ON DELETE CASCADE,
            team varchar(2) NOT NULL CHECK (team IN ('ct', 't')),
            definition_index integer NOT NULL CHECK (definition_index IN (4725,5027,5030,5031,5032,5033,5034,5035)),
            paint_kit integer NOT NULL CHECK (paint_kit > 0),
            wear real NOT NULL CHECK (wear >= 0 AND wear <= 1),
            seed integer NOT NULL CHECK (seed >= 0 AND seed <= 1000),
            PRIMARY KEY(collection_id, team)
        );
        CREATE TABLE IF NOT EXISTS skin_collection_agents (
            collection_id bigint NOT NULL REFERENCES skin_collections(id) ON DELETE CASCADE,
            team varchar(2) NOT NULL CHECK (team IN ('ct', 't')),
            model varchar(160) NOT NULL,
            PRIMARY KEY(collection_id, team)
        );
        INSERT INTO server_settings(key, value) VALUES ('map', 'de_dust2') ON CONFLICT DO NOTHING;
        """;

    public static async Task BootstrapAdmins(IDbContextFactory<VeronaDbContext> contexts, IEnumerable<string> steamIds)
    {
        await using var db = await contexts.CreateDbContextAsync();
        if (await db.Players.AnyAsync(player => player.Role == "admin")) return;

        // ADMIN_STEAM_IDS is migration/bootstrap input only. Once one admin exists,
        // changing the environment cannot silently grant or revoke database roles.
        foreach (var steamId in steamIds.Where(x => x.Length == 17 && x.All(char.IsAsciiDigit)))
        {
            var id = decimal.Parse(steamId);
            var player = await db.Players.FindAsync(id);
            if (player is null)
                db.Players.Add(new PlayerEntity { SteamId = id, Name = $"Player {steamId[^5..]}", Role = "admin" });
            else
                player.Role = "admin";
        }
        await db.SaveChangesAsync();
    }

    public static async Task<RequestIdentity?> GetIdentity(IDbContextFactory<VeronaDbContext> contexts, string steamId)
    {
        await using var db = await contexts.CreateDbContextAsync();
        return await db.Players.AsNoTracking()
            .Where(player => player.SteamId == decimal.Parse(steamId))
            .Select(player => new RequestIdentity(player.SteamId.ToString(), player.Name, player.Role,
                player.AvatarUrl, player.FaceitElo, player.FaceitNickname))
            .SingleOrDefaultAsync();
    }

    public static async Task Enqueue(NpgsqlDataSource db, CommandInput input)
    {
        // PostgreSQL is the durable hand-off between short browser requests and the
        // plugin poll loop. A command remains pending until the plugin acknowledges it.
        await using var command = db.CreateCommand("INSERT INTO server_commands(type, steam_id, value, reason) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING");
        command.Parameters.AddWithValue(input.Type);
        command.Parameters.AddWithValue(input.SteamId is null ? DBNull.Value : decimal.Parse(input.SteamId));
        command.Parameters.AddWithValue((object?)input.Value ?? DBNull.Value);
        command.Parameters.AddWithValue((object?)input.Reason ?? DBNull.Value);
        await command.ExecuteNonQueryAsync();
    }
}
