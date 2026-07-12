import "dotenv/config";
import { createUserBot } from "./user-bot.js";

const token = process.env.BOT_TOKEN?.trim();
if (!token) throw new Error("BOT_TOKEN is not set in bot/.env");

const bot = createUserBot(token, process.env.DB_PATH || "./data/chat.db");
process.once("SIGINT", () => bot.stop());
process.once("SIGTERM", () => bot.stop());
await bot.start({ drop_pending_updates: false });
