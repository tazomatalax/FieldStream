import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

// In-memory stores (replace with DB later)
const tenants = new Map(); // tenantId -> { id, name, createdAt }
const devices = new Map(); // deviceId -> { id, tenantId, name, createdAt }

// Helpers
function requireTenant(req, res, next) {
  const { tenantId } = req.params;
  if (!tenants.has(tenantId)) return res.status(404).json({ error: 'Tenant not found' });
  next();
}

// Routes
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// Tenants
app.post('/tenants', (req, res) => {
  const id = uuidv4();
  const name = req.body.name || `Tenant ${id.slice(0, 8)}`;
  const tenant = { id, name, createdAt: new Date().toISOString() };
  tenants.set(id, tenant);
  res.status(201).json(tenant);
});

app.get('/tenants', (_req, res) => {
  res.json(Array.from(tenants.values()));
});

app.delete('/tenants/:tenantId', requireTenant, (req, res) => {
  const { tenantId } = req.params;
  // Delete tenant devices
  Array.from(devices.values())
    .filter(d => d.tenantId === tenantId)
    .forEach(d => devices.delete(d.id));
  tenants.delete(tenantId);
  res.status(204).end();
});

// Devices
app.post('/tenants/:tenantId/devices', requireTenant, (req, res) => {
  const { tenantId } = req.params;
  const id = req.body.id || uuidv4();
  const name = req.body.name || id;
  const device = { id, tenantId, name, createdAt: new Date().toISOString() };
  devices.set(id, device);
  res.status(201).json(device);
});

app.get('/tenants/:tenantId/devices', requireTenant, (req, res) => {
  const { tenantId } = req.params;
  res.json(Array.from(devices.values()).filter(d => d.tenantId === tenantId));
});

app.delete('/tenants/:tenantId/devices/:deviceId', requireTenant, (req, res) => {
  const { deviceId } = req.params;
  devices.delete(deviceId);
  res.status(204).end();
});

// Issue JWT for a device (short-lived)
app.post('/tenants/:tenantId/devices/:deviceId/token', requireTenant, (req, res) => {
  const { tenantId, deviceId } = req.params;
  const device = devices.get(deviceId);
  if (!device || device.tenantId !== tenantId) return res.status(404).json({ error: 'Device not found' });
  const expiresIn = req.body.expiresIn || '15m';
  const token = jwt.sign({ sub: deviceId, tenantId }, JWT_SECRET, { expiresIn });
  res.json({ token, expiresIn });
});

app.listen(PORT, () => {
  console.log(`Admin API listening on port ${PORT}`);
});
