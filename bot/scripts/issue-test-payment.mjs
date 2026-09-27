import 'dotenv/config';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import {Bot} from 'grammy';
import {TestPaymentStore,testInvoiceParameters} from '../src/test-payment.js';
import {telegramClientOptions,closeTelegramTransport} from '../src/telegram-transport.js';
import {installTelegramReliability} from '../src/telegram-reliability.js';
import {safeErrorSummary} from '../src/safe-error.js';

const mode=process.argv[2];
if(!['--enable-and-send','--disable','--status'].includes(mode)){
 console.error('Usage: node scripts/issue-test-payment.mjs --enable-and-send | --disable | --status');
 process.exit(2);
}
const db=new DatabaseSync(path.resolve(process.env.DB_PATH||'data/chat.db'));
db.exec('PRAGMA busy_timeout=3000');
const ledger=new TestPaymentStore(db);
try {
 if(mode==='--disable'){
  ledger.setEnabled(false);
  console.log(JSON.stringify({enabled:false,historyPreserved:true,newInvoicesDisabled:true}));
 }else if(mode==='--status'){
  const orders=db.prepare('SELECT stars,created_ms,approved_ms,paid_ms,refunded_ms,invoice_message_id FROM test_payment_orders ORDER BY created_ms DESC LIMIT 10').all();
  console.log(JSON.stringify({enabled:ledger.enabled(),orders},null,2));
 }else {
  const admins=[...new Set(String(process.env.ADMIN_IDS||'').split(',').map(Number).filter(id=>Number.isSafeInteger(id)&&id>0))];
  if(admins.length!==1)throw new Error('Exactly one configured administrator is required; no invoice sent');
  const owner=admins[0];
  const existing=ledger.paidByUser(owner);
  if(existing)throw new Error('Test payment is already completed; no additional invoice sent');
  const bot=new Bot(process.env.BOT_TOKEN,{client:telegramClientOptions()});
  installTelegramReliability(bot);
  const me=await bot.api.getMe();
  const chat=await bot.api.getChat(owner);
  if(chat.type!=='private'||chat.id!==owner)throw new Error('Private owner chat not verified');
  ledger.setEnabled(true);
  const order=ledger.create(owner,me.id);
  const before=Number(db.prepare('SELECT until_ms FROM premium_access WHERE user_id=?').get(owner)?.until_ms||0);
  if(order.invoice_message_id!==null){
   console.log(JSON.stringify({sent:false,alreadySent:true,title:'Тестовая оплата',stars:8,bot:me.username,messageId:order.invoice_message_id}));
  }else{
   // Do not automatically retry this side effect after an ambiguous network failure.
   const message=await bot.api.raw.sendInvoice(testInvoiceParameters(ledger,order));
   ledger.noteInvoice(order.id,message.message_id);
   const after=Number(db.prepare('SELECT until_ms FROM premium_access WHERE user_id=?').get(owner)?.until_ms||0);
   console.log(JSON.stringify({sent:true,bot:me.username,title:message.invoice?.title||'Тестовая оплата',currency:message.invoice?.currency,stars:message.invoice?.total_amount,messageId:message.message_id,premiumUnchanged:before===after,userMustConfirmPayment:true,realPurchasePerformed:false},null,2));
  }
 }
}catch(error){console.error(safeErrorSummary(error));process.exitCode=1;}
finally{db.close();closeTelegramTransport();}
