# AGENTS.md — контекст проекта Verona

Этот файл — стартовая точка для AI-агентов и новых разработчиков. Перед изменениями прочитайте его, затем `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` и затрагиваемые исходники. Не делайте выводы только по README: здесь зафиксированы границы и неочевидные инварианты.

## Что представляет собой Verona

Verona — переносимый CS2 dedicated server с собственным CounterStrikeSharp-плагином и локальной веб-панелью. Хосту нужны только Docker Desktop/Engine и браузер; SteamCMD, .NET SDK и Node.js находятся внутри Docker build/runtime.

Текущее поведение:

- `docker compose up -d --build` поднимает только `verona-cs2-admin` и `verona-cs2-postgres`;
- контейнер `verona-cs2-server` находится в Compose profile `game` и запускается пользователем из панели;
- перед стартом администратор выбирает режим, совместимую карту либо Workshop ID, число игроков, ботов, VAC, practice, infinite ammo и friendly fire;
- Steam OpenID даёт обычному игроку доступ только к собственному Skinchanger;
- роль `admin` в PostgreSQL открывает административные API;
- PostgreSQL — основной persistent store для игроков, банов и скинов;
- `config/skins.json` остаётся offline fallback до первого успешного ответа Admin API для конкретного игрока;
- плагин меняет внешний вид уже существующего оружия, но не выдаёт оружие и не меняет экономику матча;
- ножи поддерживаются через ограниченный allow-list item definition index и `ChangeSubclass`; перчатки и агенты выбираются отдельно для CT/T; StatTrak и name tags пока не поддерживаются.

## Состав системы

- `docker-compose.yml` — admin/PostgreSQL по умолчанию и CS2 в profile `game`.
- `Dockerfile` — сборка C#-плагина и собственный Linux runtime-образ CS2.
- `docker/entrypoint.sh` — SteamCMD, Metamod, CounterStrikeSharp, установка Verona и запуск CS2.
- `src/ServerCore` — игровой плагин; историческое имя каталога не означает отдельный продукт ServerCore.
- `admin/Verona.Admin` — ASP.NET Core control plane: auth, authorization, PostgreSQL, Docker Engine API, plugin API и SignalR.
- EF Core владеет версионированными миграциями и обычным CRUD control plane; PostgreSQL-specific очередь команд, `jsonb` и массовые loadout-транзакции используют параметризованный Npgsql SQL.
- `admin/ui` — React 19 + TypeScript + Vite + Tailwind CSS v4 SPA с официальными shadcn/ui-компонентами на Radix UI.
- `admin/ui/public/skins-catalog.json` — статический каталог оружия/paint kits/rarity colors/изображений для выбора в UI; назначения игроков там не хранятся.
- `config/launch.env` — генерируемый панелью snapshot параметров следующего старта CS2.
- `config/skins.json` — ручной аварийный fallback, не основной UI store.
- `gamedata/verona.json` — поддерживаемая проектом нативная сигнатура economy attributes.

## Архитектурные границы

- `VeronaPlugin` только связывает lifecycle CounterStrikeSharp, `WeaponSkinsModule` и `AdminApiClient`.
- `WeaponSkinsModule` проверяет игровые entities и применяет косметику.
- `SkinCatalog` независимо и частично валидирует JSON fallback; эта логика покрывается unit-тестами.
- `AdminApiClient` не подключается к PostgreSQL напрямую. Плагин общается с backend по HTTP и `VERONA_PLUGIN_API_KEY`.
- Браузер не обращается напрямую к Docker socket или PostgreSQL.
- Backend является единственным владельцем авторизации и проверки ролей. React route guards и скрытые кнопки — UX, не security boundary.
- Entrypoint отвечает за deployment и launch-конфигурацию, но не должен содержать бизнес-логику аккаунтов или skinchanger.

Пока используется один plugin assembly с внутренними модулями. Отдельный плагин оправдан, только когда функция получает независимые lifecycle, конфигурацию и возможность установки.

## Авторизация и права

Единственный способ входа — Steam OpenID 2.0. Он подтверждает владение SteamID64 без Steam Web API key; callback обязательно перепроверяется через `check_authentication` у Steam.

