// Read-only diagnostic: never issues invoices or calls a refund method.
import 'dotenv/config';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Bot } from 'grammy';
import { telegramClientOptions, closeTelegramTransport } from '../src/telegram-transport.js';
import { installTelegramReliability } from '../src/telegram-reliability.js';
import { safeErrorSummary } from '../src/safe-error.js';
const db=new DatabaseSync(path.resolve(process.env.DB_PATH||'data/chat.db'),{readOnly:true});
const bot=new Bot(process.env.BOT_TOKEN,{client:telegramClientOptions()});
const admin=new Bot(process.env.ADMIN_BOT_TOKEN,{client:telegramClientOptions()});
installTelegramReliability(bot);installTelegramReliability(admin);
async function read(fn){for(let i=0;;i++){try{return await fn();}catch(e){if(i===2)throw e;await new Promise(r=>setTimeout(r,300));}}}
try{
 const [me,adminMe,balance,tx]=await Promise.all([read(()=>bot.api.getMe()),read(()=>admin.api.getMe()),read(()=>bot.api.getMyStarBalance()),read(()=>bot.api.getStarTransactions({limit:100}))]);
 const orders=db.prepare('SELECT * FROM test_payment_orders ORDER BY created_ms DESC LIMIT 10').all();
 console.log(JSON.stringify({at:new Date().toISOString(),readOnly:true,bot:me.username,adminBot:adminMe.username,balance,tests:orders.map(o=>({stars:o.stars,paid:o.paid_ms!==null,paidAt:o.paid_ms?new Date(o.paid_ms).toISOString():null,refunded:o.refunded_ms!==null,telegramIncomingVerified:tx.transactions.some(t=>t.id===o.charge_id&&t.source?.user?.id===o.user_id&&t.amount===o.stars),telegramRefundVerified:tx.transactions.some(t=>t.id===o.charge_id&&t.receiver?.user?.id===o.user_id)})),premiumPayments:db.prepare('SELECT COUNT(*) n FROM premium_payments').get().n,integrity:db.prepare('PRAGMA quick_check').all()},null,2));
}catch(error){console.error(safeErrorSummary(error));process.exitCode=1;}
finally{db.close();closeTelegramTransport();}
