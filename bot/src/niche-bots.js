import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { Bot, InlineKeyboard, InputFile, session } from "grammy";
import { safeErrorSummary } from "./safe-error.js";
import { parseStartSource } from "./tracking.js";

const COMMON_SCHEMA = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS niche_users (
  id INTEGER PRIMARY KEY,
  username TEXT,
  source TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS niche_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  meta TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_niche_actions_user ON niche_actions(user_id, created_at);
`;

class NicheStore {
  constructor(filename, schema = "") {
    const absolute = path.resolve(filename);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    this.db = new DatabaseSync(absolute);
    this.db.exec(COMMON_SCHEMA + schema);
  }
  close() { this.db.close(); }
  user(ctx, source = null) {
    if (!ctx?.from?.id) return;
    this.db.prepare(`INSERT INTO niche_users(id,username,source) VALUES(?,?,?)
      ON CONFLICT(id) DO UPDATE SET username=excluded.username, source=COALESCE(niche_users.source, excluded.source), updated_at=CURRENT_TIMESTAMP`)
      .run(ctx.from.id, ctx.from.username ?? null, source);
  }
  action(userId, action, meta = null) {
    this.db.prepare("INSERT INTO niche_actions(user_id,action,meta) VALUES(?,?,?)").run(userId, action, meta == null ? null : JSON.stringify(meta));
  }
  countUsers() { return this.db.prepare("SELECT COUNT(*) count FROM niche_users").get().count; }
}

function trackedStart(store, handler) {
  return async (ctx) => {
    const source = parseStartSource(ctx.match, ctx.from.id);
    store.user(ctx, source);
    store.action(ctx.from.id, "start", source);
    await handler(ctx);
  };
}

function attachBasics(bot, store, profile) {
  bot.closeStore = () => store.close();
  bot.syncProfile = async () => {
    const calls = [
      bot.api.setMyName(profile.name),
      bot.api.setMyDescription(profile.description),
      bot.api.setMyShortDescription(profile.short),
      bot.api.setMyCommands(profile.commands)
    ];
    const results = await Promise.allSettled(calls);
    const failed = results.filter((r) => r.status === "rejected");
    if (failed.length) console.error(`${profile.name} profile sync: ${failed.length} failed`);
  };
  bot.catch((error) => console.error(`${profile.name} error`, safeErrorSummary(error)));
  return bot;
}

export function createStudyBot(token, dbPath, random = Math.random) {
  const store = new NicheStore(dbPath, `
    CREATE TABLE IF NOT EXISTS flashcards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      front TEXT NOT NULL,
      back TEXT NOT NULL,
      score INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_flashcards_user ON flashcards(user_id);
  `);
  const bot = new Bot(token);
  bot.use(session({ initial: () => ({ cardId: null }) }));
  const help = "📚 Study Cards\n\n/add вопрос | ответ — добавить карточку\n/quiz — повторить случайную карточку\n/cards — сколько карточек сохранено\n/del ID — удалить карточку";
  bot.command("start", trackedStart(store, (ctx) => ctx.reply(help)));
  bot.command("help", (ctx) => ctx.reply(help));
  bot.command("add", async (ctx) => {
    store.user(ctx);
    const [front, back] = String(ctx.match || "").split("|").map((x) => x.trim());
    if (!front || !back) return ctx.reply("Формат: /add вопрос | ответ");
    const r = store.db.prepare("INSERT INTO flashcards(user_id,front,back) VALUES(?,?,?)").run(ctx.from.id, front.slice(0,800), back.slice(0,1200));
    store.action(ctx.from.id, "card_add");
    await ctx.reply(`✅ Карточка #${r.lastInsertRowid} сохранена.`);
  });
  bot.command("cards", async (ctx) => {
    store.user(ctx);
    const count = store.db.prepare("SELECT COUNT(*) count FROM flashcards WHERE user_id=?").get(ctx.from.id).count;
    await ctx.reply(`Карточек: ${count}`);
  });
  bot.command("del", async (ctx) => {
    const id = Number(ctx.match);
    if (!Number.isInteger(id)) return ctx.reply("Формат: /del 12");
    const r = store.db.prepare("DELETE FROM flashcards WHERE id=? AND user_id=?").run(id, ctx.from.id);
    await ctx.reply(r.changes ? "Удалено." : "Карточка не найдена.");
  });
  bot.command("quiz", async (ctx) => {
    store.user(ctx);
    const cards = store.db.prepare("SELECT id,front,back,score FROM flashcards WHERE user_id=? ORDER BY score ASC, id ASC").all(ctx.from.id);
    if (!cards.length) return ctx.reply("Сначала добавьте карточки: /add вопрос | ответ");
    const pool = cards.slice(0, Math.min(cards.length, 12));
    const card = pool[Math.floor(random() * pool.length)];
    ctx.session.cardId = Number(card.id);
    await ctx.reply(`❓ ${card.front}`, { reply_markup: new InlineKeyboard().text("Показать ответ", `study:show:${card.id}`) });
  });
  bot.callbackQuery(/^study:show:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const card = store.db.prepare("SELECT id,front,back FROM flashcards WHERE id=? AND user_id=?").get(id, ctx.from.id);
    if (!card) return ctx.answerCallbackQuery("Карточка уже удалена");
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(`❓ ${card.front}\n\n✅ ${card.back}`, { reply_markup: new InlineKeyboard().text("Знал", `study:rate:${id}:1`).text("Не знал", `study:rate:${id}:-1`) });
  });
  bot.callbackQuery(/^study:rate:(\d+):(-?1)$/, async (ctx) => {
    const id = Number(ctx.match[1]); const delta = Number(ctx.match[2]);
    store.db.prepare("UPDATE flashcards SET score=MAX(-5,MIN(20,score+?)) WHERE id=? AND user_id=?").run(delta, id, ctx.from.id);
    store.action(ctx.from.id, "card_review", { known: delta > 0 });
    await ctx.answerCallbackQuery(delta > 0 ? "Запомнено" : "Вернём чаще");
    await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard().text("Следующая: /quiz", "study:next") });
  });
  bot.callbackQuery("study:next", async (ctx) => { await ctx.answerCallbackQuery(); await ctx.reply("Следующая карточка: /quiz"); });
  return attachBasics(bot, store, {
    name: "Tectra Study Cards",
    short: "Карточки и интервальное повторение прямо в Telegram.",
    description: "Создавайте свои flashcards, повторяйте слабые карточки чаще и учитесь без отдельного приложения.",
    commands: [{command:"add",description:"добавить карточку"},{command:"quiz",description:"повторение"},{command:"cards",description:"мои карточки"},{command:"help",description:"помощь"}]
  });
}

