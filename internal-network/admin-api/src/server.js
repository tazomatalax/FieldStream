import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import { v4 as uuidv4 } from 'uuid';
import { PrismaClient } from '@prisma/client';
import {
  initializeOIDC,
  setupOIDCRoutes,
  authenticate,
  authorize,
  requireRole,
  ROLES,
} from './auth.js';
import {
  metricsMiddleware,
  metricsHandler,
  tenantsTotal,
  devicesTotal,
  tokensIssuedTotal,
  tokensRevokedTotal,
  authAttemptsTotal,
} from './metrics.js';
import { logger, auditLogger, requestLogger } from './logger.js';

const app = express();
app.use(cors({
  origin: process.env.CORS_ORIGIN || true,
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

// Apply logging and metrics middleware
app.use(requestLogger);
app.use(metricsMiddleware);

const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const prisma = new PrismaClient();

// Apply authentication and authorization globally
app.use(authenticate);
app.use(authorize);

// Metrics endpoint (before auth to allow scraping)
app.get('/metrics', metricsHandler);

// Audit logging helper
async function auditLog(action, { tenantId, deviceId, resourceId, details, req } = {}) {
  try {
    await prisma.auditLog.create({
      data: {
        action,
        actorType: req?.user?.type || 'api',
        actorId: req?.user?.id || null,
        tenantId,
        deviceId,
        resourceId,
        details,
        ipAddress: req?.ip || req?.socket?.remoteAddress || null,
        userAgent: req?.headers?.['user-agent'] || null,
      },
    });
    
    // Also log to structured logger for external aggregation
    auditLogger.log(action, { tenantId, deviceId, resourceId, details, userId: req?.user?.id });
  } catch (error) {
    logger.error('Audit log error', { error: error.message });
  }
}

// Middleware to check tenant exists
async function requireTenant(req, res, next) {
  const { tenantId } = req.params;
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
  req.tenant = tenant;
  next();
}

// Routes
app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', database: 'connected' });
  } catch (error) {
    res.status(503).json({ status: 'degraded', database: 'disconnected', error: error.message });
  }
});

// Tenants CRUD
app.post('/tenants', async (req, res) => {
  try {
    const id = req.body.id || uuidv4();
    const name = req.body.name || `Tenant ${id.slice(0, 8)}`;
    const tenant = await prisma.tenant.create({
      data: { id, name },
    });
    await auditLog('CREATE_TENANT', { tenantId: id, resourceId: id, details: { name }, req });
    res.status(201).json(tenant);
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Tenant ID already exists' });
    }
    console.error('Create tenant error:', error);
    res.status(500).json({ error: 'Failed to create tenant' });
  }
});

app.get('/tenants', async (_req, res) => {
  try {
    const tenants = await prisma.tenant.findMany({
      orderBy: { createdAt: 'desc' },
    });
    res.json(tenants);
  } catch (error) {
    console.error('List tenants error:', error);
    res.status(500).json({ error: 'Failed to list tenants' });
  }
});

app.get('/tenants/:tenantId', requireTenant, async (req, res) => {
  res.json(req.tenant);
});

app.patch('/tenants/:tenantId', requireTenant, async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { name } = req.body;
    const tenant = await prisma.tenant.update({
      where: { id: tenantId },
      data: { name },
    });
    await auditLog('UPDATE_TENANT', { tenantId, resourceId: tenantId, details: { name }, req });
    res.json(tenant);
  } catch (error) {
    console.error('Update tenant error:', error);
    res.status(500).json({ error: 'Failed to update tenant' });
  }
});

app.delete('/tenants/:tenantId', requireTenant, async (req, res) => {
  try {
    const { tenantId } = req.params;
    await prisma.tenant.delete({ where: { id: tenantId } });
    await auditLog('DELETE_TENANT', { resourceId: tenantId, details: { tenantId }, req });
    res.status(204).end();
  } catch (error) {
    console.error('Delete tenant error:', error);
    res.status(500).json({ error: 'Failed to delete tenant' });
  }
});

// Devices CRUD
app.post('/tenants/:tenantId/devices', requireTenant, async (req, res) => {
  try {
    const { tenantId } = req.params;
    const id = req.body.id || uuidv4();
    const name = req.body.name || id;
    const device = await prisma.device.create({
      data: { id, name, tenantId },
    });
    await auditLog('CREATE_DEVICE', { tenantId, deviceId: id, resourceId: id, details: { name }, req });
    res.status(201).json(device);
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Device ID already exists' });
    }
    console.error('Create device error:', error);
    res.status(500).json({ error: 'Failed to create device' });
  }
});

app.get('/tenants/:tenantId/devices', requireTenant, async (req, res) => {
  try {
    const { tenantId } = req.params;
    const devices = await prisma.device.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
    res.json(devices);
  } catch (error) {
    console.error('List devices error:', error);
    res.status(500).json({ error: 'Failed to list devices' });
  }
});

app.get('/tenants/:tenantId/devices/:deviceId', requireTenant, async (req, res) => {
  try {
    const { tenantId, deviceId } = req.params;
    const device = await prisma.device.findFirst({
      where: { id: deviceId, tenantId },
    });
    if (!device) return res.status(404).json({ error: 'Device not found' });
    res.json(device);
  } catch (error) {
    console.error('Get device error:', error);
    res.status(500).json({ error: 'Failed to get device' });
  }
});

