# Travel Globe Animator (MVP)

Клиентское Angular-приложение для построения flight-дуги (great-circle) между двумя городами, анимации самолёта и экспорта 4K-видео без сервера.

## Быстрый старт

```bash
pnpm install --config.package-manager-strict=false
pnpm start
```

Откройте `http://localhost:4200`.

## Что есть в MVP

- `From city` / `To city` + `Build route`
- Подсказки городов через OSM Nominatim (debounce 400ms + cache)
- Fallback: ручной ввод координат в `Advanced`
- 3D Globe на Cesium + OSM tiles (без Cesium Ion token)
- Дуговой маршрут с настраиваемой высотой
- Анимация самолёта: `Play / Pause / Reset`, duration, progress slider, `Fit to route`
- `Export 4K video`: оффлайн-рендер 3840x2160, 30fps

## Экспорт 4K: режимы

1. `WebCodecs + webm-muxer` (предпочтительно, frame-by-frame оффлайн)
2. `MediaRecorder` fallback (best effort, зависит от производительности)
3. `PNG sequence ZIP` fallback (каждый 5-й кадр)

## Поддержка браузеров

- Рекомендуется: **Chrome / Edge (новые версии)** с поддержкой WebCodecs
- Firefox: обычно fallback на MediaRecorder / PNG
- Safari: возможны ограничения WebCodecs/MediaRecorder, будет fallback

## Ограничения

- Геокодинг Nominatim может временно ограничивать частые запросы (`429`)
- 4K экспорт тяжёлый по CPU/RAM; закройте тяжёлые вкладки
- Видео без звука (только анимация маршрута)
