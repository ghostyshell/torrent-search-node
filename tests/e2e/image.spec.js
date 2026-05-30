const { test, expect } = require('@playwright/test');

test.describe('Image API Endpoints', () => {
  test('GET /api/google-images/search should search for images', async ({
    request,
  }) => {
    const response = await request.get(
      '/api/google-images/search?q=test+movie'
    );

    expect([200, 500]).toContain(response.status());

    const data = await response.json();
    expect(data).toHaveProperty('success');

    if (response.status() === 200) {
      expect(data.success).toBe(true);
      expect(data).toHaveProperty('query', 'test movie');
      expect(data).toHaveProperty('results');
      expect(data).toHaveProperty('count');
      expect(Array.isArray(data.results)).toBe(true);
      expect(data.count).toBe(data.results.length);
    } else {
      // API might not be configured or available
      expect(data.success).toBe(false);
      expect(data).toHaveProperty('error');
    }
  });

  test('GET /api/google-images/search should return error for missing query', async ({
    request,
  }) => {
    const response = await request.get('/api/google-images/search');

    expect(response.status()).toBe(400);

    const data = await response.json();
    expect(data).toHaveProperty('error', 'Query parameter "q" is required');
  });

  test('GET /api/google-images/suggestions should generate suggestions', async ({
    request,
  }) => {
    const response = await request.get(
      '/api/google-images/suggestions?q=action+movie'
    );

    expect([200, 500]).toContain(response.status());

    const data = await response.json();
    expect(data).toHaveProperty('success');

    if (response.status() === 200) {
      expect(data.success).toBe(true);
      expect(data).toHaveProperty('query', 'action movie');
      expect(data).toHaveProperty('suggestions');
      expect(Array.isArray(data.suggestions)).toBe(true);
    }
  });

  test('GET /api/google-images/suggestions should return error for missing query', async ({
    request,
  }) => {
    const response = await request.get('/api/google-images/suggestions');

    expect(response.status()).toBe(400);

    const data = await response.json();
    expect(data).toHaveProperty('error', 'Query parameter "q" is required');
  });

  test('POST /api/pixhost/upload should handle missing image data/URL', async ({
    request,
  }) => {
    const response = await request.post('/api/pixhost/upload', {
      data: {}, // Missing imageUrl and imageData
    });

    expect(response.status()).toBe(400);

    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data).toHaveProperty(
      'error',
      'Either imageUrl or imageData is required'
    );
  });

  test('POST /api/images/batch-process should handle missing images array', async ({
    request,
  }) => {
    const response = await request.post('/api/images/batch-process', {
      data: {}, // Missing images array
    });

    expect(response.status()).toBe(400);

    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data).toHaveProperty('error', 'Images array is required');
  });

  test('POST /api/images/batch-process should handle invalid images parameter', async ({
    request,
  }) => {
    const response = await request.post('/api/images/batch-process', {
      data: { images: 'not-an-array' },
    });

    expect(response.status()).toBe(400);

    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data).toHaveProperty('error', 'Images array is required');
  });

  test('POST /api/images/batch-process should handle proxy operation', async ({
    request,
  }) => {
    const testImages = [
      { url: 'https://httpbin.org/image/jpeg' },
      { url: 'https://httpbin.org/image/png' },
    ];

    const response = await request.post('/api/images/batch-process', {
      data: {
        images: testImages,
        operation: 'proxy',
      },
    });

    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data).toHaveProperty('operation', 'proxy');
    expect(data).toHaveProperty('totalProcessed', 2);
    expect(data).toHaveProperty('results');
    expect(Array.isArray(data.results)).toBe(true);
    expect(data.results.length).toBe(2);

    // Check that each result has the expected structure
    data.results.forEach((result) => {
      expect(result).toHaveProperty('originalUrl');
      expect(result).toHaveProperty('success');
      if (result.success) {
        expect(result).toHaveProperty('proxyUrl');
      }
    });
  });

  test('POST /api/images/batch-process should handle unknown operation', async ({
    request,
  }) => {
    const testImages = [{ url: 'https://httpbin.org/image/jpeg' }];

    const response = await request.post('/api/images/batch-process', {
      data: {
        images: testImages,
        operation: 'unknown-operation',
      },
    });

    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data).toHaveProperty('operation', 'unknown-operation');
    expect(data).toHaveProperty('results');

    // Should return error for unknown operation
    const result = data.results[0];
    expect(result.success).toBe(false);
    expect(result).toHaveProperty('error', 'Unknown operation');
  });
});
