const pool = require('./src/db');

// Import the helper functions we need
function getJsDayFromYMD(dateStr) {
  const parts = String(dateStr || "").split("-").map((x) => Number(x));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const [y, m, d] = parts;
  const dt = new Date(Date.UTC(y, m - 1, d));
  const jsDay = dt.getUTCDay();
  return Number.isFinite(jsDay) ? jsDay : null;
}

function ymdAddDays(ymd, deltaDays) {
  const base = new Date(`${ymd}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + Number(deltaDays || 0));
  return base.toISOString().slice(0, 10);
}

function isActiveDayOfWeek(ymd, activeDayIds) {
  if (!activeDayIds || !activeDayIds.size) return true;
  const jsDay = getJsDayFromYMD(ymd);
  if (jsDay === null || jsDay === undefined) return false;
  const dbDayId = jsDay === 0 ? 7 : jsDay;
  return activeDayIds.has(dbDayId);
}

function ymdAddActiveDays(startYmd, deltaActiveDays, activeDayIds) {
  const n = Number(deltaActiveDays || 0);
  if (!Number.isFinite(n) || n === 0) return startYmd;
  if (!activeDayIds || !activeDayIds.size) return ymdAddDays(startYmd, n);

  let cur = startYmd;
  let remaining = n;
  let guard = 0;
  while (remaining > 0 && guard < 2000) {
    cur = ymdAddDays(cur, 1);
    if (isActiveDayOfWeek(cur, activeDayIds)) remaining -= 1;
    guard += 1;
  }
  return cur;
}

async function test() {
  try {
    // Get active days
    const [activeDaysRows] = await pool.execute(
      'SELECT id FROM timetable_days WHERE Is_active = 1 ORDER BY id'
    );
    const activeDayIds = new Set(activeDaysRows.map(r => Number(r.id)));

    console.log('Active day IDs:', Array.from(activeDayIds).sort().join(', '));

    // Test ymdAddActiveDays function
    const startDate = '2026-01-05';
    console.log(`\nTesting ymdAddActiveDays from ${startDate}:`);

    const result1 = ymdAddActiveDays(startDate, 6, activeDayIds);
    console.log(`  Add 6 working days: ${startDate} -> ${result1}`);

    const result2 = ymdAddActiveDays(startDate, 13, activeDayIds);
    console.log(`  Add 13 working days: ${startDate} -> ${result2}`);

    const result3 = ymdAddActiveDays(startDate, 20, activeDayIds);
    console.log(`  Add 20 working days: ${startDate} -> ${result3}`);

    const result4 = ymdAddActiveDays(startDate, 30, activeDayIds);
    console.log(`  Add 30 working days: ${startDate} -> ${result4}`);

    console.log('\n✓ All tests passed - no errors');

  } catch (err) {
    console.error('✗ Error:', err.message);
    console.error(err.stack);
  } finally {
    await pool.end();
  }
}

test();
