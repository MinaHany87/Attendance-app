// HR page: manage employees and export attendance to Excel.

const $ = (id) => document.getElementById(id);

function showMsg(id, text, isError = false) {
  const el = $(id);
  el.textContent = text;
  el.className = isError ? 'message error' : 'message';
  el.hidden = false;
}

function showGate() {
  $('hr').hidden = true;
  $('gate').hidden = false;
  $('pinInput').value = '';
  $('pinInput').focus();
}

async function loadEmployees() {
  const employees = await api('employees?all=1');

  $('empBody').innerHTML = employees.length
    ? employees
        .map(
          (e) => `
        <tr>
          <td>${escapeHtml(e.name)}</td>
          <td>${e.is_active ? '<span class="badge ok">Active</span>' : '<span class="badge">Inactive</span>'}</td>
          <td class="actions-cell">
            <button class="btn outline small" data-action="rename" data-id="${e.id}" data-name="${escapeHtml(e.name)}">Rename</button>
            <button class="btn outline small" data-action="toggle" data-id="${e.id}" data-active="${e.is_active}">
              ${e.is_active ? 'Deactivate' : 'Activate'}
            </button>
          </td>
        </tr>`
        )
        .join('')
    : '<tr><td colspan="3" class="empty">No employees yet. Add the first one above.</td></tr>';

  $('exportEmployee').innerHTML =
    '<option value="">All employees</option>' +
    employees
      .map((e) => `<option value="${e.id}">${escapeHtml(e.name)}${e.is_active ? '' : ' (inactive)'}</option>`)
      .join('');
}

async function openHr() {
  await loadEmployees();
  const now = cairoParts();
  $('fromDate').value = `${now.year}-${now.month}-01`;
  $('toDate').value = cairoToday();
  $('gate').hidden = true;
  $('hr').hidden = false;
}

// ---------- Actions ----------
$('gateForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pin = $('pinInput').value.trim();
  try {
    await api('login', { method: 'POST', body: { pin } });
    localStorage.setItem(PIN_KEY, pin);
    $('gateError').hidden = true;
    await openHr();
  } catch (err) {
    localStorage.removeItem(PIN_KEY);
    $('gateError').textContent = err.message;
    $('gateError').hidden = false;
  }
});

$('addForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const name = $('newName').value;
    await api('employees', { method: 'POST', body: { name } });
    $('newName').value = '';
    showMsg('hrMsg', 'Employee added.');
    await loadEmployees();
  } catch (err) {
    showMsg('hrMsg', err.message, true);
  }
});

$('empBody').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  try {
    if (btn.dataset.action === 'rename') {
      const newName = window.prompt('New name:', btn.dataset.name);
      if (!newName) return;
      await api(`employees/${id}`, { method: 'PATCH', body: { name: newName } });
    } else {
      const makeActive = btn.dataset.active !== 'true';
      await api(`employees/${id}`, { method: 'PATCH', body: { isActive: makeActive } });
    }
    showMsg('hrMsg', 'Employee updated.');
    await loadEmployees();
  } catch (err) {
    showMsg('hrMsg', err.message, true);
  }
});

$('exportForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const from = $('fromDate').value;
  const to = $('toDate').value;
  const employeeId = $('exportEmployee').value;
  if (from > to) {
    showMsg('exportMsg', 'The "From" date must be before the "To" date.', true);
    return;
  }

  try {
    const query = `from=${from}&to=${to}${employeeId ? `&employeeId=${employeeId}` : ''}`;
    const blob = await api(`export?${query}`, { raw: true });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `attendance_${from}_to_${to}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showMsg('exportMsg', 'Export downloaded.');
  } catch (err) {
    showMsg('exportMsg', err.message, true);
  }
});

$('lockBtn').addEventListener('click', () => {
  localStorage.removeItem(PIN_KEY);
  showGate();
});

// ---------- Start ----------
(async function boot() {
  startClock();
  try {
    await openHr();
  } catch {
    showGate();
  }
})();
