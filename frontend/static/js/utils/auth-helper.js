// Define the AuthHelper object and immediately assign it to window
window.AuthHelper = {
  // Configuration
  config: {
    tokenName: 'authToken',
    refreshTokenName: 'refreshToken',
    userDataName: 'userData',
    authTypeName: 'authType',
    visitorIdName: 'visitorId',
    csrfTokenName: 'csrfToken',
    tokenExpiryName: 'tokenExpiry',
    storageType: 'localStorage', // or 'sessionStorage' for session-only persistence
    apiBase: '/api',
    authEndpoint: '/api/auth',
    loginEndpoint: '/api/auth/login',
    registerEndpoint: '/api/auth/register',
    statusEndpoint: '/api/auth/verify',
    refreshEndpoint: '/api/auth/refresh',
    logoutEndpoint: '/api/auth/logout',
    guestLoginEndpoint: '/api/auth/get-or-create-visitor-id',
    setUserNameEndpoint: '/api/auth/set-user-name',
    oauthGoogleEndpoint: '/api/auth/oauth/google',
    oauthAppleEndpoint: '/api/auth/oauth/apple',
    loginPath: '/login',
    homePath: '/my-chats',
    chatPath: '/chat',
    tokenExpireTolerance: 300000, // 5 minutes in milliseconds
    // Auth types
    authTypes: {
      STANDARD: 'standard',
      GUEST: 'guest',
      OAUTH_GOOGLE: 'oauth_google',
      OAUTH_APPLE: 'oauth_apple'
    }
  },

  // Keep reference to original fetch
  _originalFetch: null,
  
  // For tracking warned endpoints
  _warnedEndpoints: new Set(),

  // Storage methods with security checks
  storage: {
    getItem(key) {
      try {
        return window[AuthHelper.config.storageType].getItem(key);
      } catch (error) {
        console.error('Storage access error:', error);
        return null;
      }
    },

    setItem(key, value) {
      try {
        window[AuthHelper.config.storageType].setItem(key, value);
        return true;
      } catch (error) {
        console.error('Storage write error:', error);
        return false;
      }
    },

    removeItem(key) {
      try {
        window[AuthHelper.config.storageType].removeItem(key);
        return true;
      } catch (error) {
        console.error('Storage remove error:', error);
        return false;
      }
    }
  },

  // Initialize authentication system
  init() {
    console.log('Initializing AuthHelper...');
    
    try {
      // Save reference to original fetch for token refresh
      this._originalFetch = window.fetch;
      
      // Override fetch to include authentication tokens
      window.fetch = this._createFetchWrapper();
      
      // Check authentication status on init
      this._checkAuthStatus();
      
      // Set up token refresh interval
      this._setupRefreshInterval();
      
      // Get or create visitor ID for guest users if not authenticated
      if (!this.isAuthenticated()) {
        this.getOrCreateVisitorId().catch(error => {
          // Just log the error but don't fail initialization
          console.warn("Failed to get visitor ID, but continuing anyway:", error);
        });
      }
      
      console.log('AuthHelper initialized');
    } catch (error) {
      console.error('Error during AuthHelper initialization:', error);
      // Continue despite errors to prevent complete failure
    }
    
    return this;
  },
  
  // Check auth status and refresh token if needed
  _checkAuthStatus() {
    if (this._isTokenExpired() && this.getRefreshToken()) {
      this.refreshToken().catch(error => {
        console.error('Token refresh failed during init:', error);
        // Fall back to guest mode
        this.clearAuth();
        this.getOrCreateVisitorId();
      });
    }
  },
  
  // Set up automatic token refresh
  _setupRefreshInterval() {
    // Clear any existing interval
    if (this._refreshInterval) {
      clearInterval(this._refreshInterval);
    }
    
    // Check token every minute and refresh if needed
    this._refreshInterval = setInterval(() => {
      if (this.isAuthenticated() && this._isTokenExpiringSoon()) {
        this.refreshToken().catch(error => {
          console.error('Scheduled token refresh failed:', error);
        });
      }
    }, 60000); // Check every minute
  },
  
  // Check if token will expire soon
  _isTokenExpiringSoon() {
    const expiryTime = parseInt(this.storage.getItem(this.config.tokenExpiryName));
    if (!expiryTime) return true;
    
    // Check if token will expire within the next 5 minutes
    return Date.now() > (expiryTime - this.config.tokenExpireTolerance);
  },

  // Token management
  saveAuth(authData) {
    if (!authData || !authData.access_token) {
      console.error('Invalid authentication data');
      return false;
    }

    try {
      // Store the token
      this.storage.setItem(this.config.tokenName, authData.access_token);
      
      // Store the refresh token if available
      if (authData.refresh_token) {
        this.storage.setItem(this.config.refreshTokenName, authData.refresh_token);
      }
      
      // Store user data
      if (authData.user) {
        this.storage.setItem(this.config.userDataName, JSON.stringify(authData.user));
      }
      
      // Store auth type
      this.storage.setItem(
        this.config.authTypeName, 
        authData.auth_type || this.config.authTypes.STANDARD
      );
      
      // Calculate and store token expiry time
      const tokenData = this._parseJwt(authData.access_token);
      if (tokenData && tokenData.exp) {
        const expiryTime = tokenData.exp * 1000; // Convert to milliseconds
        this.storage.setItem(this.config.tokenExpiryName, expiryTime);
      }
      
      // Dispatch auth change event
      this._dispatchAuthEvent('login', authData.user);
      
      return true;
    } catch (error) {
      console.error('Error saving authentication data:', error);
      return false;
    }
  },

  clearAuth() {
    const userData = this.getUserData();
    
    // Remove all authentication data
    this.storage.removeItem(this.config.tokenName);
    this.storage.removeItem(this.config.refreshTokenName);
    this.storage.removeItem(this.config.userDataName);
    this.storage.removeItem(this.config.authTypeName);
    this.storage.removeItem(this.config.tokenExpiryName);
    
    // Keep visitor ID for continuity of guest experience
    
    // Dispatch auth change event
    this._dispatchAuthEvent('logout', userData);
    
    console.log('Authentication data cleared');
    return true;
  },
  
  // Dispatch authentication state change events
  _dispatchAuthEvent(type, userData) {
    const event = new CustomEvent('auth:change', {
      detail: {
        type,
        user: userData,
        isAuthenticated: type === 'login',
        timestamp: new Date().toISOString()
      }
    });
    
    document.dispatchEvent(event);
    console.log(`Auth event dispatched: ${type}`);
  },

  // Authentication status
  isAuthenticated() {
    const token = this.getToken();
    if (!token) return false;
    
    // Check if token is expired
    if (this._isTokenExpired()) {
      // Only try to refresh if we actually have a refresh token
      const refreshToken = this.getRefreshToken();
      if (refreshToken) {
        // Try to refresh the token automatically in the background
        // Using setTimeout to make this non-blocking
        setTimeout(() => {
          this.refreshToken()
            .catch(error => {
              // Only log once per session to avoid log spam
              if (!this._loggedRefreshError) {
                console.error('Token refresh failed:', error);
                this._loggedRefreshError = true;
              }
              
              // Clear invalid auth data
              this.clearAuth();
              
              // Fall back to guest mode
              this.getOrCreateVisitorId();
            });
        }, 0);
      } else {
        // No refresh token available, consider not authenticated
        return false;
      }
      
      // Consider user not authenticated if token is expired
      return false;
    }
    
    return true;
  },
  
  _isTokenExpired() {
    const expiryTime = parseInt(this.storage.getItem(this.config.tokenExpiryName));
    if (!expiryTime) return true;
    
    // Check if token is expired
    return Date.now() > expiryTime;
  },

  getToken() {
    return this.storage.getItem(this.config.tokenName);
  },
  
  getRefreshToken() {
    return this.storage.getItem(this.config.refreshTokenName);
  },

  getUserData() {
    const userData = this.storage.getItem(this.config.userDataName);
    if (!userData) return null;
    
    try {
      return JSON.parse(userData);
    } catch (error) {
      console.error('Error parsing user data:', error);
      return null;
    }
  },
  
  getUserName() {
    const userData = this.getUserData();
    if (userData) {
      return userData.display_name || userData.username || userData.name || 'User';
    } else {
      const visitorId = this.getVisitorId();
      return visitorId ? 'Guest' : 'Visitor';
    }
  },
  
  getUserId() {
    const userData = this.getUserData();
    return userData ? (userData.user_id || userData.id) : this.getOrCreateVisitorId();
  },

  getAuthType() {
    return this.storage.getItem(this.config.authTypeName) || this.config.authTypes.GUEST;
  },
  
  isGuest() {
    return this.getAuthType() === this.config.authTypes.GUEST;
  },

  // Token refresh
  async refreshToken() {
    const refreshToken = this.getRefreshToken();
    if (!refreshToken) {
      throw new Error('No refresh token available');
    }
    
    try {
      // Use the original fetch, not the overridden one
      const fetchFn = this._originalFetch || window.fetch;
      
      const response = await fetchFn(this.config.refreshEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${refreshToken}`,
          'X-CSRF-Token': this._getCsrfToken()
        },
        credentials: 'include',
        body: JSON.stringify({ refresh_token: refreshToken })
      });
      
      if (!response.ok) {
        throw new Error('Token refresh failed');
      }
      
      const authData = await response.json();
      this.saveAuth(authData);
      return authData.access_token;
    } catch (error) {
      console.error('Error refreshing token:', error);
      // Clear auth on refresh failure
      this.clearAuth();
      throw error;
    }
  },

  // CSRF protection
  _getCsrfToken() {
    let token = this.storage.getItem(this.config.csrfTokenName);
    
    if (!token) {
      // Generate a new token if one doesn't exist
      token = this._generateRandomToken(32);
      this.storage.setItem(this.config.csrfTokenName, token);
    }
    
    return token;
  },

  _generateRandomToken(length = 32) {
    const array = new Uint8Array(length);
    window.crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
  },

  getVisitorId() {
    return this.storage.getItem(this.config.visitorIdName);
  },

  // Get or create a visitor ID for guest users
  async getOrCreateVisitorId() {
    const existingId = this.getVisitorId();
    
    try {
      // If we already have an ID, return it
      if (existingId) {
        // If we already have an access token, return the ID
        if (this.getToken()) {
          return existingId;
        }
        
        // Generate a guest username format
        const guestUsername = `guest_${existingId.substring(0, 8)}`;
        
        // Use the register endpoint for guest user
        const response = await fetch(this.config.registerEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': this._getCsrfToken()
          },
          credentials: 'include',
          body: JSON.stringify({
            username: guestUsername,
            password: existingId, // Use the ID as the password too
            email: `${guestUsername}@guest.local`,
            display_name: 'Guest User'
          })
        });
        
        if (response.ok) {
          const data = await response.json();
          
          // Save auth tokens
          this.saveAuth({
            ...data,
            auth_type: this.config.authTypes.GUEST
          });
          
          return existingId;
        }
      }
      
      // Generate a new visitor ID if we don't have one
      const newId = this._generateRandomToken(16);
      const guestUsername = `guest_${newId.substring(0, 8)}`;
      
      // Use the register endpoint for guest user
      const response = await fetch(this.config.registerEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': this._getCsrfToken()
        },
        credentials: 'include',
        body: JSON.stringify({
          username: guestUsername,
          password: newId, // Use the ID as the password too
          email: `${guestUsername}@guest.local`,
          display_name: 'Guest User'
        })
      });
      
      if (!response.ok) {
        throw new Error('Failed to register guest user');
      }
      
      const data = await response.json();
      
      // Save the visitor ID
      this.storage.setItem(this.config.visitorIdName, newId);
      
      // Save auth tokens
      this.saveAuth({
        ...data,
        auth_type: this.config.authTypes.GUEST
      });
      
      return newId;
    } catch (error) {
      console.error('Error creating guest user:', error);
      
      // Generate a fallback ID locally if the service is unavailable
      if (!existingId) {
        const fallbackId = this._generateRandomToken(16);
        this.storage.setItem(this.config.visitorIdName, fallbackId);
        return fallbackId;
      }
      
      return existingId;
    }
  },

  // Authentication methods
  async login(username, password) {
    try {
      const response = await fetch(this.config.loginEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': this._getCsrfToken()
        },
        credentials: 'include',
        body: JSON.stringify({ username, password })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Login failed');
      }
      
      const authData = await response.json();
      
      // Save authentication data
      this.saveAuth({
        ...authData,
        auth_type: this.config.authTypes.STANDARD
      });
      
      return authData;
    } catch (error) {
      console.error('Login error:', error);
      throw error;
    }
  },
  
  async register(userData) {
    if (!userData.username || !userData.password || !userData.email) {
      throw new Error('Missing required registration fields');
    }
    
    try {
      const response = await fetch(this.config.registerEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': this._getCsrfToken()
        },
        credentials: 'include',
        body: JSON.stringify(userData)
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Registration failed');
      }
      
      const authData = await response.json();
      
      // Save authentication data
      this.saveAuth({
        ...authData,
        auth_type: this.config.authTypes.STANDARD
      });
      
      return authData;
    } catch (error) {
      console.error('Registration error:', error);
      throw error;
    }
  },
  
  async setUserName(displayName) {
    if (!displayName) {
      throw new Error('Display name is required');
    }
    
    try {
      const response = await this.fetchWithAuth(this.config.setUserNameEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ display_name: displayName })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update display name');
      }
      
      const data = await response.json();
      
      // Update token and user data if the response includes them
      if (data.access_token) {
        this.storage.setItem(this.config.tokenName, data.access_token);
      }
      
      if (data.user) {
        this.storage.setItem(this.config.userDataName, JSON.stringify(data.user));
      }
      
      // Dispatch auth change event for name update
      this._dispatchAuthEvent('update', data.user);
      
      return data;
    } catch (error) {
      console.error('Error updating display name:', error);
      throw error;
    }
  },

  async logout() {
    try {
      // Call logout endpoint
      await this.fetchWithAuth(this.config.logoutEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      }).catch(err => {
        // Ignore server-side errors during logout
        console.warn('Logout API error (continuing):', err);
      });
      
      // Always clear local auth data regardless of server response
      this.clearAuth();
      
      // Redirect to login page or home depending on configuration
      const redirectTarget = this.config.loginPath || '/';
      
      // Only redirect if we're not already on the target page
      if (window.location.pathname !== redirectTarget) {
        window.location.href = redirectTarget;
      }
      
      return true;
    } catch (error) {
      // Even if the server-side logout fails, still clear the local data
      console.error('Logout error:', error);
      this.clearAuth();
      return false;
    }
  },

  requireAuth(redirectUrl = null) {
    if (!this.isAuthenticated()) {
      const currentPath = window.location.pathname;
      const targetUrl = redirectUrl || this.config.loginPath;
      
      // Only redirect if we're not already on the login page
      if (currentPath !== targetUrl) {
        // Store the current path for redirection after login
        if (currentPath !== '/' && currentPath !== this.config.loginPath) {
          sessionStorage.setItem('auth_redirect', currentPath);
        }
        
        window.location.href = targetUrl;
      }
      
      return false;
    }
    
    return true;
  },

  redirectIfAuthenticated(targetUrl = null) {
    if (this.isAuthenticated()) {
      const redirect = targetUrl || sessionStorage.getItem('auth_redirect') || this.config.homePath;
      
      // Clear the redirect URL from storage
      sessionStorage.removeItem('auth_redirect');
      
      // Redirect to the target URL
      window.location.href = redirect;
      return true;
    }
    
    return false;
  },

  getAuthHeaders() {
    const headers = {
      'Content-Type': 'application/json',
      'X-CSRF-Token': this._getCsrfToken()
    };
    
    const token = this.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    
    return headers;
  },

  // Create a fetch wrapper that adds auth headers
  _createFetchWrapper() {
    const self = this;
    const originalFetch = window.fetch;
    
    return function wrappedFetch(url, options = {}) {
      // Skip auth header for login/register endpoints
      const isAuthEndpoint = url.includes('/api/auth/login') || 
                            url.includes('/api/auth/register') ||
                            url.includes('/api/auth/get-or-create-visitor-id');
      
      // Skip for non-API requests
      const isApiRequest = url.startsWith('/api/') || url.startsWith(self.config.apiBase);
      
      // Clone the options to avoid modifying the original
      const fetchOptions = { ...options };
      
      // Initialize headers if not present
      fetchOptions.headers = fetchOptions.headers || {};
      
      // Only add auth headers for API requests that aren't auth endpoints
      if (isApiRequest && !isAuthEndpoint) {
        const token = self.getToken();
        if (token) {
          // Add as object property if headers is an object
          if (typeof fetchOptions.headers === 'object' && !(fetchOptions.headers instanceof Headers)) {
            fetchOptions.headers['Authorization'] = `Bearer ${token}`;
          } 
          // Add to Headers object
          else if (fetchOptions.headers instanceof Headers) {
            fetchOptions.headers.append('Authorization', `Bearer ${token}`);
          }
          // Create new headers object
          else {
            fetchOptions.headers = {
              'Authorization': `Bearer ${token}`,
              ...fetchOptions.headers
            };
          }
        }
      }
      
      // Add CSRF token for POST/PUT/DELETE requests
      if (['POST', 'PUT', 'DELETE'].includes(fetchOptions.method?.toUpperCase())) {
        const csrfToken = self._getCsrfToken();
        
        // Add as object property if headers is an object
        if (typeof fetchOptions.headers === 'object' && !(fetchOptions.headers instanceof Headers)) {
          fetchOptions.headers['X-CSRF-Token'] = csrfToken;
        } 
        // Add to Headers object
        else if (fetchOptions.headers instanceof Headers) {
          fetchOptions.headers.append('X-CSRF-Token', csrfToken);
        }
        // Create new headers object
        else {
          fetchOptions.headers = {
            'X-CSRF-Token': csrfToken,
            ...fetchOptions.headers
          };
        }
      }
      
      // Make the fetch request
      return originalFetch(url, fetchOptions).then(response => {
        // Handle 401 Unauthorized errors
        if (response.status === 401 && isApiRequest && !isAuthEndpoint) {
          // If we have a refresh token, try to refresh and retry
          const refreshToken = self.getRefreshToken();
          if (refreshToken) {
            // Notify only once per endpoint
            const endpoint = url.split('?')[0]; // Remove query params
            if (!self._warnedEndpoints.has(endpoint)) {
              console.warn(`Auth token rejected for ${endpoint}, attempting refresh...`);
              self._warnedEndpoints.add(endpoint);
            }
            
            return self.refreshToken().then(newToken => {
              // Update the Authorization header with the new token
              if (typeof fetchOptions.headers === 'object' && !(fetchOptions.headers instanceof Headers)) {
                fetchOptions.headers['Authorization'] = `Bearer ${newToken}`;
              } 
              // Add to Headers object
              else if (fetchOptions.headers instanceof Headers) {
                fetchOptions.headers.delete('Authorization');
                fetchOptions.headers.append('Authorization', `Bearer ${newToken}`);
              }
              // Create new headers object
              else {
                fetchOptions.headers = {
                  'Authorization': `Bearer ${newToken}`,
                  ...fetchOptions.headers
                };
              }
              
              // Retry the request with the new token
              return originalFetch(url, fetchOptions);
            }).catch(error => {
              // If refresh fails, redirect to login
              console.error('Token refresh failed:', error);
              self.clearAuth();
              
              // Only redirect if in browser context
              if (typeof window !== 'undefined') {
                // Store the current page for redirection after login
                sessionStorage.setItem('auth_redirect', window.location.pathname);
                
                // Redirect to login page
                if (window.location.pathname !== self.config.loginPath) {
                  window.location.href = self.config.loginPath;
                }
              }
              
              return response;
            });
          }
        }
        
        return response;
      });
    };
  },

  async fetchWithAuth(url, options = {}) {
    // Ensure we have headers object
    options.headers = options.headers || {};
    
    // Add auth headers
    const authHeaders = this.getAuthHeaders();
    options.headers = {
      ...authHeaders,
      ...options.headers
    };
    
    // Make the request
    return fetch(url, options);
  },

  _parseJwt(token) {
    try {
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));

      return JSON.parse(jsonPayload);
    } catch (error) {
      console.error('Error parsing JWT:', error);
      return null;
    }
  }
};

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
  AuthHelper.init();
  console.log('AuthHelper initialized');
});

// Export for module use
if (typeof exports !== 'undefined') {
  exports.AuthHelper = AuthHelper;
}