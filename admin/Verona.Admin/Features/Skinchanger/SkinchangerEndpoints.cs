using System.Text.RegularExpressions;
using Npgsql;

namespace Verona.Admin.Features.Skinchanger;

public static class SkinchangerEndpoints
{
    public static void MapSkinchangerEndpoints(this WebApplication app,
        IReadOnlyDictionary<string, string> weaponTeams, IReadOnlySet<string> agentModels)
    {
        app.MapGet("/api/players/{steamId}/skins", async (string steamId, NpgsqlDataSource db) =>
        {
            var skins = new List<SkinInput>();
            await using var command = db.CreateCommand("SELECT weapon, team, paint_kit, wear, seed, stat_trak, name_tag, keychain_id, keychain_seed, stickers FROM player_weapon_skins WHERE steam_id=$1 ORDER BY weapon,team");
            command.Parameters.AddWithValue(decimal.Parse(steamId));
            await using var reader = await command.ExecuteReaderAsync();
            while (await reader.ReadAsync()) skins.Add(ReadSkin(reader));
            return Results.Ok(skins);
        });
        app.MapPut("/api/players/{steamId}/skins/{weapon}", async (string steamId, string weapon, SkinInput input, NpgsqlDataSource db) =>
        {
            if (!ValidSteamId(steamId) || !ValidSkin(weapon, input, weaponTeams)) return Results.BadRequest();
            await SaveWeaponSkin(db, steamId, weapon, input, syncActiveCollection: false);
            await Database.Enqueue(db, new CommandInput("refresh_skins", steamId));
            return Results.NoContent();
        });
        app.MapDelete("/api/players/{steamId}/skins/{weapon}/{team}", async (string steamId, string weapon, string team, NpgsqlDataSource db) =>
        {
            if (!ValidSteamId(steamId) || !ValidTeamScope(team)) return Results.BadRequest();
            await using var command = db.CreateCommand("DELETE FROM player_weapon_skins WHERE steam_id=$1 AND weapon=$2 AND team=ANY($3)");
            command.Parameters.AddWithValue(decimal.Parse(steamId)); command.Parameters.AddWithValue(weapon); command.Parameters.AddWithValue(TeamTargets(team).ToArray());
            await command.ExecuteNonQueryAsync();
            await Database.Enqueue(db, new CommandInput("refresh_skins", steamId));
            return Results.NoContent();
        });
        
        // Self-service skinchanger: a Steam player edits only their own loadout.
        app.MapGet("/api/me/collections", async (HttpContext context, NpgsqlDataSource db) =>
        {
            if (context.Items["identity"] is not RequestIdentity identity) return Results.BadRequest();
            var result = new List<object>();
            await using var command = db.CreateCommand("""
                SELECT c.id,c.name,c.active,count(i.weapon)::int FROM skin_collections c
                LEFT JOIN skin_collection_items i ON i.collection_id=c.id
                WHERE c.steam_id=$1 GROUP BY c.id ORDER BY c.created_at
                """);
            command.Parameters.AddWithValue(decimal.Parse(identity.SteamId));
            await using var reader = await command.ExecuteReaderAsync();
            while(await reader.ReadAsync()) result.Add(new { id=reader.GetInt64(0),name=reader.GetString(1),active=reader.GetBoolean(2),count=reader.GetInt32(3) });
            return Results.Ok(result);
        });
        app.MapPost("/api/me/collections", async (HttpContext context, CollectionInput input, NpgsqlDataSource db) =>
        {
            if (context.Items["identity"] is not RequestIdentity identity || string.IsNullOrWhiteSpace(input.Name) || input.Name.Trim().Length>48) return Results.BadRequest();
            await using var connection = await db.OpenConnectionAsync();
            await using var tx = await connection.BeginTransactionAsync();
            long id;
            await using (var command = connection.CreateCommand())
            {
                command.CommandText = "INSERT INTO skin_collections(steam_id,name,active) VALUES($1,$2,NOT EXISTS(SELECT 1 FROM skin_collections WHERE steam_id=$1)) RETURNING id";
                command.Transaction = tx;
                command.Parameters.AddWithValue(decimal.Parse(identity.SteamId));
                command.Parameters.AddWithValue(input.Name.Trim());
                id = (long)(await command.ExecuteScalarAsync())!;
            }
            if (input.Skins != null && input.Skins.Count > 0)
            {
                foreach (var skin in input.Skins)
                {
                    if (!ValidSkin(skin.Weapon, skin, weaponTeams)) continue;
                    foreach (var team in TeamTargets(skin.Team))
                    {
                        await using var itemCmd = connection.CreateCommand();
                        itemCmd.CommandText = "INSERT INTO skin_collection_items(collection_id,weapon,team,paint_kit,wear,seed,stat_trak,name_tag,keychain_id,keychain_seed,stickers) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb) ON CONFLICT DO NOTHING";
                        itemCmd.Transaction = tx;
                        itemCmd.Parameters.AddWithValue(id);
                        itemCmd.Parameters.AddWithValue(skin.Weapon);
                        itemCmd.Parameters.AddWithValue(team);
                        itemCmd.Parameters.AddWithValue(skin.PaintKit);
                        itemCmd.Parameters.AddWithValue(skin.Wear);
                        itemCmd.Parameters.AddWithValue(skin.Seed);
                        itemCmd.Parameters.AddWithValue(skin.StatTrak);
                        itemCmd.Parameters.AddWithValue(NameTagValue(skin.NameTag));
                        itemCmd.Parameters.AddWithValue(KeychainValue(skin.KeychainId));
                        itemCmd.Parameters.AddWithValue(skin.KeychainSeed);
                        itemCmd.Parameters.AddWithValue(SkinJson.SerializeStickers(skin.Stickers));
                        await itemCmd.ExecuteNonQueryAsync();
                    }
                }
            }
            else
            {
                await using var copy = connection.CreateCommand();
                copy.CommandText = "INSERT INTO skin_collection_items(collection_id,weapon,team,paint_kit,wear,seed,stat_trak,name_tag,keychain_id,keychain_seed,stickers) SELECT $1,weapon,team,paint_kit,wear,seed,stat_trak,name_tag,keychain_id,keychain_seed,stickers FROM player_weapon_skins WHERE steam_id=$2";
                copy.Transaction = tx;
                copy.Parameters.AddWithValue(id);
                copy.Parameters.AddWithValue(decimal.Parse(identity.SteamId));
                await copy.ExecuteNonQueryAsync();
                await using var copyGloves = connection.CreateCommand();
                copyGloves.CommandText = "INSERT INTO skin_collection_gloves(collection_id,team,definition_index,paint_kit,wear,seed) SELECT $1,team,definition_index,paint_kit,wear,seed FROM player_gloves WHERE steam_id=$2";
                copyGloves.Transaction = tx; copyGloves.Parameters.AddWithValue(id); copyGloves.Parameters.AddWithValue(decimal.Parse(identity.SteamId)); await copyGloves.ExecuteNonQueryAsync();
                await using var copyAgents = connection.CreateCommand();
                copyAgents.CommandText = "INSERT INTO skin_collection_agents(collection_id,team,model) SELECT $1,team,model FROM player_agents WHERE steam_id=$2";
                copyAgents.Transaction = tx; copyAgents.Parameters.AddWithValue(id); copyAgents.Parameters.AddWithValue(decimal.Parse(identity.SteamId)); await copyAgents.ExecuteNonQueryAsync();
            }
            await tx.CommitAsync();
            return Results.Ok(new { id });
        });
        app.MapGet("/api/me/collections/{id:long}/skins", async (HttpContext context, long id, NpgsqlDataSource db) =>
        {
            if (context.Items["identity"] is not RequestIdentity identity) return Results.BadRequest();
            await using var check = db.CreateCommand("SELECT count(*) FROM skin_collections WHERE id=$1 AND steam_id=$2");
            check.Parameters.AddWithValue(id);
            check.Parameters.AddWithValue(decimal.Parse(identity.SteamId));
            if (Convert.ToInt32(await check.ExecuteScalarAsync()) == 0) return Results.NotFound();
            var skins = new List<object>();
            await using var command = db.CreateCommand("SELECT weapon, team, paint_kit, wear, seed, stat_trak, name_tag, keychain_id, keychain_seed, stickers FROM skin_collection_items WHERE collection_id=$1 ORDER BY weapon,team");
            command.Parameters.AddWithValue(id);
            await using var reader = await command.ExecuteReaderAsync();
            while (await reader.ReadAsync()) skins.Add(new { weapon = reader.GetString(0), team = reader.GetString(1), paintKit = reader.GetInt32(2), wear = reader.GetFloat(3), seed = reader.GetInt32(4), statTrak = reader.GetBoolean(5), nameTag = reader.IsDBNull(6) ? null : reader.GetString(6), keychainId = reader.IsDBNull(7) ? (int?)null : reader.GetInt32(7), keychainSeed = reader.GetInt32(8), stickers = SkinJson.ParseStickers(reader.IsDBNull(9) ? null : reader.GetString(9)) });
            return Results.Ok(skins);
        });
        app.MapPost("/api/me/collections/{id:long}/activate", async (HttpContext context,long id,NpgsqlDataSource db) =>
        {
            if (context.Items["identity"] is not RequestIdentity identity) return Results.BadRequest();
            await using var connection=await db.OpenConnectionAsync();
            await using var tx=await connection.BeginTransactionAsync();
            await using(var own=connection.CreateCommand()){own.CommandText="SELECT count(*) FROM skin_collections WHERE id=$1 AND steam_id=$2";own.Transaction=tx;own.Parameters.AddWithValue(id);own.Parameters.AddWithValue(decimal.Parse(identity.SteamId));if(Convert.ToInt32(await own.ExecuteScalarAsync())==0)return Results.NotFound();}
            // Two statements are intentional: PostgreSQL may evaluate the target row
            // before clearing the old one in a single UPDATE, briefly violating the
            // partial unique index that permits one active collection per player.
            await using(var deactivate=connection.CreateCommand()){deactivate.CommandText="UPDATE skin_collections SET active=false WHERE steam_id=$1 AND active";deactivate.Transaction=tx;deactivate.Parameters.AddWithValue(decimal.Parse(identity.SteamId));await deactivate.ExecuteNonQueryAsync();}
            await using(var activate=connection.CreateCommand()){activate.CommandText="UPDATE skin_collections SET active=true WHERE id=$1 AND steam_id=$2";activate.Transaction=tx;activate.Parameters.AddWithValue(id);activate.Parameters.AddWithValue(decimal.Parse(identity.SteamId));await activate.ExecuteNonQueryAsync();}
            await using(var clear=connection.CreateCommand()){clear.CommandText="DELETE FROM player_weapon_skins WHERE steam_id=$1";clear.Transaction=tx;clear.Parameters.AddWithValue(decimal.Parse(identity.SteamId));await clear.ExecuteNonQueryAsync();}
            await using(var copy=connection.CreateCommand()){copy.CommandText="INSERT INTO player_weapon_skins(steam_id,weapon,team,paint_kit,wear,seed,stat_trak,name_tag,keychain_id,keychain_seed,stickers) SELECT $1,weapon,team,paint_kit,wear,seed,stat_trak,name_tag,keychain_id,keychain_seed,stickers FROM skin_collection_items WHERE collection_id=$2";copy.Transaction=tx;copy.Parameters.AddWithValue(decimal.Parse(identity.SteamId));copy.Parameters.AddWithValue(id);await copy.ExecuteNonQueryAsync();}
            await using(var clear=connection.CreateCommand()){clear.CommandText="DELETE FROM player_gloves WHERE steam_id=$1";clear.Transaction=tx;clear.Parameters.AddWithValue(decimal.Parse(identity.SteamId));await clear.ExecuteNonQueryAsync();}
            await using(var clear=connection.CreateCommand()){clear.CommandText="DELETE FROM player_agents WHERE steam_id=$1";clear.Transaction=tx;clear.Parameters.AddWithValue(decimal.Parse(identity.SteamId));await clear.ExecuteNonQueryAsync();}
            await using(var copy=connection.CreateCommand()){copy.CommandText="INSERT INTO player_gloves(steam_id,team,definition_index,paint_kit,wear,seed) SELECT $1,team,definition_index,paint_kit,wear,seed FROM skin_collection_gloves WHERE collection_id=$2";copy.Transaction=tx;copy.Parameters.AddWithValue(decimal.Parse(identity.SteamId));copy.Parameters.AddWithValue(id);await copy.ExecuteNonQueryAsync();}
            await using(var copy=connection.CreateCommand()){copy.CommandText="INSERT INTO player_agents(steam_id,team,model) SELECT $1,team,model FROM skin_collection_agents WHERE collection_id=$2";copy.Transaction=tx;copy.Parameters.AddWithValue(decimal.Parse(identity.SteamId));copy.Parameters.AddWithValue(id);await copy.ExecuteNonQueryAsync();}
            await tx.CommitAsync(); await Database.Enqueue(db,new CommandInput("refresh_skins",identity.SteamId)); return Results.NoContent();
        });
        app.MapDelete("/api/me/collections/{id:long}", async (HttpContext context, long id, NpgsqlDataSource db) =>
        {
            if (context.Items["identity"] is not RequestIdentity identity) return Results.BadRequest();
            await using var connection = await db.OpenConnectionAsync();
            await using var tx = await connection.BeginTransactionAsync();
            bool isActive = false;
            await using (var check = connection.CreateCommand())
            {
                check.CommandText = "SELECT active FROM skin_collections WHERE id=$1 AND steam_id=$2";
                check.Transaction = tx;
                check.Parameters.AddWithValue(id);
                check.Parameters.AddWithValue(decimal.Parse(identity.SteamId));
                var res = await check.ExecuteScalarAsync();
                if (res == null) return Results.NotFound();
                isActive = (bool)res;
            }
            await using (var delete = connection.CreateCommand())
            {
                delete.CommandText = "DELETE FROM skin_collections WHERE id=$1 AND steam_id=$2";
                delete.Transaction = tx;
                delete.Parameters.AddWithValue(id);
                delete.Parameters.AddWithValue(decimal.Parse(identity.SteamId));
                await delete.ExecuteNonQueryAsync();
            }
            if (isActive)
            {
                long? nextId = null;
                await using (var findNext = connection.CreateCommand())
                {
                    findNext.CommandText = "SELECT id FROM skin_collections WHERE steam_id=$1 ORDER BY created_at DESC LIMIT 1";
                    findNext.Transaction = tx;
                    findNext.Parameters.AddWithValue(decimal.Parse(identity.SteamId));
                    var nextVal = await findNext.ExecuteScalarAsync();
                    if (nextVal != null) nextId = (long)nextVal;
                }
                await using (var clear = connection.CreateCommand())
                {
                    clear.CommandText = "DELETE FROM player_weapon_skins WHERE steam_id=$1";
                    clear.Transaction = tx;
                    clear.Parameters.AddWithValue(decimal.Parse(identity.SteamId));
                    await clear.ExecuteNonQueryAsync();
                }
                await using (var clearCosmetics = connection.CreateCommand())
                {
                    clearCosmetics.CommandText = "DELETE FROM player_gloves WHERE steam_id=$1";
                    clearCosmetics.Transaction = tx; clearCosmetics.Parameters.AddWithValue(decimal.Parse(identity.SteamId)); await clearCosmetics.ExecuteNonQueryAsync();
                }
                await using (var clearAgents = connection.CreateCommand())
                {
                    clearAgents.CommandText = "DELETE FROM player_agents WHERE steam_id=$1";
                    clearAgents.Transaction = tx; clearAgents.Parameters.AddWithValue(decimal.Parse(identity.SteamId)); await clearAgents.ExecuteNonQueryAsync();
                }
                if (nextId.HasValue)
                {
                    await using (var activate = connection.CreateCommand())
                    {
                        activate.CommandText = "UPDATE skin_collections SET active=true WHERE id=$1";
                        activate.Transaction = tx;
                        activate.Parameters.AddWithValue(nextId.Value);
                        await activate.ExecuteNonQueryAsync();
                    }
                    await using (var copy = connection.CreateCommand())
                    {
                        copy.CommandText = "INSERT INTO player_weapon_skins(steam_id,weapon,team,paint_kit,wear,seed,stat_trak,name_tag,keychain_id,keychain_seed,stickers) SELECT $1,weapon,team,paint_kit,wear,seed,stat_trak,name_tag,keychain_id,keychain_seed,stickers FROM skin_collection_items WHERE collection_id=$2";
                        copy.Transaction = tx;
                        copy.Parameters.AddWithValue(decimal.Parse(identity.SteamId));
                        copy.Parameters.AddWithValue(nextId.Value);
                        await copy.ExecuteNonQueryAsync();
                    }
                    await using (var copyCosmetics = connection.CreateCommand())
                    {
                        copyCosmetics.CommandText = "INSERT INTO player_gloves(steam_id,team,definition_index,paint_kit,wear,seed) SELECT $1,team,definition_index,paint_kit,wear,seed FROM skin_collection_gloves WHERE collection_id=$2";
                        copyCosmetics.Transaction = tx; copyCosmetics.Parameters.AddWithValue(decimal.Parse(identity.SteamId)); copyCosmetics.Parameters.AddWithValue(nextId.Value); await copyCosmetics.ExecuteNonQueryAsync();
                    }
                    await using (var copyAgents = connection.CreateCommand())
                    {
                        copyAgents.CommandText = "INSERT INTO player_agents(steam_id,team,model) SELECT $1,team,model FROM skin_collection_agents WHERE collection_id=$2";
                        copyAgents.Transaction = tx; copyAgents.Parameters.AddWithValue(decimal.Parse(identity.SteamId)); copyAgents.Parameters.AddWithValue(nextId.Value); await copyAgents.ExecuteNonQueryAsync();
                    }
                }
            }
            await tx.CommitAsync();
            await Database.Enqueue(db, new CommandInput("refresh_skins", identity.SteamId));
            return Results.NoContent();
        });
        app.MapGet("/api/me/skins", async (HttpContext context, NpgsqlDataSource db) =>
        {
            if (context.Items["identity"] is not RequestIdentity { SteamId: { } steamId }) return Results.BadRequest();
            var skins = new List<SkinInput>();
            await using var command = db.CreateCommand("SELECT weapon, team, paint_kit, wear, seed, stat_trak, name_tag, keychain_id, keychain_seed, stickers FROM player_weapon_skins WHERE steam_id=$1 ORDER BY weapon,team");
            command.Parameters.AddWithValue(decimal.Parse(steamId));
            await using var reader = await command.ExecuteReaderAsync();
            while (await reader.ReadAsync()) skins.Add(ReadSkin(reader));
            return Results.Ok(skins);
        });
        app.MapPut("/api/me/skins/{weapon}", async (HttpContext context, string weapon, SkinInput input, NpgsqlDataSource db) =>
        {
            if (context.Items["identity"] is not RequestIdentity { SteamId: { } steamId }) return Results.BadRequest();
            if (!ValidSkin(weapon, input, weaponTeam…803 tokens truncated…gents/{team}", async (HttpContext context, string team, AgentInput input, NpgsqlDataSource db) =>
        {
            if (context.Items["identity"] is not RequestIdentity identity || !ValidAgent(team, input, agentModels)) return Results.BadRequest();
            await SaveAgent(db, identity.SteamId, team, input.Model);
            await SyncActiveCollectionAgent(db, identity.SteamId, team, input.Model);
            await Database.Enqueue(db, new CommandInput("refresh_skins", identity.SteamId));
            return Results.NoContent();
        });
        app.MapDelete("/api/me/agents/{team}", async (HttpContext context, string team, NpgsqlDataSource db) =>
        {
            if (context.Items["identity"] is not RequestIdentity identity || !ValidTeam(team)) return Results.BadRequest();
            await DeleteCosmetic(db, "player_agents", identity.SteamId, team);
            await DeleteActiveCollectionCosmetic(db, "skin_collection_agents", identity.SteamId, team);
            await Database.Enqueue(db, new CommandInput("refresh_skins", identity.SteamId));
            return Results.NoContent();
        });
        
        app.MapGet("/api/players/{steamId}/cosmetics", async (string steamId, NpgsqlDataSource db) =>
            Results.Ok(await ReadLoadout(db, steamId)));
        app.MapPut("/api/players/{steamId}/gloves/{team}", async (string steamId, string team, GloveInput input, NpgsqlDataSource db) =>
        {
            if (!ValidSteamId(steamId) || !ValidGlove(team, input)) return Results.BadRequest();
            await SaveGlove(db, steamId, team, input); await Database.Enqueue(db, new CommandInput("refresh_skins", steamId)); return Results.NoContent();
        });
        app.MapDelete("/api/players/{steamId}/gloves/{team}", async (string steamId, string team, NpgsqlDataSource db) =>
        {
            if (!ValidSteamId(steamId) || !ValidTeam(team)) return Results.BadRequest();
            await DeleteCosmetic(db, "player_gloves", steamId, team); await Database.Enqueue(db, new CommandInput("refresh_skins", steamId)); return Results.NoContent();
        });
        app.MapPut("/api/players/{steamId}/agents/{team}", async (string steamId, string team, AgentInput input, NpgsqlDataSource db) =>
        {
            if (!ValidSteamId(steamId) || !ValidAgent(team, input, agentModels)) return Results.BadRequest();
            await SaveAgent(db, steamId, team, input.Model); await Database.Enqueue(db, new CommandInput("refresh_skins", steamId)); return Results.NoContent();
        });
        app.MapDelete("/api/players/{steamId}/agents/{team}", async (string steamId, string team, NpgsqlDataSource db) =>
        {
            if (!ValidSteamId(steamId) || !ValidTeam(team)) return Results.BadRequest();
            await DeleteCosmetic(db, "player_agents", steamId, team); await Database.Enqueue(db, new CommandInput("refresh_skins", steamId)); return Results.NoContent();
        });
        
        // Every account the server has ever seen, for the admin skinchanger player picker.
        app.MapGet("/api/players/known", async (NpgsqlDataSource db) =>
        {
            var players = new List<object>();
            await using var command = db.CreateCommand("SELECT steam_id::text,name,last_seen_at,avatar_url,profile_url,faceit_elo,faceit_nickname FROM players ORDER BY last_seen_at DESC LIMIT 500");
            await using var reader = await command.ExecuteReaderAsync();
            while (await reader.ReadAsync()) players.Add(new {
                steamId = reader.GetString(0), name = reader.GetString(1), lastSeenAt = reader.GetFieldValue<DateTimeOffset>(2),
                avatarUrl = reader.IsDBNull(3) ? null : reader.GetString(3), profileUrl = reader.IsDBNull(4) ? null : reader.GetString(4),
                faceitElo = reader.IsDBNull(5) ? (int?)null : reader.GetInt32(5),
                faceitNickname = reader.IsDBNull(6) ? null : reader.GetString(6)
            });
            return Results.Ok(players);
        });
        
        app.MapGet("/api/plugin/players/{steamId}/skins", async (string steamId, NpgsqlDataSource db) =>
        {
            var skins = new List<SkinInput>();
            await using var command = db.CreateCommand("SELECT weapon,team,paint_kit,wear,seed,stat_trak,name_tag,keychain_id,keychain_seed,stickers FROM player_weapon_skins WHERE steam_id=$1");
            command.Parameters.AddWithValue(decimal.Parse(steamId));
            await using var reader = await command.ExecuteReaderAsync();
            while (await reader.ReadAsync()) skins.Add(ReadSkin(reader));
            return Results.Ok(skins);
        });
        app.MapGet("/api/plugin/players/{steamId}/loadout", async (string steamId, NpgsqlDataSource db) =>
            ValidSteamId(steamId) ? Results.Ok(await ReadLoadout(db, steamId)) : Results.BadRequest());
        
        static bool IsKnifeWeapon(string weapon) =>
            weapon.Equals("weapon_bayonet", StringComparison.OrdinalIgnoreCase)
            || weapon.StartsWith("weapon_knife_", StringComparison.OrdinalIgnoreCase);
        
        static IReadOnlyList<string> TeamTargets(string team) =>
            team == "both" ? ["t", "ct"] : [team];
        
        static async Task SaveWeaponSkin(
            NpgsqlDataSource db,
            string steamId,
            string weapon,
            SkinInput input,
            bool syncActiveCollection)
        {
            await using var connection = await db.OpenConnectionAsync();
            await using var tx = await connection.BeginTransactionAsync();
            var owner = decimal.Parse(steamId);
        
            // Remove legacy fallback rows left by an older process before writing exact slots.
            await using (var legacy = connection.CreateCommand())
            {
                legacy.Transaction = tx;
                legacy.CommandText = "DELETE FROM player_weapon_skins WHERE steam_id=$1 AND weapon=$2 AND team='both'";
                legacy.Parameters.AddWithValue(owner);
                legacy.Parameters.AddWithValue(weapon);
                await legacy.ExecuteNonQueryAsync();
            }
        
            foreach (var team in TeamTargets(input.Team))
            {
                if (IsKnifeWeapon(weapon))
                {
                    await using var clearKnives = connection.CreateCommand();
                    clearKnives.Transaction = tx;
                    clearKnives.CommandText = "DELETE FROM player_weapon_skins WHERE steam_id=$1 AND team=$2 AND weapon<>$3 AND (weapon LIKE 'weapon_knife_%' OR weapon='weapon_bayonet')";
                    clearKnives.Parameters.AddWithValue(owner);
                    clearKnives.Parameters.AddWithValue(team);
                    clearKnives.Parameters.AddWithValue(weapon);
                    await clearKnives.ExecuteNonQueryAsync();
                }
        
                await using var command = connection.CreateCommand();
                command.Transaction = tx;
                command.CommandText = """
                    INSERT INTO player_weapon_skins(steam_id,weapon,team,paint_kit,wear,seed,stat_trak,name_tag,keychain_id,keychain_seed,stickers)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
                    ON CONFLICT (steam_id,weapon,team) DO UPDATE SET paint_kit=EXCLUDED.paint_kit,wear=EXCLUDED.wear,seed=EXCLUDED.seed,stat_trak=EXCLUDED.stat_trak,name_tag=EXCLUDED.name_tag,keychain_id=EXCLUDED.keychain_id,keychain_seed=EXCLUDED.keychain_seed,stickers=EXCLUDED.stickers,updated_at=now()
                    """;
                command.Parameters.AddWithValue(owner); command.Parameters.AddWithValue(weapon); command.Parameters.AddWithValue(team);
                command.Parameters.AddWithValue(input.PaintKit); command.Parameters.AddWithValue(input.Wear); command.Parameters.AddWithValue(input.Seed);
                command.Parameters.AddWithValue(input.StatTrak); command.Parameters.AddWithValue(NameTagValue(input.NameTag));
                command.Parameters.AddWithValue(KeychainValue(input.KeychainId)); command.Parameters.AddWithValue(input.KeychainSeed);
                command.Parameters.AddWithValue(SkinJson.SerializeStickers(input.Stickers));
                await command.ExecuteNonQueryAsync();
        
                if (!syncActiveCollection) continue;
                if (IsKnifeWeapon(weapon))
                {
                    await using var clearCollectionKnives = connection.CreateCommand();
                    clearCollectionKnives.Transaction = tx;
                    clearCollectionKnives.CommandText = "DELETE FROM skin_collection_items WHERE team=$2 AND weapon<>$3 AND (weapon LIKE 'weapon_knife_%' OR weapon='weapon_bayonet') AND collection_id IN(SELECT id FROM skin_collections WHERE steam_id=$1 AND active)";
                    clearCollectionKnives.Parameters.AddWithValue(owner); clearCollectionKnives.Parameters.AddWithValue(team); clearCollectionKnives.Parameters.AddWithValue(weapon);
                    await clearCollectionKnives.ExecuteNonQueryAsync();
                }
                await using var collection = connection.CreateCommand();
                collection.Transaction = tx;
                collection.CommandText = """
                    INSERT INTO skin_collection_items(collection_id,weapon,team,paint_kit,wear,seed,stat_trak,name_tag,keychain_id,keychain_seed,stickers)
                    SELECT id,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb FROM skin_collections WHERE steam_id=$1 AND active
                    ON CONFLICT(collection_id,weapon,team) DO UPDATE SET paint_kit=EXCLUDED.paint_kit,wear=EXCLUDED.wear,seed=EXCLUDED.seed,stat_trak=EXCLUDED.stat_trak,name_tag=EXCLUDED.name_tag,keychain_id=EXCLUDED.keychain_id,keychain_seed=EXCLUDED.keychain_seed,stickers=EXCLUDED.stickers
                    """;
                collection.Parameters.AddWithValue(owner); collection.Parameters.AddWithValue(weapon); collection.Parameters.AddWithValue(team);
                collection.Parameters.AddWithValue(input.PaintKit); collection.Parameters.AddWithValue(input.Wear); collection.Parameters.AddWithValue(input.Seed);
                collection.Parameters.AddWithValue(input.StatTrak); collection.Parameters.AddWithValue(NameTagValue(input.NameTag));
                collection.Parameters.AddWithValue(KeychainValue(input.KeychainId)); collection.Parameters.AddWithValue(input.KeychainSeed);
                collection.Parameters.AddWithValue(SkinJson.SerializeStickers(input.Stickers));
                await collection.ExecuteNonQueryAsync();
            }
            await tx.CommitAsync();
        }
        
        static bool ValidSteamId(string value) => Regex.IsMatch(value, "^[0-9]{17}$");
        static bool ValidTeam(string value) => value is "ct" or "t";
        static bool ValidTeamScope(string value) => value is "both" or "ct" or "t";
        static bool ValidSkin(string weapon, SkinInput value, IReadOnlyDictionary<string, string> weaponTeams)
        {
            if (!string.Equals(weapon, value.Weapon, StringComparison.OrdinalIgnoreCase)
                || value.PaintKit <= 0 || !float.IsFinite(value.Wear) || value.Wear is < 0 or > 1
                || value.Seed is < 0 or > 1000 || !ValidTeamScope(value.Team)
                || (value.NameTag is not null && value.NameTag.Length > 20)
                || (value.KeychainId is not null && value.KeychainId <= 0)
                || value.KeychainSeed is < 0 or > 100000
                || !ValidStickers(value.Stickers)
                || !weaponTeams.TryGetValue(weapon, out var availableTo)) return false;
            return availableTo == "both" || availableTo == value.Team;
        }
        static bool ValidStickers(IReadOnlyList<StickerInput>? stickers)
        {
            if (stickers is null) return true;
            if (stickers.Count > 5) return false;
            var slots = new HashSet<int>();
            foreach (var s in stickers)
            {
                if (s.Slot is < 0 or > 4 || !slots.Add(s.Slot) || s.StickerId <= 0
                    || !float.IsFinite(s.Wear) || s.Wear is < 0 or > 1
                    || !float.IsFinite(s.Scale) || s.Scale is <= 0 or > 5
                    || !float.IsFinite(s.Rotation) || s.Rotation is < -360 or > 360
                    || !float.IsFinite(s.OffsetX) || s.OffsetX is < -1 or > 1
                    || !float.IsFinite(s.OffsetY) || s.OffsetY is < -1 or > 1) return false;
            }
            return true;
        }
        // A nullable keychain id becomes SQL NULL; the jsonb sticker payload is written via ::jsonb cast.
        static object KeychainValue(int? keychainId) => keychainId is null ? DBNull.Value : keychainId.Value;
        
        // Empty name tags are stored as SQL NULL so the game plugin never applies a blank label.
        static object NameTagValue(string? nameTag) =>
            string.IsNullOrWhiteSpace(nameTag) ? DBNull.Value : nameTag.Trim();
        
        // Every full skin row selects weapon,team,paint_kit,wear,seed,stat_trak,name_tag,keychain_id,keychain_seed,stickers in that order.
        static SkinInput ReadSkin(NpgsqlDataReader reader) => new(
            reader.GetString(0), reader.GetString(1), reader.GetInt32(2), reader.GetFloat(3), reader.GetInt32(4),
            reader.GetBoolean(5), reader.IsDBNull(6) ? null : reader.GetString(6),
            SkinJson.ParseStickers(reader.IsDBNull(9) ? null : reader.GetString(9)),
            reader.IsDBNull(7) ? null : reader.GetInt32(7), reader.GetInt32(8));
        static bool ValidGlove(string team, GloveInput value) => ValidTeam(team) && value.Team == team
            && value.DefinitionIndex is 4725 or 5027 or 5030 or 5031 or 5032 or 5033 or 5034 or 5035 && value.PaintKit > 0
            && float.IsFinite(value.Wear) && value.Wear is >= 0 and <= 1 && value.Seed is >= 0 and <= 1000;
        static bool ValidAgent(string team, AgentInput value, IReadOnlySet<string> allowedModels) =>
            ValidTeam(team) && value.Team == team && allowedModels.Contains(value.Model);
        
        static async Task<PlayerLoadout> ReadLoadout(NpgsqlDataSource db, string steamId)
        {
            var skins = new List<SkinInput>(); var gloves = new List<GloveInput>(); var agents = new List<AgentInput>();
            await using (var command = db.CreateCommand("SELECT weapon,team,paint_kit,wear,seed,stat_trak,name_tag,keychain_id,keychain_seed,stickers FROM player_weapon_skins WHERE steam_id=$1 ORDER BY weapon,team"))
            { command.Parameters.AddWithValue(decimal.Parse(steamId)); await using var reader = await command.ExecuteReaderAsync(); while (await reader.ReadAsync()) skins.Add(ReadSkin(reader)); }
            await using (var command = db.CreateCommand("SELECT team,definition_index,paint_kit,wear,seed FROM player_gloves WHERE steam_id=$1 ORDER BY team"))
            { command.Parameters.AddWithValue(decimal.Parse(steamId)); await using var reader = await command.ExecuteReaderAsync(); while (await reader.ReadAsync()) gloves.Add(new(reader.GetString(0),reader.GetInt32(1),reader.GetInt32(2),reader.GetFloat(3),reader.GetInt32(4))); }
            await using (var command = db.CreateCommand("SELECT team,model FROM player_agents WHERE steam_id=$1 ORDER BY team"))
            { command.Parameters.AddWithValue(decimal.Parse(steamId)); await using var reader = await command.ExecuteReaderAsync(); while (await reader.ReadAsync()) agents.Add(new(reader.GetString(0),reader.GetString(1))); }
            return new(skins, gloves, agents);
        }
        static async Task SaveGlove(NpgsqlDataSource db, string steamId, string team, GloveInput value)
        {
            await using var command = db.CreateCommand("INSERT INTO player_gloves(steam_id,team,definition_index,paint_kit,wear,seed) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(steam_id,team) DO UPDATE SET definition_index=EXCLUDED.definition_index,paint_kit=EXCLUDED.paint_kit,wear=EXCLUDED.wear,seed=EXCLUDED.seed,updated_at=now()");
            command.Parameters.AddWithValue(decimal.Parse(steamId)); command.Parameters.AddWithValue(team); command.Parameters.AddWithValue(value.DefinitionIndex); command.Parameters.AddWithValue(value.PaintKit); command.Parameters.AddWithValue(value.Wear); command.Parameters.AddWithValue(value.Seed); await command.ExecuteNonQueryAsync();
        }
        static async Task SaveAgent(NpgsqlDataSource db, string steamId, string team, string model)
        {
            await using var command = db.CreateCommand("INSERT INTO player_agents(steam_id,team,model) VALUES($1,$2,$3) ON CONFLICT(steam_id,team) DO UPDATE SET model=EXCLUDED.model,updated_at=now()");
            command.Parameters.AddWithValue(decimal.Parse(steamId)); command.Parameters.AddWithValue(team); command.Parameters.AddWithValue(model); await command.ExecuteNonQueryAsync();
        }
        static async Task DeleteCosmetic(NpgsqlDataSource db, string table, string steamId, string team)
        {
            var sql = table == "player_gloves" ? "DELETE FROM player_gloves WHERE steam_id=$1 AND team=$2" : "DELETE FROM player_agents WHERE steam_id=$1 AND team=$2";
            await using var command = db.CreateCommand(sql); command.Parameters.AddWithValue(decimal.Parse(steamId)); command.Parameters.AddWithValue(team); await command.ExecuteNonQueryAsync();
        }
        static async Task SyncActiveCollectionGlove(NpgsqlDataSource db, string steamId, string team, GloveInput value)
        {
            await using var command=db.CreateCommand("INSERT INTO skin_collection_gloves(collection_id,team,definition_index,paint_kit,wear,seed) SELECT id,$2,$3,$4,$5,$6 FROM skin_collections WHERE steam_id=$1 AND active ON CONFLICT(collection_id,team) DO UPDATE SET definition_index=EXCLUDED.definition_index,paint_kit=EXCLUDED.paint_kit,wear=EXCLUDED.wear,seed=EXCLUDED.seed");
            command.Parameters.AddWithValue(decimal.Parse(steamId));command.Parameters.AddWithValue(team);command.Parameters.AddWithValue(value.DefinitionIndex);command.Parameters.AddWithValue(value.PaintKit);command.Parameters.AddWithValue(value.Wear);command.Parameters.AddWithValue(value.Seed);await command.ExecuteNonQueryAsync();
        }
        static async Task SyncActiveCollectionAgent(NpgsqlDataSource db, string steamId, string team, string model)
        {
            await using var command=db.CreateCommand("INSERT INTO skin_collection_agents(collection_id,team,model) SELECT id,$2,$3 FROM skin_collections WHERE steam_id=$1 AND active ON CONFLICT(collection_id,team) DO UPDATE SET model=EXCLUDED.model");
            command.Parameters.AddWithValue(decimal.Parse(steamId));command.Parameters.AddWithValue(team);command.Parameters.AddWithValue(model);await command.ExecuteNonQueryAsync();
        }
        static async Task DeleteActiveCollectionCosmetic(NpgsqlDataSource db, string table, string steamId, string team)
        {
            var sql=table=="skin_collection_gloves" ? "DELETE FROM skin_collection_gloves WHERE team=$2 AND collection_id IN(SELECT id FROM skin_collections WHERE steam_id=$1 AND active)" : "DELETE FROM skin_collection_agents WHERE team=$2 AND collection_id IN(SELECT id FROM skin_collections WHERE steam_id=$1 AND active)";
            await using var command=db.CreateCommand(sql);command.Parameters.AddWithValue(decimal.Parse(steamId));command.Parameters.AddWithValue(team);await command.ExecuteNonQueryAsync();
        }
        
    }
}
