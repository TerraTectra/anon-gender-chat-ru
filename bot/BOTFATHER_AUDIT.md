# BotFather audit

Audit date: 2026-07-17.

## Active family

All ten bots below answer the Telegram Bot API, use long polling without webhooks, and are launched by the `AnonGenderChatBot` scheduled task.

| Bot | Purpose | Main commands |
| --- | --- | --- |
| `@anon_gender_chat_ru_bot` | Anonymous age-safe matching and chat | `/start`, `/stats`, `/invite`, `/catalog`, `/reset` |
| `@anon_gender_chat_ru_admin_bot` | Private network administration, metrics, reports and channel publishing | `/start`, `/overview`, `/daily`, `/growth`, `/channels` |
| `@EnglishTalkMatchBot` | English conversation partner matching | `/start`, `/stats`, `/invite`, `/bots` |
| `@FocusSprintTimerBot` | Focus sessions and completion statistics | `/start`, `/focus`, `/stats`, `/invite`, `/bots` |
| `@GameMateFinderRuBot` | Teammate matching by game and player profile | `/start`, `/stats`, `/invite`, `/bots` |
| `@PocketBudgetRuBot` | Personal income and expense tracking | `/start`, `/today`, `/month`, `/limit`, `/undo`, `/bots` |
| `@TerraTectraBotsBot` | Family catalogue, recommendations and tracked product links | `/start`, `/bots`, `/suggest` |
| `@DevTaks_bot` | Telegram tasks and reminders | `/start`, `/tasks`, `/done`, `/snooze`, `/bots` |
| `@TectraQuizBot` | Short knowledge quizzes, daily challenge, streaks and referrals | `/start`, `/quiz`, `/daily`, `/score`, `/invite`, `/bots` |
| `@TectraPartyBot` | Seven social game modes, daily prompt and streaks | `/start`, `/play`, `/daily`, `/story`, `/stats`, `/invite`, `/bots` |

## Profile completeness

- All ten active bots have a profile photo.
- Quiz and party avatars were added on 2026-07-17 in the shared neon robot style.
- Run `npm run profiles:audit` to inspect avatars, descriptions, short descriptions and commands without exposing bot tokens.
- Run `npm run profiles:audit:strict` in automated checks when an incomplete profile should fail the check.

## Removed legacy bots

The following BotFather entries had no running service, no useful profile or duplicated an active product. They were deleted instead of keeping dead public handles:

- `@autodeals_1764060561_bot`
- `@autodeals_1764059431_bot`
- `@OmnixRelayBot`
- `@signalwatchapp_bot`
- `@smartshifts_bot`
- `@anonimniychatallfree_bot`
- `@TURBOTOOLS_bot`
- `@CoderMistral_bot`
- `@JarvisResponder_bot`
- `@JarvisMVP_bot`
- `@JUBBot_bot`

## Entertainment publishing

- `@TectraFun` has 20 rotating posts and four daily slots: 08:45, 12:30, 16:15 and 20:45 Moscow time.
- `@TectraQuiz` has 18 rotating posts and three daily slots: 10:00, 14:00 and 19:30 Moscow time.
- Both channels are enabled. `@TectraPartyBot` publishes their queues and has only the Telegram permission to post messages.
