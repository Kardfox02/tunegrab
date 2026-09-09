# Архитектура фронтенда Tunegrab

## 1. Назначение

Фронтенд Tunegrab — адаптивное SPA для двух пользователей. Он предоставляет доступ к общей музыкальной библиотеке, поиску и загрузке аудио с YouTube, а также к воспроизведению треков через серверный стриминг.

Назначение (виды):

- **Библиотека** (`/library`) — общая коллекция треков;
- **Поиск** (`/search`) — поиск YouTube, загрузки, локальный upload;
- **Профиль** (`/settings`) — личный кабинет;
- **Панель управления** (`/admin`) — аккаунт, состояние сервера, обслуживание.

Реализованный функционал:

- авторизация: регистрация, вход, выход, восстановление сессии по cookie;
- общая библиотека треков: поиск, сортировка, бесконечный список с серверной догрузкой партиями по 50, удаление;
- локальная загрузка MP3-файлов (кнопка внизу страницы поиска, центрирована);
- поиск на YouTube;
- постановка загрузок в очередь, прогресс, отмена и повтор;
- восстановление активных загрузок после перезагрузки страницы;
- воспроизведение через `<audio>` с очередью, сквозным воспроизведением по библиотеке и Media Session API;
- лайки (сердечки в библиотеке и плеере, оптимистичный toggle);
- личный кабинет: статистика прослушиваний с переключателем периода, список «Любимое»;
- панель управления (`/admin`): смена пароля, круговая диаграмма хранилища, очистка кэша превью, команды CLI;
- тосты-уведомления.

## 2. Технологический стек

