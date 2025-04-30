/**
 * Authentication helper utilities for ABDRE Chat Application
 */

const AuthHelper = {
  /**
   * Check if the user is authenticated
   * @returns {boolean} - True if the user is authenticated
   */
  isAuthenticated() {
    return !!localStorage.getItem('access_token');
  },
  
  /**
   * Get the current user ID
   * @returns {string|null} - User ID or null if not authenticated
   */
  getUserId() {
    return localStorage.getItem('user_id');
  },
  
  /**
   * Get the access token
   * @returns {string|null} - Access token or null if not authenticated
   */
  getToken() {
    return localStorage.getItem('access_token');
  },
  
  /**
   * Save authentication data
   * @param {Object} data - Authentication data
   */
  saveAuth(data) {
    if (data.access_token) {
      localStorage.setItem('access_token', data.access_token);
    }
    
    if (data.user_id) {
      localStorage.setItem('user_id', data.user_id);
    }
    
    if (data.refresh_token) {
      localStorage.setItem('refresh_token', data.refresh_token);
    }
  },
  
  /**
   * Clear authentication data
   */
  clearAuth() {
    localStorage.removeItem('access_token');
    localStorage.removeItem('user_id');
    localStorage.removeItem('refresh_token');
  },
  
  /**
   * Redirect to login if not authenticated
   * @param {string} redirectUrl - URL to redirect to after login
   * @returns {boolean} - True if redirected, false if already authenticated
   */
  requireAuth(redirectUrl) {
    if (!this.isAuthenticated()) {
      const loginUrl = redirectUrl 
        ? `/login?next=${encodeURIComponent(redirectUrl)}`
        : '/login';
      
      window.location.href = loginUrl;
      return true;
    }
    
    return false;
  }
}; 