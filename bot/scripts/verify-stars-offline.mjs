import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createAdminBot } from '../src/admin-bot.js';
import { DatabaseSync } from 'node:sqlite';

const source=path.resolve(process.argv[2]||'');
if(!process.argv[2]||!fs.existsSync(path.join(source,'manifest.json')))throw new Error('Pass an explicit backup directory with manifest.json');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'stars-snapshot-check-'));
const prior=process.cwd();let bot;
const report={snapshot:path.basename(source),copiedDataOnly:true,externalCalls:0,checks:[]};
try{
 fs.cpSync(path.join(source,'data'),path.join(root,'data'),{recursive:true});
 process.chdir(root);
 bot=createAdminBot('654321:offline-test',path.join(root,'data/chat.db'),'9',{anonVariantsEnabled:true});
 bot.botInfo={id:654321,is_bot:true,first_name:'Offline',username:'OfflineSnapshotBot'};
 const calls=[];let seq=1;
 bot.api.config.use(async(_previous,method,payload)=>{calls.push({method,...payload});return {ok:true,result:{message_id:1,date:1,chat:{id:payload.chat_id,type:'private'},text:payload.text}};});
 const from={id:9,is_bot:false,first_name:'Offline'};
 const command=text=>bot.handleUpdate({update_id:seq++,message:{message_id:seq,date:1,from,chat:{id:9,type:'private'},text,entities:[{type:'bot_command',offset:0,length:text.length}]}});
 const cb=data=>bot.handleUpdate({update_id:seq++,callback_query:{id:String(seq),from,chat_instance:'test',data,message:{message_id:1,date:1,chat:{id:9,type:'private'},text:'Offline'}}});
 await command('/chats');assert.ok(calls.some(c=>c.text?.includes('Все анонимные чаты (9)')));report.checks.push('nine_brand_admin');
 await cb('multi_all:a:0');assert.ok(calls.at(-1).text?.includes('Все активные сессии'));report.checks.push('unified_active_sessions');
 await cb('multi_all:m:0');assert.ok(calls.at(-1).text?.includes('Общий архив'));report.checks.push('unified_archive');
 await command('/payments');assert.ok(calls.at(-1).text?.includes('Платежи всех 9'));assert.ok(calls.at(-1).text.length<4096);report.checks.push('nine_brand_payments');
 const file=path.join(root,'data/chat-session-archive/sessions.sqlite');
 const db=new DatabaseSync(file,{readOnly:true});
 const ended=db.prepare("SELECT id FROM chat_sessions WHERE status!='active' LIMIT 1").get();db.close();
 if(ended){
  await cb(`multi_session:anon:${ended.id}:gm:0`);assert.ok(calls.at(-1).reply_markup.inline_keyboard.flat().some(b=>b.callback_data?.startsWith('multi_delete:')));
  await cb(`multi_delete:anon:${ended.id}:gm:0`);await cb(`multi_delete_confirm:anon:${ended.id}:gm:0`);
  assert.ok(calls.at(-1).text?.includes('удалены'));report.checks.push('delete_archived_session_on_copy');
 }else report.checks.push('no_archived_session_in_snapshot; synthetic_deletion_tests_cover_it');
 const saved=new DatabaseSync(path.join(root,'data/chat.db'),{readOnly:true});
 report.originalPayments=saved.prepare('SELECT COUNT(*) n FROM premium_payments').get().n;
 assert.equal(Object.values(saved.prepare('PRAGMA quick_check').get())[0],'ok');saved.close();
 report.checks.push('original_payment_rows_and_integrity');
 console.log(JSON.stringify(report,null,2));
}finally{bot?.stopDailyReportScheduler();bot?.closeStore();process.chdir(prior);fs.rmSync(root,{recursive:true,force:true});}
