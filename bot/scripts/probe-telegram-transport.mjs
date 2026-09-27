import 'dotenv/config';
import {Bot} from 'grammy';
import {HttpsProxyAgent} from 'https-proxy-agent';
import {telegramFailureCode} from '../src/telegram-health.js';
// Read-only getMe calls. Never poll updates, send messages or expose credentials.
const agent=new HttpsProxyAgent('http://127.0.0.1:10808',{keepAlive:true});
const direct=new Bot(process.env.BOT_TOKEN,{client:{timeoutSeconds:4}});
const proxy=new Bot(process.env.BOT_TOKEN,{client:{timeoutSeconds:4,baseFetchConfig:{agent}}});
const records=[];
for(let round=0;round<6;round++){
 const samples=await Promise.all([['default',direct],['local_proxy',proxy]].map(async([route,bot])=>{
  const started=performance.now();
  try{await bot.api.getMe();return {route,ok:true,ms:Math.round(performance.now()-started)};}
  catch(error){return {route,ok:false,ms:Math.round(performance.now()-started),code:telegramFailureCode(error)};}
 }));
 records.push(...samples);
}
agent.destroy();
console.log(JSON.stringify({at:new Date().toISOString(),readOnly:true,samples:records},null,2));