| Инструмент | Роль |
|---|---|
| Vue 3 (Composition API, `<script setup>`) | компонентная модель и реактивный UI |
| Vite | dev-сервер, production-сборка |
| TypeScript | типы API-контрактов и состояния (`strict`) |
| Pinia | прикладное состояние (setup-стиль store'ов) |
| Vue Router | маршрутизация SPA, lazy-загрузка views |
| Axios | HTTP-клиент: `withCredentials`, единый разбор ошибок |
| Vitest + Vue Test Utils | модульные тесты stores, guards, composables и компонентов |
| CSS | собственная визуальная система на дизайн-токенах, без UI-фреймворка |

Версии зафиксированы в `frontend/package.json` (на момент описания: Vue 3.5, Vite 8, TS 6.0, Pinia 3, vue-router 5, Axios 1.13, Vitest 4).

Аудиоданные не попадают в реактивное состояние: браузер получает их напрямую через `<audio>` и Range-запросы к `/stream/{id}`.

## 3. Режимы запуска

### Разработка

Работают два процесса (фактическая конфигурация `vite.config.ts`):

```text
Vite :8080 (host: true, allowedHosts: [rknshit.com])
  └── proxy /auth, /tracks, /youtube, /stream, /covers, /events, /likes,
          /admin/health, /admin/thumbnails, /admin/commands
          (админ-API — точные префиксы: широкое '/admin' перехватило бы
          GET-навигацию на /admin при перезагрузке страницы и дало 404)
          ↓
      FastAPI :8000
```

- Фронтенд обращается к относительным путям, поэтому cookie `tunegrab_session` работает без CORS и ручной передачи токена.
- `strictPort: true` — порт `8080` занят другим процессом → ошибка старта, а не тихий перенос.
- `host: true` — dev-сервер доступен из локальной сети (проверка на телефоне); Origin-middleware backend'а в dev-режиме пропускает private-network origins.

Команды: `npm run dev`, `npm run build`, `npm run preview`, `npm test` / `npm run test:watch`, `npm run typecheck`.

### Production-сборка

`npm run build` сначала прогоняет `vue-tsc -b` (типизация — часть сборки), затем `vite build` — приложение собирается в `frontend/dist` с хешированными именами ассетов. Раздача собранной сборки backend'ом (mount статики + SPA fallback) **не реализована** — сейчас сервис эксплуатируется в dev-режиме (Vite proxy).

### PWA-манифест

`public/manifest.webmanifest` подключён в `index.html` (`display: standalone`, тёмная `theme_color`, иконки). Это даёт «installable»-поведение на Android, но **service worker отсутствует** — офлайн-режим не реализован и не заявлен.

## 4. Структура каталогов (фактическая)

```text
frontend/
├── index.html                       # lang="ru", viewport-fit=cover, manifest, тёмная тема до гидрации
├── vite.config.ts                   # alias @ → src, proxy, port 8080, vitest (jsdom)
├── tsconfig.json / tsconfig.app.json / tsconfig.node.json
├── package.json
├── public/
│   ├── favicon.png
│   ├── icons.svg
│   ├── theme1.jpg / theme1-vertical.jpg   # фоновые изображения (см. §11)
│   └── manifest.webmanifest
└── src/
    ├── api/                         # транспорт: HTTP-клиент и функции по доменам
    │   ├── client.ts                #   axios-инстанс, interceptor 401, createAbortGroup
    │   ├── auth-api.ts              #   /auth/*
    │   ├── tracks-api.ts            #   /tracks: список, удаление, upload MP3
    │   ├── youtube-api.ts           #   /youtube/*: поиск, загрузки, cancel, retry
    │   ├── events-api.ts            #   /events: запись события, stats
    │   ├── likes-api.ts             #   /likes: список, ids, PUT, DELETE
    │   ├── admin-api.ts             #   /admin: health, thumbnails/clear, команды CLI
    │   └── index.ts                 #   re-export публичного API-слоя
    ├── components/
    │   ├── AppShell.vue             # каркас защищённой области + привязка queueSupplier
    │   ├── AppHeader.vue            # логотип + никнейм-ссылка на /admin (стекло)
    │   ├── AppSidebar.vue           # круглые стеклянные кнопки навигации + тултипы
    │   ├── AppNotifications.vue     # тосты (TransitionGroup, aria-live, стекло)
    │   ├── AppIcon.vue              # inline-SVG-иконки по имени
    │   ├── PlayerBar.vue            # владелец <audio>, свайпы, seek/volume
    │   ├── TrackList.vue            # <ul> из TrackRow
    │   ├── TrackRow.vue             # строка трека: обложка, статус, удаление
    │   ├── SearchForm.vue           # форма поиска (defineModel, enterkeyhint)
    │   ├── StorageDonutChart.vue    # SVG-донат хранилища (stroke-dasharray, легенда)
    │   ├── YouTubeResultCard.vue    # карточка результата: превью, статус, кнопка
    │   ├── DownloadProgress.vue     # progressbar + aria-live-лейбл
    │   ├── LoadingState.vue / EmptyState.vue / ErrorState.vue
    ├── services/
    │   ├── cover-color.service.ts   # доминирующий цвет обложки (canvas, кэш)
    │   └── media-session.service.ts # MediaSession API с feature-detection
    ├── stores/
    │   ├── auth.store.ts
    │   ├── library.store.ts
    │   ├── downloads.store.ts
    │   ├── player.store.ts
    │   ├── profile.store.ts        # кабинет: stats, лайки, сердечки (likedTrackIds)
    │   └── notifications.store.ts
    ├── router/
    │   └── index.ts                 # createAppRouter(pinia, history)
    ├── views/
    │   ├── LoginView.vue
    │   ├── RegisterView.vue
    │   ├── LibraryView.vue
    │   ├── SearchView.vue
    │   ├── SettingsView.vue        # личный кабинет (см. §12)
    │   └── AdminView.vue           # панель управления (см. §12)
    ├── types/
    │   ├── api.ts                   # Paginated<T>
    │   ├── auth.ts                  # User, AuthResponse, payloads
    │   ├── errors.ts                # ApiError, isApiError, apiErrorFromAxios
    │   ├── track.ts                 # Track, статусы, сортировка
    │   ├── youtube.ts               # поиск/загрузка/active-контракты
    │   ├── events.ts                # события прослушиваний, статистика
    │   ├── likes.ts                 # контракты лайков
    │   └── admin.ts                 # контракты админ-панели
    ├── composables/
    │   ├── useDebouncedSearch.ts    # debounce + AbortGroup + state машины запроса
    │   ├── usePolling.ts            # createPolling: интервалы, visibilitychange
    │   ├── useInfiniteScroll.ts     # IntersectionObserver-сентинел бесконечного списка
    │   ├── useMediaQuery.ts         # useMediaQuery / useIsDesktop
    │   └── useSwipeSwitch.ts        # touch-свайп плеера (prev/next)
    ├── styles/
    │   ├── tokens.css               # дизайн-токены (цвета, отступы, z-index, переходы)
    │   ├── base.css                 # reset, типографика, focus-visible, reduced-motion
    │   ├── layout.css               # app-shell, header, sidebar, player-bar, safe areas
    │   └── components.css           # btn, card, field, states, yt-card, track-row…
    ├── App.vue                      # SVG-фильтр liquid-displacement + RouterView + тосты
    └── main.ts                      # createApp → pinia → router → mount
```

Зависимости между слоями направлены строго вниз:

```text
views / components / composables
        ↓
      stores  ──────────────→ services (media-session)
        ↓
       api (client + доменные модули)
        ↓
   types (контракты)      styles
```

Компоненты не вызывают axios напрямую и не знают формат ошибок backend — только `ApiError` и stores. `types/track.ts` — единственный источник истины по статусам (`TRACK_STATUSES`, `ACTIVE_TRACK_STATUSES`, `TERMINAL_TRACK_STATUSES`).

## 5. Маршруты и guards

### Публичные

| Маршрут | View | meta |
|---|---|---|
| `/login` | `LoginView` | `guestOnly` |
| `/register` | `RegisterView` | `guestOnly` |

### Защищённые (внутри `AppShell`)

| Маршрут | View |
|---|---|
| `/library` | `LibraryView` |
| `/search` | `SearchView` |
| `/settings` | `SettingsView` |
| `/admin` | `AdminView` |

`/` → redirect на `library`. Все views загружаются лениво (`() => import(...)`); `AppShell` — тоже отдельный чанк.

### `createAppRouter(pinia, history)`

Фабрика принимает `Pinia` и историю (для тестов — `createMemoryHistory`), что позволяет собирать router вне бутстрапа приложения.

`router.beforeEach`:

```text
await auth.restoreSession()   (try/catch)
    ↓ ошибка восстановления →
      requiresAuth → redirect /login?redirect=…
      иначе        → пропустить навигацию
    ↓ успех →
      currentUser?
        → downloads.restore() один раз (если ещё не восстановлены)
      requiresAuth && anonymous → /login?redirect=to.fullPath
      guestOnly && authenticated → /library
```

Редирект на `/login` сохраняет исходный путь в query `redirect`; `LoginView` валидирует его (`startsWith('/')` и не `'//'` — защита от open redirect) и делает `router.replace`.

Выход из сессии: `auth.onSessionTeardown` в router делает `push('/login')`, а teardown-подписки stores очищают состояние. Набор колбэков `Set<SessionTeardown>`: `downloads.reset`, `library.reset`, `player.reset`, `router → /login`.

## 6. Архитектура состояния

### `auth.store`

Состояние: `currentUser`, `initialized`, `isRestoring`, `isPending`, `lastError`.

- `restoreSession()` дедуплицируется (`restorePromise`): параллельные guards дают один `GET /auth/me`.
- Исходы: `401` → anonymous (`initialized = true`); успех → authenticated; прочие ошибки (сеть/5xx) → `initialized` остаётся `false`, ошибка пробрасывается. Следующая навигация повторяет restore — временный сбой не «залипает».
- `login` / `register` / `changePassword` устанавливают `currentUser` из ответа и помечают `initialized`.
- `logout()` всегда завершается teardown (`markUnauthenticated`), даже если `POST /auth/logout` упал — cookie и локальное состояние всё равно расходятся.
-Interceptor в `client.ts` обрабатывает `401` глобально. Список «безопасных» путей: `/auth/me`, `/auth/login`, `/auth/change-password` — их `401` не вызывает teardown. `401` любого другого запроса → `markUnauthenticated()`.

Токены в `localStorage` не хранятся; HttpOnly cookie полностью контролируется браузером.

### `library.store`

Состояние: `tracks`, `total`, `page` (внутренний счётчик загруженных партий), `query`, `sortBy`, `order`, `isLoading`, `isLoadingNextPage`, `error`, `isInitialized`, `deletingIds`, `deleteError`; computed: `hasMore`, `isQueryEmpty`.

Библиотека — **бесконечный список**: партия `LIBRARY_PAGE_LIMIT = 50` догружается при доскролле, новые треки аппендятся. Постраничной навигации и параметра `page` в URL больше нет.

- `applyRouteQuery(routeQuery)` — точка входа изменений фильтров: читает `q` / `sort_by` (whitelist) / `order`, нормализует невалидные значения к дефолтам и запускает `load()` при изменении. Back/Forward/reload восстанавливают фильтры и сортировку (позиция скролла — нет).
- `load()` — загрузка первой партии (offset 0). Перед запросом **прерывает prefetch**: `extensionAbortGroup.abort()`, сброс `nextPageCursor`. Так запоздавший ответ догрузки не дописывает устаревшие треки в новый список. In-flight дубли гасятся `AbortGroup`.
- `removeTrack(id)` — после успешного `DELETE` (204): `player.removeTrack(id)` и **локальное удаление** из `tracks` (`total -= 1`). Полная перезагрузка обрезала бы бесконечный список к первой партии. При `409` трек остаётся, в `deleteError` кладётся сообщение «Файл используется плеером…».
- Сквозное воспроизведение и бесконечный список сходятся в один `loadNextPage()`:
  - `nextPageCursor` (ref) — серверный offset следующей партии, единственный источник истины о позиции в списке;
  - `hasMore = cursor < total`; при дедупликации дублей `tracks.length` может отстать от `total`, поэтому сравнение длин не используется;
  - `loadNextPage()` — запрос партии по курсору; дублирует in-flight через `nextPagePromise`; **фильтрует треки с уже присутствующими id** (offset-пагинация + локальные удаления дают дубли); аппендит свежие в `tracks`, двигает курсор, возвращает `Track[]` для очереди плеера; выставляет `isLoadingNextPage` (спиннер сентинела);
  - `setQueueSupplier` плеера и scroll-загрузчик вызывают один и тот же метод — параллельные вызовы получают один Promise, лишних запросов нет.

### `downloads.store`

Состояние: `active` (активные треки), `isRestored`; служебное: `youtubeLinks` (Map `youtube_id → {trackId, exists}`), `generations`, `pollers`, `epoch`.

Публичные действия: `queueDownload(result)`, `restore()`, `cancelDownload(id)`, `retryDownload(id)`, `startPolling(id)` / `stopPolling(id)`, `stateForResult(youtubeId)` / `activeTrackFor(youtubeId)` — связь карточки поиска с загрузкой (`'idle' | 'queued' | 'exists'`).

Восстановление после reload (вызывается guard'ом после успешного restore сессии):

```text
GET /youtube/downloads/active
    ↓
active ← items с активными статусами
для каждого: youtubeLinks.set(youtube_id, { trackId, exists: false })  ← кнопка поиска снова «В очереди»
для каждого: startPolling(trackId)
```

Правила polling (`createPolling` из `usePolling.ts`):

- один poller на `track_id`; видимой вкладке — 1500 мс, скрытой — 12000 мс;
- `visibilitychange → visible` — немедленное обновление;
- `runningTask` — защита от наложения тиков;
- опция `runOnStart` (по умолчанию `true`) — выполнить задачу сразу при `start()`; `false` — ждать первого интервала (используется, когда начальная загрузка уже сделана вызывающим кодом);
- активные статусы: `pending/downloading/converting/finalizing`; терминальные `done/error/cancelled` останавливают polling;
- `done` → обновить библиотеку (`library.load()`) + уведомление; `error` → предупреждение.

Защита от stale responses — generation token на `track_id` (+ глобальный `epoch` для logout/reset):

```text
startPolling(trackId)
    ↓
generation[id] += 1; localGeneration = generation[id]
    ↓
ответ пришёл
    ↓
generations[id] !== localGeneration → игнор
иначе → applyTrack(track); терминальный статус → stopPolling
```

`AbortGroup` прерывает in-flight запрос при остановке polling, но generation-проверка — единственная гарантия консистентности: ответ уже завершившегося запроса всё равно может попасть в обработчик.

### `player.store`

Состояние: `currentTrack`, `queue`, `isPlaying`, `position`, `duration`, `volume`, `isLoading`, `playbackError`; computed: `hasCurrentTrack`, `isQueueEmpty`.

`volume` персистится в `localStorage` (`tunegrab.player-volume`) с safe-guard'ами на приватный режим.

Аудио-адаптер: store не знает про DOM. `PlayerBar` при mount вызывает `bindAudioController(controller)` с интерфейсом `PlayerAudioController { load, play, pause, seek, setVolume }`; события `<audio>` идут в store методами `audioPlaying / audioPaused / audioTimeUpdate / audioDurationChanged / audioWaiting / audioCanPlay / audioEnded / audioFailed`.

Выбор следующего трека — контекст воспроизведения:

- `playFromList(track, list)` фиксирует `contextList`/`contextIndex` (позиция трека в списке) и запускает `playTrack`. `LibraryView.play()` передаёт текущую страницу библиотеки — очередь наследует поиск и сортировку.
- `playOrToggle(track, list)` — точка входа клика по треку в списке: если трек уже текущий → `togglePlay()` (пауза/возобновление без перезапуска), иначе → `playFromList`. Визуализация «сейчас играет» (см. §11) построена на `currentTrack`/`isPlaying`, поэтому автоматически переезжает на следующий трек при автопереключении через `audioEnded`.
- `playNext()` / `playPrevious()` идут по контексту, пропуская неготовые треки (`status !== 'done' || audio_url === null`); при пустом контексте — голова ручной очереди (`addToQueue` / `playFromQueueHead`).
- **Жизненный цикл очереди**: очередь не переживает смену контекста. `playFromList()` (клик по треку в любом списке) очищает `queue`, `playedTrackIds` и историю — иначе оставшийся prefetch предыдущей сессии перехватывал бы воспроизведение по `ended` (очередь приоритетнее контекста) и играл «чужие» треки.
- **История и дедупликация прослушанного**: `playedTrackIds` (Set) — все треки, запускавшиеся в текущем контексте; оба пути пополнения очереди (`extendContext`-prefetch и fallback-supplier в `audioEnded`) фильтруют по `playedTrackIds` + `contextList` + `queue`. Это закрывает повторы после `library.load()` (например, завершение загрузки сбрасывает курсор библиотеки — supplier возвращает уже прослушанную страницу). `playbackHistory` (cap 100, объекты Track) — для `playPrevious` в режиме ручной очереди: когда текущий трек вне контекста, «назад» возвращает последний игравший трек из истории (с поправкой `contextIndex`, если трек в контексте); в голове контекста `playPrevious` бездействует, как и раньше. Сброс истории и `playedTrackIds` — в `playFromList` и `reset`.
- Поставщик очереди: `setQueueSupplier((lastTrackId) => Promise<Track[]>)`. Плеер не знает про библиотеку: `AppShell` связывает supplier с `library.loadNextPage()`.
  - **prefetch**: на native `play` (`audioPlaying`), если впереди контекста нет треков, supplier догружает следующую партию заранее (`extendContext`, флаг `extensionInFlight` от повторного входа).
  - **fallback**: если prefetch не успел, `audioEnded` догружает синхронно с индикатором `isLoading`; пустая партия → остановка.
- Защита от гонок: `playbackEpoch` инкрементируется в `playTrack`; запоздавший ответ supplier с устаревшей эпохой игнорируется.
- `removeTrack(id)` (вызывается из library после 204) чистит очередь; если трек текущий — полная остановка и очистка состояния.
- `auth.onSessionTeardown(reset)` — logout очищает плеер полностью.

Media Session: `services/media-session.service.ts` оборачивает `navigator.mediaSession` с feature-detection (обёртка `MediaSessionCapabilities` для тестируемости). Метаданные + обработчики `play/pause/previoustrack/nexttrack/stop` перевешиваются на каждое `setTrack`/`setPlaying` — Safari/WebKit фиксирует состав кнопок в момент установки metadata. `onNext/onPrevious` замыкаются на `player.playNext/playPrevious`.

### `profile.store`

Личные данные пользователя (кабинет + сердечки в списках). Состояние: `stats` (период задаёт вызывающий, по умолчанию 7 дней), `likedTracks`, `likedTrackIds` (Set — источник для сердечек), `togglingIds`, `likesTotal`/`likesCursor`/`hasMoreLikes` (серверная пагинация), флаги загрузки/ошибок.

- `loadProfile(force = false)` — лениво один раз за сессию (параллельно stats + **полный набор лайкнутых id** через `GET /likes/ids` + первая партия likes), вызывается из `SettingsView` и `LibraryView` (сердечкам нужен набор лайков);
  - `likedTrackIds` и постраничный список `likedTracks` — **независимые состояния**: ids приходят одним лёгким запросом сразу для всех лайков пользователя и работают во всей библиотеке и плеере; список «Любимое» догружается партиями и на сердечки не влияет — лайк на треке за пределами первой партии виден без прокрутки списка (раньше сердечко появлялось только после дозагрузки «Любимого» до этого трека);
- `refreshLikes()` — перезагружает только постраничный список «Любимого»; `likedTrackIds` не трогает (их источник — `GET /likes/ids` и оптимистичный toggle);
- `refreshStats(periodDays?)` — перезагрузка только статистики (опциональный период пробрасывается в `GET /events/me/stats?period_days=...`); вызывается переключателем периода и поллингом в `SettingsView`;
- «Любимое» — **дозагрузка при скролле**, как в библиотеке: `loadNextLikes()` по партиям 50 (сентинел `useInfiniteScroll`), дедупликация параллельных вызовов одним Promise, фильтрация дублей (offset + оптимистичные удаления);
- `toggleLike(track)` — **оптимистичный toggle**: Set + список + счётчик обновляются мгновенно, при ошибке — откат и тост; идемпотентность бэка гасит гонки двойных тапов;
- ответы валидируются (мусорный ответ → ошибка секции, а не падение рендера);
- `auth.onSessionTeardown` — полный сброс.

### `notifications.store`

`push(message, type = 'info', duration = 5000)` — авто-dismiss через таймер; `dismiss(id)`, `clear()`. Типы: `info | success | warning | error`. Отрисовка — `AppNotifications` (глобально, вне RouterView), `aria-live="polite"` + `TransitionGroup`.

## 7. HTTP-клиент и API

`api/client.ts`:

- единственный axios-инстанс: `baseURL: ''` (относительные пути), `withCredentials: true`;
- `apiErrorFromAxios()` нормализует любые ошибки в `ApiError { status, detail, fields, aborted }`:
  - `axios.isCancel` → `aborted: true` (для схем «забрать последний запрос»);
  - массив `detail` в формате Pydantic 422 → склеенный `detail` + `fields: Record<имя_поля, msg>`;
  - остальное → строковый `detail` или сообщение axios;
- response-interceptor: `401` на незащищённом списке путей → `unauthorizedHandler` (регистрируется auth.store), после чего ошибка всё равно пробрасывается дальше в caller;
- `createAbortGroup()` — реюзабельная группа AbortController: `nextSignal()` отменяет предыдущий и выдаёт новый, `abort()` гасит группу. Используется в поиске, библиотеке и polling.

Доменные модули (тонкие, без бизнес-логики):

```text
auth-api.ts    getCurrentUser, login, register, logout, changePassword
tracks-api.ts  listTracks(query, signal), deleteTrack(id), uploadTrack(file: File)
youtube-api.ts searchYouTube(q, limit, signal), queueDownload(payload),
               fetchDownloadStatus(id, signal), fetchActiveDownloads(signal),
               cancelDownload(id), retryDownload(id)
```

Контракты backend:

```text
POST /auth/register | /auth/login | /auth/logout | /auth/change-password
GET  /auth/me

GET    /tracks?q=&sort_by=&order=&limit=50&offset=0     → Paginated<Track>
DELETE /tracks/{track_id}                               → 204
POST   /tracks/upload (multipart: file)                 → Track

GET  /youtube/search?q=&limit=10                        → YouTubeSearchResponse
POST /youtube/download                                  → { track, queued }
GET  /youtube/downloads/active                          → { items: Track[] }
GET  /youtube/{track_id}                                → Track
POST /youtube/cancel/{track_id} | /retry/{track_id}     → Track

GET  /stream/{track_id}    (браузер напрямую, <audio>)
GET  /covers/{cover_name}  (браузер напрямую, <img>)
```

События и лайки (`events-api.ts`, `likes-api.ts`):

```text
POST /events                                           → 201 (тело игнорируется фронтендом)
GET  /events/me/stats?period_days=1|7|30 (1–30, def 7) → ListeningStats
GET  /likes                                            → LikeListResponse (пагинация)
GET  /likes/ids                                        → { track_ids: number[] } (все id сразу)
PUT    /likes/{track_id}                               → 200|201 Like
DELETE /likes/{track_id}                               → 204

GET  /admin/health                                     → AdminHealth (track_count, ffmpeg, диск, размеры хранилища)
POST /admin/thumbnails/clear                           → { deleted_files, freed_bytes }
POST /admin/commands/verify-storage                    → { ok, errors }
POST /admin/commands/cleanup-orphans                   → { deleted_count, files }
```

`GET /events/me/history` (ListeningHistoryResponse с пагинацией) существует в backend-контракте и в `types/events.ts`, но фронтенд его не использует — history-api в `events-api.ts` отсутствует.

Правила работы с URL и полями:

- Frontend использует только `audio_url` и `cover_url` из `Track`; внутренний `cover_path` не существует в типах.
- Превью результата поиска — проксированный `/youtube/thumbnail/{youtube_id}` (авторизованный endpoint backend'а), а не внешние URL YouTube.
- `GET /youtube/downloads/active` возвращает только активные статусы в порядке `created_at ASC, id ASC` — это снимок для reconciliation, источник истины — последний ответ `GET /youtube/{track_id}`.

Контракт прогресса (отображение без изменений):

```text
pending 0% | downloading 0–80% | converting 80–95% | finalizing 95–99% | done 100% | error | cancelled
```

## 8. Плеер и стриминг

- `PlayerBar` — единственный владелец `<audio preload="auto">`; источник — `/stream/{id}`. Cookie и Range-запросы браузер отправляет сам: перемотка и частичная загрузка работают без участия axios. Blob URL для обычного воспроизведения не создаётся.
- Первый запуск — после явного действия пользователя; `audio.play()` как Promise, отказ (autoplay-политики iOS) → `audioPaused()`, не ошибка приложения.
- Компонент обрабатывает `play/pause/timeupdate/loadedmetadata/waiting/stalled/canplay/ended/error`; `error` → `player.audioFailed(...)`.
- **Автовосстановление стрима** (`player.store`): обрыв фонового воспроизведения (Android Doze приостанавливает сеть, разрыв SSH-туннеля) рвёт Range-соединение, и браузер сам его не восстанавливает. Поэтому:
  - `audioFailed` больше не завершает воспроизведение ошибкой, а запускает восстановление: пауза 1 с → повторный `load(audio_url)` + `play()`; после `canplay` позиция восстанавливается одноразовым `seek()` (флаг `pendingResumeAt`); максимум 3 попытки (`MAX_RECOVERY_ATTEMPTS`), затем — постоянная ошибка «Не удалось воспроизвести трек» + `mediaSession.setPaused()`.
  - **stall-watchdog**: обрыв TCP без `error`-события проявляется как молчаливое зависание; каждый `timeupdate` при `isPlaying` перезаводит таймер 10 с (`STALL_TIMEOUT_MS`); срабатывание при игре запускает тот же путь восстановления. Ручная пауза (`audioPaused`) и любые смены трека/сброс (`playTrack`, `reset`) гасят таймеры и сбрасывают счётчик попыток; успешный старт (`audioPlaying`) возвращает счётчик в 0.
  - `preload="auto"` (вместо `metadata`) — больший буфер переживает короткие сетевые ямы без разрыва.
- Touch: `useSwipeSwitch` на панели — свайп влево/вправо (порог 25% ширины, вертикальный дрейф, превышающий горизонтальный, жестом не считается — это скролл страницы) переключает трек; кнопки/инпуты исключены (`shouldIgnoreTarget`), `touch-action: none` в CSS.
- **Кнопка лайка**: круглая 3×3rem слева от обложки (grid-область `like` на обоих брейкпоинтах). Неликнутое — контур в muted-цвете; лайкнутое — заливка `--track-accent` (цвет обложки играющего трека, как у play-кнопки) с тёмной иконкой. Toggle через общий `profile.toggleLike` — состояние синхронно между плеером, библиотекой и кабинетом.
- **Телеметрия прослушиваний** (`player.store`): события `play` (первый старт трека) и `complete`/`skip` (при ended и ручных переходах) уходят в `POST /events` fire-and-forget. **fraction_played — по фактически прослушанному времени**: `listenedSeconds` накапливается дельтами `timeupdate` ≤ 2 c (большой скачок = перемотка, не засчитывается); seek задаёт новую точку отсчёта; сброс при смене трека/reset. Перемотка на середину с дослушиванием даёт ~0.5, а не 1.0.
- Удаление трека: только после 204; при `409` player state не трогается.

## 9. UX-состояния и ошибки

Каждая страница различает: первичную загрузку (`LoadingState`), пустой результат (`EmptyState`), ошибку с retry (`ErrorState`), контент и недоступное действие (disabled + причина).

Маппинг статусов:

| Статус | Поведение |
|---|---|
| 401 `/auth/me` | завершить restore как anonymous |
| 401 прочие | teardown → `/login` |
| 403 | показать отказ (например, POST без доверенного Origin) |
| 404 | «ресурс исчез»; polling при 404 статуса повторится на следующем тике |
| 409 | конфликт (занят файл при удалении, дубликат при upload) — инлайн у строки/карточки |
| 422 | разбор полей в `ApiError.fields` |
| 429 | показать «слишком много попыток», без авто-ретраев |
| сеть/5xx | ошибка блока с кнопкой retry; polling не останавливается |

Ошибки по месту возникновения:

- удаление — инлайн-сообщение в `TrackRow` (`deleteError.id`);
- постановка загрузки — инлайн в `YouTubeResultCard` (`downloadError`);
- upload MP3 и события загрузок — тосты через `notifications.store`.

## 10. Производительность

- Библиотека — бесконечный список: первая партия 50 + догрузка по доскроллу (`IntersectionObserver`-сентинел, `rootMargin: 200px`, спиннер в сентинеле); наблюдатель перепривязывается к сентинелу через watcher за ref — сентинел рендерится динамически и в момент mount может не существовать; виртуализация не применяется.
- Поиск: debounce 350 мс (`useDebouncedSearch`), отмена устаревшего запроса через `AbortGroup`, `minLength = 2`.
- Обложки: `loading="lazy" decoding="async"`, фиксированные контейнеры (aspect-ratio) против layout shift.
- Аудио и blob-объекты никогда не попадают в Pinia.
- Polling ≤ 1 раза в 1.5 с на видимой вкладке, 12 с — на скрытой; моментальный refresh при возврате на вкладку.
- Lazy-чанки всех views и `AppShell`; анимации — CSS-транзишены, не JS-таймеры.
- `prefers-reduced-motion` глобально гасит анимации и переходы (base.css).

## 11. Визуальная система, адаптивность, доступность

Дизайн-токены — `styles/tokens.css`: тёмная тема (`color-scheme: dark`), палитра поверхностей/границ/текста, акцент `#a78bfa`, семантические цвета успеха/предупреждения/ошибки, шкала отступов `--space-*`, радиусы, тени, `--z-content/player/toast`, `--touch-target: 2.75rem`. `index.html` задаёт фон и `theme-color` до гидрации против белой вспышки.

Фоновое изображение рендерится фиксированным слоем `body::before` (`z-index: -1`, `pointer-events: none`) вместо `background-attachment: fixed`, который игнорируется iOS Safari. В `public/` лежат две копии исходника (3840×2160): `theme1.jpg` (горизонтальная, desktop) и `theme1-vertical.jpg` (пре-повёрнутая на 90°, mobile) — поворот выполнен на этапе ассетов, а не CSS-transform: компоситор Android ресемплирует повёрнутый слой при микросдвигах динамического вьюпорта, и фон «дрожал» при скролле. Слой — простая fixed-заливка `100vw × 100vh` (константы большого вьюпорта: не ресайзится и не сдвигается при скролле) на всех экранах; картинка переключается media-запросом: до 767px — `theme1-vertical.jpg`, от 768px — `theme1.jpg`. Слой затемнён градиентом `rgba(13, 15, 20, 0.38)` (цвет `--color-bg`) поверх фото — плотность регулируется одним значением в `base.css`. `--color-bg` остаётся подложкой на время загрузки (фон на `body` отсутствует намеренно — непрозрачный фон `body` отрисовывается поверх слоя `::before`).

### Liquid glass

Все стеклянные поверхности строятся на токенах `--glass-*` (`tokens.css`: два уровня плотности `--glass-surface/-strong`, `--glass-border`, `--glass-highlight`, `--glass-blur` для статичного стекла, `--glass-blur-liquid` для displacement-ветки) и двух паттернах:

- **`.glass` / `.glass--strong`** (`components.css`) — полупрозрачный фон + `backdrop-filter: blur() saturate()` + стеклянный край (border) + внутренний блик (`inset box-shadow`). Применяется к шапке, плееру, карточкам (`card`, `track-row`, `yt-card`), инпутам, тостам, кнопкам `btn-secondary`.
- **Displacement-каскад** (по статье «Liquid Glass на CSS», habr 974058): глобальный SVG-фильтр `#liquid-displacement` (`App.vue`: `feImage` с base64 PNG-шумом + `feDisplacementMap`, R-канал → X, G-канал → Y) вставляется в `backdrop-filter: url(#liquid-displacement) blur(4px)` через `@supports not (hanging-punctuation: first)` — условие истинно везде, кроме Safari, который не поддерживает SVG-фильтры в backdrop-filter и остаётся на обычном blur. Малый blur в liquid-ветке обязателен: под сильным размытием волна displacement не видна.
- **Гибрид**: displacement — только на каркасе (шапка, плеер, орбы навигации, мобильный док, тултипы, инпуты, `btn-secondary`, тосты, `.card`). Скроллящиеся списки (`.track-row`, `.yt-card`) — **матовое стекло** (статичный `blur(14px)`, без `@supports`-каскада): их десятки, волна на них не читается и бьёт по FPS.
- Отказ от эффектов: `@media (prefers-reduced-transparency: reduce)` возвращает всем `.glass` непрозрачные поверхности.

Ограничение: displacement применяется ко всем стеклянным элементам, включая скроллящиеся карточки — на слабом железе возможны лаги; при необходимости `.card`/`.track-row`/`.yt-card` переводятся на статичный blur правкой одного каскада.

### Навигация

Сайдбар-колонка удалена. `AppSidebar.vue` рендерит круглые стеклянные кнопки (`.app-sidebar__link`, диаметр `--nav-orb-size`/`--touch-target`) с иконкой по центру; подпись — стеклянная пилюля-тултип (`position: absolute` рядом с кнопкой), которая появляется по `:hover`/`:focus-visible` (`opacity` + `translateX`) и растворяется после ухода курсора — иконка при этом неподвижна. **Тултипы существуют только на desktop** (`@media (min-width: 768px)`; на тач-устройствах `display: none` — тап даёт `:focus-visible`, и пилюля не должна вылезать на телефоне). Активный маршрут — accent-заливка + pop-анимация. На ширине до 767px — прежний горизонтальный док внизу (стеклянная пилюля), на desktop — вертикальный стек у левого края по центру (`--nav-orb-dock-inset`), контент на всю ширину (grid `header/content`). `aria-label` остаётся на ссылке, тултип помечен `aria-hidden` (текст дублирует label).

Layout (`styles/layout.css`):

- mobile-first; `AppShell` — flex-колонка `min-height: 100svh` (desktop — grid `header/content` с `1fr`), рабочая область — flex-колонка: view может прижимать контент к низу страницы (`margin-top: auto`, пример — кнопка «Загрузить свой трек» в `SearchView`);
- до 767px навигация — плавающий нижний dock-док; `PlayerBar` закреплён над ним; контент получает нижний отступ под плеер + мобильную навигацию + `env(safe-area-inset-bottom)`;
- горизонтальный скролл запрещён (`overflow-x: hidden`, `min-width: 320px`).

Доступность:

- `*:focus-visible` — outline + focus-ring;
- `aria-label` у всех иконочных кнопок и контролов плеера; `aria-pressed` у сегментов сортировки;
- прогресс загрузки — `role="progressbar"` + `aria-live="polite"`-лейбл; тосты и live-сообщения поиска — `aria-live`;
- семантические элементы: `nav`, `header`, `main`, `section`, `form role="search"`, кнопки вместо кликабельных div;
- паттерн взаимодействия `TrackRow` зависит от среды: `useIsDesktop` (`hover + fine pointer`) — двойной клик по строке и hover-кнопка на обложке; на тач-устройствах — одиночный тап по строке;
- **sticky hover**: все hover-подсветки (строки и карточки треков, кнопки, инпуты, сегменты сортировки, skip-кнопки и орбы навигации) обёрнуты в `@media (hover: hover) and (pointer: fine)` — на тач-устройствах тап не «залипает» в hover-состоянии; `:focus-visible` и `--current`-состояния вне media и работают всегда.

Визуализация играющего трека: строка с `currentTrack.id` получает класс `.track-row--current` — постоянные hover-стили, но в контрастном цвете обложки: `player.store` держит `trackAccent` — доминирующий «живой» цвет обложки, извлечённый `services/cover-color.service.ts` (canvas-сэмпл 32×32, квантование, отброс выбросов, доводка насыщенности/светлоты; кэш + дедупликация in-flight по URL, фоллбэк — `--color-accent`). Цвет приходит в строку инлайн-CSS-переменной `--track-accent` и красит обводку строки, fade-подсветку обложки и эквалайзер из 5 анимированных полосок (блюр-оверлей обложки «как при наведении»); при паузе полоски замирают (`animation-play-state: paused`), `prefers-reduced-motion` показывает статичные полоски. Клик по обложке/строке играющего трека ставит его на паузу (`playOrToggle`), повторный — возобновляет. Прокидывание: `LibraryView` → `TrackList` (`current-track-id`, `is-playing`) → `TrackRow` (`isCurrent`, `isPlaying`).

Динамический акцент обложек:

- **Каждая строка** несёт `--track-accent` из цвета своей обложки (синхронный `resolveCoverColor` + колбэк готовности в `TrackRow`); hover строки красится её собственным цветом обложки — контрастная реакция до запуска воспроизведения.
- **Играющий трек**: эквалайзер использует `--track-accent-eq` — приоритетно `trackAccent` плеера (цвет обложки играющего трека).
- **Плеер**: `PlayerBar` выставляет `--track-accent` (merged computed со swipe-стилями) — кнопка play, слайдеры (`accent-color`), hover-подложки skip-кнопок перекрашиваются под цвет обложки играющего трека; при смене трека/сбросе переменная уходит, возвращая дефолтный акцент.

Проверяемые среды: Android Chrome/Firefox, iOS Safari (в т.ч. приватный режим — safe-guard'ы `localStorage`), desktop Chrome/Edge/Safari.

## 12. Известные ограничения

### Панель управления (`AdminView`)

Открывается по клику на никнейм в `AppHeader` (`RouterLink to="/admin"`, aria-label «Панель управления»; sticky-hover-подсветка цвета текста, как у остальных hover-элементов). Три секции-карточки (`.card.settings-section`, токены и стекло — как в кабинете):

- **Аккаунт** — секция-тоггл (форма скрыта по умолчанию): заголовок «Аккаунт» — кнопка с `aria-expanded`/`aria-controls` и CSS-шевроном (переиспользует hover/focus/reduced-motion паттерны). Внутри — форма смены пароля (текущий / новый ≥ 8 символов / повтор) поверх готового `auth-api.changePassword`; клиентская валидация длины и совпадения, ошибка 401 → «Текущий пароль неверен», успех → сброс полей + тост. Смена пароля отзывает прочие сессии (token_version) и выдаёт свежую cookie — состояние фронта не сбрасывается.
- **Состояние сервера** — `StorageDonutChart` (SVG-донат на `stroke-dasharray`; сегменты: аудио — accent, обложки — success, превью — warning, **свободное место на диске — 4-й сегмент** в `--color-surface-hover`; нулевые категории не рендерятся вовсе — round-cap рисовал бы точку; зазор между дугами только при 2+ сегментах, одиночная дуга — полное кольцо; центр — занято всего; `role="img"` + aria-label с раскладкой) и факты: число треков, свободно на диске, статус директорий и ffmpeg (ok/warn цветами). Загрузка при маунте — `LoadingState`/`ErrorState` с retry. Легенда строится из тех же `arcs` — согласована с диаграммой автоматически.
- **Обслуживание** — три действия с общим флагом `busyCommand` (кнопки disabled во время любой операции): «Очистить кэш превью» (`confirm()` → результат N файлов / освобождено X), «Проверить хранилище» (аналог CLI verify-storage: список ошибок или «проверка пройдена»), «Очистить сироты-файлы» (аналог CLI cleanup-orphans: `confirm()` → список удалённых). Результаты — inline-блоки + тосты через `notifications.store`; после очисток — обновление диаграммы (`loadHealth()`).

Форматирование байтов (Б/КБ/МБ/ГБ/ТБ) — локальные хелперы в `AdminView` и `StorageDonutChart`.

- `SettingsView` — личный кабинет: приветствие «Привет, {username}», секции Статистика → Плейлисты (заглушка «Появится скоро») → Любимое (с дозагрузкой при скролле), кнопка «Выйти» в шапке. Смена пароля живёт в панели управления `/admin` (см. выше).
  - **Статистика**: переключатель периода (24 часа / 7 дней / 30 дней — сегмент-кнопки, сменa → немедленный `refreshStats(days)`) + **автообновление каждые 30 с** через `createPolling` (`runOnStart: false`, чтобы не дублировать запрос `reloadProfile()` при маунте; в фоновой вкладке интервал больше, при возврате на вкладку — мгновенный тик). Заголовок секции отражает выбранный период; топ-3 ранжируется на бэке с затуханием по свежести (см. ARCHITECTURE.md). Общее время прослушивания показывается только в счётчиках сверху; у треков в топе время не выводится — только место, обложка, название и автор.
- Service worker не реализован: офлайн-режима нет, `manifest.webmanifest` даёт только установку иконки/темы.
- В `vite.config.ts` dev-порт `8080` (историческая документация упоминала `5173`).
- `E2E`-сценариев нет: покрытие — только модульные тесты.

## 13. Тесты

Запуск: `npm test` (Vitest, jsdom, `vi.useFakeTimers` для таймерозависимых сценариев). HTTP мокается подменой `apiClient.defaults.adapter`, FastAPI не нужен.

| Файл | Защищает |
|---|---|
| `stores/__tests__/auth.store.test.ts` | дедупликация restore, 401 → anonymous, transient-сбой 5xx не фиксирует `initialized` и повторяется, login/change-password, teardown при неудачном logout, interceptor 401 на защищённых запросах |
| `stores/__tests__/library.store.test.ts` | applyRouteQuery + нормализация, stale-ответы, ошибки + retry, локальное удаление (204/409), `loadNextPage` + дедупликация вызовов и дублей списка, offset 0 при загрузке, отмена prefetch обычной загрузкой, reset по teardown |
| `stores/__tests__/downloads.store.test.ts` | restore + polling, терминальные статусы, связь с результатами поиска, дедупликация, stale generation (cancel/retry/reset), скрытая вкладка, teardown, abort in-flight |
| `stores/__tests__/player.store.test.ts` | команды адаптера, персист громкости, контекст prev/next с пропуском неготовых, prefetch supplier, fallback `ended`, эпохи против гонок, очередь, removeTrack, teardown, автовосстановление стрима (retry с позицией, лимит попыток, stall-watchdog, сброс при смене трека/паузе) |
| `stores/__tests__/profile.store.test.ts` | ленивая загрузка один раз за сессию, сердечки из `/likes/ids` видны для лайков за пределами первой партии списка, догрузка «Любимого» не перезаписывает ids, reloadProfile, оптимистичный toggle + откат, дедупликация страниц, teardown |
| `router/__tests__/guards.test.ts` | redirect anonymous с сохранением `redirect`, guestOnly, один restore на навигации, redirect на login при transient-сбое restore и повтор после восстановления, 401 после входа → login |
| `views/__tests__/library-view.test.ts` | рендер строк и счётчик, debounce-поиск → URL, сортировка → URL, сентинел/спиннер догрузки, play через store, сквозное воспроизведение в следующую партию, локальное удаление, live-прогресс |
| `views/__tests__/search-view.test.ts` | рендер результатов, empty/error/429-retry, постановка загрузок и статусы кнопок, upload (успех/ошибка/disabled), обновление библиотеки после upload |
| `views/__tests__/auth-views.test.ts` | login с `redirect`, register |
| `views/__tests__/settings-view.test.ts` | кабинет: статистика и переключатель периода, секция «Любимое», заглушка плейлистов, logout |
| `components/__tests__/player-bar.test.ts` | связь audio events ↔ store, исполнение команд, инпуты seek/volume, восстановление стрима после `error` вместо финальной ошибки |
| `components/__tests__/app-shell.test.ts` | protected shell: навигация + пользователь |
| `composables/__tests__/use-debounced-search.test.ts` | debounce, minLength, abort, ошибки |
| `services/__tests__/cover-color.service.test.ts` | квантование, сохранение hue, отброс выбросов, прозрачный сэмпл → null |
| `api/__tests__/*.test.ts`, `__tests__/smoke.test.ts` | транспорт и контракты |

Правило границ: компонентные тесты `PlayerBar` проверяют только мост audio ↔ store; бизнес-правила очереди — в тестах `player.store`.
