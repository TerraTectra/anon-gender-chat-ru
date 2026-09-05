import "dotenv/config";

const bots = [
  ["BOT_TOKEN", "anonymous-chat"],
  ["ADMIN_BOT_TOKEN", "admin"],
  ["ENGLISH_BOT_TOKEN", "english"],
  ["FOCUS_BOT_TOKEN", "focus"],
  ["GAME_BOT_TOKEN", "game"],
  ["BUDGET_BOT_TOKEN", "budget"],
  ["HUB_BOT_TOKEN", "hub"],
  ["TASK_BOT_TOKEN", "tasks"],
  ["QUIZ_BOT_TOKEN", "quiz"],
  ["PARTY_BOT_TOKEN", "party"]
];

const strict = process.argv.includes("--strict");

async function telegram(token, method, payload = {}) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const result = await response.json();
  if (!result.ok) throw new Error(result.description ?? `${method} failed`);
  return result.result;
}

async function auditBot(envName, role) {
  const token = process.env[envName]?.trim();
  if (!token) return { role, username: "-", status: "not-configured", missing: [] };

  const me = await telegram(token, "getMe");
  const [photos, description, shortDescription, commands] = await Promise.all([
    telegram(token, "getUserProfilePhotos", { user_id: me.id, limit: 1 }),
    telegram(token, "getMyDescription"),
    telegram(token, "getMyShortDescription"),
    telegram(token, "getMyCommands")
  ]);

  const missing = [];
  if (photos.total_count === 0) missing.push("avatar");
  if (!description.description?.trim()) missing.push("description");
  if (!shortDescription.short_description?.trim()) missing.push("short-description");
  if (commands.length === 0) missing.push("commands");

  return {
    role,
    username: `@${me.username}`,
    status: missing.length === 0 ? "complete" : "incomplete",
    avatar: photos.total_count > 0 ? "yes" : "no",
    description: description.description?.trim() ? "yes" : "no",
    shortDescription: shortDescription.short_description?.trim() ? "yes" : "no",
    commands: commands.length,
    missing
  };
}

const results = [];
let apiErrors = 0;

for (const [envName, role] of bots) {
  try {
    results.push(await auditBot(envName, role));
  } catch (error) {
    apiErrors += 1;
    results.push({ role, username: "-", status: "api-error", missing: [], error: error.message });
  }
}

console.table(results.map(({ role, username, status, avatar, description, shortDescription, commands }) => ({
  role,
  username,
  status,
  avatar: avatar ?? "-",
  description: description ?? "-",
  short: shortDescription ?? "-",
  commands: commands ?? "-"
})));

for (const result of results) {
  if (result.missing.length > 0) console.log(`${result.username}: missing ${result.missing.join(", ")}`);
  if (result.error) console.error(`${result.role}: ${result.error}`);
}

const incomplete = results.filter((result) => result.status === "incomplete").length;
const configured = results.filter((result) => result.status !== "not-configured").length;
console.log(`Profile audit: ${configured} configured, ${incomplete} incomplete, ${apiErrors} API errors.`);

if (apiErrors > 0 || (strict && incomplete > 0)) process.exitCode = 1;
