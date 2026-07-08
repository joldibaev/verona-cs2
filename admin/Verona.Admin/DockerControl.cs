using System.Net.Sockets;
using System.Net;
using System.Text.Json;

namespace Verona.Admin;

public sealed class DockerControl : IDisposable
{
    // Never accept this name from HTTP input. Docker socket access is effectively
    // host-level authority, so the adapter exposes operations for one fixed container.
    private const string ContainerName = "verona-cs2-server";
    private readonly HttpClient _client;

    public DockerControl()
    {
        var handler = new SocketsHttpHandler
        {
            ConnectCallback = async (_, cancellationToken) =>
            {
                // Docker Engine speaks HTTP over a Unix socket; replacing only the
                // transport lets the rest of this adapter use ordinary HttpClient.
                var socket = new Socket(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified);
                await socket.ConnectAsync(new UnixDomainSocketEndPoint("/var/run/docker.sock"), cancellationToken);
                return new NetworkStream(socket, ownsSocket: true);
            }
        };
        _client = new HttpClient(handler) { BaseAddress = new Uri("http://docker") };
    }

    public async Task<ContainerStatus> GetStatus(CancellationToken cancellationToken)
    {
        try
        {
            using var response = await _client.GetAsync($"/containers/{ContainerName}/json", cancellationToken);
            if (!response.IsSuccessStatusCode) return new(false, "missing", false);
            using var json = JsonDocument.Parse(await response.Content.ReadAsStreamAsync(cancellationToken));
            var state = json.RootElement.GetProperty("State");
            return new(true, state.GetProperty("Status").GetString() ?? "unknown",
                state.GetProperty("Running").GetBoolean(), state.GetProperty("StartedAt").GetString());
        }
        catch (Exception exception)
        {
            return new(false, "docker-unavailable", false, Error: exception.Message);
        }
    }


    public Task<HttpResponseMessage> Start(CancellationToken ct) => Post($"/containers/{ContainerName}/start", ct);
    public Task<HttpResponseMessage> Stop(CancellationToken ct) => Post($"/containers/{ContainerName}/stop?t=20", ct);

    public async Task<IReadOnlyList<string>> GetLogs(int tail, DateTimeOffset? since, CancellationToken ct)
    {
        try
        {
            using var response = await _client.GetAsync(
                $"/containers/{ContainerName}/logs?stdout=1&stderr=1&timestamps=1&tail={Math.Clamp(tail, 20, 500)}{(since is null ? "" : $"&since={since.Value.ToUnixTimeSeconds()}")}", ct);
            if (!response.IsSuccessStatusCode) return [];
            var bytes = await response.Content.ReadAsByteArrayAsync(ct);
            return DecodeDockerLog(bytes).TakeLast(tail).ToArray();
        }
        catch { return []; }
    }

    private static IEnumerable<string> DecodeDockerLog(byte[] bytes)
    {
        // Docker multiplexes non-TTY stdout/stderr with an eight-byte frame header.
        var offset = 0;
        while (offset + 8 <= bytes.Length && bytes[offset] is 1 or 2)
        {
            var length = IPAddress.NetworkToHostOrder(BitConverter.ToInt32(bytes, offset + 4));
            offset += 8;
            if (length < 0 || offset + length > bytes.Length) yield break;
            foreach (var line in System.Text.Encoding.UTF8.GetString(bytes, offset, length)
                         .Split('\n', StringSplitOptions.RemoveEmptyEntries))
                yield return line.TrimEnd('\r');
            offset += length;
        }
        if (offset == 0)
            foreach (var line in System.Text.Encoding.UTF8.GetString(bytes)
                         .Split('\n', StringSplitOptions.RemoveEmptyEntries))
                yield return line.TrimEnd('\r');
    }
    public async Task Restart(CancellationToken ct)
    {
        using var response = await Post($"/containers/{ContainerName}/restart?t=20", ct);
        response.EnsureSuccessStatusCode();
    }

    private async Task<HttpResponseMessage> Post(string path, CancellationToken ct)
    {
        var response = await _client.PostAsync(path, content: null, ct);
        if (!response.IsSuccessStatusCode && response.StatusCode != System.Net.HttpStatusCode.NotModified)
            response.EnsureSuccessStatusCode();
        return response;
    }

    public void Dispose() => _client.Dispose();
}
