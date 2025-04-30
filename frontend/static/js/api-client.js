/**
 * Abdre API Client
 * Client-side JavaScript for interacting with Abdre API Gateway
 */

class AbdreAPIClient {
  constructor() {
    this.baseUrl = ''; // Empty base URL means relative to current domain
    this.tokenKey = 'abdre_auth_token';
    this.refreshTokenKey = 'abdre_refresh_token';
    this.user = null;
    
    // Initialize services
    this.auth = this.createAuthService();
    this.user = this.createUserService();
    this.chat = this.createChatService();
    this.oauth = this.createOAuthService();
    this.realtime = this.createRealtimeService();
    
    // Initialize auth state
    this.refreshAuthState();
  }
  
  /**
   * Get stored authentication token
   */
  getToken() {
    return localStorage.getItem(this.tokenKey);
  }
  
  /**
   * Get stored refresh token
   */
  getRefreshToken() {
    return localStorage.getItem(this.refreshTokenKey);
  }
  
  /**
   * Store authentication tokens
   */
  setTokens(token, refreshToken) {
    if (token) {
      localStorage.setItem(this.tokenKey, token);
    }
    
    if (refreshToken) {
      localStorage.setItem(this.refreshTokenKey, refreshToken);
    }
    
    this.refreshAuthState();
  }
  
  /**
   * Clear authentication tokens
   */
  clearTokens() {
    localStorage.removeItem(this.tokenKey);
    localStorage.removeItem(this.refreshTokenKey);
    this.user = null;
  }
  
  /**
   * Check if user is authenticated
   */
  isAuthenticated() {
    return !!this.getToken();
  }
  
  /**
   * Refresh authentication state
   */
  async refreshAuthState() {
    const token = this.getToken();
    if (!token) {
      this.user = null;
      return;
    }
    
    // Attempt to decode token without verification (client-side)
    try {
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(window.atob(base64));
      
      this.user = {
        id: payload.user_id,
        username: payload.username,
        role: payload.role || 'user',
        exp: payload.exp
      };
      
      // Check if token is expired
      if (payload.exp && payload.exp < Date.now() / 1000) {
        console.log('Token expired, attempting to refresh...');
        try {
          await this.auth.refreshToken();
        } catch (error) {
          console.error('Failed to refresh token:', error);
          this.clearTokens();
        }
      }
    } catch (e) {
      console.error('Failed to decode token:', e);
      this.clearTokens();
    }
  }
  
  /**
   * Make an API request with proper auth headers
   */
  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}/api/${endpoint}`;
    
    // Set up headers
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };
    
    // Add auth token if available
    const token = this.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    
    // Create request options
    const requestOptions = {
      method: options.method || 'GET',
      headers,
      credentials: 'same-origin',
      ...options
    };
    
    // Add body if present
    if (options.body) {
      requestOptions.body = JSON.stringify(options.body);
    }
    
    try {
      const response = await fetch(url, requestOptions);
      
      // Handle 401 Unauthorized
      if (response.status === 401 && this.getRefreshToken()) {
        try {
          // Try to refresh the token
          const refreshed = await this.auth.refreshToken();
          if (refreshed) {
            // Retry the original request with new token
            headers['Authorization'] = `Bearer ${this.getToken()}`;
            return this.request(endpoint, options);
          }
        } catch (refreshError) {
          console.error('Token refresh failed:', refreshError);
          this.clearTokens();
          
          // Redirect to login if we're not already there
          if (!window.location.pathname.includes('/login')) {
            window.location.href = '/login';
          }
          
          throw new Error('Authentication required');
        }
      }
      
      // Parse JSON response
      let data;
      try {
        data = await response.json();
      } catch (e) {
        data = { message: 'No response data' };
      }
      
      // Handle error responses
      if (!response.ok) {
        const error = new Error(data.message || 'API request failed');
        error.status = response.status;
        error.data = data;
        throw error;
      }
      
      return data;
    } catch (error) {
      console.error(`API request failed: ${endpoint}`, error);
      throw error;
    }
  }
  
  /**
   * Create authentication service methods
   */
  createAuthService() {
    return {
      login: async (username, password) => {
        const data = await this.request('auth/login', {
          method: 'POST',
          body: { username, password }
        });
        
        if (data.token) {
          this.setTokens(data.token, data.refresh_token);
        }
        
        return data;
      },
      
      register: async (userData) => {
        const data = await this.request('auth/register', {
          method: 'POST',
          body: userData
        });
        
        if (data.token) {
          this.setTokens(data.token, data.refresh_token);
        }
        
        return data;
      },
      
      refreshToken: async () => {
        const refreshToken = this.getRefreshToken();
        if (!refreshToken) return false;
        
        try {
          const data = await this.request('auth/refresh', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${refreshToken}`
            }
          });
          
          if (data.token) {
            this.setTokens(data.token, data.refresh_token || refreshToken);
            return true;
          }
          
          return false;
        } catch (error) {
          this.clearTokens();
          return false;
        }
      },
      
      logout: () => {
        this.clearTokens();
        // Redirect to login page
        window.location.href = '/login';
      },
      
      verifyToken: async () => {
        try {
          const data = await this.request('auth/verify');
          return data.valid === true;
        } catch (error) {
          return false;
        }
      }
    };
  }
  
  /**
   * Create user service methods
   */
  createUserService() {
    return {
      getCurrentUser: async () => {
        return this.request('users/me');
      },
      
      updateProfile: async (userData) => {
        return this.request('users/me', {
          method: 'PUT',
          body: userData
        });
      },
      
      getUserById: async (userId) => {
        return this.request(`users/${userId}`);
      },
      
      searchUsers: async (query) => {
        return this.request(`users/search?q=${encodeURIComponent(query)}`);
      }
    };
  }
  
  /**
   * Create chat service methods
   */
  createChatService() {
    return {
      getChats: async () => {
        return this.request('chats');
      },
      
      getChatById: async (chatId) => {
        return this.request(`chats/${chatId}`);
      },
      
      createChat: async (chatData) => {
        return this.request('chats', {
          method: 'POST',
          body: chatData
        });
      },
      
      sendMessage: async (chatId, message) => {
        return this.request(`chats/${chatId}/messages`, {
          method: 'POST',
          body: { content: message }
        });
      },
      
      getMessages: async (chatId, limit = 50, before = null) => {
        let url = `chats/${chatId}/messages?limit=${limit}`;
        if (before) {
          url += `&before=${before}`;
        }
        return this.request(url);
      },
      
      joinChat: async (inviteCode) => {
        return this.request(`chats/join`, {
          method: 'POST',
          body: { invite_code: inviteCode }
        });
      }
    };
  }
  
  /**
   * Create OAuth service methods
   */
  createOAuthService() {
    return {
      getProviders: async () => {
        return this.request('oauth/providers');
      },
      
      initiateOAuth: (provider) => {
        window.location.href = `${this.baseUrl}/api/oauth/${provider}/authorize`;
      },
      
      handleCallback: async (provider, code) => {
        const data = await this.request(`oauth/${provider}/callback`, {
          method: 'POST',
          body: { code }
        });
        
        if (data.token) {
          this.setTokens(data.token, data.refresh_token);
        }
        
        return data;
      }
    };
  }
  
  /**
   * Create realtime service methods
   */
  createRealtimeService() {
    return {
      getWebSocketUrl: () => {
        return `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/api/realtime/ws`;
      },
      
      getAPIUrl: () => {
        return `${this.baseUrl}/api/realtime`;
      }
    };
  }
}

// Create and export global instance
const api = new AbdreAPIClient();
window.api = api; // Make available globally 