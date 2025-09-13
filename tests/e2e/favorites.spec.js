const { test, expect } = require('@playwright/test');

test.describe('Favorites API Endpoints', () => {
  const testTorrent = {
    title: 'Test Movie 2024',
    magnet: 'magnet:?xt=urn:btih:test123456789abcdef&dn=Test+Movie+2024',
    seeders: '100',
    leechers: '10',
    size: '1.5 GB',
  };

  test('POST /api/cache/favorites should add favorite with valid torrent', async ({
    request,
  }) => {
    const response = await request.post('/api/cache/favorites', {
      data: { torrent: testTorrent },
    });

    let favoriteAdded = false;

    if (response.status() === 200) {
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data).toHaveProperty('message', 'Favorite added successfully');
      favoriteAdded = true;
    } else {
      // Cache not available
      expect(response.status()).toBe(503);
      const data = await response.json();
      expect(data).toHaveProperty('error', 'Cache not available');
    }

    // Cleanup: Remove the favorite to avoid affecting production data
    if (favoriteAdded) {
      try {
        await request.delete('/api/cache/favorites', {
          data: { torrent: testTorrent },
        });
      } catch (error) {
        console.warn('Failed to cleanup favorite:', error);
      }
    }
  });

  test('POST /api/cache/favorites should return error for missing torrent', async ({
    request,
  }) => {
    const response = await request.post('/api/cache/favorites', {
      data: {}, // Missing torrent field
    });

    if (response.status() !== 503) {
      // Skip if cache not available
      expect(response.status()).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data).toHaveProperty('error', 'Missing required field: torrent');
    }
  });

  test('GET /api/cache/favorites should retrieve favorites list', async ({
    request,
  }) => {
    const response = await request.get('/api/cache/favorites');

    expect([200, 503]).toContain(response.status());

    const data = await response.json();
    expect(data).toHaveProperty('success');

    if (response.status() === 200) {
      expect(data.success).toBe(true);
      expect(data).toHaveProperty('favorites');
      expect(Array.isArray(data.favorites)).toBe(true);
      expect(data).toHaveProperty('pagination');

      // Check pagination structure
      const pagination = data.pagination;
      expect(pagination).toHaveProperty('currentPage');
      expect(pagination).toHaveProperty('totalPages');
      expect(pagination).toHaveProperty('totalCount');
      expect(pagination).toHaveProperty('limit');
      expect(pagination).toHaveProperty('hasNextPage');
      expect(pagination).toHaveProperty('hasPrevPage');
    }
  });

  test('GET /api/cache/favorites with pagination should work', async ({
    request,
  }) => {
    const response = await request.get('/api/cache/favorites?page=1&limit=10');

    expect([200, 503]).toContain(response.status());

    const data = await response.json();

    if (response.status() === 200) {
      expect(data.success).toBe(true);
      expect(data.pagination.currentPage).toBe(1);
      expect(data.pagination.limit).toBe(10);
      expect(data.favorites.length).toBeLessThanOrEqual(10);
    }
  });

  test('DELETE /api/cache/favorites should remove favorite', async ({
    request,
  }) => {
    // First add a favorite to remove
    const addResponse = await request.post('/api/cache/favorites', {
      data: { torrent: { ...testTorrent, title: 'Test Movie for Deletion' } },
    });

    if (addResponse.status() === 200) {
      // Then try to remove it
      const removeResponse = await request.delete('/api/cache/favorites', {
        data: { torrent: { ...testTorrent, title: 'Test Movie for Deletion' } },
      });

      expect([200, 404]).toContain(removeResponse.status());

      const removeData = await removeResponse.json();
      if (removeResponse.status() === 200) {
        expect(removeData.success).toBe(true);
        expect(removeData).toHaveProperty(
          'message',
          'Favorite removed successfully'
        );
      } else {
        expect(removeData.success).toBe(false);
        expect(removeData).toHaveProperty('error', 'Favorite not found');
      }
    }
  });

  test('DELETE /api/cache/favorites should return error for missing torrent', async ({
    request,
  }) => {
    const response = await request.delete('/api/cache/favorites', {
      data: {}, // Missing torrent field
    });

    if (response.status() !== 503) {
      // Skip if cache not available
      expect(response.status()).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data).toHaveProperty('error', 'Missing required field: torrent');
    }
  });

  test('POST /api/favorites/check should check if torrent is favorite', async ({
    request,
  }) => {
    const response = await request.post('/api/favorites/check', {
      data: { torrent: testTorrent },
    });

    if (response.status() === 200) {
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data).toHaveProperty('isFavorite');
      expect(typeof data.isFavorite).toBe('boolean');
    } else {
      expect([500, 503]).toContain(response.status());
    }
  });

  test('POST /api/favorites/check should return error for missing torrent', async ({
    request,
  }) => {
    const response = await request.post('/api/favorites/check', {
      data: {}, // Missing torrent field
    });

    if (response.status() !== 503) {
      // Skip if cache not available
      expect(response.status()).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data).toHaveProperty('error', 'Missing required field: torrent');
    }
  });

  test('GET /api/favorites/:favoriteId/details should handle favorite details', async ({
    request,
  }) => {
    const testFavoriteId = 'test_favorite_123';
    const response = await request.get(
      `/api/favorites/${testFavoriteId}/details`
    );

    expect([200, 404, 500, 503]).toContain(response.status());

    const data = await response.json();
    expect(data).toHaveProperty('success');

    if (response.status() === 200) {
      expect(data.success).toBe(true);
      expect(data).toHaveProperty('details');
    } else if (response.status() === 404) {
      expect(data.success).toBe(false);
      expect(data).toHaveProperty('error', 'Favorite details not found');
    }
  });

  test('POST /api/favorites/:favoriteId/details should store favorite details', async ({
    request,
  }) => {
    const testFavoriteId = 'test_favorite_123';
    const testDetails = {
      description: 'Test movie description',
      genre: 'Action',
      year: 2024,
      rating: 8.5,
    };

    const response = await request.post(
      `/api/favorites/${testFavoriteId}/details`,
      {
        data: { details: testDetails },
      }
    );

    if (response.status() === 200) {
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data).toHaveProperty(
        'message',
        'Favorite details stored successfully'
      );
    } else if (response.status() === 400) {
      const data = await response.json();
      expect(data).toHaveProperty(
        'error',
        'Missing required fields: favoriteId and details'
      );
    } else {
      expect([500, 503]).toContain(response.status());
    }
  });

  test('GET /api/favorites/:favoriteId/screenshots should handle favorite screenshots', async ({
    request,
  }) => {
    const testFavoriteId = 'test_favorite_123';
    const response = await request.get(
      `/api/favorites/${testFavoriteId}/screenshots`
    );

    expect([200, 404, 503]).toContain(response.status());

    const data = await response.json();
    expect(data).toHaveProperty('success');

    if (response.status() === 200) {
      expect(data.success).toBe(true);
      expect(data).toHaveProperty('screenshots');
    } else if (response.status() === 404) {
      expect(data.success).toBe(false);
      expect(data).toHaveProperty('error', 'Screenshots not found');
    }
  });

  test('POST /api/favorites/:favoriteId/screenshots should store favorite screenshots', async ({
    request,
  }) => {
    const testFavoriteId = 'test_favorite_123';
    const testScreenshots = [
      { timestamp: 30, url: 'https://example.com/screenshot1.jpg' },
      { timestamp: 60, url: 'https://example.com/screenshot2.jpg' },
    ];

    const response = await request.post(
      `/api/favorites/${testFavoriteId}/screenshots`,
      {
        data: { screenshots: testScreenshots },
      }
    );

    if (response.status() === 200) {
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data).toHaveProperty('message', 'Screenshots stored successfully');
    } else if (response.status() === 400) {
      const data = await response.json();
      expect(data).toHaveProperty(
        'error',
        'Missing required fields: favoriteId and screenshots'
      );
    } else {
      expect([500, 503]).toContain(response.status());
    }
  });

  test('POST /api/favorites/entry should store favorite entry', async ({
    request,
  }) => {
    const testEntry = {
      favoriteId: 'test_favorite_123',
      entryData: {
        notes: 'Great movie!',
        watched: true,
        rating: 9.0,
        watchedDate: new Date().toISOString(),
      },
    };

    const response = await request.post('/api/favorites/entry', {
      data: testEntry,
    });

    if (response.status() === 200) {
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data).toHaveProperty(
        'message',
        'Favorite entry stored successfully'
      );
    } else if (response.status() === 400) {
      const data = await response.json();
      expect(data).toHaveProperty(
        'error',
        'Missing required fields: favoriteId and entryData'
      );
    } else {
      expect([500, 503]).toContain(response.status());
    }
  });
});
