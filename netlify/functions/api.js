// Netlify Function: all API routes for the attendance app.
// Routes are served under /api/* (see netlify.toml).

const { Pool } = require('pg');
const ExcelJS = require('exceljs');

const CAIRO_TZ = 'Africa/Cairo';
const MIN_HOURS = 8;
const MONTH_DIVISOR = 26;

// ---------- Database ----------
let pool;
function db() {
  if (!pool) {
    const connectionString = process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('Database connection string is missing. Set NETLIFY_DATABASE_URL or DATABASE_URL.');
    }
    pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false }, max: 2 });
  }
  return pool;
}

// ---------- Helpers ----------
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const reply = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

function parseBody(event) {
  if (!event.body) return {};
  try {
    return JSON.parse(event.body);
  } catch {
    throw new HttpError(400, 'Invalid JSON in request body.');
  }
}

function requirePin(event) {
  const expected = process.env.APP_PIN;
  if (!expected) return; // no PIN set = open access
  const headers = event.headers || {};
  const given = headers['x-app-pin'] || headers['X-App-Pin'] || '';
  if (given !== expected) throw new HttpError(401, 'Wrong or missing PIN.');
}

function toId(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'Invalid employee id.');
  return n;
}

function cleanName(value) {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  if (!name) throw new HttpError(400, 'Name is required.');
  if (name.length > 100) throw new HttpError(400, 'Name is too long (max 100 characters).');
  return name;
}

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const isTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s || '');
const pad = (n) => String(n).padStart(2, '0');

// ---------- Cairo time ----------
const partsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: CAIRO_TZ,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hourCycle: 'h23',
});
const clockFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: CAIRO_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function cairoParts(date) {
  const p = Object.fromEntries(partsFormatter.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}

// Today's date in Cairo as YYYY-MM-DD
function todayCairo(now = new Date()) {
  const p = cairoParts(now);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

// Cairo's offset from UTC at a given instant (+2h in winter, +3h in summer)
function cairoOffsetMs(ts) {
  const p = cairoParts(new Date(ts));
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - ts;
}

// Convert a Cairo wall-clock date + HH:MM into a real UTC Date
function cairoToDate(dateStr, hhmm) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, h, mi);
  let ts = wall - cairoOffsetMs(wall);
  ts = wall - cairoOffsetMs(ts); // refine around daylight-saving changes
  return new Date(ts);
}

function fmtClock(date) {
  return date ? clockFormatter.format(new Date(date)) : '';
}

function fmtHM(hours) {
  const mins = Math.round(hours * 60);
  return `${Math.floor(mins / 60)} h ${pad(mins % 60)} min`;
}

function hoursBetween(inAt, outAt) {
  return Math.round(((outAt - inAt) / 3600000) * 100) / 100;
}

function alertFor(hours) {
  return hours < MIN_HOURS ? `Less than ${MIN_HOURS} hours: worked ${fmtHM(hours)}` : null;
}

