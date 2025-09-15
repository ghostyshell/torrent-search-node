const { test, expect } = require('@playwright/test');
const TestAuthHelper = require('../helpers/auth');

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

    let cacheValueSet = false;

    if (response.status() === 200) {
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data).toHaveProperty('message', 'Value cached successfully');
      expect(data).toHaveProperty('key', testKey);
      cacheValueSet = true;
    } else {
      // Cache not available - this is acceptable
      expect(response.status()).toBe(503);
    }

    // Cleanup: Delete the cached value to avoid affecting production data
    if (cacheValueSet) {
      try {
        await request.delete(`/api/cache/delete/${testKey}`);
      } catch (error) {
        console.warn(`Failed to cleanup cache key ${testKey}:`, error);
      }
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

    let cacheValueSet = false;

    // First set a value
    const setResponse = await request.post('/api/cache/set', {
      data: {
        key: testKey,
        value: testValue,
      },
    });

    if (setResponse.status() === 200) {
      cacheValueSet = true;

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

    // Cleanup: Delete the cached value to avoid affecting production data
    if (cacheValueSet) {
      try {
        await request.delete(`/api/cache/delete/${testKey}`);
      } catch (error) {
        console.warn(`Failed to cleanup cache key ${testKey}:`, error);
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
    const authedRequest = TestAuthHelper.createAuthRequest(request);
    const testLink = {
      url: `https://example.com/test-link-${Date.now()}`,
      title: 'Test Link Title',
    };

    const response = await authedRequest.post('/api/cache/cached-links', {
      data: testLink,
    });

    let createdLinkId = null;

    if (response.status() === 200) {
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data).toHaveProperty('message', 'Link stored successfully');
      expect(data).toHaveProperty('storedLink');

      const storedLink = data.storedLink;
      expect(storedLink).toHaveProperty('id');
      expect(storedLink).toHaveProperty('url', testLink.url);
      expect(storedLink).toHaveProperty('title', testLink.title);
      expect(storedLink).toHaveProperty('dateAdded');

      createdLinkId = storedLink.id;
    } else {
      // Cache not available
      expect(response.status()).toBe(503);
    }

    // Cleanup: Delete the created cached link to avoid affecting production data
    if (createdLinkId) {
      try {
        await authedRequest.delete(`/api/cache/cached-links/${createdLinkId}`);
      } catch (error) {
        console.warn(`Failed to cleanup cached link ${createdLinkId}:`, error);
      }
    }
  });

  test('GET /api/cache/cached-links should retrieve cached links', async ({
    request,
  }) => {
    const authedRequest = TestAuthHelper.createAuthRequest(request);
    const response = await authedRequest.get('/api/cache/cached-links');

    expect([200, 503]).toContain(response.status());

    const data = await response.json();
    expect(data).toHaveProperty('success');

    if (response.status() === 200) {
      expect(data.success).toBe(true);
      expect(data).toHaveProperty('storedLinks');
      expect(data).toHaveProperty('pagination');
      expect(Array.isArray(data.storedLinks)).toBe(true);
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
