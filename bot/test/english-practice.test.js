import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LanguageStore } from '../src/language-store.js';
import { installEnglishPractice, workEnglishExercises } from '../src/english-practice.js';
async function fixture(run){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'english-pilot-'));
 const filename=path.join(dir,'test.db');const store=new LanguageStore(filename);
 const commands=new Map();let callback;const messages=[];
 const bot={command:(name,fn)=>commands.set(name,fn),callbackQuery:(_pattern,fn)=>{callback=fn;}};
 installEnglishPractice(bot,store);
 const ctx=(id=1)=>({from:{id,username:'test'},reply:async(text,options)=>messages.push({text,options}),answerCallbackQuery:async text=>messages.push({callback:text})});
 try{await run({commands,callback:()=>callback,store,ctx,messages,filename});}finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
}
test('pilot has twelve valid unique work-English exercises',()=>{
 assert.equal(workEnglishExercises.length,12);assert.equal(new Set(workEnglishExercises.map(x=>x.id)).size,12);
 for(const e of workEnglishExercises){assert.equal(e.options.length,3);assert.ok(e.correct>=0&&e.correct<3);assert.ok(e.explanation.length>10);}
});
test('solo practice works without another learner or a completed matching profile',()=>fixture(async h=>{
 await h.commands.get('practice')(h.ctx());assert.ok(h.messages[0].text.includes('Introduce your role'));assert.equal(h.store.getUser(1).state,'idle');
}));
test('wrong answer is recorded but not counted as solved',()=>fixture(async h=>{
 await h.commands.get('practice')(h.ctx());const ctx=h.ctx();ctx.match=['','intro','1'];await h.callback()(ctx);
 assert.equal(h.store.db.prepare('SELECT solved FROM work_english_progress WHERE user_id=1').get().solved,0);
}));
test('correct answers advance the pilot and survive reopening SQLite',()=>fixture(async h=>{
 await h.commands.get('practice')(h.ctx());const ctx=h.ctx();ctx.match=['','intro','0'];await h.callback()(ctx);
 const reopened=new LanguageStore(h.filename);assert.equal(reopened.db.prepare('SELECT solved FROM work_english_progress WHERE user_id=1').get().solved,1);reopened.close();
 h.messages.length=0;await h.commands.get('practice')(h.ctx());assert.ok(h.messages[0].text.includes('Ask when a task'));
}));
test('repeat incorrect click cannot erase a solved answer',()=>fixture(async h=>{
 await h.commands.get('practice')(h.ctx());const ctx=h.ctx();ctx.match=['','intro','0'];await h.callback()(ctx);ctx.match=['','intro','2'];await h.callback()(ctx);
 assert.equal(h.store.db.prepare('SELECT solved FROM work_english_progress WHERE user_id=1').get().solved,1);
}));
test('practice does not interrupt an active conversation',()=>fixture(async h=>{
 h.store.upsertUser(1,'test');h.store.db.prepare("UPDATE users SET partner_id=2,state='chatting' WHERE id=1").run();
 await h.commands.get('practice')(h.ctx());assert.equal(h.store.getUser(1).partner_id,2);assert.ok(h.messages[0].text.includes('/stop'));
}));
test('progress remains isolated between users',()=>fixture(async h=>{
 await h.commands.get('practice')(h.ctx());const ctx=h.ctx();ctx.match=['','intro','0'];await h.callback()(ctx);
 h.messages.length=0;await h.commands.get('practice_stats')(h.ctx(2));assert.ok(h.messages[0].text.includes('0/12'));
}));
