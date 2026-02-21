# Director Extension Backend (Vercel)

Backend для экстеншна `РЕЖИССЁР`.

## Endpoints

- `GET /api/health`
- `GET /api/tip-menu?username=<model_username>&host=<optional_origin>`
- `GET /api/sessions/:sessionId`
- `PUT /api/sessions/:sessionId` с телом `{ "state": { ... } }`
- `DELETE /api/sessions/:sessionId`

## Storage

- Рекомендуемый вариант в Vercel Marketplace: **Upstash (Redis)**.
- Backend поддерживает оба набора env:
  - `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (Marketplace Upstash),
  - `KV_REST_API_URL` + `KV_REST_API_TOKEN` (старый формат Vercel KV).
- Если заданы переменные любого из наборов выше, используется Redis (персистентно).
- Если KV не задан:
  - по умолчанию backend возвращает `503` на работу с сессиями (чтобы не было тихой потери данных),
  - для локальной отладки можно включить `ALLOW_MEMORY_FALLBACK=true` (неперсистентно между cold start).
- `PUT /api/sessions/:sessionId` защищен от stale-write: старый снапшот не перезапишет более новый (`409 Conflict`).

## Env vars

- `BACKEND_API_KEY` — опциональный ключ. Если задан, клиент должен передавать его в `x-api-key`.
- `CORS_ORIGINS` — `*` или список origin через запятую.
- `TIP_MENU_ORIGINS` — опциональный список origin для fallback tip menu, через запятую.
- `SESSION_TTL_SEC` — TTL сессии в секундах (по умолчанию 259200).
- `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` — для Upstash (предпочтительно).
- `KV_REST_API_URL` / `KV_REST_API_TOKEN` — альтернативный/legacy формат Vercel KV.
- `ALLOW_MEMORY_FALLBACK` — только для локальной отладки (`true`/`false`).

## Deploy на Vercel

1. Откройте этот каталог как отдельный проект:
   - `/Users/flame/Documents/SC/director-extension/backend`
2. Добавьте env vars из раздела выше.
3. Деплойте командой `vercel --prod`.
4. В настройках экстеншна укажите:
   - `Backend URL`: `https://<your-project>.vercel.app`
   - `Backend API key`: значение `BACKEND_API_KEY` (если используете).

## Локальный запуск

```bash
cd /Users/flame/Documents/SC/director-extension/backend
npm install
npm run dev
```
