// Explicitly displays the verified owner's balance and paid test card. Never refunds or charges.
import 'dotenv/config';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Bot } from 'grammy';
import { telegramClientOptions, closeTelegramTransport } from '../src/telegram-transport.js';
import { installTelegramReliability } from '../src/telegram-reliability.js';
import { safeErrorSummary } from '../src/safe-error.js';
import { adminPaymentDetail, formatStarBalance } from '../src/payment-admin-panel.js';
import { adminKeyboard } from '../src/keyboards.js';
const db = new DatabaseSync(path.resolve(process.env.DB_PATH || 'data/chat.db'), {readOnly:true});
try {
 if (process.argv[2] !== '--send') throw new Error('Use --send to display the owner payment card.');
 const ids = [...new Set(String(process.env.ADMIN_IDS || '').split(',').map(Number).filter(n => Number.isSafeInteger(n) && n > 0))];
 if (ids.length !== 1) throw new Error('Exactly one configured owner is required. Nothing sent.');
 const owner = ids[0];
 const main = new Bot(process.env.BOT_TOKEN, {client:telegramClientOptions()});
 const admin = new Bot(process.env.ADMIN_BOT_TOKEN, {client:telegramClientOptions()});
 installTelegramReliability(main);installTelegramReliability(admin);
 const [me, adminMe, ownerChat, balance] = await Promise.all([main.api.getMe(), admin.api.getMe(), admin.api.getChat(owner), main.api.getMyStarBalance()]);
 if (ownerChat.type !== 'private' || ownerChat.id !== owner || me.id === adminMe.id) throw new Error('Owner or bot identity mismatch');
 const row = db.prepare('SELECT * FROM test_payment_orders WHERE user_id=? AND bot_id=? AND paid_ms IS NOT NULL ORDER BY paid_ms DESC LIMIT 1').get(owner,me.id);
 if (!row?.charge_id) throw new Error('No confirmed test payment belongs to the configured owner');
 const view = adminPaymentDetail({...row,kind:'t',order_id:row.id,days:0,title:'Тестовая оплата'});
 const commands = await admin.api.getMyCommands();
 const additions=[{command:'payments',description:'Платежи, баланс и возвраты'},{command:'balance',description:'Баланс Stars основного бота'}];
 await admin.api.setMyCommands([...commands.filter(c=>!additions.some(a=>a.command===c.command)),...additions]);
 const saved = await admin.api.getMyCommands();
 if (!additions.every(a=>saved.some(c=>c.command===a.command))) throw new Error('Admin command verification failed');
 // Do not retry message sends after ambiguous network failures.
 const header = await admin.api.sendMessage(owner,`Баланс @${me.username}: ${formatStarBalance(balance)} ⭐.\n\nЭто баланс основного бота в Telegram, а не ваш личный баланс. Раздел «💳 Платежи» и /balance теперь показывают его напрямую. ${row.refunded_ms == null ? 'Ниже карточка тестовой оплаты с кнопкой возврата. Сам возврат пока не выполнен.' : 'Ниже карточка тестовой оплаты. Возврат этого платежа уже отмечен в журнале.'}`,{reply_markup:adminKeyboard});
 const card = await admin.api.sendMessage(owner,view.text,{reply_markup:view.reply_markup});
 console.log(JSON.stringify({sent:true,adminBot:adminMe.username,paymentBot:me.username,balance,headerMessageId:header.message_id,cardMessageId:card.message_id,refundButtonVisible:card.reply_markup?.inline_keyboard?.flat().some(b=>b.callback_data==='refundask:t:'+row.id)||false,refundPerformed:false,commandsVerified:true},null,2));
} catch(error) {console.error(safeErrorSummary(error));process.exitCode=1;}
finally {db.close();closeTelegramTransport();}
