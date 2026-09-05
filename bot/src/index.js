import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { createAdminBot } from "./admin-bot.js";
import { createBudgetBot } from "./budget-bot.js";
import { ChannelPublisher } from "./channel-publisher.js";
import { createEnglishBot } from "./english-bot.js";
import { createFocusBot } from "./focus-bot.js";
import { createGameBot } from "./game-bot.js";
import { createHubBot } from "./hub-bot.js";
import { createPartyBot } from "./party-bot.js";
import { createQuizBot } from "./quiz-bot.js";
import { createTaskBot } from "./task-bot.js";
import { createUserBot } from "./user-bot.js";
import { isTelegramPollingConflict, safeErrorSummary } from "./safe-error.js";
import { acquireSingleInstance, AlreadyRunningError, SINGLE_INSTANCE_EXIT_CODE } from "./single-instance.js";

const token = process.env.BOT_TOKEN?.trim();
const adminToken = process.env.ADMIN_BOT_TOKEN?.trim();
const englishToken = process.env.ENGLISH_BOT_TOKEN?.trim();
const focusToken = process.env.FOCUS_BOT_TOKEN?.trim();
const gameToken = process.env.GAME_BOT_TOKEN?.trim();
const budgetToken = process.env.BUDGET_BOT_TOKEN?.trim();
const hubToken = process.env.HUB_BOT_TOKEN?.trim();
const taskToken = process.env.TASK_BOT_TOKEN?.trim();
const quizToken = process.env.QUIZ_BOT_TOKEN?.trim();
const partyToken = process.env.PARTY_BOT_TOKEN?.trim();

if (!token) throw new Error("BOT_TOKEN is not set in bot/.env");
if (!adminToken) throw new Error("ADMIN_BOT_TOKEN is not set in bot/.env");
if (token === adminToken) throw new Error("BOT_TOKEN and ADMIN_BOT_TOKEN must be different");

let instanceLock;
try {
  instanceLock = await acquireSingleInstance();
} catch (error) {
  if (error instanceof AlreadyRunningError) {
    console.error("Bot network is already running on this computer; duplicate start cancelled.");
    process.exit(SINGLE_INSTANCE_EXIT_CODE);
  }
  throw error;
}

const dbPath = process.env.DB_PATH || "./data/chat.db";
const englishDbPath = process.env.ENGLISH_DB_PATH || "./data/english-chat.db";
const focusDbPath = process.env.FOCUS_DB_PATH || "./data/focus.db";
const gameDbPath = process.env.GAME_DB_PATH || "./data/game.db";
const budgetDbPath = process.env.BUDGET_DB_PATH || "./data/budget.db";
const hubDbPath = process.env.HUB_DB_PATH || "./data/hub.db";
const taskDbPath = process.env.TASK_DB_PATH || "./data/tasks.db";
const quizDbPath = process.env.QUIZ_DB_PATH || "./data/quiz.db";
const partyDbPath = process.env.PARTY_DB_PATH || "./data/party.db";
const sessionArchiveRoot = process.env.SESSION_ARCHIVE_ROOT || undefined;
const userBot = createUserBot(token, dbPath, { sessionArchiveRoot });
const partyBot = partyToken ? createPartyBot(partyToken, partyDbPath) : null;
let channelPublisher = null;
const adminBot = createAdminBot(adminToken, dbPath, process.env.ADMIN_IDS, {
  sessionArchiveRoot,
  englishDbPath: englishToken ? englishDbPath : null,
  focusDbPath: focusToken ? focusDbPath : null,
  gameDbPath: gameToken ? gameDbPath : null,
  budgetDbPath: budgetToken ? budgetDbPath : null,
  hubDbPath: hubToken ? hubDbPath : null,
  taskDbPath: taskToken ? taskDbPath : null,
  quizDbPath: quizToken ? quizDbPath : null,
  partyDbPath: partyToken ? partyDbPath : null,
  healthPath: process.env.HEALTH_PATH || "./data/health.json",
  reportStatePath: process.env.ADMIN_REPORT_STATE_PATH || "./data/admin-report-state.json",
  reportHour: Number(process.env.ADMIN_REPORT_HOUR || 10),
  sourceMediaSender: async (chatId, media, caption) => {
    const common = { protect_content: true };
    if (media.kind === "photo") {
      return userBot.api.sendPhoto(chatId, media.file_id, { ...common, caption });
    }
    if (media.kind === "video") {
      return userBot.api.sendVideo(chatId, media.file_id, { ...common, caption });
    }
    await userBot.api.sendMessage(chatId, caption, common);
    return userBot.api.sendVideoNote(chatId, media.file_id, common);
  },
  channelStatusProvider: () => channelPublisher?.status() || []
});
channelPublisher = new ChannelPublisher(
  (channel) => channel.publisher === "party" && partyBot ? partyBot.api : adminBot.api,
  process.env.CHANNELS_CONFIG_PATH || "./content/channels.json",
  process.env.CHANNELS_STATE_PATH || "./data/channel-publisher-state.json"
);
const englishBot = englishToken ? createEnglishBot(englishToken, englishDbPath) : null;
const focusBot = focusToken ? createFocusBot(focusToken, focusDbPath) : null;
const gameBot = gameToken ? createGameBot(gameToken, gameDbPath) : null;
const budgetBot = budgetToken ? createBudgetBot(budgetToken, budgetDbPath) : null;
const hubBot = hubToken ? createHubBot(hubToken, hubDbPath) : null;
const taskBot = taskToken ? createTaskBot(taskToken, taskDbPath) : null;
const quizBot = quizToken ? createQuizBot(quizToken, quizDbPath) : null;
focusBot?.startFocusScheduler();
taskBot?.startTaskScheduler();
adminBot.startDailyReportScheduler();
channelPublisher.start();

