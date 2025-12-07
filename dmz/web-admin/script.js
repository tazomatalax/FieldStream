let currentUser = null;

const api = async (path, options = {}) => {
  const response = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    ...options,
  });
  
  if (response.status === 401) {
    showLoginRequired();
    throw new Error('Authentication required');
  }
  
  if (response.status === 403) {
    alert('You do not have permission to perform this action.');
    throw new Error('Forbidden');
  }
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || 'Request failed');
  }
  
  if (response.status === 204) return null;
  return response.json();
};

function showLoginRequired() {
  document.getElementById('loginSection').classList.remove('hidden');
  document.getElementById('mainContent').classList.add('hidden');
  document.getElementById('userInfo').classList.add('hidden');
}

function showMainContent() {
  document.getElementById('loginSection').classList.add('hidden');
  document.getElementById('mainContent').classList.remove('hidden');
  document.getElementById('userInfo').classList.remove('hidden');
}

function updateUIForRole(role) {
  const isAdmin = role === 'admin';
  const isOperator = role === 'operator';
  const canWrite = isAdmin || isOperator;
  
  // Tenant creation - admin only
  document.getElementById('btnCreateTenant').classList.toggle('disabled', !isAdmin);
  document.getElementById('tenantName').disabled = !isAdmin;
  
  // Device creation - admin and operator
  document.getElementById('btnCreateDevice').classList.toggle('disabled', !canWrite);
  document.getElementById('deviceId').disabled = !canWrite;
  document.getElementById('deviceName').disabled = !canWrite;
  
  // Token issuance - admin and operator
  document.getElementById('btnIssueToken').classList.toggle('disabled', !canWrite);
  
  // Audit section visible to all authenticated users
  document.getElementById('auditSection').classList.remove('hidden');
}

function login() {
  window.location.href = '/api/auth/login';
}

function logout() {
  window.location.href = '/api/auth/logout';
}

async function checkAuth() {
  try {
    const result = await api('/auth/me');
    if (result.authenticated) {
      currentUser = result.user;
      document.getElementById('userName').textContent = currentUser.name || currentUser.email;
      const roleEl = document.getElementById('userRole');
      roleEl.textContent = currentUser.role;
      roleEl.className = `role-badge ${currentUser.role}`;
      showMainContent();
      updateUIForRole(currentUser.role);
      return true;
    }
  } catch (e) {
    // Auth check failed
  }
  showLoginRequired();
  return false;
}

async function loadTenants() {
  try {
    const list = await api('/tenants');
    const sel = document.getElementById('tenantSelect');
    const sel2 = document.getElementById('tenantSelectToken');
    const auditSel = document.getElementById('auditTenantFilter');
    sel.innerHTML = '';
    sel2.innerHTML = '';
    auditSel.innerHTML = '<option value="">All Tenants</option>';
    const container = document.getElementById('tenants');
    container.innerHTML = '';
    
    list.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = `${t.name} (${t.id.slice(0, 8)})`;
      sel.appendChild(opt);
      sel2.appendChild(opt.cloneNode(true));
      auditSel.appendChild(opt.cloneNode(true));
      
      const card = document.createElement('div');
      card.className = 'card';
      const canDelete = currentUser?.role === 'admin';
      card.innerHTML = `
        <strong>${t.name}</strong><br/>
        <code>${t.id}</code>
        ${canDelete ? `<button onclick="deleteTenant('${t.id}')" style="margin-left: 12px; color: red;">Delete</button>` : ''}
      `;
      container.appendChild(card);
    });
  } catch (e) {
    console.error('Failed to load tenants:', e);
  }
}

async function createTenant() {
  const name = document.getElementById('tenantName').value;
  if (!name) return alert('Enter a tenant name');
  try {
    await api('/tenants', { method: 'POST', body: JSON.stringify({ name }) });
    document.getElementById('tenantName').value = '';
    await loadTenants();
  } catch (e) {
    console.error('Failed to create tenant:', e);
  }
}

