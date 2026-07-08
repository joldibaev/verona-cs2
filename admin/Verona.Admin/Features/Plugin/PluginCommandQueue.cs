using Npgsql;

namespace Verona.Admin.Features.Plugin;

public sealed class PluginCommandQueue(NpgsqlDataSource db)
{
    public async Task<IReadOnlyList<ServerCommand>> Claim(CancellationToken ct)
    {
        var result = new List<ServerCommand>();
        // Claims are leases, not delivery receipts. SKIP LOCKED permits overlapping
        // polls without allowing two plugin workers to own the same command.
        await using var command = db.CreateCommand("""
            WITH ready AS (
                SELECT id FROM server_commands
                WHERE completed_at IS NULL AND failed_at IS NULL
                  AND next_attempt_at <= now()
                  AND (claimed_at IS NULL OR claimed_at < now() - interval '15 seconds')
                ORDER BY id LIMIT 50 FOR UPDATE SKIP LOCKED
            )
            UPDATE server_commands c
            SET claim_token=gen_random_uuid(), claimed_at=now(), attempt_count=attempt_count+1
            FROM ready WHERE c.id=ready.id
            RETURNING c.id,c.claim_token::text,c.attempt_count,c.type,c.steam_id::text,c.value,c.reason
            """);
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
            result.Add(new(reader.GetInt64(0), reader.GetString(1), reader.GetInt32(2), reader.GetString(3),
                reader.IsDBNull(4) ? null : reader.GetString(4), reader.IsDBNull(5) ? null : reader.GetString(5),
                reader.IsDBNull(6) ? null : reader.GetString(6)));
        return result;
    }

    public async Task Acknowledge(IEnumerable<CommandAck> acknowledgements, CancellationToken ct)
    {
        foreach (var ack in acknowledgements.Take(50))
        {
            if (!Guid.TryParse(ack.ClaimToken, out var claimToken)) continue;
            await using var command = db.CreateCommand(ack.Success ? """
                UPDATE server_commands
                SET completed_at=now(), claim_token=NULL, claimed_at=NULL, last_error=NULL
                WHERE id=$1 AND claim_token=$2 AND completed_at IS NULL AND failed_at IS NULL
                """ : """
                UPDATE server_commands
                SET failed_at=CASE WHEN attempt_count>=5 THEN now() ELSE NULL END,
                    next_attempt_at=CASE WHEN attempt_count>=5 THEN next_attempt_at
                        ELSE now() + make_interval(secs => LEAST(30, power(2, attempt_count)::int)) END,
                    claim_token=NULL, claimed_at=NULL, last_error=left($3,500)
                WHERE id=$1 AND claim_token=$2 AND completed_at IS NULL AND failed_at IS NULL
                """);
            command.Parameters.AddWithValue(ack.Id);
            command.Parameters.AddWithValue(claimToken);
            if (!ack.Success) command.Parameters.AddWithValue(ack.Error ?? "Plugin execution failed");
            await command.ExecuteNonQueryAsync(ct);
        }
    }
}
