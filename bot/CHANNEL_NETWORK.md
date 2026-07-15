# TerraTectra Channel Network

## Active schedule

| Channel | Moscow time | Purpose |
| --- | --- | --- |
| `@TerraTectraAI` | 09:15, 16:45 | Practical AI and automation |
| `@TerraTectraFocus` | 10:30, 15:30 | Focus and work habits |
| `@TerraTectraMoney` | 11:45, 18:30 | Personal finance habits |
| `@TectraFun` | 08:45, 14:15, 20:45 | Prepared; awaiting publisher admin rights |
| `@TectraQuiz` | 11:00, 19:30 | Prepared; awaiting publisher admin rights |

The publisher accepts either one `schedule` value or an array of time slots. It records each completed slot separately and, after downtime, publishes only the latest overdue item instead of flooding a channel.

Контентная сеть дополняет продуктовых ботов и ведёт аудиторию в семейный хаб через отдельные метки источников.

## Первая линейка

- **TerraTectra AI Практика** — прикладной ИИ и автоматизация без новостного шума.
- **TerraTectra Фокус** — задачи, внимание и личная система работы.
- **TerraTectra Деньги** — спокойный бытовой учёт финансов без инвестиционных рекомендаций.

## Автопубликация

Очереди находятся в `content/channels.json`. Служба раз в минуту проверяет московское расписание и публикует не более одного поста в каждый канал за день. Позиция очереди и история отправок хранятся в `data/channel-publisher-state.json`.

Для запуска канала:

1. Создать публичный Telegram-канал с `chatId` из конфигурации.
2. Добавить `@anon_gender_chat_ru_admin_bot` администратором с правом публикации.
3. Переключить `enabled` на `true`.
4. Проверить статус командой `/channels` в приватном Admin Hub.

Ссылки в публикациях используют источники `src_channel_ai`, `src_channel_focus` и `src_channel_money`, поэтому регистрации видны в разделах источников и кампаний.
