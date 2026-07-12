export function ageGroup(age) {
  return age >= 18 ? "adult" : "minor";
}

export function profileMatches(queue, profile) {
  if (queue.mode === "random") return true;
  if (queue.targetGender !== "any" && queue.targetGender !== profile.gender) {
    return false;
  }
  return profile.age >= queue.minAge && profile.age <= queue.maxAge;
}

export function queuesAreCompatible(leftQueue, leftProfile, rightQueue, rightProfile) {
  if (ageGroup(leftProfile.age) !== ageGroup(rightProfile.age)) return false;
  return profileMatches(leftQueue, rightProfile) && profileMatches(rightQueue, leftProfile);
}
