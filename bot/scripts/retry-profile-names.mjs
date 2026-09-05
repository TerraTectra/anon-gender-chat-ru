import 'dotenv/config';
import { Bot } from 'grammy';
const profiles=[
['ENGLISH_BOT_TOKEN','Tectra Music'],
['FOCUS_BOT_TOKEN','Tectra Random'],
['GAME_BOT_TOKEN','Tectra Meet'],
['BUDGET_BOT_TOKEN','Tectra Moderator'],
['TASK_BOT_TOKEN','Tectra Post Bot'],
['QUIZ_BOT_TOKEN','Tectra Video Saver'],
['PARTY_BOT_TOKEN','Tectra Auto Approve'],
['HUB_BOT_TOKEN','Tectra Nearby']
];
let failed=0;
for(const [env,name] of profiles){const token=process.env[env];if(!token){failed++;continue;}try{const bot=new Bot(token);await bot.api.setMyName(name);const me=await bot.api.getMe();console.log(`${me.username}: ${name} OK`);}catch(e){failed++;console.error(`${env}: ${e?.description||e?.message||e}`);}}
process.exitCode=failed?1:0;
