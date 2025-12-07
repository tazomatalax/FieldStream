// Prometheus metrics and structured logging for FieldStream services
import client from 'prom-client';

// Create a Registry to register metrics
export const metricsRegistry = new client.Registry();

// Add default metrics (CPU, memory, etc.)
client.collectDefaultMetrics({ register: metricsRegistry });

// Custom metrics for FieldStream

// HTTP Request metrics
export const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.001, 0.005, 0.015, 0.05, 0.1, 0.2, 0.5, 1, 2, 5],
  registers: [metricsRegistry],
});

export const httpRequestTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [metricsRegistry],
});

// WebSocket metrics
export const wsConnectionsActive = new client.Gauge({
  name: 'websocket_connections_active',
  help: 'Number of active WebSocket connections',
  labelNames: ['tenant_id'],
  registers: [metricsRegistry],
});

export const wsMessagesTotal = new client.Counter({
  name: 'websocket_messages_total',
  help: 'Total number of WebSocket messages',
  labelNames: ['tenant_id', 'device_id', 'message_type', 'direction'],
  registers: [metricsRegistry],
});

export const wsMessageSize = new client.Histogram({
  name: 'websocket_message_size_bytes',
  help: 'Size of WebSocket messages in bytes',
  labelNames: ['tenant_id', 'message_type'],
  buckets: [100, 500, 1000, 5000, 10000, 50000, 100000, 500000, 1000000],
  registers: [metricsRegistry],
});

// MQTT metrics
export const mqttMessagesTotal = new client.Counter({
  name: 'mqtt_messages_total',
  help: 'Total number of MQTT messages',
  labelNames: ['tenant_id', 'topic_type', 'direction'],
  registers: [metricsRegistry],
});

export const mqttMessageProcessingDuration = new client.Histogram({
  name: 'mqtt_message_processing_duration_seconds',
  help: 'Duration of MQTT message processing',
  labelNames: ['tenant_id', 'data_type'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
  registers: [metricsRegistry],
});

// Tenant/Device metrics
export const tenantsTotal = new client.Gauge({
  name: 'tenants_total',
  help: 'Total number of tenants',
  registers: [metricsRegistry],
});

export const devicesTotal = new client.Gauge({
  name: 'devices_total',
  help: 'Total number of devices',
  labelNames: ['tenant_id'],
  registers: [metricsRegistry],
});

export const tokensIssuedTotal = new client.Counter({
  name: 'tokens_issued_total',
  help: 'Total number of tokens issued',
  labelNames: ['tenant_id'],
  registers: [metricsRegistry],
});

export const tokensRevokedTotal = new client.Counter({
  name: 'tokens_revoked_total',
  help: 'Total number of tokens revoked',
  labelNames: ['tenant_id'],
  registers: [metricsRegistry],
});

// Authentication metrics
export const authAttemptsTotal = new client.Counter({
  name: 'auth_attempts_total',
  help: 'Total authentication attempts',
  labelNames: ['method', 'success'],
  registers: [metricsRegistry],
});

// Database metrics
export const dbQueryDuration = new client.Histogram({
  name: 'db_query_duration_seconds',
  help: 'Database query duration in seconds',
  labelNames: ['operation', 'table'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
  registers: [metricsRegistry],
});

// InfluxDB metrics
export const influxWriteTotal = new client.Counter({
  name: 'influxdb_writes_total',
  help: 'Total InfluxDB write operations',
  labelNames: ['tenant_id', 'measurement', 'status'],
  registers: [metricsRegistry],
});

export const influxWriteDuration = new client.Histogram({
  name: 'influxdb_write_duration_seconds',
  help: 'InfluxDB write duration in seconds',
  labelNames: ['tenant_id', 'measurement'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
  registers: [metricsRegistry],
});

// Express middleware for HTTP metrics
export function metricsMiddleware(req, res, next) {
  const start = process.hrtime();
  
  res.on('finish', () => {
    const [seconds, nanoseconds] = process.hrtime(start);
    const duration = seconds + nanoseconds / 1e9;
    
    // Normalize route for metrics (replace IDs with :id)
    const route = req.route?.path || req.path.replace(/[0-9a-f-]{36}/g, ':id');
    
    httpRequestDuration.observe(
      { method: req.method, route, status_code: res.statusCode },
      duration
    );
    
    httpRequestTotal.inc({
      method: req.method,
      route,
      status_code: res.statusCode,
    });
  });
  
  next();
}

// Metrics endpoint handler
export async function metricsHandler(req, res) {
  try {
    res.set('Content-Type', metricsRegistry.contentType);
    res.end(await metricsRegistry.metrics());
  } catch (error) {
    res.status(500).end(error.message);
  }
}
