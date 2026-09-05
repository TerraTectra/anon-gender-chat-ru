import { InlineKeyboard } from 'grammy';

// Original, fixed exercises. No external model, paid API, or live partner is required.
export const workEnglishExercises = [
  {id:'intro',prompt:'Introduce your role in a new team.',options:['I am a junior developer.','I have a junior developer.','I be a junior developer.'],correct:0,explanation:'Use “I am” to describe your role.'},
  {id:'deadline',prompt:'Ask when a task must be finished.',options:['Where is the task?','When is the deadline?','Who is the keyboard?'],correct:1,explanation:'“Deadline” is the latest time by which a task should be finished.'},
  {id:'repeat',prompt:'You did not understand an instruction. Ask politely.',options:['You speak bad.','Never repeat it.','Could you explain that again, please?'],correct:2,explanation:'“Could you …, please?” is a polite request.'},
  {id:'blocked',prompt:'Explain that you need access before you can continue.',options:['I am blocked because I do not have access.','I am access because I do not have blocked.','The access am finish.'],correct:0,explanation:'State the blocker and the reason: “I am blocked because …”.'},
  {id:'update',prompt:'Give a short update about completed work.',options:['I finished the first task.','I finish yesterday tomorrow.','I am finish the task yesterday.'],correct:0,explanation:'Use a past form for a completed action: “I finished …”.'},
  {id:'clarify',prompt:'Ask which part of a request has priority.',options:['Do you have a colour?','Which part should I do first?','Where yesterday first?'],correct:1,explanation:'“Which part should I do first?” asks about priority without guessing.'},
  {id:'review',prompt:'Ask a teammate to review a change.',options:['You must like my code.','My change is a person.','Could you review this change?'],correct:2,explanation:'“Review” means examine the change and provide feedback.'},
  {id:'estimate',prompt:'Give an estimate without promising certainty.',options:['I expect it to take about two hours.','It takes all hours forever definitely.','It cannot ever change.'],correct:0,explanation:'“I expect … about …” makes it clear that this is an estimate.'},
  {id:'reproduce',prompt:'Ask how to see the same software problem.',options:['What steps reproduce the issue?','What food reproduces the keyboard?','When does your name issue?'],correct:0,explanation:'Reproduction steps describe how another person can observe the same issue.'},
  {id:'scope',prompt:'Confirm what is outside the current task.',options:['Everything is secretly included.','Is the mobile version outside the scope of this task?','Scope has already eaten the task.'],correct:1,explanation:'“Outside the scope” means not included in the current task.'},
  {id:'handoff',prompt:'Tell the team where to find test instructions.',options:['Testing is nowhere.','Please test my thoughts.','The test instructions are in the README.'],correct:2,explanation:'Point to a concrete location so another person can reproduce your check.'},
  {id:'feedback',prompt:'Ask for a concrete example of requested changes.',options:['Could you show me an example of the expected result?','The result expected example all.','You cannot ask me anything.'],correct:0,explanation:'An example makes the expected outcome easier to understand and check.'}
];

export function installEnglishPractice(bot, store) {
  store.db.exec(`CREATE TABLE IF NOT EXISTS work_english_progress (
    user_id INTEGER NOT NULL, exercise_id TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0, solved INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(user_id, exercise_id)
  )`);
  async function practice(ctx) {
    const user=store.getUser(ctx.from.id);
    if(user?.partner_id||user?.state==='searching') {
      await ctx.reply('Use /stop to leave the chat or search before starting private practice.'); return;
    }
    store.upsertUser(ctx.from.id,ctx.from.username);
    const solved=new Set(store.db.prepare('SELECT exercise_id FROM work_english_progress WHERE user_id=? AND solved=1').all(ctx.from.id).map(x=>x.exercise_id));
    const exercise=workEnglishExercises.find(x=>!solved.has(x.id));
    if(!exercise){await ctx.reply(`You completed all ${workEnglishExercises.length} exercises in this pilot. /practice_stats shows your result. Live partner search remains available with /search.`);return;}
    const keyboard=new InlineKeyboard();
    exercise.options.forEach((option,index)=>{keyboard.text(String(index+1),`work_en:${exercise.id}:${index}`);});
    await ctx.reply(`Work English: one practical situation\n\n${exercise.prompt}\n\n${exercise.options.map((x,i)=>`${i+1}. ${x}`).join('\n')}\n\nChoose a number below. No live partner or AI subscription is needed.`,{reply_markup:keyboard});
    store.recordEvent(ctx.from.id,'practice_shown');
  }
  bot.command('practice',practice);
  bot.command('practice_stats',async ctx=>{
    const result=store.db.prepare('SELECT COUNT(*) AS tried, COALESCE(SUM(solved),0) AS solved, COALESCE(SUM(attempts),0) AS attempts FROM work_english_progress WHERE user_id=?').get(ctx.from.id);
    await ctx.reply(`Work English: ${result.solved}/${workEnglishExercises.length} solved; ${result.attempts} attempts. Next exercise: /practice.`);
  });
  bot.callbackQuery(/^work_en:([a-z]+):([0-2])$/,async ctx=>{
    const exercise=workEnglishExercises.find(x=>x.id===ctx.match[1]);
    if(!exercise){await ctx.answerCallbackQuery('This exercise is not available.');return;}
    const user=store.getUser(ctx.from.id);
    if(user?.partner_id||user?.state==='searching'){await ctx.answerCallbackQuery('Leave your conversation with /stop first.');return;}
    const correct=Number(ctx.match[2])===exercise.correct;
    store.db.prepare(`INSERT INTO work_english_progress(user_id,exercise_id,attempts,solved) VALUES(?,?,1,?)
      ON CONFLICT(user_id,exercise_id) DO UPDATE SET attempts=attempts+1,solved=MAX(solved,excluded.solved),updated_at=CURRENT_TIMESTAMP`).run(ctx.from.id,exercise.id,Number(correct));
    await ctx.answerCallbackQuery(correct?'Correct!':'Try the explanation below.');
    await ctx.reply(`${correct?'Correct.':'Not quite.'} ${exercise.explanation}\n\nCorrect answer: ${exercise.options[exercise.correct]}\nNext: /practice`);
    store.recordEvent(ctx.from.id,correct?'practice_correct':'practice_retry');
  });
}