Роль хранится в `players.role` и читается из PostgreSQL при каждом защищённом запросе, поэтому demotion действует сразу. `ADMIN_STEAM_IDS` используется только один раз, если в БД ещё нет администратора; после bootstrap environment больше не является источником ролей. Сессии — случайные HttpOnly cookies, хранятся 12 часов только в памяти admin-процесса.

При входе backend обновляет публичные Steam name/avatar через profile XML. FACEIT ELO загружается через официальный Data API только при заданном `FACEIT_API_KEY`; ключ никогда не передаётся браузеру.

Обычный Steam-пользователь должен иметь доступ только к `/api/me/**`. Целевой SteamID для этих endpoints берётся из server-side session identity, никогда из body/query/path клиента. Все остальные `/api/**` и SignalR требуют admin-сессию. `/api/plugin/**` использует отдельный ключ и не должен принимать browser session как замену.

## Запуск и Docker

Обычный стек:

```powershell
docker compose up -d --build
```

Если `verona-cs2-server` ещё не создан или изменился его image/entrypoint:

```powershell
docker compose --profile game create --build cs2
```

После этого панель стартует/останавливает уже созданный контейнер через Docker socket. Environment контейнера нельзя менять при `start`, поэтому backend валидирует форму, атомарно записывает `/config/launch.env`, а entrypoint читает её при каждом запуске. Не добавляйте в этот файл невалидированные свободные строки: он исполняется Bash через `source`.

Admin port остаётся привязанным к `127.0.0.1`, пока контейнер имеет `/var/run/docker.sock`. Компрометация backend с Docker socket фактически означает компрометацию Docker-хоста. Для публичной панели нужны отдельная модель доступа, HTTPS и ограниченный Docker proxy — простой bind на `0.0.0.0` запрещён.

CS2 хранится во внешнем volume `verona-cs2-data`. Не запускайте `docker compose down -v` и не удаляйте volume без явного согласия пользователя: повторная загрузка занимает десятки гигабайт.

## Инварианты игрового плагина

1. Не удерживайте объект игрового event после callback; заранее копируйте значения.
2. Изменения entities делайте на игровом потоке через `Server.NextFrame`.
3. После fallback-полей вызывайте `Utilities.SetStateChanged`, иначе клиент может не получить обновление.
4. Paint/seed/wear записываются и в обе economy attribute lists через `gamedata/verona.json`.
5. Боты игнорируются; controller, pawn, services и handles могут быть invalid даже после прежней проверки.
6. Ошибка одного оружия или JSON leaf пропускает только эту запись. Синтаксически сломанный JSON отключает весь fallback, но не валит сервер.
7. После первого успешного remote response даже пустой PostgreSQL-результат авторитетен для игрока; иначе удалённый скин воскреснет из JSON fallback.
8. SteamID64 передаётся в JSON как строка, потому что JavaScript `number` теряет точность.
9. Команды, полученные HTTP-клиентом, исполняются через CounterStrikeSharp/игровой поток, а не из timer callback.
10. На SteamID может быть выбран только один `weapon_knife_*`/`weapon_bayonet` для каждого точного scope (`ct`, `t`): действие `both` атомарно обновляет оба scope, backend удаляет прежнюю модель в каждом из них, а плагин принимает только известные item definition index.
11. Стикеры используют только четыре стандартные позиции оружия (`slot 0..3`). Свободное размещение не поддерживается: scale всегда `1`, rotation и offset всегда `0`, а пятый slot принудительно очищается плагином.

## Инварианты runtime