export function createRandomBot(token, dbPath, random = Math.random) {
  const store = new NicheStore(dbPath);
  const bot = new Bot(token);
  const help = "🎲 Tectra Random\n\n/number 1 100 — случайное число\n/pick пицца | суши | бургер — выбрать вариант\n/coin — монетка\n/dice — кубик\n/shuffle a | b | c — перемешать список";
  bot.command("start", trackedStart(store, (ctx) => ctx.reply(help)));
  bot.command("help", (ctx) => ctx.reply(help));
  bot.command("number", async (ctx) => {
    const parts = String(ctx.match||"").trim().split(/\s+/).map(Number); let [a,b] = parts;
    if (!Number.isFinite(a) || !Number.isFinite(b)) return ctx.reply("Формат: /number 1 100");
    if (a > b) [a,b]=[b,a]; if (b-a > 1_000_000_000) return ctx.reply("Слишком большой диапазон.");
    const n = Math.floor(random()*(b-a+1))+a; store.user(ctx); store.action(ctx.from.id,"number"); await ctx.reply(`🎯 ${n}`);
  });
  bot.command("pick", async (ctx) => {
    const items=String(ctx.match||"").split("|").map(x=>x.trim()).filter(Boolean);
    if(items.length<2) return ctx.reply("Формат: /pick вариант 1 | вариант 2 | вариант 3");
    store.user(ctx); store.action(ctx.from.id,"pick",{count:items.length}); await ctx.reply(`👉 ${items[Math.floor(random()*items.length)]}`);
  });
  bot.command("coin", async (ctx)=>{store.user(ctx);store.action(ctx.from.id,"coin");await ctx.reply(random()<.5?"🪙 Орёл":"🪙 Решка");});
  bot.command("dice", async (ctx)=>{store.user(ctx);store.action(ctx.from.id,"dice");await ctx.reply(`🎲 ${Math.floor(random()*6)+1}`);});
  bot.command("shuffle", async (ctx)=>{const a=String(ctx.match||"").split("|").map(x=>x.trim()).filter(Boolean);if(a.length<2)return ctx.reply("Формат: /shuffle a | b | c");for(let i=a.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}store.user(ctx);store.action(ctx.from.id,"shuffle");await ctx.reply(a.map((x,i)=>`${i+1}. ${x}`).join("\n"));});
  return attachBasics(bot, store, {name:"Tectra Random",short:"Рандомайзер, выбор победителя и быстрые жеребьёвки.",description:"Случайные числа, выбор из списка, монетка, кубик и перемешивание — без регистрации и лишних экранов.",commands:[{command:"number",description:"случайное число"},{command:"pick",description:"выбрать вариант"},{command:"coin",description:"монетка"},{command:"dice",description:"кубик"},{command:"shuffle",description:"перемешать список"}]});
}

