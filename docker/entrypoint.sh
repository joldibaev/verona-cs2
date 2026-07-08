#!/usr/bin/env bash
set -Eeuo pipefail

server_dir=/server
game_dir="$server_dir/game/csgo"
steamcmd=/opt/steamcmd/steamcmd.sh

if [[ "$(id -u)" == "0" ]]; then
  # Docker creates fresh named-volume mount points as root. Fix only those entry
  # points, then drop privileges; recursively chowning the 60+ GB install is avoided.
  # logs is a separate bind mount and may also be created as root on a fresh host.
  chown steam:steam "$server_dir"
  [[ -d "$game_dir/logs" ]] && chown steam:steam "$game_dir/logs"
  exec gosu steam "$0" "$@"
fi

log() { printf '[verona] %s\n' "$*"; }

install_cs2() {
  # App 730 is updated on every start so the server can join current CS2 clients.
  # Plugin platforms remain pinned separately because their ABI needs validation.
  local update_args=(+force_install_dir "$server_dir" +login anonymous +app_update 730)
  if [[ "${STEAMCMD_VALIDATE:-0}" == "1" ]]; then
    update_args+=(validate)
  fi
  update_args+=(+quit)
  log "Installing/updating CS2 through SteamCMD. The first download is large."
  "$steamcmd" "${update_args[@]}"
}

install_metamod() {
  # Markers make platform extraction idempotent while still allowing an explicit
  # version change in Compose to trigger a reinstall.
  local marker="$game_dir/addons/.metamod-${METAMOD_VERSION}"
  if [[ ! -f "$marker" ]]; then
    log "Installing Metamod:Source ${METAMOD_VERSION}"
    local build="${METAMOD_VERSION##*git}"
    local version="${METAMOD_VERSION%-git*}"
    local archive="/tmp/metamod.tar.gz"
    # Metamod 2.x dev builds are distributed from mms.alliedmods.net, not GitHub releases.
    # The branch directory is derived from the version prefix (e.g. 2.0.0 -> 2.0).
    local branch="${version%.*}"
    curl -fsSL "https://mms.alliedmods.net/mmsdrop/${branch}/mmsource-${version}-git${build}-linux.tar.gz" -o "$archive"
    tar -xzf "$archive" -C "$game_dir"
    rm -f "$archive"
    rm -f "$game_dir/addons"/.metamod-*
    touch "$marker"
  fi


  # Steam updates may replace gameinfo.gi, so verify this on every start.
  if ! grep -q 'Game[[:space:]]\+csgo/addons/metamod' "$game_dir/gameinfo.gi"; then
    sed -i '/Game_LowViolence[[:space:]]\+csgo_lv/a\            Game    csgo/addons/metamod' "$game_dir/gameinfo.gi"
  fi
}

install_counterstrikesharp() {
  local marker="$game_dir/addons/.counterstrikesharp-${COUNTERSTRIKESHARP_VERSION}"
  [[ -f "$marker" ]] && return

  log "Installing CounterStrikeSharp ${COUNTERSTRIKESHARP_VERSION} with runtime"
  local archive="/tmp/counterstrikesharp.zip"
  curl -fsSL "https://github.com/roflmuffin/CounterStrikeSharp/releases/download/v${COUNTERSTRIKESHARP_VERSION}/counterstrikesharp-with-runtime-linux-${COUNTERSTRIKESHARP_VERSION}.zip" -o "$archive"
  unzip -q -o "$archive" -d "$game_dir"
  rm -f "$archive"
  rm -f "$game_dir/addons"/.counterstrikesharp-*
  touch "$marker"
}

