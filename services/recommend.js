/* ==========================================================================
   Technician recommendation engine.
   Ranks technicians by: department match, availability (schedule +
   unavailability), current workload, and optional category skill.
   Pure-ish: takes the db handle, returns a ranked list with reasons.
   ========================================================================== */

// Statuses that count as "active workload" on a technician — every status
// except the terminal ones (Resolved/Closed/Cancelled). New/Open/On Scheduled
// are included because assigning a technician no longer forces the status to
// "Assigned": a ticket can sit in New/Open/On Scheduled and still be real work.
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

/**
 * @returns Array<{ id, username, department, workload, available, off_duty,
 *                  skill_match, score, reasons: string[] }>
 * sorted best-first. Never throws for "no technician" — returns [].
 */
async function recommendTechnicians(db, { department, categoryName, atDate = new Date() }) {
  const role = roleForDept(department);
  const techs = await db.pAll(
    `SELECT id, username, department FROM users
      WHERE role = ? AND is_active = 1`,
    [role]
  );
  if (!techs.length) return [];

  const dow = atDate.getDay(); // 0=Sun..6=Sat
  const nowMins = atDate.getHours() * 60 + atDate.getMinutes();
  const iso = atDate.toISOString();

  const results = [];
  for (const t of techs) {
    const reasons = [];

    // Workload
    const wl = await db.pGet(
      `SELECT COUNT(*) AS c FROM tickets
        WHERE assigned_technician_id = ?
          AND status IN (${OPEN_ASSIGNED_STATUSES.map(() => '?').join(',')})`,
      [t.id, ...OPEN_ASSIGNED_STATUSES]
    );
    const workload = wl ? wl.c : 0;

    // Schedule availability (is now within a working window today?)
    const sched = await db.pAll(
      `SELECT start_time, end_time FROM technician_schedules
        WHERE user_id = ? AND day_of_week = ? AND active = 1`,
      [t.id, dow]
    );
    let scheduledNow = false;
    let hasScheduleToday = sched.length > 0;
    for (const s of sched) {
      const start = toMinutes(s.start_time);
      const end = toMinutes(s.end_time);
      if (start != null && end != null && nowMins >= start && nowMins <= end) {
        scheduledNow = true;
        break;
      }
    }

    // Explicit unavailability block overlapping now
    const unavail = await db.pGet(
      `SELECT 1 FROM technician_unavailability
        WHERE user_id = ? AND start_datetime <= ? AND end_datetime >= ?`,
      [t.id, iso, iso]
    );
    const offDuty = !!unavail;

    // Skill match
    let skillMatch = false;
    if (categoryName) {
      const skill = await db.pGet(
        `SELECT 1 FROM technician_skills
          WHERE user_id = ? AND (category_name = ? OR (category_name IS NULL AND department_code = ?))`,
        [t.id, categoryName, department]
      );
      skillMatch = !!skill;
    }

    const available = scheduledNow && !offDuty;

    // Scoring — higher is better.
    let score = 0;
    if (available) { score += 100; reasons.push('available now'); }
    else if (!hasScheduleToday) { reasons.push('no schedule today'); }
    else if (!scheduledNow) { reasons.push('off-hours now'); }
    if (offDuty) reasons.push('marked unavailable');
    if (skillMatch) { score += 30; reasons.push(`skilled in ${categoryName}`); }
    score -= workload * 10; // prefer lighter workload
    reasons.push(`${workload} open ticket${workload === 1 ? '' : 's'}`);

    // One short label for the UI. "Busy" covers a technician who has a shift
    // today but is outside it right now; an explicit unavailability block wins.
    const availability = offDuty
      ? 'Off duty'
      : available
        ? 'Available now'
        : !hasScheduleToday
          ? 'No schedule today'
          : 'Busy';

    results.push({
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
    });
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

module.exports = { recommendTechnicians, OPEN_ASSIGNED_STATUSES };
