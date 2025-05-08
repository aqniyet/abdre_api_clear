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
    cookieEnabled: true, // Whether to use HTTP-only cookies for tokens (preferred)
    apiBase: '/api',
    authEndpoint: '/api/auth',
    loginEndpoint: '/api/auth/login',
    registerEndpoint: '/api/auth/register',
    statusEndpoint: '/api/auth/verify',
    sessionCheckEndpoint: '/api/auth/check-session',
    refreshEndpoint: '/api/auth/refresh',
    logoutEndpoint: '/api/auth/logout',
    guestLoginEndpoint: '/api/auth/visitor',
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
      // Save reference to original fetch only if not already saved
      if (!this._originalFetch) {
        this._originalFetch = window.fetch.bind(window);
      }
      
      // Override fetch to include authentication tokens
      // Only set once to avoid recursive wrapping
      if (window.fetch !== this.wrappedFetch) {
        // Create the wrapper function and bind this context
        this.wrappedFetch = this._createFetchWrapper().bind(this);
        window.fetch = this.wrappedFetch;
      }
      
      // Check authentication status on init
      this._checkAuthStatus();
      
      // Set up token refresh interval
      this._setupRefreshInterval();
      
      // Get or create visitor ID for guest users if not authenticated
      if (!this.isAuthenticated()) {
        // Don't wait for this promise, handle error internally
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
    // First check if we have a token
    if (!this.getToken()) {
      console.log('No token found during status check');
      return;
    }
    
    // Validate session state with backend
    this.checkSession()
      .then(sessionStatus => {
        console.log('Session check result:', sessionStatus);
        
        if (sessionStatus.token_status === 'expired' && this.getRefreshToken()) {
          // Token expired, try to refresh
          console.log('Token expired, attempting refresh');
          return this.refreshToken();
        } else if (sessionStatus.token_status !== 'valid') {
          // Token invalid, switch to guest mode
          console.log('Token invalid, switching to guest mode');
          this.clearAuth();
          return this.getOrCreateVisitorId();
        }
        
        // Valid token, nothing to do
        return sessionStatus;
      })
      .catch(error => {
        console.error('Error during auth status check:', error);
        // Fall back to guest mode on error
        this.clearAuth();
        this.getOrCreateVisitorId();
      });
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
  
  // Check if token is expired
  _isTokenExpired() {
    const expiryTime = parseInt(this.storage.getItem(this.config.tokenExpiryName));
    if (!expiryTime) return true;
    
    // Check if token is already expired
    return Date.now() > expiryTime;
  },

  // Check session status with backend
  async checkSession() {
    try {
      const response = await this.fetchWithAuth(this.config.sessionCheckEndpoint, {
        method: 'GET',
        credentials: 'include' // Always include cookies
      });
      
      if (!response.ok) {
        throw new Error(`Session check failed: ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('Session check error:', error);
      return {
        authenticated: false,
        guest: false,
        token_status: 'error'
      };
    }
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
      const authType = authData.auth_type || this.config.authTypes.STANDARD;
      this.storage.setItem(this.config.authTypeName, authType);
      
      // Store visitor_id for guest users
      if (authType === this.config.authTypes.GUEST && authData.visitor_id) {
        this.storage.setItem(this.config.visitorIdName, authData.visitor_id);
        console.log(`Stored visitor ID: ${authData.visitor_id}`);
      }
      
      // Calculate and store token expiry time
      const tokenData = this._parseJwt(authData.access_token);
      if (tokenData && tokenData.exp) {
        const expiryTime = tokenData.exp * 1000; // Convert to milliseconds
        this.storage.setItem(this.config.tokenExpiryName, expiryTime);
      }
      
      // Dispatch auth change event
      this._dispatchAuthEvent(
        authType === this.config.authTypes.GUEST ? 'guest-login' : 'login', 
        authData.user
      );
      
      console.log(`Authentication saved. Type: ${authType}`);
      return true;
    } catch (error) {
      console.error('Error saving authentication data:', error);
      return false;
    }
  },

  clearAuth() {
    const userData = this.getUserData();
    const wasGuest = this.isGuest();
    
    // Remove all authentication data
    this.storage.removeItem(this.config.tokenName);
    this.storage.removeItem(this.config.refreshTokenName);
    this.storage.removeItem(this.config.userDataName);
    this.storage.removeItem(this.config.authTypeName);
    this.storage.removeItem(this.config.tokenExpiryName);
    
    // Remove visitor ID only if explicit logout is requested
    // This preserves the visitor ID for guests even when token expires
    if (this._isExplicitLogout) {
      this.storage.removeItem(this.config.visitorIdName);
      this._isExplicitLogout = false;
    }
    
    // Dispatch logout event
    this._dispatchAuthEvent(wasGuest ? 'guest-logout' : 'logout', userData);
    
    console.log('Authentication cleared');
  },
  
  // Dispatch authentication state change events
  _dispatchAuthEvent(type, userData) {
    const event = new CustomEvent('auth:change', {
      detail: {
        type,
        user: userData,
        isAuthenticated: type === 'login',
        isGuest: type === 'guest-login',
        timestamp: new Date().toISOString()
      }
    });
    
    document.dispatchEvent(event);
    console.log(`Auth event dispatched: ${type}`);
  },

  // Authentication status
  isAuthenticated() {
    const token = this.getToken();
    const authType = this.getAuthType();
    
    // No token means not authenticated
    if (!token) return false;
    
    // Guest users are not considered fully authenticated
    if (authType === this.config.authTypes.GUEST) return false;
    
    // Check if token is expired
    if (this._isTokenExpired()) {
      // Only try to refresh if we have a refresh token
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
      }
      
      return false;
    }
    
    return true;
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
    if (!userData) return '';
    
    // Return display name if available, otherwise username, or empty string
    return userData.display_name || userData.username || '';
  },

  getUserId() {
    const userData = this.getUserData();
    return userData ? userData.user_id || '' : '';
  },

  getAuthType() {
    return this.storage.getItem(this.config.authTypeName) || '';
  },

  isGuest() {
    const authType = this.getAuthType();
    return authType === this.config.authTypes.GUEST;
  },

  // Token refresh
  async refreshToken() {
    console.log('Refreshing token...');
    const refreshToken = this.getRefreshToken();
    
    if (!refreshToken) {
      throw new Error('No refresh token available');
    }
    
    try {
      // Prepare request
      const response = await this._originalFetch(this.config.refreshEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${refreshToken}`
        },
        body: JSON.stringify({ refresh_token: refreshToken }),
        credentials: 'include' // Include cookies
      });
      
      if (!response.ok) {
        throw new Error(`Failed to refresh token: ${response.status}`);
      }
      
      const data = await response.json();
      
      // Save the new tokens
      this.saveAuth(data);
      
      console.log('Token refreshed successfully');
      return data;
    } catch (error) {
      console.error('Token refresh error:', error);
      
      // Clear authentication on refresh failure
      this.clearAuth();
      
      throw error;
    }
  },

  // Get CSRF token from meta tag
  _getCsrfToken() {
    // Check for CSRF token in meta tag
    const metaTag = document.querySelector('meta[name="csrf-token"]');
    if (metaTag) {
      return metaTag.getAttribute('content');
    }
    
    // Use a stored token if we already generated one
    const storedToken = this.storage.getItem(this.config.csrfTokenName);
    if (storedToken) {
      return storedToken;
    }
    
    // Generate a random token if none exists
    const newToken = this._generateRandomToken();
    // Store it for future use to prevent recursion
    this.storage.setItem(this.config.csrfTokenName, newToken);
    return newToken;
  },
  
  // Generate a random token for CSRF protection
  _generateRandomToken(length = 32) {
    // Simple implementation to avoid crypto API issues
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  },

  getVisitorId() {
    return this.storage.getItem(this.config.visitorIdName);
  },

  // Get or create a visitor ID for guest users
  async getOrCreateVisitorId() {
    try {
      // If we already have a visitor ID, return it
      const existingId = this.getVisitorId();
      if (existingId) {
        console.log('Using existing visitor ID:', existingId);
        return { visitor_id: existingId };
      }
      
      console.log('Getting or creating visitor ID...');
      
      // Request a new visitor ID from the server
      const response = await this._originalFetch(this.config.guestLoginEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include' // Include cookies
      });
      
      if (!response.ok) {
        throw new Error(`Failed to get visitor ID: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (!data.visitor_id) {
        throw new Error('No visitor ID in response');
      }
      
      // Store the visitor ID
      this.storage.setItem(this.config.visitorIdName, data.visitor_id);
      console.log('Stored visitor ID:', data.visitor_id);
      
      // Save guest auth type
      this.storage.setItem(this.config.authTypeName, this.config.authTypes.GUEST);
      
      // Dispatch auth event
      this._dispatchAuthEvent('visitor-created', { visitor_id: data.visitor_id });
      
      return data;
    } catch (error) {
      console.error('Error getting/creating visitor ID:', error);
      throw error;
    }
  },

  /**
   * Login as a guest user
   * This will create a visitor ID and handle the guest authentication flow
   * @returns {Promise<Object>} Result object with success status
   */
  async loginAsGuest() {
    try {
      // Get or create visitor ID
      const visitorData = await this.getOrCreateVisitorId();
      
      if (!visitorData || !visitorData.visitor_id) {
        throw new Error('Failed to get visitor ID');
      }
      
      // Set auth type as guest
      this.storage.setItem(this.config.authTypeName, this.config.authTypes.GUEST);
      
      // Dispatch auth event
      this._dispatchAuthEvent('guest-login', { visitor_id: visitorData.visitor_id });
      
      return {
        success: true,
        visitor_id: visitorData.visitor_id
      };
    } catch (error) {
      console.error('Guest login error:', error);
      return {
        success: false,
        error: error.message || 'An error occurred during guest login'
      };
    }
  },

  // Regular login with username and password
  async login(username, password, remember = false) {
    console.log('Logging in...');
    
    if (!username || !password) {
      return { success: false, error: 'Username and password are required' };
    }
    
    try {
      // Prepare request
      const response = await this._originalFetch(this.config.loginEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': this._getCsrfToken()
        },
        body: JSON.stringify({ username, password, remember }),
        credentials: 'include' // Include cookies
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Login failed' }));
        return { success: false, error: errorData.error || 'Login failed' };
      }
      
      const data = await response.json();
      
      // Save authentication data
      this.saveAuth(data);
      
      console.log('Login successful');
      return { success: true, data };
    } catch (error) {
      console.error('Login error:', error);
      return { success: false, error: error.message || 'An unexpected error occurred' };
    }
  },
  
  // User registration
  async register(userData) {
    console.log('Registering new user...');
    
    if (!userData.username || !userData.password || !userData.email) {
      return { success: false, error: 'Username, password, and email are required' };
    }
    
    try {
      // Prepare request
      const response = await this._originalFetch(this.config.registerEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': this._getCsrfToken()
        },
        body: JSON.stringify(userData),
        credentials: 'include' // Include cookies
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Registration failed' }));
        return { success: false, error: errorData.error || 'Registration failed' };
      }
      
      const data = await response.json();
      
      // Save authentication data
      this.saveAuth(data);
      
      console.log('Registration successful');
      return { success: true, data };
    } catch (error) {
      console.error('Registration error:', error);
      return { success: false, error: error.message || 'An unexpected error occurred' };
    }
  },
  
  // Set user display name
  async setUserName(displayName) {
    console.log('Setting user display name...');
    
    if (!displayName) {
      return { success: false, error: 'Display name is required' };
    }
    
    try {
      // Get auth headers
      const headers = this.getAuthHeaders();
      headers['Content-Type'] = 'application/json';
      
      // Prepare request
      const response = await this._originalFetch(this.config.setUserNameEndpoint, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ display_name: displayName }),
        credentials: 'include' // Include cookies
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to set display name' }));
        return { success: false, error: errorData.error || 'Failed to set display name' };
      }
      
      const data = await response.json();
      
      // Update user data in storage
      const userData = this.getUserData();
      if (userData) {
        userData.display_name = displayName;
        this.storage.setItem(this.config.userDataName, JSON.stringify(userData));
      }
      
      console.log('Display name updated successfully');
      return { success: true, data };
    } catch (error) {
      console.error('Error setting display name:', error);
      return { success: false, error: error.message || 'An unexpected error occurred' };
    }
  },
  
  // Logout user
  async logout() {
    console.log('Logging out...');
    
    try {
      // Set flag for explicit logout to also clear visitor ID
      this._isExplicitLogout = true;
      
      // Get current token for logout request
      const token = this.getToken();
      const refreshToken = this.getRefreshToken();
      
      if (token) {
        // Prepare request
        const response = await this._originalFetch(this.config.logoutEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ refresh_token: refreshToken }),
          credentials: 'include' // Include cookies to clear them
        });
        
        if (!response.ok) {
          console.warn('Logout request failed:', await response.text());
        }
      }
      
      // Clear authentication regardless of server response
      this.clearAuth();
      
      console.log('Logout successful');
      return { success: true };
    } catch (error) {
      console.error('Logout error:', error);
      
      // Clear authentication even if request fails
      this.clearAuth();
      
      return { success: true, error: error.message }; // Still successful from client perspective
    }
  },
  
  // Require authentication or redirect
  requireAuth(redirectUrl = null) {
    // If not authenticated, redirect to login page
    if (!this.isAuthenticated()) {
      console.log('Authentication required. Redirecting to login page.');
      
      // Build redirect URL
      const loginRedirect = new URL(this.config.loginPath, window.location.origin);
      
      // Add the current URL as redirect parameter
      const currentPath = redirectUrl || window.location.pathname + window.location.search;
      loginRedirect.searchParams.set('redirect', currentPath);
      
      // Redirect to login page
      window.location.href = loginRedirect.toString();
      return false;
    }
    
    return true;
  },
  
  // Redirect if already authenticated
  redirectIfAuthenticated(targetUrl = null) {
    // If authenticated, redirect to target or home
    if (this.isAuthenticated()) {
      const redirectUrl = targetUrl || this.config.homePath;
      console.log(`Already authenticated. Redirecting to: ${redirectUrl}`);
      window.location.href = redirectUrl;
      return true;
    }
    
    return false;
  },
  
  // Get headers for authenticated requests
  getAuthHeaders() {
    const headers = {
      'Accept': 'application/json'
    };
    
    // Add Authorization header if token exists
    const token = this.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    
    // Add CSRF token if available
    const csrfToken = this._getCsrfToken();
    if (csrfToken) {
      headers['X-CSRF-Token'] = csrfToken;
    }
    
    return headers;
  },
  
  // Create a wrapper around the fetch API that adds auth headers
  _createFetchWrapper() {
    const self = this;
    
    // Store and return a permanent reference to the wrapper function
    if (this._fetchWrapper) {
      return this._fetchWrapper;
    }
    
    // Create the wrapper function
    this._fetchWrapper = function wrappedFetch(url, options = {}) {
      // Skip wrapping for requests to the original fetch
      if (options && options._unwrapped) {
        delete options._unwrapped;
        return self._originalFetch(url, options);
      }
      
      // Default options
      const defaultOptions = {
        credentials: 'include' // Always include cookies
      };
      
      // Merge options
      const mergedOptions = { ...defaultOptions, ...options };
      
      // Skip auth headers for auth-related endpoints
      const skipAuthHeader = (
        url.includes(self.config.loginEndpoint) ||
        url.includes(self.config.registerEndpoint) ||
        url.includes('/api/auth/verify') ||
        url.includes('/api/auth/refresh')
      );
      
      // For all other endpoints, add auth headers if available
      if (!skipAuthHeader) {
        // Initialize headers if not present
        if (!mergedOptions.headers) {
          mergedOptions.headers = {};
        }
        
        // If headers is an object (not Headers instance)
        if (!(mergedOptions.headers instanceof Headers)) {
          const token = self.getToken();
          
          // Add Authorization header if token exists
          if (token) {
            mergedOptions.headers['Authorization'] = `Bearer ${token}`;
          }
          
          // Add CSRF token
          const csrfToken = self._getCsrfToken();
          if (csrfToken) {
            mergedOptions.headers['X-CSRF-Token'] = csrfToken;
          }
        }
      }
      
      // Make the request with original fetch
      return self._originalFetch(url, mergedOptions)
        .then(response => {
          // Handle 401 Unauthorized or 403 Forbidden
          if (response.status === 401 || response.status === 403) {
            // Don't handle auth errors for auth endpoints to avoid loops
            if (
              !url.includes(self.config.authEndpoint) && 
              !url.includes('/auth/') &&
              !self._warnedEndpoints.has(url)
            ) {
              console.warn(`Authentication failed for ${url}. Status: ${response.status}`);
              self._warnedEndpoints.add(url); // Add to warned set
              
              // Use unwrapped fetch for session check to avoid loops
              const checkOptions = {
                method: 'GET',
                credentials: 'include',
                _unwrapped: true // Mark to skip wrapping
              };
              
              // Check session status
              self._originalFetch(self.config.sessionCheckEndpoint, checkOptions)
                .then(resp => resp.json())
                .then(sessionStatus => {
                  if (sessionStatus.token_status !== 'valid') {
                    console.log('Token invalid, clearing authentication');
                    self.clearAuth();
                  }
                })
                .catch(error => {
                  console.error('Error checking session status:', error);
                });
            }
          }
          
          return response;
        })
        .catch(error => {
          console.error(`Fetch error for ${url}:`, error);
          throw error;
        });
    };
    
    return this._fetchWrapper;
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
    
    // Use original fetch to avoid recursion
    return this._originalFetch(url, options);
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

// Initialize on load only if we're in a browser
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  // Initialize only once when DOM is loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (window.AuthHelper) {
        window.AuthHelper.init();
        console.log('AuthHelper initialized');
      }
    });
  } else {
    // DOM already loaded, initialize immediately
    if (window.AuthHelper && !window.AuthHelper.initialized) {
      window.AuthHelper.init();
      window.AuthHelper.initialized = true;
      console.log('AuthHelper initialized');
    }
  }
}

// Export for module use
if (typeof exports !== 'undefined') {
  exports.AuthHelper = window.AuthHelper;
}