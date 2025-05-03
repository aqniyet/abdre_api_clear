/**
 * Socket.IO Client for ABDRE Chat Application
 * Handles all real-time communication with the backend
 */

class SocketClient {
  constructor() {
    this.socket = null;
    this.connected = false;
    this.handlers = {
      'message': [],
      'join': [],
      'user_active': [],
      'user_away': [],
      'check_status': [],
      'request_unread_count': []
    };
  }

  /**
   * Initialize the socket connection
   * @returns {Promise} - Promise that resolves when the connection is established
   */
  init() {
    return new Promise((resolve, reject) => {
      try {
        const accessToken = AuthHelper.getToken();
        
        if (!accessToken) {
          reject(new Error('No access token found'));
          return;
        }

        // Initialize socket.io connection through the API Gateway
        this.socket = io(window.location.origin, {
          path: '/api/realtime/socket.io',
          auth: {
            token: accessToken
          },
          transports: ['websocket', 'polling']
        });

        // Set up event listeners
        this.socket.on('connect', () => {
          console.log('Socket connected');
          this.connected = true;
          resolve(this.socket);
        });

        this.socket.on('disconnect', () => {
          console.log('Socket disconnected');
          this.connected = false;
        });

        this.socket.on('connect_error', async (error) => {
          console.error('Socket connection error:', error);
          
          // Try to refresh token if connection error
          if (error.message === 'Authentication failed' || error.message === 'jwt expired') {
            try {
              await AuthHelper.refreshToken();
              // Try to reconnect with new token
              if (this.socket) {
                this.socket.auth.token = AuthHelper.getToken();
                this.socket.connect();
              }
            } catch (refreshError) {
              console.error('Token refresh failed:', refreshError);
              reject(error);
            }
          } else {
            reject(error);
          }
        });

        // Set up event handlers for incoming messages
        this.socket.on('message', (data) => this._triggerEvent('message', data));
        this.socket.on('join', (data) => this._triggerEvent('join', data));
        this.socket.on('user_active', (data) => this._triggerEvent('user_active', data));
        this.socket.on('user_away', (data) => this._triggerEvent('user_away', data));
        this.socket.on('check_status', (data) => this._triggerEvent('check_status', data));
        this.socket.on('request_unread_count', (data) => this._triggerEvent('request_unread_count', data));
        this.socket.on('pong', (data) => {
          console.log('Pong received:', data);
          const roundTripTime = new Date() - new Date(data.received_ping);
          console.log(`Ping round-trip time: ${roundTripTime}ms`);
        });
      } catch (error) {
        console.error('Socket initialization error:', error);
        reject(error);
      }
    });
  }

  /**
   * Trigger event handlers for a specific event
   * @param {string} event - Event name
   * @param {Object} data - Event data
   * @private
   */
  _triggerEvent(event, data) {
    if (this.handlers[event]) {
      this.handlers[event].forEach(handler => handler(data));
    }
  }

  /**
   * Register an event handler
   * @param {string} event - Event name
   * @param {Function} callback - Event handler function
   * @returns {Function} - Function to remove the event handler
   */
  on(event, callback) {
    if (!this.handlers[event]) {
      this.handlers[event] = [];
    }
    
    this.handlers[event].push(callback);
    
    // Return a function to remove this handler
    return () => {
      this.handlers[event] = this.handlers[event].filter(handler => handler !== callback);
    };
  }

  /**
   * Join a chat room
   * @param {Object} data - Room join data
   */
  joinRoom(data) {
    if (!this.connected) {
      console.error('Socket not connected');
      return;
    }
    
    this.socket.emit('join', {
      room_id: data.room_id,
      visitor_id: data.visitor_id || localStorage.getItem('user_id'),
      visitor_name: data.visitor_name
    });
  }

  /**
   * Send a message to a chat room
   * @param {Object} data - Message data
   */
  sendMessage(data) {
    if (!this.connected) {
      console.error('Socket not connected');
      return;
    }
    
    this.socket.emit('message', {
      room_id: data.room_id,
      message: data.message,
      message_id: data.message_id
    });
  }

  /**
   * Set user as active in a chat room
   * @param {Object} data - User active data
   */
  setUserActive(data) {
    if (!this.connected) {
      console.error('Socket not connected');
      return;
    }
    
    this.socket.emit('user_active', {
      room_id: data.room_id,
      visitor_id: data.visitor_id || localStorage.getItem('user_id')
    });
  }

  /**
   * Set user as away in a chat room
   * @param {Object} data - User away data
   */
  setUserAway(data) {
    if (!this.connected) {
      console.error('Socket not connected');
      return;
    }
    
    this.socket.emit('user_away', {
      room_id: data.room_id,
      visitor_id: data.visitor_id || localStorage.getItem('user_id')
    });
  }

  /**
   * Check status of users in a chat room
   * @param {Object} data - Check status data
   */
  checkStatus(data) {
    if (!this.connected) {
      console.error('Socket not connected');
      return;
    }
    
    this.socket.emit('check_status', {
      room_id: data.room_id
    });
  }

  /**
   * Request unread message count for a user in a chat room
   * @param {Object} data - Request unread count data
   */
  requestUnreadCount(data) {
    if (!this.connected) {
      console.error('Socket not connected');
      return;
    }
    
    this.socket.emit('request_unread_count', {
      room_id: data.room_id,
      visitor_id: data.visitor_id || localStorage.getItem('user_id')
    });
  }

  /**
   * Disconnect the socket
   */
  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.connected = false;
    }
  }

  /**
   * Test the socket connection by sending a ping
   * @returns {boolean} - Whether the socket is connected
   */
  testConnection() {
    if (!this.connected) {
      console.error('Socket not connected');
      return false;
    }
    
    console.log('Socket connection test - currently connected:', this.connected);
    console.log('Socket ID:', this.socket.id);
    
    // Send a ping to test bidirectional communication
    this.socket.emit('ping', { timestamp: new Date().toISOString() });
    
    return true;
  }
}

// Create and export a singleton instance
const socketClient = new SocketClient(); 