export function sourcePerformanceStats(db, activitySql, limit = 10) {
  return db.prepare(`
    SELECT
      users.source,
      COUNT(DISTINCT users.id) AS users,
      COUNT(DISTINCT activity.user_id) AS active_users,
      COALESCE(SUM(activity.actions), 0) AS actions
    FROM users
    LEFT JOIN (${activitySql}) AS activity ON activity.user_id = users.id
    WHERE users.source IS NOT NULL
    GROUP BY users.source
    ORDER BY users DESC, active_users DESC, users.source
    LIMIT ?
  `).all(limit);
}
