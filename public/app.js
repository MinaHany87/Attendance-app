// Employee attendance page.

const EMP_KEY = 'attendance_employee';
const $ = (id) => document.getElementById(id);

let today = null;     // today's record for the selected employee (or null)
let history = null;   // history response for the selected month

const selectedId = () => Number($('employeeSelect').value) || null;

function showMessage(text, isError = false) {
  const box = $('msgBox');
  box.textContent = text;
  box.className = isError ? 'message error' : 'message';
  box.hidden = false;
}

function showAlert(text) {
  const box = $('alertBox');
  box.textContent = text;
  box.hidden = !text;
}

function showGate() {
  $('app').hidden = true;
  $('gate').hidden = false;
  $('pinInput').value = '';
  $('pinInput').focus();
}

async function openApp() {
  const employees = await api('employees');
  const select = $('employeeSelect');
  select.innerHTML =
    '<option value="">Select your name...</option>' +
    employees.map((e) => `<option value="${e.id}">${escapeHtml(e.name)}</option>`).join('');

  const saved = localStorage.getItem(EMP_KEY);
  if (saved && employees.some((e) => String(e.id) === saved)) select.value = saved;

  $('gate').hidden = true;
  $('app').hidden = false;
  await refresh();
}

async function refresh() {
  showMessage('');
  showAlert('');
  if (!selectedId()) {
    today = null;
    history = null;
    renderToday();
    renderHistory();
    return;
  }
  await Promise.all([loadToday(), loadHistory()]);
}

async function loadToday() {
  today = await api(`today?employeeId=${selectedId()}`);
  renderToday();
}

async function loadHistory() {
  const month = $('monthInput').value || cairoMonth();
  history = await api(`history?employeeId=${selectedId()}&month=${month}`);
  renderHistory();
}

function renderToday() {
  const hasEmployee = Boolean(selectedId());
  const hasOut = Boolean(today && today.checkOut);

  let text = 'Select your name to begin.';
  if (hasEmployee && !today) text = 'Not checked in yet today.';
  if (hasEmployee && today && !hasOut) text = `Checked in at ${today.checkIn}. Check out when you leave.`;
  if (hasEmployee && hasOut) {
    text = `Checked in at ${today.checkIn} · Checked out at ${today.checkOut} · Hours worked: ${fmtHM(today.hours)}`;
  }
  $('todayStatus').textContent = text;

  $('checkInBtn').disabled = !hasEmployee || Boolean(today);
  $('checkOutBtn').disabled = !hasEmployee || !today || hasOut;

  $('editCard').hidden = !today;
  if (today) {
    $('editIn').value = today.checkIn || '';
    $('editOut').value = today.checkOut || '';
    if (today.alert) showAlert(`Alert: ${today.alert}`);
  }
}

function renderHistory() {
  const body = $('historyBody');
  if (!history) {
    body.innerHTML = '<tr><td colspan="5" class="empty">Select your name to see your history.</td></tr>';
    $('totalHours').textContent = '-';
    $('totalDecimal').textContent = '';
    $('dividedHours').textContent = '-';
    return;
  }

  body.innerHTML = history.records.length
    ? history.records
        .map(
          (r) => `
        <tr>
          <td>${escapeHtml(r.workDate)}</td>
          <td>${escapeHtml(r.checkIn || '-')}</td>
          <td>${escapeHtml(r.checkOut || '-')}</td>
          <td>${r.hours == null ? '-' : escapeHtml(fmtHM(r.hours))}</td>
          <td>${r.alert ? `<span class="badge warn">${escapeHtml(r.alert)}</span>` : ''}</td>
        </tr>`
        )
        .join('')
    : '<tr><td colspan="5" class="empty">No attendance recorded for this month.</td></tr>';

  const s = history.summary;
  $('totalHours').textContent = s.totalText;
  $('totalDecimal').textContent = `${s.totalHours} hours`;
  $('dividedHours').textContent = `${s.dividedBy26} hours`;
}

// ---------- Actions ----------
$('gateForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pin = $('pinInput').value.trim();
  try {
    await api('login', { method: 'POST', body: { pin } });
    localStorage.setItem(PIN_KEY, pin);
    $('gateError').hidden = true;
    await openApp();
  } catch (err) {
    localStorage.removeItem(PIN_KEY);
    $('gateError').textContent = err.message;
    $('gateError').hidden = false;
  }
});

$('employeeSelect').addEventListener('change', () => {
  localStorage.setItem(EMP_KEY, $('employeeSelect').value);
  refresh().catch((err) => showMessage(err.message, true));
});

$('monthInput').addEventListener('change', () => {
  loadHistory().catch((err) => showMessage(err.message, true));
});

$('checkInBtn').addEventListener('click', async () => {
  try {
    const r = await api('checkin', { method: 'POST', body: { employeeId: selectedId() } });
    showMessage(r.message);
    await refresh();
  } catch (err) {
    showMessage(err.message, true);
  }
});

$('checkOutBtn').addEventListener('click', async () => {
  try {
    const r = await api('checkout', { method: 'POST', body: { employeeId: selectedId() } });
    showMessage(r.message);
    if (r.alert) {
      showAlert(`Alert: ${r.alert}. Your check-out has been saved.`);
      window.alert(`${r.alert}.\nYour check-out has been saved.`);
    }
    await refresh();
  } catch (err) {
    showMessage(err.message, true);
  }
});

$('editForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!today) return;
  const body = { employeeId: selectedId() };
  const inVal = $('editIn').value;
  const outVal = $('editOut').value;
  if (inVal && inVal !== today.checkIn) body.checkIn = inVal;
  if (outVal && outVal !== today.checkOut) body.checkOut = outVal;

  if (Object.keys(body).length === 1) {
    showMessage('Nothing changed.');
    return;
  }

  try {
    const r = await api(`attendance/${today.id}`, { method: 'PATCH', body });
    showMessage(r.message);
    if (r.alert) showAlert(`Alert: ${r.alert}`);
    await refresh();
  } catch (err) {
    showMessage(err.message, true);
  }
});

$('lockBtn').addEventListener('click', () => {
  localStorage.removeItem(PIN_KEY);
  showGate();
});

// ---------- Start ----------
(async function boot() {
  startClock();
  $('monthInput').value = cairoMonth();
  if (localStorage.getItem(PIN_KEY)) {
    try {
      await openApp();
      return;
    } catch {
      localStorage.removeItem(PIN_KEY);
    }
  }
  showGate();
})();
