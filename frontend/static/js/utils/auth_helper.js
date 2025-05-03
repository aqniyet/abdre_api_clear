/**
 * Authentication helper utilities for ABDRE Chat Application
 */

console.log('Auth Helper (auth_helper.js) loaded successfully');

const AuthHelper = {
  /**
   * Check if the user is authenticated
   * @returns {boolean} - True if the user is authenticated
   */
  isAuthenticated() {
    console.log('AuthHelper.isAuthenticated called');
    return !!localStorage.getItem('access_token');
  },
  
  /**
   * Get the current user ID
   * @returns {string|null} - User ID or null if not authenticated
   */
  getUserId() {
    console.log('AuthHelper.getUserId called');
    return localStorage.getItem('user_id');
  },
  
  /**
   * Get the access token
   * @returns {string|null} - Access token or null if not authenticated
   */
  getToken() {
    console.log('AuthHelper.getToken called');
    return localStorage.getItem('access_token');
  },
  
  /**
   * Save authentication data
   * @param {Object} data - Authentication data
   */
  saveAuth(data) {
    console.log('AuthHelper.saveAuth called with data:', JSON.stringify(data));
    
    if (data.access_token || data.token) {
      localStorage.setItem('access_token', data.access_token || data.token);
    }
    
    if (data.user_id) {
      localStorage.setItem('user_id', data.user_id);
    } else if (data.user && data.user.username) {
      localStorage.setItem('user_id', data.user.username);
    }
    
    if (data.refresh_token) {
      localStorage.setItem('refresh_token', data.refresh_token);
    }
    
    if (data.user) {
      localStorage.setItem('user_role', data.user.role || 'user');
      if (data.user.email) {
        localStorage.setItem('user_email', data.user.email);
      }
      if (data.user.username) {
        localStorage.setItem('user_name', data.user.username);
      }
    }
  },
  
  /**
   * Clear authentication data
   */
  clearAuth() {
    console.log('AuthHelper.clearAuth called');
    localStorage.removeItem('access_token');
    localStorage.removeItem('user_id');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user_role');
    localStorage.removeItem('user_email');
    localStorage.removeItem('user_name');
  },
  
  /**
   * Refresh the access token using the refresh token
   * @returns {Promise} - Promise that resolves with the new tokens
   */
  async refreshToken() {
    console.log('AuthHelper.refreshToken called');
    const refreshToken = localStorage.getItem('refresh_token');
    
    if (!refreshToken) {
      throw new Error('No refresh token available');
    }
    
    try {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${refreshToken}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error('Failed to refresh token');
      }
      
      const data = await response.json();
      console.log('Token refresh successful, received:', JSON.stringify(data));
      
      // Save the new tokens
      if (data.token || data.access_token) {
        localStorage.setItem('access_token', data.access_token || data.token);
      }
      
      if (data.refresh_token) {
        localStorage.setItem('refresh_token', data.refresh_token);
      }
      
      return data;
    } catch (error) {
      console.error('Token refresh failed:', error);
      this.clearAuth();
      throw error;
    }
  },
  
  /**
   * Verify token validity
   * @returns {Promise<boolean>} - Promise that resolves to token validity
   */
  async verifyToken() {
    console.log('AuthHelper.verifyToken called');
    const token = this.getToken();
    
    if (!token) {
      return false;
    }
    
    try {
      const response = await fetch('/api/auth/verify', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (!response.ok) {
        // Try to refresh the token if verification fails
        try {
          await this.refreshToken();
          return true;
        } catch (refreshError) {
          return false;
        }
      }
      
      const data = await response.json();
      return data.valid === true;
    } catch (error) {
      console.error('Token verification failed:', error);
      return false;
    }
  },
  
  /**
   * Redirect to login if not authenticated
   * @param {string} redirectUrl - URL to redirect to after login
   * @returns {boolean} - True if redirected, false if already authenticated
   */
  requireAuth(redirectUrl) {
    console.log('AuthHelper.requireAuth called with redirectUrl:', redirectUrl);
    if (!this.isAuthenticated()) {
      const loginUrl = redirectUrl 
        ? `/login?next=${encodeURIComponent(redirectUrl)}`
        : '/login';
      
      window.location.href = loginUrl;
      return true;
    }
    
    // Also verify token validity asynchronously
    this.verifyToken().then(valid => {
      if (!valid) {
        const loginUrl = redirectUrl 
          ? `/login?next=${encodeURIComponent(redirectUrl)}`
          : '/login';
        
        window.location.href = loginUrl;
      }
    });
    
    return false;
  }
};

console.log('AuthHelper object initialized and available');

// Add a global error handler for unhandled errors
window.addEventListener('error', function(e) {
  console.error('Global error caught:', e.error);
}); 