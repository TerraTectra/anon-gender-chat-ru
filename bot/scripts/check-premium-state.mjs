import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
const db=new DatabaseSync(path.resolve(process.env.DB_PATH||'data/chat.db'),{readOnly:true});
const report={at:new Date().toISOString(),health:JSON.parse(fs.readFileSync(process.env.HEALTH_PATH||'data/health.json','utf8')),integrity:db.prepare('PRAGMA quick_check').all(),paymentTables:db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'premium_%'").all().map(r=>r.name),paidOrders:db.prepare('SELECT COUNT(*) n FROM premium_payments').get().n,pendingOrders:db.prepare('SELECT COUNT(*) n FROM premium_orders').get().n,activePremium:db.prepare('SELECT COUNT(*) n FROM premium_access WHERE until_ms>?').get(Date.now()).n,asymmetricPairs:db.prepare('SELECT COUNT(*) n FROM users a LEFT JOIN users b ON b.id=a.partner_id WHERE a.partner_id IS NOT NULL AND (b.partner_id IS NULL OR b.partner_id!=a.id)').get().n};
db.close();
console.log(JSON.stringify(report,null,2));
