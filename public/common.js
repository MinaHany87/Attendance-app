// Shared helpers for the employee page and the HR page.

const PIN_KEY = 'attendance_pin';
const CAIRO_TZ = 'Africa/Cairo';

async function api(path, { method = 'GET', body, raw = false } = {}) {
  const res = await fetch('/api/' + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-App-Pin': localStorage.getItem(PIN_KEY) || '',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (raw) {
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Download failed.');
    }
    return res.blob();
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status}).`);
  return data;
}

function cairoParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: CAIRO_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  return Object.fromEntries(parts.map((p) => [p.type, p.value]));
}

function cairoToday() {
  const p = cairoParts();
  return `${p.year}-${p.month}-${p.day}`;
}

function cairoMonth() {
  return cairoToday().slice(0, 7);
}

function fmtHM(hours) {
  const mins = Math.round(hours * 60);
  return `${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, '0')} min`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function startClock() {
  const dateEl = document.getElementById('cairoDate');
  const timeEl = document.getElementById('cairoTime');
  const tick = () => {
    const now = new Date();
    if (dateEl) {
      dateEl.textContent = new Intl.DateTimeFormat('en-GB', {
        timeZone: CAIRO_TZ, weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
      }).format(now);
    }
    if (timeEl) {
      timeEl.textContent = new Intl.DateTimeFormat('en-GB', {
        timeZone: CAIRO_TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
      }).format(now);
    }
  };
  tick();
  setInterval(tick, 1000);
}
