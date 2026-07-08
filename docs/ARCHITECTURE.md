# Архитектура Verona CS2

## Сервисы и trust boundaries

```text
Browser (untrusted input)
  -> ASP.NET Core / React, 127.0.0.1:8080
       -> in-memory HttpOnly sessions
       -> PostgreSQL 18
       -> Docker Engine socket -> verona-cs2-server lifecycle

VeronaPlugin
  -> Admin plugin API + X-Verona-Key
       -> heartbeat / commands / player skins
```

Browser никогда не получает доступ к PostgreSQL, Docker socket или plugin key. React route guards улучшают UX; реальные права проверяет middleware backend. `/api/plugin/**` отделён от browser sessions и аутентифицируется собственным ключом.

Admin имеет Docker socket и потому считается высокопривилегированным control plane. Порт намеренно публикуется только на loopback.

## Жизненный цикл запуска

`docker compose up -d --build` запускает PostgreSQL и admin. CS2 находится в profile `game`, чтобы тяжёлый сервер не стартовал автоматически вместе с Docker Desktop.

```text
первое создание/обновление контейнера
  -> docker compose --profile game create --build cs2

кнопка «Запустить»
  -> backend валидирует launch form
  -> пишет /config/launch.env
  -> Docker Engine API стартует существующий verona-cs2-server
  -> entrypoint читает launch.env
  -> SteamCMD обновляет CS2
  -> проверяются Metamod и CounterStrikeSharp
  -> устанавливаются Verona и gamedata
  -> создаётся verona.cfg
  -> CS2 запускается от steam с выбранной картой/режимом
```

Docker не позволяет изменить environment остановленного контейнера при простом `start`, поэтому параметры передаются через host-mounted `config/launch.env`. Backend принимает только известные пары game type/mode и ограниченные значения; это критично, поскольку Bash загружает файл командой `source`.

Официальные карты фильтруются UI по режиму. Workshop map задаётся числовым ID и запускается через `+host_workshop_map`. Practice и infinite ammo используют cheats; UI выключает VAC, а entrypoint добавляет `-insecure`.

## Runtime CS2

Установка хранится во внешнем volume `verona-cs2-data`. Entrypoint стартует от root только для исправления владельцев mount points, затем немедленно переходит на пользователя `steam`.

Три runtime workaround нельзя удалять без проверки чистого volume:

- SteamCMD должен иметь право записывать `/server` и вложенные mount points;
- прямому запуску `cs2` нужен `LD_LIBRARY_PATH=/server/game/bin/linuxsteamrt64` для `libv8.so`;
- Steamworks ожидает `steamclient.so` в `~/.steam/sdk64`, куда создаётся симлинк на копию SteamCMD.

## Авторизация

Steam OpenID 2.0 подтверждает только владение SteamID64. Backend повторно отправляет подписанный callback Steam с `openid.mode=check_authentication`; локально доверять query string нельзя. Steam Web API key не требуется.

```text
Steam user -> OpenID -> SessionIdentity(SteamId)
                         -> PostgreSQL players.role on every request
```

Роль не кэшируется в сессии: backend читает её из PostgreSQL при каждом защищённом запросе, поэтому demotion применяется немедленно. `ADMIN_STEAM_IDS` — только bootstrap, когда администраторов в БД ещё нет. Обычный пользователь допущен только к `/api/me/**`, где SteamID извлекается из session identity. Admin endpoints с произвольным target SteamID недоступны обычному пользователю.

После OpenID backend обновляет публичные Steam name/avatar через profile XML. При наличии server-side `FACEIT_API_KEY` официальный FACEIT Data API дополняет запись ELO; сбой внешнего API не блокирует вход.

## Control plane и данные

PostgreSQL хранит игроков, роли, профили, назначения скинов, баны, настройки и очередь команд. Heartbeat плагина обновляет online snapshot в памяти и persistent player record в БД. Команды помечаются delivered атомарным `UPDATE ... RETURNING` с `SKIP LOCKED`, чтобы два poll не получили одну pending-команду.

Сессии и текущий online snapshot намеренно ephemeral; рестарт admin разлогинивает пользователей, а список online восстанавливается со следующим heartbeat.

## Skinchanger

`admin/ui/public/skins-catalog.json` содержит публичные метаданные: оружие, paint kit, редкость, Steam CDN image URL и допустимый wear конкретного paint kit. Он нужен для UX, но backend повторно проверяет базовые диапазоны, потому что клиентские данные недоверенные.

```text
выбор в UI
  -> PUT /api/me/skins/{weapon}
     или admin PUT /api/players/{steamId}/skins/{weapon}
  -> UPSERT player_weapon_skins
  -> enqueue refresh_skins
  -> plugin poll
  -> remote snapshot игрока заменяется
  -> skin применяется к существующему оружию
```

Admin выбирает любого игрока из persistent списка `players`. Обычный пользователь всегда редактирует SteamID своей сессии. Удаление записи делает стандартный внешний вид авторитетным remote-состоянием.

Перчатки и агенты хранятся отдельно от оружия в `player_gloves` и `player_agents`, по одному значению на CT/T. Plugin loadout snapshot возвращает оружие, перчатки и агентов атомарно с точки зрения refresh. Перчатки применяются к `EconGloves` с теми же economy texture attributes, агент меняет модель уже существующего pawn; ни одна из операций не выдаёт предметы. Активная skin collection синхронизирует все три вида косметики.

Оружейный skin assignment хранится в независимых слотах `ct` и `t`. Значение `both` принимается только как команда записи: backend в одной транзакции материализует её в два командных слота, поэтому последующее изменение CT не затрагивает T. AK-47/Glock и другие T-only позиции принимают только `t`, M4/USP-S и другие CT-only — только `ct`. Доступность берётся из статического каталога, но независимо проверяется backend перед записью.

### Применение внутри игры

На connect/spawn плагин перечитывает JSON fallback, запрашивает remote skins и через следующий frame обходит `MyWeapons`. На pickup копируются значения event и на следующем frame обрабатывается полученное оружие.

Плагин записывает `FallbackPaintKit`, `FallbackSeed`, `FallbackWear`, отмечает schema state changed и дублирует paint/seed/wear в обе economy attribute lists через функцию из `gamedata/verona.json`. После первого успешного Admin API response remote snapshot, включая пустой, становится источником истины для игрока. До него используется `config/skins.json`.

## Модули и направление зависимостей

- `VeronaPlugin` — composition root и игровые events.
- `WeaponSkinsModule` — CounterStrikeSharp entities и cosmetic mutation.
- `SkinCatalog` — чистая JSON validation/fallback model.
- `AdminApiClient` — heartbeat, polling и remote skin snapshots.
- `Verona.Admin` — auth, authorization, persistence и orchestration.
- `admin/ui` — React presentation и client-side state; базовые controls принадлежат проекту и генерируются shadcn/ui поверх Tailwind CSS v4 и Radix UI.

Игровой plugin не получает Npgsql или Docker client. Backend не знает CounterStrikeSharp entities. UI не является security boundary.

## Совместимость и лицензирование

Metamod и CounterStrikeSharp — обязательный runtime, но игровых feature-библиотек нет. Код GPL-3.0 WeaponPaints не копируется. Бинарная сигнатура в `gamedata/verona.json` считается версионируемым deployment artifact и требует игрового smoke-test после обновлений CS2.
