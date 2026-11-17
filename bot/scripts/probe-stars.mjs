import fs from 'node:fs';
import path from 'node:path';
import { config } from 'dotenv';
import { Bot } from 'grammy';
import { anonVariants } from '../src/anon-variants.js';
import { paymentConfiguration,variantSalesEnabled } from '../src/premium-pricing.js';
import { telegramClientOptions,closeTelegramTransport } from '../src/telegram-transport.js';
import { installTelegramReliability } from '../src/telegram-reliability.js';
import { safeErrorSummary } from '../src/safe-error.js';

const envFile=process.argv[2];
if(!envFile)throw new Error('Pass private production .env path; values are never printed');
config({path:path.resolve(envFile),quiet:true});
const admins=String(process.env.ADMIN_IDS||'').split(',').map(Number).filter(id=>Number.isSafeInteger(id)&&id>0);
if(!admins.length)throw new Error('No configured payment administrators');
const report={at:new Date().toISOString(),adminCount:admins.length,diagnosticInvoices:Boolean(process.argv.includes('--diagnostic-invoices')),realCharges:0,bots:[],errors:0};
for(const brand of [{id:'anon',tokenEnv:'BOT_TOKEN',username:'anon_gender_chat_ru_bot'},...anonVariants,{id:'admin',tokenEnv:'ADMIN_BOT_TOKEN',username:'anon_gender_chat_ru_admin_bot'}]){
 const row={id:brand.id};
 try{
  const bot=new Bot(process.env[brand.tokenEnv],{client:telegramClientOptions()});installTelegramReliability(bot);
  const me=await bot.api.getMe();if(me.username.toLowerCase()!==brand.username.toLowerCase())throw new Error('bot_identity_mismatch');
  row.identity='ok';
  if(brand.id!=='admin'){
   const [balance,ledger,commands]=await Promise.all([bot.api.getMyStarBalance(),bot.api.getStarTransactions({offset:0,limit:100}),bot.api.getMyCommands()]);
   row.balance=balance.amount;row.ledgerRecords=ledger.transactions.length;
   row.paymentCommands=commands.some(c=>c.command==='premium')&&commands.some(c=>c.command==='paysupport');
   row.salesEnabled=brand.id==='anon'||variantSalesEnabled(brand.id);
   if(report.diagnosticInvoices&&brand.id!=='anon'){
    row.invoicePricesAccepted=[];
    for(const plan of Object.values(paymentConfiguration(brand.id).plans)){
     // Unknown payload cannot pass the production pre-checkout validator.
     // Never print/save/distribute the returned link; never send an invoice to a user.
     const link=await bot.api.raw.createInvoiceLink({title:'Диагностика формата',description:`${plan.days} дней. Диагностический неоплачиваемый заказ.`,
      payload:`diagnostic-format-only:${brand.id}:${plan.stars}`,currency:'XTR',prices:[{label:'Формат',amount:plan.stars}],provider_token:''});
     if(typeof link!=='string'||!link.startsWith('https://'))throw new Error('diagnostic_invoice_not_confirmed');
     row.invoicePricesAccepted.push(plan.stars);
    }
   }
  }
 }catch(error){row.error=safeErrorSummary(error);report.errors++;}
 report.bots.push(row);
}
closeTelegramTransport();
const output=process.argv.find(arg=>arg.startsWith('--output='))?.slice(9);
if(output)fs.writeFileSync(path.resolve(output),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));process.exitCode=report.errors?1:0;
