import { describe, expect, it } from 'vitest'

import { localizeApiDetail, localizeValidationMessage } from '../error-messages'

describe('localizeApiDetail — точные строки бэкенда', () => {
  it('переводит 409 конфликт добавления трека в плейлист', () => {
    expect(localizeApiDetail('Track is already in the playlist', 409)).toBe(
      'Трек уже добавлен в плейлист',
    )
  })

  it('переводит остальные известные detail независимо от статуса', () => {
    expect(localizeApiDetail('Username is already registered', 409)).toBe(
      'Это имя пользователя уже занято',
    )
    expect(localizeApiDetail('The file is too large', 413)).toBe('Файл слишком большой')
    expect(localizeApiDetail('Too many login attempts', 429)).toBe(
      'Слишком много попыток входа — попробуйте позже',
    )
    expect(localizeApiDetail('Invalid username or password', 401)).toBe(
      'Неверное имя пользователя или пароль',
    )
    expect(localizeApiDetail('This track is already in the library', 409)).toBe(
      'Этот трек уже есть в библиотеке',
    )
  })

  it('не трогает уже русские строки', () => {
    expect(localizeApiDetail('Трек добавлен в плейлист', 200)).toBe('Трек добавлен в плейлист')
  })

  it('пропускает неизвестные строки прозрачно', () => {
    expect(localizeApiDetail('Some future backend message', 400)).toBe(
      'Some future backend message',
    )
  })
})

describe('localizeApiDetail — axios boilerplate и статусный fallback', () => {
  it(' axios "Request failed with status code 500" → серверная формулировка', () => {
    expect(localizeApiDetail('Request failed with status code 500', 500)).toBe(
      'Ошибка сервера — попробуйте позже',
    )
  })

  it('axios "Network Error" (status 0) → сообщение о сети', () => {
    expect(localizeApiDetail('Network Error', 0)).toBe(
      'Не удалось выполнить запрос — проверьте подключение',
    )
  })

  it('boilerplate со статусом без формулы → статусный fallback', () => {
    expect(localizeApiDetail('Request failed with status code 404', 404)).toBe('Не найдено')
  })
})

describe('localizeValidationMessage — pydantic-поля', () => {
  it('минимальная длина пароля', () => {
    expect(localizeValidationMessage('password', 'String should have at least 8 characters')).toBe(
      'Пароль: минимум 8 симв.',
    )
  })

  it('минимальная длина имени пользователя', () => {
    expect(localizeValidationMessage('username', 'String should have at least 3 characters')).toBe(
      'Имя пользователя: минимум 3 симв.',
    )
  })

  it('известное поле, но незнакомая формула → сообщение как есть', () => {
    expect(localizeValidationMessage('password', 'Value error, weak password')).toBe(
      'Value error, weak password',
    )
  })

  it('неизвестное поле → сообщение как есть', () => {
    expect(localizeValidationMessage('widget', 'Input should be a valid integer')).toBe(
      'Input should be a valid integer',
    )
  })
})
