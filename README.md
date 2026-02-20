# Stripchat Extension: РЕЖИССЁР (MVP)

MVP-экстеншн в стиле "Dark Cinematic" с механикой:

- Предпродакшн до `50` тк (настраивается)
- Переход в LIVE
- Режиссёр (топ донатер), Претендент (2 место), Толпа
- Смена власти по правилам `Margin` + `Tenure`
- Режиссёрский пульт с cooldown
- Производственная доска на основе реального tip menu модели
- Перераспределение пользователем своих уже внесённых токенов между позициями (без возврата)

## Критичное обновление SDK

Добавлен новый метод Platform SDK:

- `v1.model.tip.menu.get`

Возвращает текущий список позиций tip menu модели и цены.

В host-обработчике (`stripchat`) метод берет актуальные данные из `viewCam.tipMenu` (`getTipMenuSettings`).

## Структура extension

- `background.html` + `src/background.js`
- `menu.html` + `src/menu.js`
- `overlay.html` + `src/overlay.js`
- `settings.html` + `src/settings.js`
- `public/manifest.json`
- `public/resolveSlotPage.js`

## Слоты

- `mainGameFun` -> `menu.html`
- `rightOverlay` -> `overlay.html`
- `background` -> `background.html` (только модель)

## Роли в tab (mainGameFun)

- Режиссёр: пульт + доска + типы + перераспределение
- Зритель: доска + типы + перераспределение
- Модель: только состояние сборов/очереди/команд

## Backend

Backend для персистентного state sync:

- `/Users/flame/Documents/SC/director-extension/backend`

Ключевые гарантии синхронизации:

- stale snapshot не перезапишет более новый (backend вернет `409`);
- без KV backend не будет молча работать в неперсистентном режиме (`503`), если явно не включен `ALLOW_MEMORY_FALLBACK=true`;
- background делает heartbeat-sync в backend и heartbeat-broadcast состояния для новых подключений.

Деплой на Vercel описан в:

- `/Users/flame/Documents/SC/director-extension/backend/README.md`

## Локальный запуск

```bash
cd /Users/flame/Documents/SC/director-extension
npm install
npm run dev
```

## Сборка

```bash
cd /Users/flame/Documents/SC/director-extension
npm run build
```

Итоговый архив для загрузки в платформу:

- `/Users/flame/Documents/SC/director-extension/director-extension.zip`
