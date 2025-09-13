const { test, expect } = require('@playwright/test');

test.describe('Health Endpoints', () => {
  test('GET /health should return basic health status', async ({ request }) => {
    const response = await request.get('/health');
    
    expect(response.status()).toBe(200);
    
    const data = await response.json();
    expect(data).toHaveProperty('status', 'healthy');
    expect(data).toHaveProperty('timestamp');
    expect(data).toHaveProperty('environment');
    expect(data).toHaveProperty('uptime');
    
    // Validate timestamp format
    expect(new Date(data.timestamp).toString()).not.toBe('Invalid Date');
    
    // Validate uptime is a number
    expect(typeof data.uptime).toBe('number');
    expect(data.uptime).toBeGreaterThanOrEqual(0);
  });

  test('GET /health/detailed should return comprehensive health info', async ({ request }) => {
    const response = await request.get('/health/detailed');
    
    expect(response.status()).toBe(200);
    
    const data = await response.json();
    expect(data).toHaveProperty('status');
    expect(data).toHaveProperty('timestamp');
    expect(data).toHaveProperty('environment');
    expect(data).toHaveProperty('version');
    expect(data).toHaveProperty('uptime');
    expect(data).toHaveProperty('memory');
    expect(data).toHaveProperty('system');
    expect(data).toHaveProperty('services');
    expect(data).toHaveProperty('responseTime');
    
    // Validate memory info
    expect(data.memory).toHaveProperty('rss');
    expect(data.memory).toHaveProperty('heapTotal');
    expect(data.memory).toHaveProperty('heapUsed');
    expect(data.memory).toHaveProperty('external');
    
    // Validate system info
    expect(data.system).toHaveProperty('platform');
    expect(data.system).toHaveProperty('arch');
    expect(data.system).toHaveProperty('nodeVersion');
    expect(data.system).toHaveProperty('pid');
    
    // Validate services info
    expect(data.services).toHaveProperty('database');
    expect(data.services).toHaveProperty('google');
    
    // Response time should be reasonable
    expect(data.responseTime).toBeGreaterThan(0);
    expect(data.responseTime).toBeLessThan(5000); // Less than 5 seconds
  });

  test('GET /health/ready should return readiness status', async ({ request }) => {
    const response = await request.get('/health/ready');
    
    // Accept either 200 (ready) or 503 (not ready)
    expect([200, 503]).toContain(response.status());
    
    const data = await response.json();
    expect(data).toHaveProperty('ready');
    expect(data).toHaveProperty('timestamp');
    expect(data).toHaveProperty('checks');
    expect(Array.isArray(data.checks)).toBe(true);
    
    // Validate checks structure
    data.checks.forEach(check => {
      expect(check).toHaveProperty('name');
      expect(check).toHaveProperty('status');
      expect(['ready', 'not_ready']).toContain(check.status);
    });
  });

  test('GET /health/live should return liveness status', async ({ request }) => {
    const response = await request.get('/health/live');
    
    expect(response.status()).toBe(200);
    
    const data = await response.json();
    expect(data).toHaveProperty('alive', true);
    expect(data).toHaveProperty('timestamp');
    expect(data).toHaveProperty('uptime');
    
    // Validate timestamp format
    expect(new Date(data.timestamp).toString()).not.toBe('Invalid Date');
    
    // Validate uptime is a number
    expect(typeof data.uptime).toBe('number');
    expect(data.uptime).toBeGreaterThanOrEqual(0);
  });
});