export function createDatingBot(token, dbPath, random = Math.random) {
  const store = new NicheStore(dbPath, `
    CREATE TABLE IF NOT EXISTS dating_profiles(user_id INTEGER PRIMARY KEY, age INTEGER NOT NULL, city TEXT NOT NULL, interests TEXT NOT NULL, bio TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS dating_likes(user_id INTEGER NOT NULL, target_id INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id,target_id));
  `);
  const bot = new Bot(token);
  const help="💞 Tectra Meet 18+\n\n/profile 26 | Москва | кино, игры, прогулки | коротко о себе\n/find — новая анкета\n/like ID — отметить симпатию\n/pause — скрыть анкету\n\nТолько 18+. Не отправляйте адрес, документы и платёжные данные незнакомым людям.";
  bot.command("start", trackedStart(store,(ctx)=>ctx.reply(help)));
  bot.command("help",ctx=>ctx.reply(help));
  bot.command("profile",async ctx=>{const p=String(ctx.match||"").split("|").map(x=>x.trim());const age=Number(p[0]);if(!Number.isInteger(age)||age<18||age>80||!p[1]||!p[2])return ctx.reply("Формат: /profile 26 | Москва | кино, игры | о себе\nТолько 18+.");store.user(ctx);store.db.prepare(`INSERT INTO dating_profiles(user_id,age,city,interests,bio,active) VALUES(?,?,?,?,?,1) ON CONFLICT(user_id) DO UPDATE SET age=excluded.age,city=excluded.city,interests=excluded.interests,bio=excluded.bio,active=1,updated_at=CURRENT_TIMESTAMP`).run(ctx.from.id,age,p[1].slice(0,80),p[2].slice(0,300),(p[3]||"").slice(0,500));store.action(ctx.from.id,"profile_save");await ctx.reply("✅ Анкета сохранена. /find — искать людей.");});
  bot.command("pause",async ctx=>{store.db.prepare("UPDATE dating_profiles SET active=0 WHERE user_id=?").run(ctx.from.id);await ctx.reply("Анкета скрыта. /profile снова активирует её.");});
  bot.command("find",async ctx=>{const me=store.db.prepare("SELECT * FROM dating_profiles WHERE user_id=? AND active=1").get(ctx.from.id);if(!me)return ctx.reply("Сначала создайте анкету через /profile.");const list=store.db.prepare("SELECT p.*,u.username FROM dating_profiles p LEFT JOIN niche_users u ON u.id=p.user_id WHERE p.active=1 AND p.user_id<>? AND lower(p.city)=lower(?) LIMIT 100").all(ctx.from.id,me.city);if(!list.length)return ctx.reply("Пока никого в вашем городе. Попробуйте позже или укажите более крупный город.");const p=list[Math.floor(random()*list.length)];store.action(ctx.from.id,"profile_view",{target:Number(p.user_id)});await ctx.reply(`💞 Анкета #${p.user_id}\n${p.age} лет · ${p.city}\nИнтересы: ${p.interests}\n${p.bio||""}\n\n/like ${p.user_id}\nКонтакт откроется только при взаимной симпатии.`);});
  bot.command("like",async ctx=>{const id=Number(ctx.match);if(!Number.isInteger(id)||id===ctx.from.id)return ctx.reply("Формат: /like ID");const target=store.db.prepare("SELECT user_id FROM dating_profiles WHERE user_id=? AND active=1").get(id);if(!target)return ctx.reply("Анкета не найдена.");store.db.prepare("INSERT OR IGNORE INTO dating_likes(user_id,target_id) VALUES(?,?)").run(ctx.from.id,id);const mutual=store.db.prepare("SELECT 1 FROM dating_likes WHERE user_id=? AND target_id=?").get(id,ctx.from.id);store.action(ctx.from.id,"like",{target:id,mutual:Boolean(mutual)});if(mutual){const u=store.db.prepare("SELECT username FROM niche_users WHERE id=?").get(id);await ctx.reply(`💚 Взаимная симпатия! ${u?.username?`@${u.username}`:`ID ${id}`}`);}else await ctx.reply("💚 Симпатия сохранена. При взаимности сообщу контакт.");});
  return attachBasics(bot,store,{name:"Tectra Meet",short:"Знакомства по городу и интересам. Только для 18+.",description:"Создайте короткую анкету, находите людей рядом по городу и интересам и открывайте контакт только при взаимной симпатии. Только 18+.",commands:[{command:"profile",description:"создать анкету 18+"},{command:"find",description:"найти анкету"},{command:"like",description:"симпатия по ID"},{command:"pause",description:"скрыть анкету"}]});
}

