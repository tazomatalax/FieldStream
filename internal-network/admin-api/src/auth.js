import jwt from 'jsonwebtoken';
import { Issuer, generators } from 'openid-client';

// OIDC Configuration from environment
const OIDC_ENABLED = process.env.OIDC_ENABLED === 'true';
const OIDC_ISSUER_URL = process.env.OIDC_ISSUER_URL;
const OIDC_CLIENT_ID = process.env.OIDC_CLIENT_ID;
const OIDC_CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET;
const OIDC_REDIRECT_URI = process.env.OIDC_REDIRECT_URI;
const SESSION_SECRET = process.env.SESSION_SECRET || 'session-secret-change-me';

// Role definitions
export const ROLES = {
  ADMIN: 'admin',
  OPERATOR: 'operator',
  AUDITOR: 'auditor',
};

// Role permissions
const ROLE_PERMISSIONS = {
  [ROLES.ADMIN]: ['*'], // All permissions
  [ROLES.OPERATOR]: [
    'tenant:read',
    'device:read',
    'device:create',
    'token:issue',
    'audit:read',
  ],
  [ROLES.AUDITOR]: [
    'tenant:read',
    'device:read',
    'audit:read',
  ],
};

// Permission to action mapping
const ENDPOINT_PERMISSIONS = {
  'GET /tenants': 'tenant:read',
  'POST /tenants': 'tenant:create',
  'PATCH /tenants/:tenantId': 'tenant:update',
  'DELETE /tenants/:tenantId': 'tenant:delete',
  'GET /tenants/:tenantId/devices': 'device:read',
  'POST /tenants/:tenantId/devices': 'device:create',
  'PATCH /tenants/:tenantId/devices/:deviceId': 'device:update',
  'DELETE /tenants/:tenantId/devices/:deviceId': 'device:delete',
  'POST /tenants/:tenantId/devices/:deviceId/token': 'token:issue',
  'GET /tenants/:tenantId/devices/:deviceId/tokens': 'token:read',
  'POST /tenants/:tenantId/devices/:deviceId/tokens/:jti/revoke': 'token:revoke',
  'GET /audit-logs': 'audit:read',
};

let oidcClient = null;
const sessionStore = new Map(); // In production, use Redis or DB

// Initialize OIDC client
export async function initializeOIDC() {
  if (!OIDC_ENABLED) {
    console.log('OIDC disabled - using local auth only');
    return null;
  }

  try {
    const issuer = await Issuer.discover(OIDC_ISSUER_URL);
    console.log('Discovered OIDC issuer:', issuer.issuer);

    oidcClient = new issuer.Client({
      client_id: OIDC_CLIENT_ID,
      client_secret: OIDC_CLIENT_SECRET,
      redirect_uris: [OIDC_REDIRECT_URI],
      response_types: ['code'],
    });

    console.log('OIDC client initialized');
    return oidcClient;
  } catch (error) {
    console.error('Failed to initialize OIDC:', error.message);
    return null;
  }
}

// Generate session token
function createSession(user) {
  const sessionId = generators.random();
  const expiresAt = Date.now() + 8 * 60 * 60 * 1000; // 8 hours

  sessionStore.set(sessionId, {
    user,
    expiresAt,
  });

  return jwt.sign({ sessionId }, SESSION_SECRET, { expiresIn: '8h' });
}

// Verify session
function verifySession(token) {
  try {
    const decoded = jwt.verify(token, SESSION_SECRET);
    const session = sessionStore.get(decoded.sessionId);

    if (!session || session.expiresAt < Date.now()) {
      sessionStore.delete(decoded.sessionId);
      return null;
    }

    return session.user;
  } catch {
    return null;
  }
}

// Check if user has permission
function hasPermission(role, permission) {
  const rolePerms = ROLE_PERMISSIONS[role] || [];
  return rolePerms.includes('*') || rolePerms.includes(permission);
}

// Get permission for endpoint
function getEndpointPermission(method, path) {
  // Normalize path by removing IDs
  const normalizedPath = path
    .replace(/\/[0-9a-f-]{36}/g, '/:id')
    .replace(/\/[^/]+$/g, (match) => {
      if (match.includes('-')) return '/:id';
      return match;
    });

  const key = `${method} ${normalizedPath}`;
  return ENDPOINT_PERMISSIONS[key] || null;
}

// Extract role from OIDC claims
function extractRole(claims) {
  // Support Azure AD / Entra ID roles claim
  const roles = claims.roles || claims['http://schemas.microsoft.com/ws/2008/06/identity/claims/role'] || [];
  
  if (roles.includes('fieldstream-admin') || roles.includes('Admin')) {
    return ROLES.ADMIN;
  }
  if (roles.includes('fieldstream-operator') || roles.includes('Operator')) {
    return ROLES.OPERATOR;
  }
  if (roles.includes('fieldstream-auditor') || roles.includes('Auditor')) {
    return ROLES.AUDITOR;
  }

  // Default to auditor (least privilege)
  return ROLES.AUDITOR;
}