- CS2 не работает от root. Entrypoint исправляет права mount points и перезапускается через `gosu steam`.
- Свежие bind/named mounts Docker может создать от root. Особое внимание `/server`, `/server/game/csgo/logs` и родительским каталогам SteamCMD.
- CS2 запускается бинарником напрямую, поэтому entrypoint обязан выставлять `LD_LIBRARY_PATH` с `game/bin/linuxsteamrt64`; иначе не находится `libv8.so`.
- Steamworks ищет `steamclient.so` в `~/.steam/sdk64`, поэтому симлинк на SteamCMD создаётся перед каждым стартом.
- CS2 update может заменить `gameinfo.gi`; строка Metamod проверяется на каждом запуске независимо от version marker.
- Metamod обязательно должен быть версии 2.x (dev builds с `mms.alliedmods.net`), так как стабильные 1.x предназначены для Source 1 и не содержат необходимых бинарников для Source 2 (директория `linuxsteamrt64`).
- CounterStrikeSharp конфиг `core.json` должен содержать `PublicChatTrigger` и `SilentChatTrigger` в формате массивов строк (например, `["!"]`). Использование одиночных строк ломает запуск плагина с ошибкой json парсера.
- `FollowCS2ServerGuidelines=false` нужен текущему skinchanger и несёт риск блокировки GSLT на публичном сервере.

## Валидация и данные

Backend обязан независимо валидировать всё, что прислал UI. Статический каталог помогает выбрать корректный paint kit и wear range, но не является доверенной границей. Минимальные ограничения: canonical `weapon_*`, `paintKit > 0`, `wear 0..1`, `seed 0..1000`, SteamID64 — 17 цифр.

Не коммитьте `.env`, GSLT, RCON password, Steam credentials, session cookies или plugin API key. Каталог содержит публичные Steam CDN URL, но не секреты.

## Проверка изменений

Минимум:

```powershell
dotnet test Verona.sln -c Release
docker compose config --quiet
cd admin/ui
npm run build
```

Без локальных SDK:

```powershell
docker build --target plugin-build -t verona-plugin-build .
docker compose build admin
```

После изменения entrypoint/platform versions требуется игровой smoke-test: сервер загрузил карту, Metamod, CounterStrikeSharp и Verona; heartbeat появился; spawn/purchase/pickup применяют скин. Компиляция не проверяет актуальность бинарной сигнатуры CS2.

Auth-изменения проверяйте минимум четырьмя случаями: anonymous → 401, обычный Steam user → собственные skins доступны, обычный user → admin API 403, admin → управление другим SteamID доступно. Launch-изменения проверяйте для каждой пары game type/mode, Workshop ID, VAC/practice и повторного старта.

## Стиль работы

- Комментарий объясняет причину, security boundary или workaround, а не переводит следующую строку на русский.
- Новое поле конфигурации требует server-side validation и обновления README/architecture/decisions.
- Не скрывайте исключения без контекста SteamID, weapon или операции.
- Не копируйте C#-код GPL-3.0 проекта Nereziel/cs2-WeaponPaints.
- Не редактируйте generated `admin/ui/dist`, соседние с TypeScript скомпилированные `.js`, `bin`, `obj` или `node_modules` как исходники.
- Рабочая папка может не иметь `.git`; до массовых изменений не рассчитывайте на `git diff` как на единственный способ восстановления.

## Текущие ограничения

Skin collections — пользовательские snapshots loadout в `skin_collections` и `skin_collection_items`. Оружейные назначения хранят независимые scope `ct`/`t`; входное действие `both` записывает оба, а оружие одной команды нельзя назначить другой. Активна максимум одна коллекция на SteamID. Переключение атомарно заменяет `player_weapon_skins` и ставит `refresh_skins`; self-service изменения синхронизируют активную коллекцию.

- Перчатки используют `EconGloves` и bodygroup refresh, агенты — allow-listed по формату model path и применяются к pawn на spawn. После обновлений CS2 ножи, перчатки и агенты требуют игрового smoke-теста моделей, анимаций и paint kit.
- Сессии теряются при рестарте admin-контейнера и пока не имеют server-side revoke UI.
- Изображения каталога зависят от доступности Steam CDN.
- Admin API разделён по `Features/Auth`, `Features/Players`, `Features/ServerLifecycle`, `Features/Plugin` и `Features/Skinchanger`; `Program.cs` остаётся composition root. Новые endpoints добавляйте в соответствующий feature, сохраняя текущие authorization boundaries.
- `gamedata/verona.json` может потребовать обновления после патча CS2.
