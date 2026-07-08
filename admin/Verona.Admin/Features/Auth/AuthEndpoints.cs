using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using Verona.Admin.Persistence;

namespace Verona.Admin.Features.Auth;

public static class AuthEndpoints
{
    private const string SessionCookie = "verona_cs2_session";
    private static readonly CookieOptions CookieOptions = new()
    {
        HttpOnly = true,
        SameSite = SameSiteMode.Strict,
        Secure = false,
        MaxAge = TimeSpan.FromHours(12)
    };

    public static void UseVeronaAuthorization(this WebApplication app, string pluginKey)
    {
        app.Use(async (context, next) =>
        {
            var path = context.Request.Path;
            if (path.StartsWithSegments("/api/plugin"))
            {
                var supplied = SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(
                    context.Request.Headers["X-Verona-Key"].ToString()));
                var expected = SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(pluginKey));
                if (!CryptographicOperations.FixedTimeEquals(supplied, expected))
                {
                    context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                    return;
                }
            }
            else if ((path.StartsWithSegments("/api") && !path.StartsWithSegments("/api/auth"))
                     || path.StartsWithSegments("/hub"))
            {
                var sessions = context.RequestServices.GetRequiredService<SessionStore>();
                var session = sessions.Get(context.Request.Cookies[SessionCookie]);
                var identity = session is null ? null : await Database.GetIdentity(
                    context.RequestServices.GetRequiredService<IDbContextFactory<VeronaDbContext>>(), session.SteamId);
                if (identity is null)
                {
                    context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                    return;
                }
                if (!identity.IsAdmin && !path.StartsWithSegments("/api/me"))
                {
                    context.Response.StatusCode = StatusCodes.Status403Forbidden;
                    return;
                }
                context.Items["identity"] = identity;
            }
            await next();
        });
    }

    public static void MapAuthEndpoints(this WebApplication app)
    {
        app.MapPost("/api/auth/logout", (SessionStore sessions, HttpRequest request, HttpResponse response) =>
        {
            sessions.Remove(request.Cookies[SessionCookie]);
            response.Cookies.Delete(SessionCookie);
            return Results.Ok();
        });
        app.MapGet("/api/auth/me", async (HttpRequest request, SessionStore sessions,
            IDbContextFactory<VeronaDbContext> contexts) =>
        {
            var session = sessions.Get(request.Cookies[SessionCookie]);
            var identity = session is null ? null : await Database.GetIdentity(contexts, session.SteamId);
            return identity is null ? Results.Unauthorized() : Results.Ok(new
            {
                authenticated = true, isAdmin = identity.IsAdmin, steamId = identity.SteamId,
                identity.Name, identity.Role, identity.AvatarUrl, identity.FaceitElo, identity.FaceitNickname
            });
        });
        app.MapGet("/api/auth/steam", (HttpRequest request) =>
        {
            var publicUrl = app.Configuration["PublicUrl"]?.TrimEnd('/');
            var host = !string.IsNullOrEmpty(publicUrl) ? publicUrl : $"{request.Scheme}://{request.Host}";
            var query = QueryString.Create(new Dictionary<string, string?>
            {
                ["openid.ns"] = "http://specs.openid.net/auth/2.0",
                ["openid.mode"] = "checkid_setup",
                ["openid.return_to"] = $"{host}/api/auth/steam/return",
                ["openid.realm"] = host,
                ["openid.identity"] = "http://specs.openid.net/auth/2.0/identifier_select",
                ["openid.claimed_id"] = "http://specs.openid.net/auth/2.0/identifier_select"
            });
            return Results.Redirect("https://steamcommunity.com/openid/login" + query);
        });
        app.MapGet("/api/auth/steam/return", async (HttpRequest request, HttpResponse response,
            SessionStore sessions, IHttpClientFactory httpFactory, PlayerProfileService profiles, CancellationToken ct) =>
        {
            var form = request.Query.Where(pair => pair.Key.StartsWith("openid."))
                .ToDictionary(pair => pair.Key, pair => pair.Value.ToString());
            form["openid.mode"] = "check_authentication";
            using var verify = await httpFactory.CreateClient().PostAsync(
                "https://steamcommunity.com/openid/login", new FormUrlEncodedContent(form), ct);
            var verdict = await verify.Content.ReadAsStringAsync(ct);
            var claimed = System.Text.RegularExpressions.Regex.Match(
                request.Query["openid.claimed_id"].ToString(), @"^https://steamcommunity\.com/openid/id/(\d{17})$");
            if (!verdict.Contains("is_valid:true") || !claimed.Success) return Results.Unauthorized();
            var steamId = claimed.Groups[1].Value;
            await profiles.Refresh(steamId, ct);
            response.Cookies.Append(SessionCookie, sessions.Create(new SessionIdentity(steamId)), CookieOptions);
            return Results.Redirect("/skinchanger");
        });
    }
}
