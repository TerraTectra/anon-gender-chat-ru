# Telegram Bot Network

## Entertainment launch

- `@TectraQuizBot` focuses on short quizzes, scores and referrals.
- `@TectraPartyBot` provides seven social modes: truth, dare, would-you-rather, charades, icebreakers, collaborative stories and "who is most likely" prompts.
- `@TectraFun` publishes entertainment prompts four times a day at 08:45, 12:30, 16:15 and 20:45 Moscow time.
- `@TectraQuiz` publishes quiz posts three times a day at 10:00, 14:00 and 19:30 Moscow time.
- `@TectraPartyBot` is the channel publisher and has only the Telegram permission required to post messages.
- The AI, focus and money channels now publish twice a day. Every schedule slot is tracked separately, so restarts do not create duplicate posts.
- Quiz keeps a compact party shortcut, while the standalone Party bot offers the broader entertainment catalogue and separate engagement statistics.

Одна Node.js-служба запускает пользовательские продукты и общую закрытую админку. Данные каждого продукта хранятся в отдельной SQLite-базе.

Служба также ведёт контентную сеть TerraTectra: планирует публикации из очередей, защищает их от повторной отправки после перезапуска и показывает состояние каналов в админке.

## Продукты

- `@TerraTectraBotsBot` — семейный хаб с категориями, рекомендациями и предложениями новых идей.
- `@DevTaks_bot` — Task Pulse: задачи и устойчивые к перезапуску напоминания с точной датой и временем по Москве.
- `@anon_gender_chat_ru_bot` — анонимный чат с возрастным разделением.
- `@EnglishTalkMatchBot` — поиск партнёра для практики английского.
- `@FocusSprintTimerBot` — устойчивые к перезапуску фокус-таймеры.
- `@GameMateFinderRuBot` — поиск игровых напарников.
- `@PocketBudgetRuBot` — учёт доходов и расходов с CSV-экспортом.
- `@anon_gender_chat_ru_admin_bot` — единый админ-хаб: статистика сети, жалобы, блокировки, активные и сохранённые медиасессии анонимного чата.

## Сессии анонимного чата

- Админ-хаб показывает текущие пары без сохранения текста переписки.
- Фото, видео и видеокружки временно загружаются в `data/chat-session-archive`, который не попадает в 14-дневные копии основных баз.
- Шестое суммарное вложение включает сохранение медиасессии. После завершения она доступна семь суток, затем метаданные и локальные файлы удаляются.
- Сессии с пятью или меньшим числом целевых вложений удаляются сразу после завершения.
- Стандартный Telegram Bot API не позволяет скачать файл больше 20 МБ. Для такого файла админ-хаб хранит метаданные и при просмотре использует основной анон-бот как резервный канал отправки.

## Контентные каналы

- `@TerraTectraAI` — прикладной ИИ и автоматизация.
- `@TerraTectraFocus` — задачи, внимание и рабочий ритм.
- `@TerraTectraMoney` — бытовой учёт денег и финансовые привычки.

## Надёжность

- `AnonGenderChatBot` держит сеть запущенной и перезапускает процесс после сбоя.
- И служба Node.js, и фоновый runner имеют singleton-защиту: вторая копия не начинает polling и не запускает бесконечный цикл конфликтов.
- `AnonGenderChatHealthCheck` проверяет `data/health.json` каждые пять минут.
- `AnonGenderChatBackup` ежедневно в 03:00 создаёт согласованные SQLite-копии.
- Копии хранятся в `data/backups` 14 дней.
- Вывод процесса записывается в ежедневные файлы `logs/bot-YYYY-MM-DD.log`.

## Установка

1. Установите Node.js 22 или новее.
2. Выполните `npm install`.
3. Создайте `.env` по образцу `.env.example` и добавьте токены.
4. Запустите `install-autostart.ps1`.

Секреты, базы, резервные копии, логи и `node_modules` исключены из Git.

## Проверка

```powershell
npm test
npm run profiles:audit:strict
node --check src/index.js
node scripts/backup.mjs
```

В админ-боте доступны:

- `/stats` — текущее состояние;
- `/sessions` — активные сессии анонимного чата;
- `/media_sessions` — активные и завершённые медиасессии с шестью и более вложениями;
- `/growth` — продуктовые метрики за семь дней;
- `/reports` — жалобы из чат-ботов;
- `/sources` — источники пользователей, включая переходы из хаба;
- `/campaigns` — регистрации, активные пользователи, конверсия и действия по каждому источнику во всём семействе;
- `/funnel` — конверсия семейного хаба и интерес к продуктам;
- `/channels` — расписание и состояние автопубликаций;
- `/ban ID` и `/unban ID` — блокировка во всей сети.