async function deleteTenant(tenantId) {
  if (!confirm('Are you sure you want to delete this tenant and all its devices?')) return;
  try {
    await api(`/tenants/${tenantId}`, { method: 'DELETE' });
    await loadTenants();
  } catch (e) {
    console.error('Failed to delete tenant:', e);
  }
}

async function loadDevices() {
  const tenantId = document.getElementById('tenantSelect').value;
  if (!tenantId) return;
  try {
    const list = await api(`/tenants/${tenantId}/devices`);
    const container = document.getElementById('devices');
    container.innerHTML = '';
    
    const canDelete = currentUser?.role === 'admin' || currentUser?.role === 'operator';
    
    list.forEach(d => {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <strong>${d.name}</strong> — <code>${d.id}</code>
        ${canDelete ? `<button onclick="deleteDevice('${tenantId}', '${d.id}')" style="margin-left: 12px; color: red;">Delete</button>` : ''}
      `;
      container.appendChild(card);
    });
  } catch (e) {
    console.error('Failed to load devices:', e);
  }
}

async function createDevice() {
  const tenantId = document.getElementById('tenantSelect').value;
  const id = document.getElementById('deviceId').value || undefined;
  const name = document.getElementById('deviceName').value || id;
  if (!tenantId) return alert('Select a tenant');
  try {
    await api(`/tenants/${tenantId}/devices`, { method: 'POST', body: JSON.stringify({ id, name }) });
    document.getElementById('deviceId').value = '';
    document.getElementById('deviceName').value = '';
    await loadDevices();
  } catch (e) {
    console.error('Failed to create device:', e);
  }
}

async function deleteDevice(tenantId, deviceId) {
  if (!confirm('Are you sure you want to delete this device?')) return;
  try {
    await api(`/tenants/${tenantId}/devices/${deviceId}`, { method: 'DELETE' });
    await loadDevices();
  } catch (e) {
    console.error('Failed to delete device:', e);
  }
}

async function issueToken() {
  const tenantId = document.getElementById('tenantSelectToken').value;
  const deviceId = document.getElementById('deviceIdToken').value;
  if (!tenantId || !deviceId) return alert('Select tenant and enter device ID');
  try {
    const res = await api(`/tenants/${tenantId}/devices/${deviceId}/token`, {
      method: 'POST',
      body: JSON.stringify({ expiresIn: '1h' }),
    });
    document.getElementById('tokenOut').textContent = JSON.stringify(res, null, 2);
  } catch (e) {
    console.error('Failed to issue token:', e);
    document.getElementById('tokenOut').textContent = `Error: ${e.message}`;
  }
}

async function loadAuditLogs() {
  const tenantId = document.getElementById('auditTenantFilter').value;
  const action = document.getElementById('auditActionFilter').value;
  
  let url = '/audit-logs?limit=50';
  if (tenantId) url += `&tenantId=${tenantId}`;
  if (action) url += `&action=${action}`;
  
  try {
    const logs = await api(url);
    const tbody = document.getElementById('auditLogs');
    tbody.innerHTML = '';
    
    logs.forEach(log => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${new Date(log.timestamp).toLocaleString()}</td>
        <td>${log.action}</td>
        <td>${log.actorId || log.actorType}</td>
        <td>${log.tenantId ? log.tenantId.slice(0, 8) + '...' : '-'}</td>
        <td>${log.deviceId ? log.deviceId.slice(0, 8) + '...' : '-'}</td>
        <td><code>${JSON.stringify(log.details || {})}</code></td>
      `;
      tbody.appendChild(tr);
    });
  } catch (e) {
    console.error('Failed to load audit logs:', e);
  }
}

window.addEventListener('load', async () => {
  document.getElementById('status').textContent = 'connecting...';
  try {
    const health = await fetch('/api/health', { credentials: 'include' }).then(r => r.json());
    document.getElementById('status').textContent = `API: ${health.status}`;
  } catch {
    document.getElementById('status').textContent = 'API unreachable';
  }
  
  const authenticated = await checkAuth();
  if (authenticated) {
    await loadTenants();
  }
});
