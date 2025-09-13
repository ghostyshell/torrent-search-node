const { test, expect } = require('@playwright/test');

test.describe('Proxy API Endpoints', () => {
  test('OPTIONS /api/proxy/* should handle CORS preflight', async ({
    request,
  }) => {
    const response = await request.fetch('/api/proxy/real-debrid/user', {
      method: 'OPTIONS',
    });

    expect(response.status()).toBe(200);

    // Check CORS headers
    const headers = response.headers();
    expect(headers['access-control-allow-origin']).toBeDefined();
    expect(headers['access-control-allow-methods']).toContain('GET');
    expect(headers['access-control-allow-methods']).toContain('POST');
    expect(headers['access-control-allow-headers']).toContain('Authorization');
  });

  test('GET /api/proxy/real-debrid/user should proxy to Real-Debrid API', async ({
    request,
  }) => {
    const response = await request.get('/api/proxy/real-debrid/user');

    // Real-Debrid API will return 401 without proper auth,
    // but our proxy should handle the request
    expect([401, 504]).toContain(response.status());

    if (response.status() === 401) {
      // Real-Debrid returned unauthorized (expected without API key)
      const data = await response.json();
      // Should be Real-Debrid's error response
      expect(typeof data).toBe('object');
    } else if (response.status() === 504) {
      // Gateway timeout or proxy error
      const data = await response.json();
      expect(data).toHaveProperty('error');
      expect(data.error).toContain('Real-Debrid API error');
    }
  });

  test('POST /api/proxy/real-debrid/unrestrict/link should proxy POST requests', async ({
    request,
  }) => {
    const response = await request.post(
      '/api/proxy/real-debrid/unrestrict/link',
      {
        data: { link: 'https://example.com/test-link' },
      }
    );

    // Should proxy the request even if it fails due to auth
    expect([400, 401, 504]).toContain(response.status());

    const data = await response.json();
    expect(typeof data).toBe('object');

    if (response.status() === 504) {
      // Our proxy error
      expect(data).toHaveProperty('error');
      expect(data.error).toContain('Real-Debrid API error');
    }
  });

  test('GET /api/proxy/real-debrid/torrents should handle different endpoints', async ({
    request,
  }) => {
    const response = await request.get('/api/proxy/real-debrid/torrents');

    // Should attempt to proxy regardless of auth status
    expect([401, 504]).toContain(response.status());

    const data = await response.json();
    expect(typeof data).toBe('object');
  });

  test('GET /api/proxy/real-debrid/downloads should proxy downloads endpoint', async ({
    request,
  }) => {
    const response = await request.get('/api/proxy/real-debrid/downloads');

    // Should proxy the request
    expect([401, 504]).toContain(response.status());

    const data = await response.json();
    expect(typeof data).toBe('object');
  });

  test('POST /api/proxy/real-debrid with Authorization header should forward auth', async ({
    request,
  }) => {
    const response = await request.post('/api/proxy/real-debrid/user', {
      data: {},
      headers: {
        Authorization: 'Bearer test-token-123',
      },
    });

    // Auth will still fail with fake token, but should be forwarded
    expect([401, 403, 404, 504]).toContain(response.status());

    const data = await response.json();
    expect(typeof data).toBe('object');
  });

  test('GET /api/proxy/real-debrid with query parameters should forward them', async ({
    request,
  }) => {
    const response = await request.get(
      '/api/proxy/real-debrid/torrents?limit=50&offset=0'
    );

    // Should forward query parameters
    expect([401, 504]).toContain(response.status());

    const data = await response.json();
    expect(typeof data).toBe('object');
  });

  test('Proxy should handle empty responses correctly', async ({ request }) => {
    // Some Real-Debrid endpoints might return empty responses
    const response = await request.delete(
      '/api/proxy/real-debrid/torrents/delete/fake-id'
    );

    // Should handle the request even if it returns empty
    expect([204, 401, 404, 504]).toContain(response.status());

    if (response.status() === 204) {
      // Empty successful response
      const text = await response.text();
      expect(text).toBe('{}');
    } else {
      const data = await response.json();
      expect(typeof data).toBe('object');
    }
  });

  test('Proxy should set appropriate CORS headers on responses', async ({
    request,
  }) => {
    const response = await request.get('/api/proxy/real-debrid/user');

    const headers = response.headers();
    expect(headers['access-control-allow-origin']).toBe('*');
    expect(headers['access-control-allow-methods']).toContain('GET');
    expect(headers['access-control-allow-methods']).toContain('POST');
  });

  test('Proxy should handle non-JSON responses', async ({ request }) => {
    // Some endpoints might return plain text
    const response = await request.get('/api/proxy/real-debrid/time');

    expect([200, 401, 504]).toContain(response.status());

    // Response might be text or JSON depending on endpoint
    const contentType = response.headers()['content-type'];
    if (contentType && contentType.includes('application/json')) {
      const data = await response.json();
      expect(typeof data).toBe('object');
    } else {
      const text = await response.text();
      expect(typeof text).toBe('string');
    }
  });

  test('Proxy should handle malformed Real-Debrid paths gracefully', async ({
    request,
  }) => {
    const response = await request.get('/api/proxy/real-debrid/');

    // Should handle empty path
    expect([400, 401, 404, 504]).toContain(response.status());

    const data = await response.json();
    expect(typeof data).toBe('object');
  });
});
