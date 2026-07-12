export function parseStartSource(value, userId) {
  const source = value?.trim() || "";
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(source)) return null;
  if (source === `ref_${userId}`) return null;
  return source;
}
