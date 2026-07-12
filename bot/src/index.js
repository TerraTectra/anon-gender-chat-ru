import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { createAdminBot } from "./admin-bot.js";
import { createBudgetBot } from "./budget-bot.js";
import { createEnglishBot } from "./english-bot.js";
import { createFocusBot } from "./focus-bot.js";
import { createGameBot } from "./game-bot.js";
import { createHubBot } from "./hub-bot.js";
import { createUserBot } from "./user-bot.js";

const token = process.env.BOT_TOKEN?.trim();
const adminToken = process.env.ADMIN_BOT_TOKEN?.trim();
const englishToken = process.env.ENGLISH_BOT_TOKEN?.trim();
const focusToken = process.env.FOCUS_BOT_TOKEN?.trim();
const gameToken = process.env.GAME_BOT_TOKEN?.trim();
const budgetToken = process.env.BUDGET_BOT_TOKEN?.trim();
const hubToken = process.env.HUB_BOT_TOKEN?.trim();

if (!token) throw new Error("BOT_TOKEN is not set in bot/.env");
if (!adminToken) throw new Error("ADMIN_BOT_TOKEN is not set in bot/.env");
if (token === adminToken) throw new Error("BOT_TOKEN and ADMIN_BOT_TOKEN must be different");

const dbPath = process.env.DB_PATH || "./data/chat.db";
const englishDbPath = process.env.ENGLISH_DB_PATH || "./data/english-chat.db";
const focusDbPath = process.env.FOCUS_DB_PATH || "./data/focus.db";
const gameDbPath = process.env.GAME_DB_PATH || "./data/game.db";
const budgetDbPath = process.env.BUDGET_DB_PATH || "./data/budget.db";
const hubDbPath = process.env.HUB_DB_PATH || "./data/hub.db";
const userBot = createUserBot(token, dbPath);
const adminBot = createAdminBot(adminToken, dbPath, process.env.ADMIN_IDS, {
  englishDbPath: englishToken ? englishDbPath : null,
  focusDbPath: focusToken ? focusDbPath : null,
  gameDbPath: gameToken ? gameDbPath : null,
  budgetDbPath: budgetToken ? budgetDbPath : null,
  hubDbPath: hubToken ? hubDbPath : null
});
const englishBot = englishToken ? createEnglishBot(englishToken, englishDbPath) : null;
const focusBot = focusToken ? createFocusBot(focusToken, focusDbPath) : null;
const gameBot = gameToken ? createGameBot(gameToken, gameDbPath) : null;
const budgetBot = budgetToken ? createBudgetBot(budgetToken, budgetDbPath) : null;
const hubBot = hubToken ? createHubBot(hubToken, hubDbPath) : null;
focusBot?.startFocusScheduler();

const botCount = 2
  + Number(Boolean(englishBot))
  + Number(Boolean(focusBot))
  + Number(Boolean(gameBot))
  + Number(Boolean(budgetBot))
  + Number(Boolean(hubBot));

const healthPath = path.resolve(process.env.HEALTH_PATH || "./data/health.json");
function writeHealth() {
  fs.mkdirSync(path.dirname(healthPath), { recursive: true });
  const temporary = `${healthPath}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({
    status: "running",
    updated_at: new Date().toISOString(),
    bots: botCount
  }, null, 2));
  fs.renameSync(temporary, healthPath);
}
writeHealth();
const healthTimer = setInterval(writeHealth, 30_000);

const shutdown = () => {
  clearInterval(healthTimer);
  userBot.stop();
  adminBot.stop();
  englishBot?.stop();
  focusBot?.stopFocusScheduler();
  focusBot?.stop();
  gameBot?.stop();
  budgetBot?.stop();
  hubBot?.stop();
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

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
await Promise.all(starts);