install_plugin() {
  local target="$game_dir/addons/counterstrikesharp/plugins/Verona"
  local gamedata_target="$game_dir/addons/counterstrikesharp/gamedata"
  mkdir -p "$target" "$gamedata_target" "$game_dir/addons/counterstrikesharp/configs" "$game_dir/logs"
  cp -a /opt/verona/. "$target/"
  # This signature exposes the engine function used to update economy attributes.
  # Merely writing fallback schema fields is not reliable across current CS2 builds.
  # We copy as both verona.json and weaponpaints.json to support various plugin lookup methods.
  cp /opt/verona-gamedata/verona.json "$gamedata_target/verona.json"
  cp /opt/verona-gamedata/verona.json "$gamedata_target/weaponpaints.json"
  # CounterStrikeSharp guards cosmetic entity changes by default. Disabling the
  # guard is required for the private skinchanger workflow.
  # We supply a complete core.json configuration so CSSharp doesn't overwrite it.
  cat > "$game_dir/addons/counterstrikesharp/configs/core.json" <<'JSON'
{
  "FollowCS2ServerGuidelines": false,
  "AutoUpdateEnabled": false,
  "AutoUpdateSignatures": false,
  "PluginLoggingEnabled": true,
  "LogLevel": "Information",
  "PublicChatTrigger": [
    "!"
  ],
  "SilentChatTrigger": [
    "/"
  ]
}
JSON
}

write_server_config() {
  mkdir -p "$game_dir/cfg"
  cat > "$game_dir/cfg/verona.cfg" <<CFG
hostname "${SERVER_HOSTNAME:-Verona CS2}"
sv_password "${SERVER_PASSWORD:-}"
rcon_password "${RCON_PASSWORD:-change-me}"
sv_lan 0
sv_hibernate_when_empty ${HIBERNATE_WHEN_EMPTY:-0}
log on
CFG

  local cfg="$game_dir/cfg/verona.cfg"
  if [[ "${BOTS_ENABLED:-0}" == "0" ]]; then
    printf 'bot_quota 0\nbot_kick\n' >> "$cfg"
  else
    cat >> "$cfg" <<CFG
bot_quota ${BOT_QUOTA:-5}
bot_quota_mode fill
bot_difficulty ${BOT_DIFFICULTY:-1}
CFG
  fi

  # Only pin friendly fire when the panel chose it; otherwise mode defaults apply.
  [[ -n "${FRIENDLY_FIRE:-}" ]] && printf 'mp_friendlyfire %s\n' "$FRIENDLY_FIRE" >> "$cfg"

  case "${MATCH_PRESET:-competitive}" in
    competitive)
      cat >> "$cfg" <<'CFG'
mp_freezetime 10
mp_warmuptime 0
mp_autoteambalance 0
mp_limitteams 0
mp_restartgame 1
CFG
      ;;
    wingman)
      cat >> "$cfg" <<'CFG'
mp_freezetime 5
mp_warmuptime 0
mp_autoteambalance 0
mp_limitteams 0
mp_restartgame 1
CFG
      ;;
    duel)
      cat >> "$cfg" <<'CFG'
mp_freezetime 3
mp_warmuptime 0
mp_autoteambalance 0
mp_limitteams 0
mp_restartgame 1
CFG
      ;;
    grenades)
      cat >> "$cfg" <<'CFG'
sv_cheats 1
mp_freezetime 0
mp_warmuptime 0
mp_roundtime 60
mp_roundtime_defuse 60
mp_roundtime_hostage 60
mp_autoteambalance 0
mp_limitteams 0
mp_respawn_on_death_ct 1
mp_respawn_on_death_t 1
mp_death_drop_gun 0
mp_buytime 9999
mp_buy_anywhere 1
mp_maxmoney 60000
mp_startmoney 60000
ammo_grenade_limit_total 5
sv_showimpacts 1
sv_grenade_trajectory_prediction 1
sv_infinite_ammo 1
mp_restartgame 1
CFG
      ;;
    custom)
      cat >> "$cfg" <<CFG
