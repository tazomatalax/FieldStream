const api = (path, options={}) => fetch(`/api${path}`, { headers: { 'Content-Type': 'application/json' }, ...options }).then(r => r.json());

async function loadTenants() {
  const list = await api('/tenants');
  const sel = document.getElementById('tenantSelect');
  const sel2 = document.getElementById('tenantSelectToken');
  sel.innerHTML = '';
  sel2.innerHTML = '';
  const container = document.getElementById('tenants');
  container.innerHTML = '';
  list.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.id; opt.textContent = `${t.name} (${t.id.slice(0,8)})`;
    sel.appendChild(opt);
    const opt2 = opt.cloneNode(true);
    sel2.appendChild(opt2);
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `<strong>${t.name}</strong><br/><code>${t.id}</code>`;
    container.appendChild(card);
  });
}

async function createTenant() {
  const name = document.getElementById('tenantName').value;
  await api('/tenants', { method: 'POST', body: JSON.stringify({ name }) });
  await loadTenants();
}

async function loadDevices() {
  const tenantId = document.getElementById('tenantSelect').value;
  if (!tenantId) return;
  const list = await api(`/tenants/${tenantId}/devices`);
  const container = document.getElementById('devices');
  container.innerHTML = '';
  list.forEach(d => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `<strong>${d.name}</strong> — <code>${d.id}</code>`;
    container.appendChild(card);
  });
}

async function createDevice() {
  const tenantId = document.getElementById('tenantSelect').value;
  const id = document.getElementById('deviceId').value || undefined;
  const name = document.getElementById('deviceName').value || id;
  if (!tenantId) return alert('Select a tenant');
  await api(`/tenants/${tenantId}/devices`, { method: 'POST', body: JSON.stringify({ id, name }) });
  await loadDevices();
}

async function issueToken() {
  const tenantId = document.getElementById('tenantSelectToken').value;
  const deviceId = document.getElementById('deviceIdToken').value;
  if (!tenantId || !deviceId) return alert('Select tenant and enter device ID');
  const res = await api(`/tenants/${tenantId}/devices/${deviceId}/token`, { method: 'POST', body: JSON.stringify({ expiresIn: '1h' }) });
  document.getElementById('tokenOut').textContent = JSON.stringify(res, null, 2);
}

window.addEventListener('load', async () => {
  document.getElementById('status').textContent = 'connecting...';
  try {
    const health = await api('/health');
    document.getElementById('status').textContent = `API: ${health.status}`;
  } catch {
    document.getElementById('status').textContent = 'API unreachable';
  }
  await loadTenants();
});
