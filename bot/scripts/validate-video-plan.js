import fs from "node:fs";
import path from "node:path";

const planPath = path.resolve(process.argv[2] || "content/video-plan.json");
const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
const seriesIds = new Set((plan.series || []).map((series) => series.id));
const allowedStatuses = new Set(["idea", "draft", "ready", "published"]);
const allowedRights = new Set(["licensed", "public_domain", "review_criticism"]);
const errors = [];

function seconds(value) {
  const match = /^(\d{2}):(\d{2}):(\d{2})$/.exec(value || "");
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

for (const [index, episode] of (plan.episodes || []).entries()) {
  const label = episode.id || `episode ${index + 1}`;
  if (!allowedStatuses.has(episode.status)) errors.push(`${label}: invalid status`);
  if (!seriesIds.has(episode.seriesId)) errors.push(`${label}: unknown seriesId`);
  if (!episode.animeTitle?.trim()) errors.push(`${label}: animeTitle is required`);
  if (!Number.isInteger(episode.season) || episode.season < 1) errors.push(`${label}: season must be a positive integer`);
  if (!Number.isInteger(episode.episode) || episode.episode < 1) errors.push(`${label}: episode must be a positive integer`);
  if (!allowedRights.has(episode.rightsBasis)) errors.push(`${label}: rightsBasis must be licensed, public_domain, or review_criticism`);
  if (!episode.onScreenSource?.trim()) errors.push(`${label}: onScreenSource is required`);

  const start = seconds(episode.timecode?.start);
  const end = seconds(episode.timecode?.end);
  if (start === null || end === null || end <= start) errors.push(`${label}: invalid timecode`);

  if (["ready", "published"].includes(episode.status)) {
    if (!episode.sourcePath?.trim()) errors.push(`${label}: sourcePath is required when ready`);
    if (!episode.hook?.trim()) errors.push(`${label}: hook is required when ready`);
    if ((episode.commentary || "").trim().length < 180) errors.push(`${label}: commentary must contain at least 180 characters when ready`);
    if (!episode.voiceover?.trim()) errors.push(`${label}: voiceover is required when ready`);
    if (!episode.telegramLink?.trim()) errors.push(`${label}: telegramLink is required when ready`);
  }
}

if (errors.length) {
  console.error(`Video plan validation failed:\n- ${errors.join("\n- ")}`);
  process.exitCode = 1;
} else {
  console.log(`Video plan is valid: ${(plan.episodes || []).length} episode(s).`);
}
