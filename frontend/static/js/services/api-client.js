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
   * Make a GET request
   * @param {string} endpoint - API endpoint
   * @returns {Promise} - Promise with the response data
   */
  async get(endpoint) {
    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        method: 'GET',
        headers: this.headers,
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
        headers: this.headers,
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
        headers: this.headers,
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
        headers: this.headers,
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
    if (response.access_token) {
      localStorage.setItem('access_token', response.access_token);
      localStorage.setItem('user_id', response.user_id);
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

  async getChatMessages(chatId) {
    return this.get(`/api/chats/${chatId}/messages`);
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