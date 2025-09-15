/**
 * Test authentication helper for e2e tests
 * Creates mock authentication tokens that work with the auth middleware
 */

class TestAuthHelper {
  static createMockToken(userOverrides = {}) {
    const mockUser = {
      id: 'test-user-12345',
      email: 'test@example.com',
      name: 'Test User',
      picture: 'https://example.com/avatar.jpg',
      timestamp: Date.now(),
      ...userOverrides,
    };

    // Create base64 encoded token similar to what the auth middleware expects
    const tokenString = JSON.stringify(mockUser);
    return Buffer.from(tokenString).toString('base64');
  }

  static getAuthHeaders(userOverrides = {}) {
    const token = this.createMockToken(userOverrides);
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }

  static createAuthRequest(request, userOverrides = {}) {
    const headers = this.getAuthHeaders(userOverrides);

    // Return a function that can be used with playwright request
    return {
      get: (url, options = {}) => {
        return request.get(url, {
          ...options,
          headers: { ...headers, ...(options.headers || {}) },
        });
      },
      post: (url, options = {}) => {
        return request.post(url, {
          ...options,
          headers: { ...headers, ...(options.headers || {}) },
        });
      },
      put: (url, options = {}) => {
        return request.put(url, {
          ...options,
          headers: { ...headers, ...(options.headers || {}) },
        });
      },
      delete: (url, options = {}) => {
        return request.delete(url, {
          ...options,
          headers: { ...headers, ...(options.headers || {}) },
        });
      },
      patch: (url, options = {}) => {
        return request.patch(url, {
          ...options,
          headers: { ...headers, ...(options.headers || {}) },
        });
      },
    };
  }
}

module.exports = TestAuthHelper;
