const { test, expect } = require('@playwright/test');

test.describe('Video API Endpoints', () => {
  const testMagnetLink =
    'magnet:?xt=urn:btih:test123456789abcdef&dn=Test+Video';
  const testVideoUrl =
    'https://sample-videos.com/zip/10/mp4/SampleVideo_1280x720_1mb.mp4';

  test('POST /api/video/screenshot should handle missing required fields', async ({
    request,
  }) => {
    const response = await request.post('/api/video/screenshot', {
      data: {}, // Missing videoUrl and timestamp
    });

    expect(response.status()).toBe(400);

    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data).toHaveProperty(
      'error',
      'Missing required fields: videoUrl (string) and timestamp (number)'
    );
  });

  test('POST /api/video/screenshot should handle missing videoUrl', async ({
    request,
  }) => {
    const response = await request.post('/api/video/screenshot', {
      data: { timestamp: 30 }, // Missing videoUrl
    });

    expect(response.status()).toBe(400);

    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data).toHaveProperty(
      'error',
      'Missing required fields: videoUrl (string) and timestamp (number)'
    );
  });

  test('POST /api/video/screenshot should handle missing timestamp', async ({
    request,
  }) => {
    const response = await request.post('/api/video/screenshot', {
      data: { videoUrl: testVideoUrl }, // Missing timestamp
    });

    expect(response.status()).toBe(400);

    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data).toHaveProperty(
      'error',
      'Missing required fields: videoUrl (string) and timestamp (number)'
    );
  });

  test('POST /api/video/screenshot should handle invalid timestamp type', async ({
    request,
  }) => {
    const response = await request.post('/api/video/screenshot', {
      data: {
        videoUrl: testVideoUrl,
        timestamp: 'invalid', // Should be number
      },
    });

    expect(response.status()).toBe(400);

    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data).toHaveProperty(
      'error',
      'Missing required fields: videoUrl (string) and timestamp (number)'
    );
  });

  test('POST /api/video/screenshot should attempt screenshot generation', async ({
    request,
  }) => {
    const response = await request.post('/api/video/screenshot', {
      data: {
        videoUrl: testVideoUrl,
        timestamp: 30,
        magnetLink: testMagnetLink,
        filename: 'test_screenshot.jpg',
      },
    });

    // May succeed or fail depending on ffmpeg availability and video accessibility
    expect([200, 500]).toContain(response.status());

    const data = await response.json();
    expect(data).toHaveProperty('success');

    if (response.status() === 200) {
      expect(data.success).toBe(true);
      expect(data).toHaveProperty('screenshot');

      const screenshot = data.screenshot;
      expect(screenshot).toHaveProperty('base64');
      expect(screenshot).toHaveProperty('timestamp', 30);
      expect(screenshot).toHaveProperty('filename');
      expect(screenshot).toHaveProperty('sizeKB');
      expect(screenshot).toHaveProperty('cached');
      expect(screenshot).toHaveProperty('generatedAt');

      // Base64 should start with data:image/jpeg;base64,
      expect(screenshot.base64).toMatch(/^data:image\/jpeg;base64,/);
    } else {
      // FFmpeg not available or video not accessible
      expect(data.success).toBe(false);
      expect(data).toHaveProperty('error');
    }
  });

  test('POST /api/video/screenshots should handle missing magnetLink', async ({
    request,
  }) => {
    const response = await request.post('/api/video/screenshots', {
      data: {}, // Missing magnetLink
    });

    expect(response.status()).toBe(400);

    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data).toHaveProperty(
      'error',
      'Missing required parameter: magnetLink'
    );
  });

  test('POST /api/video/screenshots should retrieve cached screenshots', async ({
    request,
  }) => {
    test.setTimeout(15000); // Give extra time for cloud database
    const response = await request.post('/api/video/screenshots', {
      data: { magnetLink: testMagnetLink },
    });

    expect([200, 503]).toContain(response.status());

    const data = await response.json();
    expect(data).toHaveProperty('success');

    if (response.status() === 200) {
      expect(data.success).toBe(true);
      expect(data).toHaveProperty('magnetLink', testMagnetLink);
      expect(data).toHaveProperty('screenshots');
      expect(data).toHaveProperty('count');
      expect(Array.isArray(data.screenshots)).toBe(true);
      expect(data.count).toBe(data.screenshots.length);

      // Check screenshot structure if any exist
      if (data.screenshots.length > 0) {
        const screenshot = data.screenshots[0];
        expect(screenshot).toHaveProperty('timestamp');
        expect(typeof screenshot.timestamp).toBe('number');
      }
    } else {
      // Cache not available
      expect(data.success).toBe(false);
      expect(data).toHaveProperty('error', 'Cache not available');
    }
  });

  test('GET /api/video/screenshots/:magnetLink should retrieve cached screenshots via GET', async ({
    request,
  }) => {
    test.setTimeout(15000); // Give extra time for cloud database
    const encodedMagnetLink = encodeURIComponent(testMagnetLink);
    const response = await request.get(
      `/api/video/screenshots/${encodedMagnetLink}`
    );

    expect([200, 503]).toContain(response.status());

    const data = await response.json();
    expect(data).toHaveProperty('success');

    if (response.status() === 200) {
      expect(data.success).toBe(true);
      expect(data).toHaveProperty('magnetLink', testMagnetLink);
      expect(data).toHaveProperty('screenshots');
      expect(data).toHaveProperty('count');
      expect(Array.isArray(data.screenshots)).toBe(true);
    } else {
      // Cache not available
      expect(data.success).toBe(false);
      expect(data).toHaveProperty('error', 'Cache not available');
    }
  });

  test('GET /api/video/screenshots without magnetLink should return error', async ({
    request,
  }) => {
    const response = await request.get('/api/video/screenshots/');

    // Should be 404 for invalid route or 200 if route exists but empty
    expect([200, 404]).toContain(response.status());
  });

  test('POST /api/video/batch-screenshots should handle missing required fields', async ({
    request,
  }) => {
    const response = await request.post('/api/video/batch-screenshots', {
      data: {}, // Missing videoUrl and timestamps
    });

    expect(response.status()).toBe(400);

    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data).toHaveProperty(
      'error',
      'Missing required fields: videoUrl (string) and timestamps (array)'
    );
  });

  test('POST /api/video/batch-screenshots should handle invalid timestamps', async ({
    request,
  }) => {
    const response = await request.post('/api/video/batch-screenshots', {
      data: {
        videoUrl: testVideoUrl,
        timestamps: 'not-an-array',
      },
    });

    expect(response.status()).toBe(400);

    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data).toHaveProperty(
      'error',
      'Missing required fields: videoUrl (string) and timestamps (array)'
    );
  });

  test('POST /api/video/batch-screenshots should handle too many timestamps', async ({
    request,
  }) => {
    const manyTimestamps = Array.from({ length: 25 }, (_, i) => i * 30); // 25 timestamps

    const response = await request.post('/api/video/batch-screenshots', {
      data: {
        videoUrl: testVideoUrl,
        timestamps: manyTimestamps,
      },
    });

    expect(response.status()).toBe(400);

    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data).toHaveProperty(
      'error',
      'Maximum 20 timestamps allowed per batch'
    );
  });

  test('POST /api/video/batch-screenshots should handle valid batch request', async ({
    request,
  }) => {
    const timestamps = [30, 60, 120]; // 3 timestamps

    const response = await request.post('/api/video/batch-screenshots', {
      data: {
        videoUrl: testVideoUrl,
        timestamps: timestamps,
        magnetLink: testMagnetLink,
      },
    });

    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data).toHaveProperty('totalRequested', 3);
    expect(data).toHaveProperty('successful');
    expect(data).toHaveProperty('failed');
    expect(data).toHaveProperty('results');
    expect(data).toHaveProperty('errors');

    expect(Array.isArray(data.results)).toBe(true);
    expect(Array.isArray(data.errors)).toBe(true);

    // Check that we have results for all timestamps
    expect(data.successful + data.failed).toBe(3);

    // Check result structure
    data.results.forEach((result) => {
      expect(result).toHaveProperty('index');
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('message');
    });
  });

  test('POST /api/video/batch-screenshots should handle invalid timestamp types', async ({
    request,
  }) => {
    const timestamps = [30, 'invalid', 120]; // Mixed valid and invalid

    const response = await request.post('/api/video/batch-screenshots', {
      data: {
        videoUrl: testVideoUrl,
        timestamps: timestamps,
      },
    });

    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data).toHaveProperty('totalRequested', 3);
    expect(data).toHaveProperty('successful');
    expect(data).toHaveProperty('failed');
    expect(data).toHaveProperty('errors');

    // Should have at least one error for the invalid timestamp
    expect(data.failed).toBeGreaterThan(0);
    expect(data.errors.length).toBeGreaterThan(0);

    // Check error structure
    const error = data.errors.find((err) => err.timestamp === 'invalid');
    expect(error).toBeDefined();
    expect(error).toHaveProperty('index');
    expect(error).toHaveProperty('error', 'Timestamp must be a number');
  });
});
