// Русская локализация сообщений об ошибках, приезжающих из бэкенда/axios.
//
// Источники английского:
//  1) detail-строки FastAPI-обработчиков (backend/app, собраны грепом);
//  2) шаблонные axios-сообщения при отсутствии detail
//     ("Request failed with status code 500", "Network Error", ...);
//  3) pydantic-валидация (массив detail) — форматируется по имени поля.
//
// Принцип: неизвестные строки проходят прозрачно — локализация не должна
// ухудшить сообщение.

/** Точные detail-строки бэкенда → русский текст. */
const DETAIL_TRANSLATIONS: Record<string, string> = {
  // playlists / tracks
  'Track is already in the playlist': 'Трек уже добавлен в плейлист',
  'This track is already in the library': 'Этот трек уже есть в библиотеке',
  'Track not found': 'Трек не найден',
  'Playlist not found': 'Плейлист не найден',
  'Only the playlist owner can do this': 'Это может делать только владелец плейлиста',
  'track_ids do not match the playlist contents':
    'Порядок треков устарел — обновите страницу и попробуйте снова',
  // uploads / files
  'The file is too large': 'Файл слишком большой',
  'Only non-empty mp3 files are supported': 'Поддерживаются только непустые mp3-файлы',
  'Track files could not be removed': 'Не удалось удалить файлы трека',
  // auth
  'Username is already registered': 'Это имя пользователя уже занято',
  'Invalid username or password': 'Неверное имя пользователя или пароль',
  'Too many login attempts': 'Слишком много попыток входа — попробуйте позже',
  'Current password is invalid': 'Текущий пароль неверен',
  'Authentication required': 'Требуется вход',
  'Invalid session': 'Сессия недействительна — войдите заново',
  // youtube
  'Too many search requests': 'Слишком много поисковых запросов — попробуйте позже',
  'Only failed or cancelled downloads can be retried':
    'Повторить можно только отменённую или неудавшуюся загрузку',
  'Thumbnail not found': 'Превью не найдено',
  // misc
  'Range not satisfiable': 'Запрошенный диапазон недоступен',
  'Origin is not allowed': 'Запрос с этого источника запрещён',
}

/** Fallback по статусу — только для шаблонного английского axios. */
const STATUS_FALLBACK: Record<number, string> = {
  400: 'Некорректный запрос',
  401: 'Требуется вход',
  403: 'Доступ запрещён',
  404: 'Не найдено',
  409: 'Такая запись уже существует',
  413: 'Файл слишком большой',
  422: 'Проверьте правильность заполнения полей',
  429: 'Слишком много запросов — попробуйте позже',
}

const NETWORK_FALLBACK = 'Не удалось выполнить запрос — проверьте подключение'
const SERVER_FALLBACK = 'Ошибка сервера — попробуйте позже'

const AXIOS_BOILERPLATE = /^(Request failed with status code|Network Error|timeout of|ERR_)/

/**
 * Локализует плоский detail: точное совпадение со словарём, иначе статусный
 * fallback для axios-шаблонов, иначе строка как есть.
 */
export function localizeApiDetail(detail: string, status: number): string {
  const translated = DETAIL_TRANSLATIONS[detail]
  if (translated !== undefined) {
    return translated
  }

  if (AXIOS_BOILERPLATE.test(detail)) {
    if (status >= 500) {
      return SERVER_FALLBACK
    }
    return STATUS_FALLBACK[status] ?? (status === 0 ? NETWORK_FALLBACK : detail)
  }

  return detail
}

/** Human-readable названия полей для pydantic-сообщений. */
const FIELD_NOUNS: Record<string, string> = {
  username: 'Имя пользователя',
  password: 'Пароль',
  current_password: 'Текущий пароль',
  new_password: 'Новый пароль',
  name: 'Название',
}

/**
 * Локализует одно pydantic-нарушение по полю. Понимает ограничения
 * length-min/max; прочие формулы возвращаются как есть (прозрачность).
 */
export function localizeValidationMessage(field: string, message: string): string {
  const noun = FIELD_NOUNS[field] ?? null

  const minMatch = message.match(/^String should have at least (\d+) characters?$/)
  if (minMatch !== null && noun !== null) {
    return `${noun}: минимум ${minMatch[1]} симв.`
  }

  const maxMatch = message.match(/^String should have at most (\d+) characters?$/)
  if (maxMatch !== null && noun !== null) {
    return `${noun}: максимум ${maxMatch[1]} симв.`
  }

  return message
}
