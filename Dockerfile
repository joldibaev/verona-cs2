# CounterStrikeSharp 1.0.370 targets net10.0. The SDK stays in this build stage;
# the final image receives the runtime from CounterStrikeSharp's release archive.
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS plugin-build
WORKDIR /src
COPY src/ServerCore/ServerCore.csproj src/ServerCore/
RUN dotnet restore src/ServerCore/ServerCore.csproj
COPY src/ServerCore/ src/ServerCore/
RUN dotnet publish src/ServerCore/ServerCore.csproj -c Release -o /out --no-restore

FROM ubuntu:24.04

ARG COUNTERSTRIKESHARP_VERSION=1.0.370
ARG METAMOD_VERSION=2.0.0-git1402

ENV DEBIAN_FRONTEND=noninteractive \
    COUNTERSTRIKESHARP_VERSION=${COUNTERSTRIKESHARP_VERSION} \
    METAMOD_VERSION=${METAMOD_VERSION} \
    DOTNET_CLI_TELEMETRY_OPTOUT=1

# SteamCMD still needs 32-bit runtime libraries even though the CS2 server is 64-bit.
RUN dpkg --add-architecture i386 && apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl tar unzip lib32gcc-s1 lib32stdc++6 libc6-i386 libicu74 tini gosu \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --shell /bin/bash steam \
    && mkdir -p /opt/steamcmd /opt/verona /opt/verona-gamedata /server /config \
    && curl -fsSL https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz \
      | tar -xz -C /opt/steamcmd

COPY --from=plugin-build /out/ /opt/verona/
COPY gamedata/verona.json /opt/verona-gamedata/verona.json
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh \
    && chown -R steam:steam /opt/steamcmd /opt/verona /opt/verona-gamedata /server /config

WORKDIR /server
EXPOSE 27015/tcp 27015/udp
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
