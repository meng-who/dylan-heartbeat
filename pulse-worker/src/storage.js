import { createDefaultState, normalizeState } from "./pulse.js";

export async function loadState(db, profileId, nowMs = Date.now()) {
  if (!db) return createDefaultState(nowMs);
  const row = await db
    .prepare("SELECT state_json FROM pulse_state WHERE profile_id = ?1")
    .bind(profileId)
    .first();
  if (!row?.state_json) return createDefaultState(nowMs);
  try {
    return normalizeState(JSON.parse(row.state_json), nowMs);
  } catch {
    return createDefaultState(nowMs);
  }
}

export async function saveState(db, profileId, state, events = []) {
  if (!db) return;
  const snapshot = JSON.stringify(state);
  const statements = [
    db.prepare(`
      INSERT INTO pulse_state(profile_id, state_json, updated_at)
      VALUES (?1, ?2, ?3)
      ON CONFLICT(profile_id) DO UPDATE SET
        state_json = excluded.state_json,
        updated_at = excluded.updated_at
    `).bind(profileId, snapshot, state.updatedAt)
  ];

  for (const event of events.slice(0, 4)) {
    statements.push(
      db.prepare(`
        INSERT INTO pulse_events(profile_id, created_at, event_type, summary, snapshot_json)
        VALUES (?1, ?2, ?3, ?4, ?5)
      `).bind(
        profileId,
        state.updatedAt,
        String(event.type || "state").slice(0, 32),
        String(event.summary || "身体状态更新").slice(0, 160),
        snapshot
      )
    );
  }

  await db.batch(statements);
  await db.prepare(`
    DELETE FROM pulse_events
    WHERE profile_id = ?1
      AND id NOT IN (
        SELECT id FROM pulse_events
        WHERE profile_id = ?1
        ORDER BY created_at DESC, id DESC
        LIMIT 200
      )
  `).bind(profileId).run();
}

export async function listEvents(db, profileId, limit = 30) {
  if (!db) return [];
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 30));
  const result = await db.prepare(`
    SELECT created_at, event_type, summary, snapshot_json
    FROM pulse_events
    WHERE profile_id = ?1
    ORDER BY created_at DESC, id DESC
    LIMIT ?2
  `).bind(profileId, safeLimit).all();
  return (result.results || []).map(row => {
    let snapshot = null;
    try {
      snapshot = JSON.parse(row.snapshot_json || "null");
    } catch {}
    return {
      created_at: row.created_at,
      event_type: row.event_type,
      summary: row.summary,
      snapshot
    };
  });
}
