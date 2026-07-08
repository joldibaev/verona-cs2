using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Verona.Admin;

namespace Verona.Admin.Persistence.Migrations;

[DbContext(typeof(VeronaDbContext))]
[Migration("202607080001_InitialSchema")]
public sealed class InitialSchema : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder) =>
        migrationBuilder.Sql(Database.InitialSchemaSql);

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        // Verona data is intentionally never dropped automatically. A destructive
        // rollback requires an explicit operator-approved backup and SQL migration.
    }
}
