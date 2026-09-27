import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Bot } from 'grammy';
import { installTelegramReliability } from '../src/telegram-reliability.js';
import { safeErrorSummary } from '../src/safe-error.js';
import {telegramClientOptions,telegramTransportMode,closeTelegramTransport} from '../src/telegram-transport.js';

const sync=process.argv.includes('--sync-commands');
const bot=new Bot(process.env.BOT_TOKEN,{client:telegramClientOptions()});
installTelegramReliability(bot);
const result={at:new Date().toISOString(),realPurchasePerformed:false,transport:telegramTransportMode()};
async function read(task){for(let attempt=0;;attempt++){try{return await task();}catch(error){if(attempt>=2)throw error;await new Promise(resolve=>setTimeout(resolve,300));}}}
try{
 const me=await read(()=>bot.api.getMe());result.username=me.username;
 const invoice=await bot.api.raw.createInvoiceLink({title:'Проверка премиума',description:'Техническая проверка. Этот счёт не предназначен для оплаты.',payload:'diagnostic:premium:'+randomUUID(),provider_token:'',currency:'XTR',prices:[{label:'Проверка тарифа 7 дней',amount:25}]});
 result.telegramAcceptedStarsInvoice=typeof invoice==='string'&&invoice.startsWith('https://t.me/');
 const balance=await read(()=>bot.api.getMyStarBalance());result.balanceStars=balance.amount;
 const transactions=await read(()=>bot.api.getStarTransactions({limit:5}));result.recentTransactionCount=transactions.transactions.length;
 const userAdditions=[{command:'premium',description:'Премиум и тарифы'},{command:'partner',description:'Анкета текущего собеседника'},{command:'visibility',description:'Видимость пола и возраста'},{command:'terms',description:'Условия покупки премиума'},{command:'paysupport',description:'Помощь с оплатой и возвратами'}];
 if(sync){
  const current=await read(()=>bot.api.getMyCommands());
  const commands=[...current.filter(c=>!userAdditions.some(a=>a.command===c.command)),...userAdditions];
  await read(()=>bot.api.setMyCommands(commands));
  const saved=await read(()=>bot.api.getMyCommands());result.userCommandsVerified=userAdditions.every(a=>saved.some(c=>c.command===a.command));
  const admin=new Bot(process.env.ADMIN_BOT_TOKEN,{client:telegramClientOptions()});installTelegramReliability(admin);
  const additions=[{command:'payments',description:'Премиум и платежи'},{command:'payment_support',description:'Обращения по оплате'},{command:'payreply',description:'Ответить по обращению'},{command:'payclose',description:'Закрыть обращение'},{command:'refund',description:'Возврат с подтверждением'},{command:'reconcile_payments',description:'Сверка платежей с Telegram'}];
  const previous=await read(()=>admin.api.getMyCommands());
  await read(()=>admin.api.setMyCommands([...previous.filter(c=>!additions.some(a=>a.command===c.command)),...additions]));
  const savedAdmin=await read(()=>admin.api.getMyCommands());result.adminCommandsVerified=additions.every(a=>savedAdmin.some(c=>c.command===a.command));
 }
 result.ok=Boolean(result.telegramAcceptedStarsInvoice&&(!sync||(result.userCommandsVerified&&result.adminCommandsVerified)));
}catch(error){result.ok=false;result.error=safeErrorSummary(error);process.exitCode=1;}
closeTelegramTransport();
console.log(JSON.stringify(result,null,2));