// OIDC Routes
export function setupOIDCRoutes(app) {
  // Login initiation
  app.get('/auth/login', (req, res) => {
    if (!oidcClient) {
      return res.status(503).json({ error: 'OIDC not configured' });
    }

    const state = generators.state();
    const nonce = generators.nonce();
    const codeVerifier = generators.codeVerifier();
    const codeChallenge = generators.codeChallenge(codeVerifier);

    // Store PKCE verifier in session
    const stateData = { nonce, codeVerifier };
    sessionStore.set(`state:${state}`, stateData);

    const authUrl = oidcClient.authorizationUrl({
      scope: 'openid profile email',
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    res.redirect(authUrl);
  });

  // OIDC callback
  app.get('/auth/callback', async (req, res) => {
    if (!oidcClient) {
      return res.status(503).json({ error: 'OIDC not configured' });
    }

    try {
      const params = oidcClient.callbackParams(req);
      const stateData = sessionStore.get(`state:${params.state}`);

      if (!stateData) {
        return res.status(400).json({ error: 'Invalid state' });
      }

      sessionStore.delete(`state:${params.state}`);

      const tokenSet = await oidcClient.callback(
        OIDC_REDIRECT_URI,
        params,
        {
          state: params.state,
          nonce: stateData.nonce,
          code_verifier: stateData.codeVerifier,
        }
      );

      const claims = tokenSet.claims();
      const userinfo = await oidcClient.userinfo(tokenSet.access_token);

      const user = {
        id: claims.sub,
        email: userinfo.email || claims.email,
        name: userinfo.name || claims.name,
        role: extractRole({ ...claims, ...userinfo }),
        provider: 'oidc',
      };

      const sessionToken = createSession(user);

      // Set cookie and redirect to admin UI
      res.cookie('session', sessionToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 8 * 60 * 60 * 1000,
      });

      res.redirect('/admin');
    } catch (error) {
      console.error('OIDC callback error:', error);
      res.status(401).json({ error: 'Authentication failed' });
    }
  });

  // Logout
  app.get('/auth/logout', (req, res) => {
    res.clearCookie('session');

    if (oidcClient && oidcClient.issuer.end_session_endpoint) {
      const logoutUrl = oidcClient.endSessionUrl({
        post_logout_redirect_uri: `${req.protocol}://${req.get('host')}/admin`,
      });
      return res.redirect(logoutUrl);
    }

    res.redirect('/admin');
  });

  // Get current user
  app.get('/auth/me', (req, res) => {
    if (req.user) {
      res.json({
        authenticated: true,
        user: {
          id: req.user.id,
          email: req.user.email,
          name: req.user.name,
          role: req.user.role,
        },
      });
    } else {
      res.json({ authenticated: false });
    }
  });

  // Local API key authentication (for service-to-service)
  app.post('/auth/api-key', (req, res) => {
    const { apiKey } = req.body;
    const validApiKey = process.env.ADMIN_API_KEY;

    if (!validApiKey || apiKey !== validApiKey) {
      return res.status(401).json({ error: 'Invalid API key' });
    }

    const user = {
      id: 'api-key-user',
      email: 'api@local',
      name: 'API User',
      role: ROLES.ADMIN,
      provider: 'api-key',
    };

    const sessionToken = createSession(user);
    res.json({ token: sessionToken });
  });
}

// Authentication middleware
export function authenticate(req, res, next) {
  // Skip auth for health check
  if (req.path === '/health') {
    return next();
  }

  // Skip auth for auth routes
  if (req.path.startsWith('/auth/')) {
    return next();
  }

  // Skip auth for device token verification (internal API)
  if (req.path === '/verify-token') {
    return next();
  }

  // Check for session cookie
  const sessionToken = req.cookies?.session;
  if (sessionToken) {
    const user = verifySession(sessionToken);
    if (user) {
      req.user = user;
      return next();
    }
  }

  // Check for Authorization header (Bearer token)
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const user = verifySession(token);
    if (user) {
      req.user = user;
      return next();
    }
  }

  // Check for API key header
  const apiKey = req.headers['x-api-key'];
  if (apiKey && apiKey === process.env.ADMIN_API_KEY) {
    req.user = {
      id: 'api-key-user',
      email: 'api@local',
      name: 'API User',
      role: ROLES.ADMIN,
      provider: 'api-key',
    };
    return next();
  }

  // If OIDC is disabled and no auth provided, allow access (dev mode)
  if (!OIDC_ENABLED && process.env.NODE_ENV !== 'production') {
    req.user = {
      id: 'dev-user',
      email: 'dev@local',
      name: 'Dev User',
      role: ROLES.ADMIN,
      provider: 'dev',
    };
    return next();
  }

  res.status(401).json({ error: 'Authentication required' });
}

// Authorization middleware
export function authorize(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const permission = getEndpointPermission(req.method, req.path);

  // If no permission defined for endpoint, allow (for health, etc.)
  if (!permission) {
    return next();
  }

  if (!hasPermission(req.user.role, permission)) {
    return res.status(403).json({
      error: 'Forbidden',
      required: permission,
      role: req.user.role,
    });
  }

  next();
}

// Role check helper for specific routes
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'Forbidden',
        required: roles,
        current: req.user.role,
      });
    }

    next();
  };
}
