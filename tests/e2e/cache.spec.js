const { test, expect } = require('@playwright/test');

test.describe('Cache API Endpoints', () => {
  test('GET /api/cache/stats should return cache statistics', async ({
    request,
  }) => {
    const response = await request.get('/api/cache/stats');

    // Accept either 200 (cache available) or 503 (cache not available)
    expect([200, 503]).toContain(response.status());

    const data = await response.json();
    expect(data).toHaveProperty('success');

    if (response.status() === 200) {
      expect(data.success).toBe(true);
      expect(data).toHaveProperty('stats');
      expect(data).toHaveProperty('timestamp');
    } else {
      expect(data.success).toBe(false);
      expect(data).toHaveProperty('error', 'Cache not available');
    }
  });

  test('POST /api/cache/set should store cache value', async ({ request }) => {
    const testKey = `test_key_${Date.now()}`;
    const testValue = { message: 'test value', timestamp: Date.now() };

    const response = await request.post('/api/cache/set', {
      data: {
        key: testKey,
        value: testValue,
        ttl: 3600,
      },
    });

    if (response.status() === 200) {
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data).toHaveProperty('message', 'Value cached successfully');
      expect(data).toHaveProperty('key', testKey);
    } else {
      // Cache not available - this is acceptable
      expect(response.status()).toBe(503);
    }
  });

  test('GET /api/cache/get/:key should retrieve cache value', async ({
    request,
  }) => {
    const testKey = `test_key_${Date.now()}`;
    const testValue = {
      message: 'test value for retrieval',
      timestamp: Date.now(),
    };

    // First set a value
    const setResponse = await request.post('/api/cache/set', {
      data: {
        key: testKey,
        value: testValue,
      },
    });

    if (setResponse.status() === 200) {
      // Then try to get it
      const getResponse = await request.get(`/api/cache/get/${testKey}`);

      expect([200, 404]).toContain(getResponse.status());

      const getData = await getResponse.json();
      if (getResponse.status() === 200) {
        expect(getData.success).toBe(true);
        expect(getData).toHaveProperty('key', testKey);
        expect(getData).toHaveProperty('value');
        expect(getData.value).toEqual(testValue);
      }
    }
  });

  test('DELETE /api/cache/delete/:key should delete cache value', async ({
    request,
  }) => {
    const testKey = `test_key_to_delete_${Date.now()}`;
    const testValue = { message: 'value to be deleted' };

    // First set a value
    const setResponse = await request.post('/api/cache/set', {
      data: {
        key: testKey,
        value: testValue,
      },
    });

    if (setResponse.status() === 200) {
      // Then delete it
      const deleteResponse = await request.delete(
        `/api/cache/delete/${testKey}`
      );

      expect([200, 503]).toContain(deleteResponse.status());

      if (deleteResponse.status() === 200) {
        const deleteData = await deleteResponse.json();
        expect(deleteData.success).toBe(true);
        expect(deleteData).toHaveProperty(
          'message',
          'Cache entry deleted successfully'
        );
        expect(deleteData).toHaveProperty('key', testKey);
      }
    }
  });

  test('POST /api/cache/cached-links should add cached link', async ({
    request,
  }) => {
    const testLink = {
      url: `https://example.com/test-link-${Date.now()}`,
      title: 'Test Link Title',
    };

    const response = await request.post('/api/cache/cached-links', {
      data: testLink,
    });

    if (response.status() === 200) {
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data).toHaveProperty('message', 'Link cached successfully');
      expect(data).toHaveProperty('cachedLink');

      const cachedLink = data.cachedLink;
      expect(cachedLink).toHaveProperty('id');
      expect(cachedLink).toHaveProperty('url', testLink.url);
      expect(cachedLink).toHaveProperty('title', testLink.title);
      expect(cachedLink).toHaveProperty('dateAdded');
    } else {
      // Cache not available
      expect(response.status()).toBe(503);
    }
  });

  test('GET /api/cache/cached-links should retrieve cached links', async ({
    request,
  }) => {
    const response = await request.get('/api/cache/cached-links');

    expect([200, 503]).toContain(response.status());

    const data = await response.json();
    expect(data).toHaveProperty('success');

    if (response.status() === 200) {
      expect(data.success).toBe(true);
      expect(data).toHaveProperty('cachedLinks');
      // The actual response has nested structure with cachedLinks and pagination
      expect(data.cachedLinks).toHaveProperty('cachedLinks');
      expect(data.cachedLinks).toHaveProperty('pagination');
      expect(Array.isArray(data.cachedLinks.cachedLinks)).toBe(true);
    }
  });

  test('POST /api/cache/cover-image should handle missing torrent field', async ({
    request,
  }) => {
    const response = await request.post('/api/cache/cover-image', {
      data: {
        imageUrl: 'https://example.com/image.jpg',
        // Missing torrent field
      },
    });

    if (response.status() !== 503) {
      // Skip if cache not available
      expect(response.status()).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data).toHaveProperty('error', 'Missing required field: torrent');
    }
  });

  test('POST /api/cache/cover-image should handle missing image data/url', async ({
    request,
  }) => {
    const response = await request.post('/api/cache/cover-image', {
      data: {
        torrent: { title: 'Test Movie', magnet: 'magnet:?xt=...' },
        // Missing imageData and imageUrl
      },
    });

    if (response.status() !== 503) {
      // Skip if cache not available
      expect(response.status()).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data).toHaveProperty(
        'error',
        'Either imageData or imageUrl is required'
      );
    }
  });

  test('POST /api/cache/stream-url should handle missing required fields', async ({
    request,
  }) => {
    const response = await request.post('/api/cache/stream-url', {
      data: {
        magnetLink: 'magnet:?xt=...',
        // Missing streamData
      },
    });

    if (response.status() !== 503) {
      // Skip if cache not available
      expect(response.status()).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data).toHaveProperty(
        'error',
        'Missing required fields: magnetLink, streamData.streamUrl'
      );
    }
  });

});