const botCount = 2
  + Number(Boolean(englishBot))
  + Number(Boolean(focusBot))
  + Number(Boolean(gameBot))
  + Number(Boolean(budgetBot))
  + Number(Boolean(hubBot))
  + Number(Boolean(taskBot))
  + Number(Boolean(quizBot))
  + Number(Boolean(partyBot));

const healthPath = path.resolve(process.env.HEALTH_PATH || "./data/health.json");
let healthStatus = "starting";
function writeHealth(status = healthStatus, details = {}) {
  healthStatus = status;
  fs.mkdirSync(path.dirname(healthPath), { recursive: true });
  const temporary = `${healthPath}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({
    status,
    updated_at: new Date().toISOString(),
    bots: botCount,
    channels: channelPublisher.status().filter((channel) => channel.enabled).length,
    ...details
  }, null, 2));
  fs.renameSync(temporary, healthPath);
}
writeHealth("starting");
const healthTimer = setInterval(() => writeHealth(), 30_000);
const readyTimer = setTimeout(() => writeHealth("running"), 5_000);
let shutdownPromise = null;

function safely(callback) {
  try {
    callback?.();
  } catch {
    // A bot can reject startup before its runner becomes stoppable.
  }
}

function shutdown(status = "stopped", details = {}) {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    clearInterval(healthTimer);
    clearTimeout(readyTimer);
    writeHealth(status, details);
    safely(() => userBot.stopSessionRetention());
    safely(() => userBot.stop());
    safely(() => adminBot.stopDailyReportScheduler());
    safely(() => channelPublisher.stop());
    safely(() => adminBot.stop());
    safely(() => englishBot?.stop());
    safely(() => focusBot?.stopFocusScheduler());
    safely(() => focusBot?.stop());
    safely(() => gameBot?.stop());
    safely(() => budgetBot?.stop());
    safely(() => hubBot?.stop());
    safely(() => taskBot?.stopTaskScheduler());
    safely(() => taskBot?.stop());
    safely(() => quizBot?.stop());
    safely(() => partyBot?.stop());
    safely(() => userBot.closeStore());
    safely(() => adminBot.closeStore());
    await instanceLock.release();
  })();
  return shutdownPromise;
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

console.log(`Starting ${botCount} bots in long-polling mode`);
const starts = [
  userBot.start({ drop_pending_updates: false }),
  adminBot.start({ drop_pending_updates: false })
];
if (englishBot) starts.push(englishBot.start({ drop_pending_updates: false }));
if (focusBot) starts.push(focusBot.start({ drop_pending_updates: false }));
if (gameBot) starts.push(gameBot.start({ drop_pending_updates: false }));
if (budgetBot) starts.push(budgetBot.start({ drop_pending_updates: false }));
if (hubBot) starts.push(hubBot.start({ drop_pending_updates: false }));
if (taskBot) starts.push(taskBot.start({ drop_pending_updates: false }));
if (quizBot) starts.push(quizBot.start({ drop_pending_updates: false }));
if (partyBot) starts.push(partyBot.start({ drop_pending_updates: false }));
try {
  await Promise.all(starts);
  await shutdown();
} catch (error) {
  const conflict = isTelegramPollingConflict(error);
  const status = conflict ? "conflict" : "failed";
  const summary = safeErrorSummary(error);
  console.error(conflict ? `Telegram polling conflict: ${summary}` : `Bot network failed: ${summary}`);
  await shutdown(status, { error: summary });
  process.exitCode = conflict ? SINGLE_INSTANCE_EXIT_CODE : 1;
}
