/* ==========================================================================
   Technician recommendation engine.
   Ranks technicians by: department match, availability (schedule +
   unavailability), current workload, and optional category skill.
   Pure-ish: takes the db handle, returns a ranked list with reasons.
   Four queries in total, regardless of team size.
   ========================================================================== */

// Statuses that count as "active workload" on a technician — every status
// except the terminal ones (Resolved/Closed/Cancelled).
const OPEN_ASSIGNED_STATUSES = [
  'New', 'Open', 'Assigned', 'On Scheduled', 'On Progress', 'Waiting Sparepart',
  'Waiting Vendor', 'Pending Outlet Response', 'Escalated',
];

function toMinutes(hhmm) {
  if (!hhmm || typeof hhmm !== 'string') return null;
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function roleForDept(department) {
  return department === 'ME' ? 'TechnicianME' : 'TechnicianIT';
}

// Unavailability blocks come from <input type="datetime-local"> and are stored
// as local wall-clock text ("2026-09-17T13:00"); older rows may be full ISO.
// Parse both to epoch ms in the server's local zone.
function blockMs(v) {
  if (!v) return null;
  const s = String(v).trim().replace(' ', 'T');
  const t = Date.parse(s.length === 10 ? `${s}T00:00` : s);
  return Number.isNaN(t) ? null : t;
}

/**
 * @returns Array<{ id, username, department, workload, available, off_duty,
 *                  skill_match, score, reasons: string[] }>
 * sorted best-first. Never throws for "no technician" — returns [].
 */
async function recommendTechnicians(db, { department, categoryName, atDate = new Date() }) {
  const role = roleForDept(department);
  const techs = await db.pAll(
    `SELECT u.id, u.username, u.department, COUNT(t.id) AS workload
       FROM users u
       LEFT JOIN tickets t
         ON t.assigned_technician_id = u.id
        AND t.status IN (${OPEN_ASSIGNED_STATUSES.map(() => '?').join(',')})
      WHERE u.role = ? AND u.is_active = 1
      GROUP BY u.id`,
    [...OPEN_ASSIGNED_STATUSES, role]
  );
  if (!techs.length) return [];

  const ids = techs.map((t) => t.id);
  const ph = ids.map(() => '?').join(',');
  const dow = atDate.getDay(); // 0=Sun..6=Sat
  const nowMins = atDate.getHours() * 60 + atDate.getMinutes();
  const nowMs = atDate.getTime();

  const [sched, blocks, skills] = await Promise.all([
    db.pAll(
      `SELECT user_id, start_time, end_time FROM technician_schedules
        WHERE user_id IN (${ph}) AND day_of_week = ? AND active = 1`,
      [...ids, dow]
    ),
    db.pAll(
      `SELECT user_id, start_datetime, end_datetime FROM technician_unavailability
        WHERE user_id IN (${ph})`,
      ids
    ),
    categoryName
      ? db.pAll(
          `SELECT DISTINCT user_id FROM technician_skills
            WHERE user_id IN (${ph})
              AND (category_name = ? OR (category_name IS NULL AND department_code = ?))`,
          [...ids, categoryName, department]
        )
      : Promise.resolve([]),
  ]);
  const skilled = new Set(skills.map((s) => s.user_id));

  const results = techs.map((t) => {
    const reasons = [];
    const workload = t.workload || 0;
    const mine = sched.filter((s) => s.user_id === t.id);
    const hasScheduleToday = mine.length > 0;
    const scheduledNow = mine.some((s) => {
      const start = toMinutes(s.start_time);
      const end = toMinutes(s.end_time);
      return start != null && end != null && nowMins >= start && nowMins < end;
    });
    const offDuty = blocks.some((b) => {
      if (b.user_id !== t.id) return false;
      const s = blockMs(b.start_datetime);
      const e = blockMs(b.end_datetime);
      return s != null && e != null && s <= nowMs && nowMs <= e;
    });
    const skillMatch = skilled.has(t.id);
    const available = scheduledNow && !offDuty;

    let score = 0;
    if (available) { score += 100; reasons.push('available now'); }
    else if (offDuty) { reasons.push('marked unavailable'); }
    else if (!hasScheduleToday) { reasons.push('no schedule today'); }
    else { reasons.push('off-hours now'); }
    if (skillMatch) { score += 30; reasons.push(`skilled in ${categoryName}`); }
    score -= workload * 10; // prefer lighter workload
    reasons.push(`${workload} open ticket${workload === 1 ? '' : 's'}`);

    const availability = offDuty
      ? 'Off duty'
      : available
        ? 'Available now'
        : !hasScheduleToday
          ? 'No schedule today'
          : 'Busy';

    return {
      id: t.id,
      username: t.username,
      department: t.department,
      workload,
      available,
      off_duty: offDuty,
      has_schedule_today: hasScheduleToday,
      availability,
      skill_match: skillMatch,
      score,
      reasons,
    };
  });

  results.sort((a, b) => b.score - a.score || a.workload - b.workload || a.username.localeCompare(b.username));
  return results;
}

module.exports = { recommendTechnicians, OPEN_ASSIGNED_STATUSES };
