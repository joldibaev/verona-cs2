using Npgsql;

namespace Verona.Admin;

public static class Database
{
    public static async Task Initialize(NpgsqlDataSource dataSource)
    {
        const string sql = """
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
            updated_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (steam_id, weapon, team)
        );
        ALTER TABLE player_weapon_skins ADD COLUMN IF NOT EXISTS team varchar(4) NOT NULL DEFAULT 'both';
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
            PRIMARY KEY(collection_id,weapon,team)
        );
        ALTER TABLE skin_collection_items ADD COLUMN IF NOT EXISTS team varchar(4) NOT NULL DEFAULT 'both';
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
        await using var command = dataSource.CreateCommand(sql);
        await command.ExecuteNonQueryAsync();
    }

    public static async Task BootstrapAdmins(NpgsqlDataSource db, IEnumerable<string> steamIds)
    {
        await using var count = db.CreateCommand("SELECT count(*) FROM players WHERE role='admin'");
        if (Convert.ToInt64(await count.ExecuteScalarAsync()) > 0) return;

        // ADMIN_STEAM_IDS is migration/bootstrap input only. Once one admin exists,
        // changing the environment cannot silently grant or revoke database roles.
        foreach (var steamId in steamIds.Where(x => x.Length == 17 && x.All(char.IsAsciiDigit)))
        {
            await using var command = db.CreateCommand("""
                INSERT INTO players(steam_id,name,role) VALUES ($1,$2,'admin')
                ON CONFLICT (steam_id) DO UPDATE SET role='admin'
                """);
            command.Parameters.AddWithValue(decimal.Parse(steamId));
            command.Parameters.AddWithValue($"Player {steamId[^5..]}");
            await command.ExecuteNonQueryAsync();
        }
    }

    public static async Task<RequestIdentity?> GetIdentity(NpgsqlDataSource db, string steamId)
    {
        await using var command = db.CreateCommand("""
            SELECT steam_id::text,name,role,avatar_url,faceit_elo,faceit_nickname
            FROM players WHERE steam_id=$1
            """);
        command.Parameters.AddWithValue(decimal.Parse(steamId));
        await using var reader = await command.ExecuteReaderAsync();
        if (!await reader.ReadAsync()) return null;
        return new RequestIdentity(reader.GetString(0), reader.GetString(1), reader.GetString(2),
            reader.IsDBNull(3) ? null : reader.GetString(3), reader.IsDBNull(4) ? null : reader.GetInt32(4),
            reader.IsDBNull(5) ? null : reader.GetString(5));
    }

    public static async Task Enqueue(NpgsqlDataSource db, CommandInput input)
    {
        // PostgreSQL is the durable hand-off between short browser requests and the
        // plugin poll loop. v1 records delivery but intentionally has no retry/ack.
        await using var command = db.CreateCommand("INSERT INTO server_commands(type, steam_id, value, reason) VALUES ($1, $2, $3, $4)");
        command.Parameters.AddWithValue(input.Type);
        command.Parameters.AddWithValue(input.SteamId is null ? DBNull.Value : decimal.Parse(input.SteamId));
        command.Parameters.AddWithValue((object?)input.Value ?? DBNull.Value);
        command.Parameters.AddWithValue((object?)input.Reason ?? DBNull.Value);
        await command.ExecuteNonQueryAsync();
    }
}