let ratesCache={at:0,data:null};
async function fiatRates(){if(ratesCache.data&&Date.now()-ratesCache.at<30*60_000)return ratesCache.data;const r=await fetch("https://open.er-api.com/v6/latest/USD",{signal:AbortSignal.timeout(7000)});if(!r.ok)throw new Error(`rates HTTP ${r.status}`);const j=await r.json();if(j.result!=="success")throw new Error("rates API failed");ratesCache={at:Date.now(),data:j.rates};return j.rates;}
export function createRatesBot(token,dbPath){const store=new NicheStore(dbPath);const bot=new Bot(token);const help="💱 Tectra Rates\n\n/rate 100 USD EUR — конвертация валют\n/rate 100 USD PLN\n/crypto btc — текущая цена BTC в USD/EUR\n\nКурсы справочные, не инвестиционная рекомендация.";bot.command("start",trackedStart(store,ctx=>ctx.reply(help)));bot.command("help",ctx=>ctx.reply(help));bot.command("rate",async ctx=>{try{const [amountRaw,fromRaw,toRaw]=String(ctx.match||"").trim().split(/\s+/);const amount=Number(String(amountRaw).replace(",","."));const from=(fromRaw||"").toUpperCase(),to=(toRaw||"").toUpperCase();if(!Number.isFinite(amount)||!from||!to)return ctx.reply("Формат: /rate 100 USD EUR");const rates=await fiatRates();if(!rates[from]||!rates[to])return ctx.reply("Эта валюта сейчас не поддерживается источником курса.");const usd=amount/rates[from],value=usd*rates[to];store.user(ctx);store.action(ctx.from.id,"rate",{from,to});await ctx.reply(`${amount.toLocaleString("ru-RU")} ${from} ≈ ${value.toLocaleString("ru-RU",{maximumFractionDigits:4})} ${to}\n\nИсточник: open.er-api.com`);}catch(e){await ctx.reply("Источник курсов временно недоступен. Попробуйте позже.");}});bot.command("crypto",async ctx=>{const q=String(ctx.match||"btc").trim().toLowerCase();const map={btc:"bitcoin",eth:"ethereum",ton:"the-open-network",sol:"solana"};const id=map[q]||q;try{const r=await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=usd,eur`,{signal:AbortSignal.timeout(7000)});const j=await r.json();const v=j[id];if(!v)return ctx.reply("Не нашёл монету. Попробуйте: /crypto btc, eth, ton, sol");store.user(ctx);store.action(ctx.from.id,"crypto",{id});await ctx.reply(`${id}: $${v.usd?.toLocaleString("en-US")} · €${v.eur?.toLocaleString("en-US")}\n\nСправочный курс CoinGecko.`);}catch{await ctx.reply("Источник криптокурсов временно недоступен.");}});return attachBasics(bot,store,{name:"Tectra Rates",short:"Конвертер валют и быстрые курсы криптовалют.",description:"Пересчитывает суммы между валютами и показывает справочные цены популярных криптовалют без регистрации.",commands:[{command:"rate",description:"конвертировать валюту"},{command:"crypto",description:"цена криптовалюты"},{command:"help",description:"помощь"}]});}

export function createPostBot(token,dbPath){const store=new NicheStore(dbPath);const bot=new Bot(token);const help="📝 Tectra Post Studio\n\n/format текст — очистить и подготовить пост\n/link Текст | https://site.ru — HTML-ссылка\n/publish @channel текст — опубликовать, если бот добавлен админом канала\n\nПеред публикацией всегда показывает факт отправки; массовых рассылок нет.";bot.command("start",trackedStart(store,ctx=>ctx.reply(help)));bot.command("help",ctx=>ctx.reply(help));bot.command("format",async ctx=>{let text=String(ctx.match||"").replace(/\r/g,"").replace(/\n{3,}/g,"\n\n").split("\n").map(x=>x.trimEnd()).join("\n").trim();if(!text)return ctx.reply("Формат: /format ваш текст");if(text.length>3900)text=text.slice(0,3900)+"…";store.user(ctx);store.action(ctx.from.id,"format");await ctx.reply(`Готовый текст:\n\n${text}`);});bot.command("link",async ctx=>{const [label,url]=String(ctx.match||"").split("|").map(x=>x.trim());if(!label||!/^https?:\/\//i.test(url||""))return ctx.reply("Формат: /link Текст ссылки | https://example.com");const esc=s=>s.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"','&quot;');await ctx.reply(`<a href="${esc(url)}">${esc(label)}</a>`,{parse_mode:"HTML"});});bot.command("publish",async ctx=>{const m=String(ctx.match||"").match(/^(@[A-Za-z0-9_]{5,})\s+([\s\S]+)$/);if(!m)return ctx.reply("Формат: /publish @channel текст поста");try{await bot.api.sendMessage(m[1],m[2].slice(0,4096));store.user(ctx);store.action(ctx.from.id,"publish",{channel:m[1]});await ctx.reply(`✅ Опубликовано в ${m[1]}.`);}catch{await ctx.reply("Не удалось опубликовать. Добавьте этого бота администратором канала с правом публикации.");}});return attachBasics(bot,store,{name:"Tectra Post Studio",short:"Быстро подготовить и опубликовать пост в Telegram-канал.",description:"Чистит текст, помогает со ссылками и публикует посты в ваши каналы, где бот назначен администратором.",commands:[{command:"format",description:"подготовить текст"},{command:"link",description:"сделать ссылку"},{command:"publish",description:"опубликовать в канал"},{command:"help",description:"помощь"}]});}

function safeFileName(url, contentType="application/octet-stream"){try{const u=new URL(url);const base=path.basename(u.pathname)||"media";if(base.includes("."))return base.slice(0,120);}catch{}const ext=contentType.includes("image/")?contentType.split("/")[1]:contentType.includes("video/")?contentType.split("/")[1]:contentType.includes("audio/")?contentType.split("/")[1]:"bin";return `media.${ext.replace(/[^a-z0-9]/gi,"")||"bin"}`;}
export function createMediaBot(token,dbPath){const store=new NicheStore(dbPath);const bot=new Bot(token);const help="📥 Tectra Media Saver\n\n/save https://... — скачать прямую публичную ссылку на файл/медиа и получить её в Telegram.\n\nЛимит базовой версии: 45 МБ. Не обходит авторизацию, DRM и ограничения приватного контента.";bot.command("start",trackedStart(store,ctx=>ctx.reply(help)));bot.command("help",ctx=>ctx.reply(help));bot.command("save",async ctx=>{const raw=String(ctx.match||"").trim();let url;try{url=new URL(raw);if(!["http:","https:"].includes(url.protocol))throw 0;}catch{return ctx.reply("Формат: /save https://example.com/file.mp4");}const tmp=path.join(os.tmpdir(),`tectra-${crypto.randomUUID()}`);try{await ctx.reply("Загружаю…");const r=await fetch(url,{redirect:"follow",signal:AbortSignal.timeout(25000),headers:{"user-agent":"Mozilla/5.0 TectraMediaSaver/1.0"}});if(!r.ok)throw new Error(`HTTP ${r.status}`);const len=Number(r.headers.get("content-length")||0);if(len>45*1024*1024)return ctx.reply("Файл больше 45 МБ.");const type=r.headers.get("content-type")||"application/octet-stream";const buf=Buffer.from(await r.arrayBuffer());if(buf.length>45*1024*1024)return ctx.reply("Файл больше 45 МБ.");fs.writeFileSync(tmp,buf);store.user(ctx);store.action(ctx.from.id,"save",{host:url.hostname,size:buf.length,type});await ctx.replyWithDocument(new InputFile(tmp, safeFileName(url,type)),{caption:`Сохранено · ${(buf.length/1024/1024).toFixed(1)} МБ`});}catch(e){await ctx.reply("Не удалось забрать эту ссылку. Бот поддерживает прямые публичные URL без логина и DRM.");}finally{try{fs.unlinkSync(tmp);}catch{}}});return attachBasics(bot,store,{name:"Tectra Media Saver",short:"Сохраняет прямые публичные ссылки на медиа и файлы в Telegram.",description:"Отправьте прямую публичную ссылку — бот скачает файл и вернёт его в Telegram. Без обхода авторизации, DRM и приватного доступа.",commands:[{command:"save",description:"сохранить файл по URL"},{command:"help",description:"помощь"}]});}

export function createJoinGuardBot(token,dbPath){const store=new NicheStore(dbPath,`CREATE TABLE IF NOT EXISTS join_guard_chats(chat_id INTEGER PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, updated_by INTEGER, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);const bot=new Bot(token);async function admin(ctx){if(ctx.chat.type==="private")return false;const m=await ctx.getChatMember(ctx.from.id);return ["creator","administrator"].includes(m.status);}const help="🛡 Tectra Join Guard\n\nДобавьте бота администратором группы/канала с правом принимать заявки.\n/autoapprove_on — автоматически принимать заявки\n/autoapprove_off — выключить\n/status — статус для текущего чата";bot.command("start",trackedStart(store,ctx=>ctx.reply(help)));bot.command("help",ctx=>ctx.reply(help));bot.command("autoapprove_on",async ctx=>{if(!(await admin(ctx)))return ctx.reply("Команда доступна только администратору группы/канала.");store.db.prepare("INSERT INTO join_guard_chats(chat_id,enabled,updated_by) VALUES(?,1,?) ON CONFLICT(chat_id) DO UPDATE SET enabled=1,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP").run(ctx.chat.id,ctx.from.id);store.user(ctx);store.action(ctx.from.id,"guard_on",{chat:ctx.chat.id});await ctx.reply("✅ Автоприём заявок включён.");});bot.command("autoapprove_off",async ctx=>{if(!(await admin(ctx)))return ctx.reply("Только администратор.");store.db.prepare("INSERT INTO join_guard_chats(chat_id,enabled,updated_by) VALUES(?,0,?) ON CONFLICT(chat_id) DO UPDATE SET enabled=0,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP").run(ctx.chat.id,ctx.from.id);await ctx.reply("Автоприём выключен.");});bot.command("status",async ctx=>{const row=store.db.prepare("SELECT enabled FROM join_guard_chats WHERE chat_id=?").get(ctx.chat.id);await ctx.reply(row?.enabled?"🟢 Автоприём включён":"⚪ Автоприём выключен");});bot.on("chat_join_request",async ctx=>{const row=store.db.prepare("SELECT enabled FROM join_guard_chats WHERE chat_id=?").get(ctx.chat.id);if(!row?.enabled)return;try{await bot.api.approveChatJoinRequest(ctx.chat.id,ctx.chatJoinRequest.from.id);store.action(ctx.chatJoinRequest.from.id,"join_approved",{chat:ctx.chat.id});}catch(e){console.error("Join Guard approve",safeErrorSummary(e));}});return attachBasics(bot,store,{name:"Tectra Join Guard",short:"Автоматически принимает заявки на вступление в ваши Telegram-чаты.",description:"Инструмент для владельцев групп и каналов: автоматический приём join requests с управлением прямо командами в чате.",commands:[{command:"autoapprove_on",description:"включить автоприём"},{command:"autoapprove_off",description:"выключить"},{command:"status",description:"статус"},{command:"help",description:"помощь"}]});}
