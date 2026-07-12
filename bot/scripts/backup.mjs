import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = path.resolve(import.meta.dirname, "..");
const dataDir = path.resolve(root, "data");
const backupDir = path.resolve(dataDir, "backups");

if (!backupDir.startsWith(`${dataDir}${path.sep}`)) {
  throw new Error("Backup directory escaped the bot data directory");
}

fs.mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replaceAll(":", "-").replace("T", "_").slice(0, 19);

for (const name of fs.readdirSync(dataDir)) {
  if (!name.endsWith(".db")) continue;
  const source = path.join(dataDir, name);
  const target = path.join(backupDir, `${path.basename(name, ".db")}_${stamp}.db`);
  const escapedTarget = target.replaceAll("'", "''");
  const db = new DatabaseSync(source);
  try {
    db.exec(`VACUUM INTO '${escapedTarget}'`);
  } finally {
    db.close();
  }
}

const retentionCutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
for (const name of fs.readdirSync(backupDir)) {
  const candidate = path.resolve(backupDir, name);
  if (!candidate.startsWith(`${backupDir}${path.sep}`)) continue;
  const stat = fs.statSync(candidate);
  if (stat.isFile() && stat.mtimeMs < retentionCutoff) fs.rmSync(candidate);
}

console.log(`Backup completed: ${stamp}`);