function monthRange(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(last)}` };
}

// ---------- Queries ----------
const ROW_SQL = `
  SELECT id, employee_id, to_char(work_date, 'YYYY-MM-DD') AS work_date,
         check_in_at, check_out_at, hours_worked, alert_message
  FROM attendance`;

function mapRow(r) {
  return {
    id: r.id,
    workDate: r.work_date,
    checkIn: fmtClock(r.check_in_at),
    checkOut: fmtClock(r.check_out_at),
    hours: r.hours_worked == null ? null : Number(r.hours_worked),
    alert: r.alert_message,
  };
}

async function activeEmployee(id) {
  const { rows } = await db().query('SELECT id, name FROM employees WHERE id = $1 AND is_active', [id]);
  if (!rows[0]) throw new HttpError(404, 'Employee not found or inactive.');
  return rows[0];
}

async function todayFor(employeeId) {
  const { rows } = await db().query(`${ROW_SQL} WHERE employee_id = $1 AND work_date = $2`, [
    employeeId,
    todayCairo(),
  ]);
  return rows[0] ? mapRow(rows[0]) : null;
}

// ---------- Employees ----------
async function listEmployees(query) {
  const includeInactive = query.all === '1';
  const { rows } = await db().query(
    `SELECT id, name, is_active FROM employees ${includeInactive ? '' : 'WHERE is_active'} ORDER BY name`
  );
  return rows;
}

async function createEmployee(body) {
  const name = cleanName(body.name);
  try {
    const { rows } = await db().query(
      'INSERT INTO employees (name) VALUES ($1) RETURNING id, name, is_active',
      [name]
    );
    return rows[0];
  } catch (err) {
    if (err.code === '23505') throw new HttpError(409, 'An employee with this name already exists.');
    throw err;
  }
}

async function updateEmployee(id, body) {
  const sets = [];
  const values = [];
  if (body.name !== undefined) {
    values.push(cleanName(body.name));
    sets.push(`name = $${values.length}`);
  }
  if (body.isActive !== undefined) {
    values.push(Boolean(body.isActive));
    sets.push(`is_active = $${values.length}`);
  }
  if (!sets.length) throw new HttpError(400, 'Nothing to update.');
  values.push(id);
  try {
    const { rows } = await db().query(
      `UPDATE employees SET ${sets.join(', ')} WHERE id = $${values.length}
       RETURNING id, name, is_active`,
      values
    );
    if (!rows[0]) throw new HttpError(404, 'Employee not found.');
    return rows[0];
  } catch (err) {
    if (err.code === '23505') throw new HttpError(409, 'An employee with this name already exists.');
    throw err;
  }
}

// ---------- Check-in / check-out ----------
async function checkIn(body) {
  const employeeId = toId(body.employeeId);
  await activeEmployee(employeeId);
  const now = new Date();
  const { rows } = await db().query(
    `INSERT INTO attendance (employee_id, work_date, check_in_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (employee_id, work_date) DO NOTHING
     RETURNING id`,
    [employeeId, todayCairo(now), now]
  );
  if (!rows[0]) throw new HttpError(409, 'You have already checked in today.');
  return {
    message: `Checked in at ${fmtClock(now)} (Cairo time).`,
    record: await todayFor(employeeId),
  };
}

async function checkOut(body) {
  const employeeId = toId(body.employeeId);
  await activeEmployee(employeeId);
  const now = new Date();
  const { rows } = await db().query(
    'SELECT id, check_in_at, check_out_at FROM attendance WHERE employee_id = $1 AND work_date = $2',
    [employeeId, todayCairo(now)]
  );
  const rec = rows[0];
  if (!rec || !rec.check_in_at) throw new HttpError(400, 'You have not checked in today.');
  if (rec.check_out_at) throw new HttpError(409, 'You have already checked out today.');

  const hours = hoursBetween(rec.check_in_at, now);
  const alert = alertFor(hours);
  await db().query(
    `UPDATE attendance
     SET check_out_at = $1, hours_worked = $2, alert_message = $3, updated_at = now()
     WHERE id = $4`,
    [now, hours, alert, rec.id]
  );
  return {
    message: `Checked out at ${fmtClock(now)}. Hours worked today: ${fmtHM(hours)}.`,
    alert,
    record: await todayFor(employeeId),
  };
}

// ---------- Edit (today only) ----------
async function editToday(attendanceId, body) {
  const employeeId = toId(body.employeeId);
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(`${ROW_SQL} WHERE id = $1 FOR UPDATE`, [attendanceId]);
    const row = rows[0];
    if (!row || row.employee_id !== employeeId) throw new HttpError(404, 'Record not found.');

    const today = todayCairo();
    if (row.work_date !== today) {
      throw new HttpError(403, "Only today's record can be edited. Past records are locked.");
    }

    const now = new Date();
    let newIn = row.check_in_at;
    let newOut = row.check_out_at;
    const changes = [];

    if (body.checkIn) {
      if (!isTime(body.checkIn)) throw new HttpError(400, 'Check-in must be a time like 09:05.');
      const value = cairoToDate(today, body.checkIn);
      changes.push(['check_in', row.check_in_at, value]);
      newIn = value;
    }
    if (body.checkOut) {
      if (!isTime(body.checkOut)) throw new HttpError(400, 'Check-out must be a time like 17:30.');
      const value = cairoToDate(today, body.checkOut);
      changes.push(['check_out', row.check_out_at, value]);
      newOut = value;
    }

    if (!changes.length) throw new HttpError(400, 'No changes provided.');
    if (newIn && newIn > now) throw new HttpError(400, 'Check-in cannot be in the future.');
    if (newOut && newOut > now) throw new HttpError(400, 'Check-out cannot be in the future.');
    if (newOut && !newIn) throw new HttpError(400, 'Check-in is required before check-out.');

    let hours = null;
    let alert = null;
    if (newOut) {
      if (newOut <= newIn) throw new HttpError(400, 'Check-out must be after check-in.');
      hours = hoursBetween(newIn, newOut);
      alert = alertFor(hours);
    }

    await client.query(
      `UPDATE attendance
       SET check_in_at = $1, check_out_at = $2, hours_worked = $3, alert_message = $4, updated_at = now()
       WHERE id = $5`,
      [newIn, newOut, hours, alert, attendanceId]
    );

    for (const [field, oldValue, newValue] of changes) {
      await client.query(
        `INSERT INTO attendance_edits (attendance_id, field_changed, old_value, new_value)
         VALUES ($1, $2, $3, $4)`,
        [
          attendanceId,
          field,
          oldValue ? new Date(oldValue).toISOString() : null,
          newValue.toISOString(),
        ]
      );
    }

    await client.query('COMMIT');
    return {
      message: 'Record updated.',
      alert,
      record: await todayFor(employeeId),
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---------- History (one employee only) ----------
async function history(query) {
  const employeeId = toId(query.employeeId);
  const month = query.month || todayCairo().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) throw new HttpError(400, 'Month must be YYYY-MM.');

  const range = monthRange(month);
  const today = todayCairo();
  const to = range.to < today ? range.to : today;

  const { rows } = await db().query(
    `${ROW_SQL} WHERE employee_id = $1 AND work_date BETWEEN $2 AND $3 ORDER BY work_date DESC`,
    [employeeId, range.from, to]
  );
  const records = rows.map(mapRow);
  const total = records.reduce((sum, r) => sum + (r.hours || 0), 0);

  return {
    month,
    from: range.from,
    to,
    records,
    summary: {
      totalHours: Math.round(total * 100) / 100,
      totalText: fmtHM(total),
      divisor: MONTH_DIVISOR,
      dividedBy26: Math.round((total / MONTH_DIVISOR) * 100) / 100,
    },
  };
}

// ---------- Excel export (HR) ----------
async function exportXlsx(query) {
  const { from, to } = query;
  if (!isDate(from) || !isDate(to)) throw new HttpError(400, 'from and to dates (YYYY-MM-DD) are required.');

  const params = [from, to];
  let filter = '';
  if (query.employeeId) {
    params.push(toId(query.employeeId));
    filter = `AND a.employee_id = $${params.length}`;
  }

  const { rows } = await db().query(
    `SELECT e.name, to_char(a.work_date, 'YYYY-MM-DD') AS work_date,
            a.check_in_at, a.check_out_at, a.hours_worked, a.alert_message
     FROM attendance a
     JOIN employees e ON e.id = a.employee_id
     WHERE a.work_date BETWEEN $1 AND $2 ${filter}
     ORDER BY e.name, a.work_date`,
    params
  );

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Mina Hany - Unlimited Care';
  const ws = wb.addWorksheet('Attendance');

  const title = ws.addRow(['Mina Hany - Unlimited Care | Attendance Report']);
  title.font = { bold: true, size: 14, color: { argb: 'FF173001' } };
  ws.mergeCells(`A1:F1`);

  const period = ws.addRow([`Period: ${from} to ${to} (Cairo time)`]);
  period.font = { color: { argb: 'FF4B7401' } };
  ws.mergeCells(`A2:F2`);

  ws.addRow([]);

  const header = ws.addRow(['Name', 'Date', 'Check-in', 'Check-out', 'Hours worked', 'Alert']);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF173001' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });

  rows.forEach((r, index) => {
    const hours = r.hours_worked == null ? '' : Number(r.hours_worked);
    const row = ws.addRow([
      r.name,
      r.work_date,
      fmtClock(r.check_in_at),
      fmtClock(r.check_out_at),
      hours,
      r.alert_message || '',
    ]);
    row.eachCell((cell) => {
      if (index % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4F8EC' } };
      }
    });
    row.getCell(5).numFmt = '0.00';
    if (r.alert_message) {
      row.getCell(6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF1C2' } };
    }
  });

  [28, 14, 12, 12, 14, 48].forEach((width, i) => {
    ws.getColumn(i + 1).width = width;
  });
  ws.views = [{ state: 'frozen', ySplit: 4 }];

  const buffer = await wb.xlsx.writeBuffer();
  return {
    base64: Buffer.from(buffer).toString('base64'),
    filename: `attendance_${from}_to_${to}.xlsx`,
  };
}

// ---------- Router ----------
exports.handler = async (event) => {
  try {
    const path = event.path || '';
    const match = path.match(/\/api(?:\/(.*))?$/);
    const parts = (match && match[1] ? match[1] : '').split('/').filter(Boolean);
    const [seg0, seg1] = parts;
    const method = event.httpMethod;
    const query = event.queryStringParameters || {};

   if (seg0 === 'login' && method === 'POST') {
  const body = parseBody(event);
  if (process.env.APP_PIN && body.pin !== process.env.APP_PIN) {
    throw new HttpError(401, 'Wrong PIN.');
  }
  return reply(200, { ok: true });
}

    requirePin(event);
    const body = method === 'POST' || method === 'PATCH' ? parseBody(event) : {};

    if (seg0 === 'employees') {
      if (method === 'GET' && !seg1) return reply(200, await listEmployees(query));
      if (method === 'POST' && !seg1) return reply(201, await createEmployee(body));
      if (method === 'PATCH' && seg1) return reply(200, await updateEmployee(toId(seg1), body));
    }
    if (seg0 === 'today' && method === 'GET') {
      return reply(200, await todayFor(toId(query.employeeId)));
    }
    if (seg0 === 'checkin' && method === 'POST') return reply(200, await checkIn(body));
    if (seg0 === 'checkout' && method === 'POST') return reply(200, await checkOut(body));
    if (seg0 === 'attendance' && method === 'PATCH' && seg1) {
      return reply(200, await editToday(toId(seg1), body));
    }
    if (seg0 === 'history' && method === 'GET') return reply(200, await history(query));
    if (seg0 === 'export' && method === 'GET') {
      const file = await exportXlsx(query);
      return {
        statusCode: 200,
        isBase64Encoded: true,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${file.filename}"`,
        },
        body: file.base64,
      };
    }

    throw new HttpError(404, 'Not found.');
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    return reply(status, {
      error: status === 500 ? 'Something went wrong. Please try again.' : err.message,
    });
  }
};
