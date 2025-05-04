/**
 * API Client for ABDRE Chat Application
 * Handles all HTTP requests to the backend services
 */

class ApiClient {
  constructor() {
    this.baseUrl = window.location.origin;
    this.headers = {
      'Content-Type': 'application/json',
    };
    this.setupAuthHeaders();
  }

  /**
   * Set up authentication headers based on saved tokens
   */
  setupAuthHeaders() {
    const accessToken = localStorage.getItem('access_token');
    if (accessToken) {
      this.headers['Authorization'] = `Bearer ${accessToken}`;
    }
  }

  /**
   * Ensure auth headers are up to date before each request
   */
  ensureAuthHeaders() {
    // Re-fetch the token in case it was refreshed
    const accessToken = localStorage.getItem('access_token');
    if (accessToken) {
      this.headers['Authorization'] = `Bearer ${accessToken}`;
    } else {
      delete this.headers['Authorization'];
    }
    return this.headers;
  }

  /**
   * Make a GET request
   * @param {string} endpoint - API endpoint
   * @returns {Promise} - Promise with the response data
   */
  async get(endpoint) {
    try {
      // For GET requests, don't include Content-Type header to avoid issues with empty bodies
      const headers = {};
      const token = localStorage.getItem('access_token');
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        method: 'GET',
        headers: headers,
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('API GET error:', error);
      throw error;
    }
  }

  /**
   * Make a POST request
   * @param {string} endpoint - API endpoint
   * @param {Object} data - Request payload
   * @returns {Promise} - Promise with the response data
   */
  async post(endpoint, data) {
    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        method: 'POST',
        headers: this.ensureAuthHeaders(),
        body: JSON.stringify(data),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('API POST error:', error);
      throw error;
    }
  }

  /**
   * Make a PUT request
   * @param {string} endpoint - API endpoint
   * @param {Object} data - Request payload
   * @returns {Promise} - Promise with the response data
   */
  async put(endpoint, data) {
    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        method: 'PUT',
        headers: this.ensureAuthHeaders(),
        body: JSON.stringify(data),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('API PUT error:', error);
      throw error;
    }
  }

  /**
   * Make a DELETE request
   * @param {string} endpoint - API endpoint
   * @returns {Promise} - Promise with the response data
   */
  async delete(endpoint) {
    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        method: 'DELETE',
        headers: this.ensureAuthHeaders(),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('API DELETE error:', error);
      throw error;
    }
  }

  // Auth API endpoints
  async register(userData) {
    return this.post('/api/auth/register', userData);
  }

  async login(credentials) {
    const response = await this.post('/api/auth/login', credentials);
    if (response.access_token || response.token) {
      // Use AuthHelper to save auth data consistently
      AuthHelper.saveAuth(response);
      this.setupAuthHeaders();
    }
    return response;
  }

  async setName(name) {
    return this.post('/api/auth/set-name', { name });
  }

  // Chat API endpoints
  async getChats() {
    return this.get('/api/chats');
  }

  async getChat(chatId) {
    return this.get(`/api/chats/${chatId}`);
  }

  async createChat(chatData) {
    return this.post('/api/chats', chatData);
  }

  /**
   * Get chat messages for a specific chat
   * @param {string} chatId - Chat ID
   * @returns {Promise} - Promise with the response data
   */
  async getChatMessages(chatId) {
    try {
      // For GET requests with no body, don't set Content-Type header
      const headers = {};
      
      const token = localStorage.getItem('access_token');
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      
      console.log('Using headers for getChatMessages:', headers);
      
      const response = await fetch(`${this.baseUrl}/api/chats/${chatId}/messages`, {
        method: 'GET',
        headers: headers
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('API getChatMessages error:', error);
      throw error;
    }
  }

  async setUserAway(userData) {
    return this.post('/api/user-away', userData);
  }

  async setUserAwayMultiple(userDataArray) {
    return this.post('/api/user-away-multiple', userDataArray);
  }
}

// Create and export a singleton instance
const apiClient = new ApiClient(); 