sv_cheats ${CUSTOM_CHEATS:-0}
mp_roundtime ${CUSTOM_ROUNDTIME:-2}
mp_roundtime_defuse ${CUSTOM_ROUNDTIME:-2}
mp_roundtime_hostage ${CUSTOM_ROUNDTIME:-2}
mp_freezetime ${CUSTOM_FREEZETIME:-10}
mp_warmuptime ${CUSTOM_WARMUPTIME:-0}
mp_buytime ${CUSTOM_BUYTIME:-90}
mp_startmoney ${CUSTOM_STARTMONEY:-800}
mp_maxmoney ${CUSTOM_MAXMONEY:-16000}
mp_buy_anywhere ${CUSTOM_BUY_ANYWHERE:-0}
mp_autoteambalance ${CUSTOM_AUTOBALANCE:-0}
mp_limitteams ${CUSTOM_LIMITTEAMS:-0}
sv_alltalk ${CUSTOM_ALLTALK:-0}
mp_respawn_on_death_ct ${CUSTOM_RESPAWN:-0}
mp_respawn_on_death_t ${CUSTOM_RESPAWN:-0}
mp_death_drop_gun ${CUSTOM_DEATH_DROP_GUN:-1}
sv_showimpacts ${CUSTOM_SHOW_IMPACTS:-0}
sv_grenade_trajectory_prediction ${CUSTOM_GRENADE_TRAJECTORY:-0}
ammo_grenade_limit_total ${CUSTOM_GRENADE_LIMIT:-4}
mp_restartgame 1
CFG
      ;;
  esac

  if [[ "${PRACTICE:-0}" == "1" ]]; then
    cat >> "$cfg" <<'CFG'
sv_cheats 1
mp_limitteams 0
mp_autoteambalance 0
mp_maxmoney 60000
mp_startmoney 60000
mp_buytime 9999
mp_buy_anywhere 1
mp_freezetime 0
mp_roundtime 60
mp_roundtime_defuse 60
mp_roundtime_hostage 60
mp_warmuptime 0
mp_death_drop_gun 0
mp_respawn_on_death_ct 1
mp_respawn_on_death_t 1
ammo_grenade_limit_total 5
sv_showimpacts 1
sv_grenade_trajectory_prediction 1
mp_restartgame 1
CFG
  fi

  if [[ "${INFINITE_AMMO:-0}" == "1" ]]; then
    printf 'sv_cheats 1\nsv_infinite_ammo 1\n' >> "$cfg"
  fi

  if [[ "${BOTS_ENABLED:-0}" == "0" ]]; then
    printf 'bot_quota 0\nbot_quota_mode normal\nbot_kick\n' >> "$cfg"
  fi

  for mode_cfg in \
    gamemode_competitive_server.cfg \
    gamemode_casual_server.cfg \
    gamemode_deathmatch_server.cfg \
    gamemode_custom_server.cfg; do
    printf 'exec verona.cfg\n' > "$game_dir/cfg/$mode_cfg"
  done
}

# The admin panel writes the launch selection (map, mode, bots, limits, RUN_GAME) here
# right before starting this container; it must win over the Compose defaults,
# so parse it and export variables while stripping any Windows carriage returns (\r).
if [[ -f /config/launch.env ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    clean_line="${line//$'\r'/}"
    if [[ -n "$clean_line" && ! "$clean_line" =~ ^[[:space:]]*# ]]; then
      export "$clean_line"
    fi
  done < /config/launch.env
fi

if [[ "${RUN_GAME:-0}" != "1" ]]; then
  log "Game server is set to idle. Sleeping indefinitely."
  sleep infinity
fi

install_cs2
install_metamod
install_counterstrikesharp
install_plugin

write_server_config

launch=("$server_dir/game/bin/linuxsteamrt64/cs2" -dedicated -usercon -console -port 27015 -maxplayers "${MAX_PLAYERS:-32}" +game_type "${GAME_TYPE:-0}" +game_mode "${GAME_MODE:-0}")
# -insecure detaches the server from VAC; required for cheats-based practice.
[[ "${VAC_INSECURE:-0}" == "1" ]] && launch+=(-insecure)
if [[ -n "${WORKSHOP_MAP_ID:-}" ]]; then
  launch+=(+host_workshop_map "$WORKSHOP_MAP_ID")
else
  launch+=(+map "${START_MAP:-de_dust2}")
fi
launch+=(+exec verona.cfg)
log "Starting CS2"
# Valve's cs2.sh normally exports this; libserver.so needs libv8.so from here.
export LD_LIBRARY_PATH="$server_dir/game/bin/linuxsteamrt64${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
# The Steamworks SDK resolves steamclient.so via ~/.steam/sdk64; SteamCMD only
# ships it inside its own directory, so expose it there on every start.
mkdir -p "$HOME/.steam/sdk64"
ln -sf /opt/steamcmd/linux64/steamclient.so "$HOME/.steam/sdk64/steamclient.so"
exec "${launch[@]}"