app.patch('/tenants/:tenantId/devices/:deviceId', requireTenant, async (req, res) => {
  try {
    const { tenantId, deviceId } = req.params;
    const { name } = req.body;
    const device = await prisma.device.updateMany({
      where: { id: deviceId, tenantId },
      data: { name },
    });
    if (device.count === 0) return res.status(404).json({ error: 'Device not found' });
    const updated = await prisma.device.findFirst({ where: { id: deviceId, tenantId } });
    await auditLog('UPDATE_DEVICE', { tenantId, deviceId, resourceId: deviceId, details: { name }, req });
    res.json(updated);
  } catch (error) {
    console.error('Update device error:', error);
    res.status(500).json({ error: 'Failed to update device' });
  }
});

app.delete('/tenants/:tenantId/devices/:deviceId', requireTenant, async (req, res) => {
  try {
    const { tenantId, deviceId } = req.params;
    const result = await prisma.device.deleteMany({
      where: { id: deviceId, tenantId },
    });
    if (result.count === 0) return res.status(404).json({ error: 'Device not found' });
    await auditLog('DELETE_DEVICE', { tenantId, resourceId: deviceId, details: { deviceId }, req });
    res.status(204).end();
  } catch (error) {
    console.error('Delete device error:', error);
    res.status(500).json({ error: 'Failed to delete device' });
  }
});

// Token issuance and management
app.post('/tenants/:tenantId/devices/:deviceId/token', requireTenant, async (req, res) => {
  try {
    const { tenantId, deviceId } = req.params;
    const device = await prisma.device.findFirst({
      where: { id: deviceId, tenantId },
    });
    if (!device) return res.status(404).json({ error: 'Device not found' });

    const expiresIn = req.body.expiresIn || '15m';
    const jti = uuidv4();
    
    // Calculate expiration
    const expiresInMs = parseExpiration(expiresIn);
    const expiresAt = new Date(Date.now() + expiresInMs);

    const token = jwt.sign({ sub: deviceId, tenantId, jti }, JWT_SECRET, { expiresIn });

    // Store token record for tracking/revocation
    await prisma.token.create({
      data: {
        jti,
        tenantId,
        deviceId,
        expiresAt,
      },
    });

    await auditLog('ISSUE_TOKEN', { tenantId, deviceId, resourceId: jti, details: { expiresIn }, req });
    res.json({ token, expiresIn, jti });
  } catch (error) {
    console.error('Issue token error:', error);
    res.status(500).json({ error: 'Failed to issue token' });
  }
});

// List tokens for a device
app.get('/tenants/:tenantId/devices/:deviceId/tokens', requireTenant, async (req, res) => {
  try {
    const { tenantId, deviceId } = req.params;
    const tokens = await prisma.token.findMany({
      where: { tenantId, deviceId },
      orderBy: { issuedAt: 'desc' },
      select: {
        id: true,
        jti: true,
        issuedAt: true,
        expiresAt: true,
        isRevoked: true,
        revokedAt: true,
      },
    });
    res.json(tokens);
  } catch (error) {
    console.error('List tokens error:', error);
    res.status(500).json({ error: 'Failed to list tokens' });
  }
});

// Revoke a token
app.post('/tenants/:tenantId/devices/:deviceId/tokens/:jti/revoke', requireTenant, async (req, res) => {
  try {
    const { tenantId, deviceId, jti } = req.params;
    const token = await prisma.token.updateMany({
      where: { jti, tenantId, deviceId, isRevoked: false },
      data: { isRevoked: true, revokedAt: new Date() },
    });
    if (token.count === 0) return res.status(404).json({ error: 'Token not found or already revoked' });
    await auditLog('REVOKE_TOKEN', { tenantId, deviceId, resourceId: jti, req });
    res.json({ message: 'Token revoked' });
  } catch (error) {
    console.error('Revoke token error:', error);
    res.status(500).json({ error: 'Failed to revoke token' });
  }
});

// Token verification endpoint (for WebSocket server to call)
app.post('/verify-token', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token required' });

    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Check if token is revoked
    if (decoded.jti) {
      const tokenRecord = await prisma.token.findUnique({
        where: { jti: decoded.jti },
      });
      if (tokenRecord?.isRevoked) {
        return res.status(401).json({ error: 'Token revoked', valid: false });
      }
    }

    res.json({ valid: true, decoded });
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', valid: false });
    }
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token', valid: false });
    }
    console.error('Verify token error:', error);
    res.status(500).json({ error: 'Token verification failed' });
  }
});

// Audit log endpoint
app.get('/audit-logs', async (req, res) => {
  try {
    const { tenantId, deviceId, action, limit = 100, offset = 0 } = req.query;
    const where = {};
    if (tenantId) where.tenantId = tenantId;
    if (deviceId) where.deviceId = deviceId;
    if (action) where.action = action;

    const logs = await prisma.auditLog.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take: parseInt(limit),
      skip: parseInt(offset),
    });
    res.json(logs);
  } catch (error) {
    console.error('List audit logs error:', error);
    res.status(500).json({ error: 'Failed to list audit logs' });
  }
});

// Helper to parse expiration string to milliseconds
function parseExpiration(exp) {
  const match = exp.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return 15 * 60 * 1000; // default 15 minutes
  const [, value, unit] = match;
  const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return parseInt(value) * multipliers[unit];
}

// Startup
async function main() {
  try {
    await prisma.$connect();
    console.log('Connected to database');
    
    // Initialize OIDC
    await initializeOIDC();
    
    // Setup OIDC routes
    setupOIDCRoutes(app);
    
    app.listen(PORT, () => {
      console.log(`Admin API listening on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  await prisma.$disconnect();
  process.exit(0);
});

main();
