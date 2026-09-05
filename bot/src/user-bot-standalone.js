import "dotenv/config";
import { createUserBot } from "./user-bot.js";
import { isTelegramPollingConflict, safeErrorSummary } from "./safe-error.js";
import { acquireSingleInstance, AlreadyRunningError, SINGLE_INSTANCE_EXIT_CODE } from "./single-instance.js";

const token = process.env.BOT_TOKEN?.trim();
if (!token) throw new Error("BOT_TOKEN is not set in bot/.env");

let instanceLock;
try {
  instanceLock = await acquireSingleInstance();
} catch (error) {
  if (error instanceof AlreadyRunningError) {
    console.error("Bot network is already running on this computer; standalone start cancelled.");
    process.exit(SINGLE_INSTANCE_EXIT_CODE);
  }
  throw error;
}

const bot = createUserBot(token, process.env.DB_PATH || "./data/chat.db", {
  sessionArchiveRoot: process.env.SESSION_ARCHIVE_ROOT || undefined
});
let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  bot.stopSessionRetention();
  try {
    bot.stop();
  } catch {
    // Startup may have failed before polling began.
  }
  bot.closeStore();
  await instanceLock.release();
};
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
try {
  await bot.start({ drop_pending_updates: false });
} catch (error) {
  const conflict = isTelegramPollingConflict(error);
  console.error(conflict ? `Telegram polling conflict: ${safeErrorSummary(error)}` : `User bot failed: ${safeErrorSummary(error)}`);
  process.exitCode = conflict ? SINGLE_INSTANCE_EXIT_CODE : 1;
} finally {
  await stop();
}
