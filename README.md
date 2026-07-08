# Verona CS2

Переносимый CS2 dedicated server с собственным C#-плагином, PostgreSQL и локальной React/Tailwind/shadcn-панелью. Проект запускается через Docker и не требует локальных SteamCMD, .NET SDK или Node.js.

Документация:

- [`AGENTS.md`](AGENTS.md) — обязательный контекст и инварианты;
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — компоненты и потоки данных;
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — журнал архитектурных решений.

## Возможности

- запуск и остановка CS2 из веб-панели;
- выбор режима и совместимой официальной карты с изображением;
- карты Steam Workshop по ID;
- max players, боты, VAC, practice, infinite ammo и friendly fire;
- online-игроки, kick и временный/постоянный ban;
- Steam OpenID и self-service Skinchanger;
- редактирование скинов любого известного игрока администратором;
- каталог 1400+ paint kits с изображениями Steam CDN, wear и seed;
- PostgreSQL для игроков, банов и назначений; EF Core для миграций/обычного CRUD и Npgsql для специализированных атомарных запросов;
- JSON fallback до первого ответа control plane.

Плагин меняет внешний вид уже существующего оружия, поддерживает модели/скины ножей, отдельные перчатки и агентов для CT/T. Он не выдаёт предметы и не меняет экономику матча. StatTrak и name tags пока не реализованы.

## Требования

- x86-64 Windows/Linux host с Docker Desktop либо Docker Engine + Compose;
- около 80 GB свободного места;
- минимум 4 GB RAM, рекомендуется 8 GB;
- интернет для первой загрузки.

## Первый запуск

```powershell
Copy-Item .env.example .env
.\prod.bat
```

`prod.bat` создаёт persistent volume при первом запуске, поднимает PostgreSQL и админку, затем собирает и создаёт остановленный контейнер игры. Откройте `http://localhost:8080`, войдите, выберите параметры и нажмите «Запустить».

Первый старт долгий: SteamCMD скачивает примерно 60–70 GB. Данные сохраняются во внешнем volume `verona-cs2-data`. После загрузки карты подключитесь:

```text
connect localhost:27015
```

С другого компьютера в LAN используйте IP Docker-хоста.

## Авторизация

Steam-вход использует OpenID 2.0 без Steam Web API key. Обычный пользователь видит Skinchanger и меняет назначения только для SteamID своей сессии.

Для первой установки перечислите bootstrap-администраторов через запятую:

```dotenv
ADMIN_STEAM_IDS=76561198000000000,76561198000000001
```

Список используется только если в PostgreSQL ещё нет администратора. После bootstrap роли меняются на странице «Игроки», а БД становится единственным источником прав. Снятие роли у последнего администратора блокируется. Сессии хранятся в памяти 12 часов, поэтому рестарт `verona-cs2-admin` разлогинивает пользователей.

Steam name и avatar обновляются при авторизации. Для FACEIT ELO задайте ключ официального FACEIT Data API в `FACEIT_API_KEY`; без него поле ELO остаётся пустым.

Панель имеет Docker socket и публикуется только на `127.0.0.1`. Не выставляйте её на `0.0.0.0` без HTTPS, публичной модели безопасности и ограничения Docker API.

## Запуск сервера

Панель валидирует настройки и записывает `config/launch.env`; entrypoint читает его при каждом старте. Доступны Casual, Competitive, Wingman и Deathmatch. Официальные карты зависят от режима; Workshop принимает числовой ID из URL `?id=...`.

Practice и infinite ammo используют cheats и требуют запуска без VAC (`-insecure`).

После изменений `Dockerfile`, `docker/entrypoint.sh` или игрового image пересоздайте контейнер:

```powershell
docker compose --profile game create --build --force-recreate cs2
```

Обычный `docker compose up -d --build` не пересоздаёт сервис неактивного profile.

## Skinchanger

Игрок входит через Steam и выбирает оружие/paint kit. UI учитывает wear range каталога и seed `0..1000`. Назначение сохраняется в PostgreSQL и применяется плагином при следующей выдаче/подборе оружия. Администратор может выбрать любого игрока, которого ранее видел сервер.

`config/skins.json` — только аварийный fallback до первого успешного ответа API для игрока:

```json
{
  "76561198000000000": {
    "weapon_ak47": { "paintKit": 600, "wear": 0.01, "seed": 42 }
  }
}
```

Canonical classname имеет вид `weapon_ak47`; `paintKit > 0`, `wear` — `0..1`, `seed` — `0..1000`. Ошибочная leaf-запись пропускается.

## LAN, GSLT и Valve

Пустой `GSLT` включает `sv_lan 1`. Для интернета создайте токен app ID `730`, храните его только в `.env` и откройте TCP/UDP `27015`. Ранее опубликованный GSLT необходимо отозвать.

Entrypoint устанавливает `FollowCS2ServerGuidelines=false`, иначе cosmetic operations блокируются. На публичном сервере владелец принимает риск блокировки GSLT и обязан учитывать [правила Valve](https://blog.counter-strike.net/index.php/server_guidelines/).

## Обслуживание

```powershell
docker compose ps
docker compose logs -f admin postgres
docker logs -f verona-cs2-server
docker compose down
docker compose build admin
docker compose --profile game create --build --force-recreate cs2
```

Не используйте `docker compose down -v` и не удаляйте `verona-cs2-data`, если не хотите повторно скачивать CS2.

## Разработка и проверка

При наличии локальных SDK:

```powershell
dotnet test Verona.sln -c Release
cd admin/ui
npm run build
```

Без них:

```powershell
docker compose config --quiet
docker build --target plugin-build -t verona-cs2-plugin-build .
docker compose build admin
```

После обновления CS2, CounterStrikeSharp или gamedata нужен игровой smoke-test: загрузка Verona, heartbeat и применение paint при spawn, purchase и pickup.

Entrypoint намеренно исправляет права mount points, задаёт `LD_LIBRARY_PATH` для `libv8.so`, создаёт ссылку `~/.steam/sdk64/steamclient.so` и восстанавливает Metamod в `gameinfo.gi`. Без этих workaround чистая установка не запускается.
