/**
 * Socket.IO Client for ABDRE Chat Application
 * Handles all real-time communication with the backend
 */

class SocketClient {
  constructor() {
    this.socket = null;
    this.connected = false;
    this.lastConnectionAttempt = 0;
    this.reconnectAttempts = 0;
    this.handlers = {
      'message': [],
      'join': [],
      'user_active': [],
      'user_away': [],
      'check_status': [],
      'request_unread_count': []
    };
    
    // Keep track of rooms to join/rejoin
    this._roomsToJoin = new Set();
    
    // Set up auto-reconnect
    this._setupAutoReconnect();
  }

  /**
   * Set up automatic reconnection checks
   * @private
   */
  _setupAutoReconnect() {
    // Check connection status every 10 seconds
    setInterval(() => {
      if (!this.connected && this.socket) {
        console.log('Socket reconnection check - not connected, attempting to reconnect...');
        
        // Only try to reconnect if sufficient time has passed since the last attempt
        // Use exponential backoff to avoid overwhelming the server
        const backoffTime = Math.min(30000, Math.pow(2, this.reconnectAttempts) * 1000);
        const now = Date.now();
        
        if (now - this.lastConnectionAttempt > backoffTime) {
          console.log(`Reconnection attempt #${this.reconnectAttempts + 1} after ${backoffTime}ms backoff`);
          this.lastConnectionAttempt = now;
          this.socket.connect();
          this.reconnectAttempts++; // Increment for next backoff calculation
        } else {
          const remainingTime = backoffTime - (now - this.lastConnectionAttempt);
          console.log(`Waiting ${Math.round(remainingTime/1000)}s before next reconnection attempt`);
        }
      } else if (this.connected && this.socket) {
        // Reset reconnect attempts counter when connected
        this.reconnectAttempts = 0;
        
        // Test connection with a ping
        this.testConnection();
      }
    }, 10000);
  }

  /**
   * Initialize the socket connection
   * @returns {Promise} - Promise that resolves when the connection is established
   */
  init() {
    return new Promise((resolve, reject) => {
      try {
        const accessToken = AuthHelper.getToken();
        console.log('SocketClient: Initializing with token available:', !!accessToken);
        
        if (!accessToken) {
          console.warn('No access token found for socket connection, will connect as guest');
        }

        // Use API Gateway as a proxy to the realtime service instead of connecting directly
        // This allows proper routing, authentication, and security
        
        // We'll use a relative URL rather than hardcoded port to work across environments
        const socketUrl = window.location.origin;
        const socketPath = '/api/realtime/socket.io';
        
        console.log(`SocketClient: Connecting to socket URL: ${socketUrl} with path: ${socketPath}`);
        
        // Configure Socket.IO with proper settings
        this.socket = io(socketUrl, {
          path: socketPath,
          auth: {
            token: accessToken || 'guest'
          },
          transports: ['websocket', 'polling'], // Try WebSocket first, fall back to polling
          reconnection: true,
          reconnectionAttempts: Infinity,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 10000, // Cap at 10 seconds
          timeout: 20000, // Increase timeout for slower connections
          withCredentials: true, // Important for CORS with credentials
          autoConnect: true,
          forceNew: true, // Ensure a clean connection each time
          query: {
            token: accessToken || 'guest' // Also include token in query params as backup
          },
          extraHeaders: accessToken ? {
            Authorization: `Bearer ${accessToken}`
          } : {}
        });

        this.lastConnectionAttempt = Date.now();
        this.reconnectAttempts = 0;

        // Set up event listeners
        this.socket.on('connect', () => {
          console.log('SocketClient: Connected successfully with ID:', this.socket.id);
          this.connected = true;
          this.reconnectAttempts = 0; // Reset counter on successful connection
          
          // Re-join all rooms after reconnection
          this._rejoinRoomsAfterReconnect();
          
          resolve(this.socket);
        });

        this.socket.on('disconnect', (reason) => {
          console.log('SocketClient: Disconnected from server. Reason:', reason);
          this.connected = false;
          
          // If the disconnection wasn't intentional, attempt to reconnect
          if (reason === 'io server disconnect' || reason === 'transport close' || reason === 'transport error') {
            console.log('SocketClient: Attempting to reconnect after disconnect...');
            this.socket.connect();
          }
        });

        this.socket.on('reconnect', (attemptNumber) => {
          console.log(`SocketClient: Reconnected after ${attemptNumber} attempts`);
          this.connected = true;
          this.reconnectAttempts = 0; // Reset counter on successful reconnection
          
          // Re-join rooms after reconnection
          this._rejoinRoomsAfterReconnect();
        });

        this.socket.on('reconnect_attempt', (attemptNumber) => {
          console.log(`SocketClient: Reconnection attempt #${attemptNumber}`);
          this.lastConnectionAttempt = Date.now();
          
          // Update auth token on reconnect attempt in case it was refreshed
          const currentToken = AuthHelper.getToken();
          if (currentToken && this.socket) {
            console.log('SocketClient: Updating auth token for reconnection attempt');
            this.socket.auth.token = currentToken;
            if (this.socket.io && this.socket.io.opts) {
              this.socket.io.opts.query = {
                ...this.socket.io.opts.query,
                token: currentToken
              };
              if (this.socket.io.opts.extraHeaders) {
                this.socket.io.opts.extraHeaders.Authorization = `Bearer ${currentToken}`;
              }
            }
          }
        });

        this.socket.on('reconnect_error', (error) => {
          console.error('SocketClient: Error during reconnection:', error);
          this.reconnectAttempts++; // Increment for exponential backoff
        });

        this.socket.on('connect_error', async (error) => {
          console.error('SocketClient: Connection error:', error.message);
          
          // Try to refresh token if connection error is authentication related
          if (error.message === 'Authentication failed' || 
              error.message === 'jwt expired' || 
              error.message.includes('auth') || 
              error.message.includes('token')) {
            
            console.log('SocketClient: Authentication error, attempting to refresh token');
            try {
              await AuthHelper.refreshToken();
              const newToken = AuthHelper.getToken();
              
              // Try to reconnect with new token
              if (this.socket && newToken) {
                console.log('SocketClient: Token refreshed, reconnecting with new token');
                this.socket.auth.token = newToken;
                if (this.socket.io && this.socket.io.opts) {
                  this.socket.io.opts.query = {
                    ...this.socket.io.opts.query,
                    token: newToken
                  };
                  if (this.socket.io.opts.extraHeaders) {
                    this.socket.io.opts.extraHeaders.Authorization = `Bearer ${newToken}`;
                  }
                }
                this.socket.connect();
              }
            } catch (refreshError) {
              console.error('SocketClient: Token refresh failed:', refreshError);
              
              // If token refresh fails, try to connect as guest
              console.log('SocketClient: Connecting as guest after auth failure');
              if (this.socket) {
                this.socket.auth.token = 'guest';
                if (this.socket.io && this.socket.io.opts) {
                  this.socket.io.opts.query = {
                    ...this.socket.io.opts.query,
                    token: 'guest'
                  };
                  if (this.socket.io.opts.extraHeaders) {
                    delete this.socket.io.opts.extraHeaders.Authorization;
                  }
                }
                this.socket.connect();
              } else {
                reject(error);
              }
            }
          } else {
            // For non-auth errors, increment reconnect attempts counter for backoff
            this.reconnectAttempts++;
            
            // If it's the first error, still resolve the promise as we're handling reconnections
            // This prevents the app from getting stuck on initialization
            if (this.reconnectAttempts === 1) {
              console.warn('SocketClient: Resolving init promise despite connection error, will reconnect in background');
              resolve(this.socket);
            }
          }
        });

        // Set up event handlers for incoming messages
        this.socket.on('message', (data) => {
          console.log('SOCKET RECEIVED MESSAGE EVENT:', data);
          this._triggerEvent('message', data);
        });
        this.socket.on('join', (data) => this._triggerEvent('join', data));
        this.socket.on('user_active', (data) => this._triggerEvent('user_active', data));
        this.socket.on('user_away', (data) => this._triggerEvent('user_away', data));
        this.socket.on('check_status', (data) => this._triggerEvent('check_status', data));
        this.socket.on('request_unread_count', (data) => this._triggerEvent('request_unread_count', data));
        
        // Handle errors from socket.io
        this.socket.on('error', (error) => {
          console.error('SocketClient: Socket error:', error);
        });
        
        // Keep track of ping timestamps
        this.pingTimestamps = {};
        
        this.socket.on('pong', (data) => {
          console.log('Pong received:', data);
          
          const pingId = data.received_ping;
          if (this.pingTimestamps[pingId]) {
            const sentTime = this.pingTimestamps[pingId];
            const roundTripTime = new Date().getTime() - sentTime;
            console.log(`Ping round-trip time: ${roundTripTime}ms`);
            
            // Clean up stored timestamp
            delete this.pingTimestamps[pingId];
            
            // If ping time is very high, this might indicate connection issues
            if (roundTripTime > 5000) {
              console.warn(`SocketClient: High ping time (${roundTripTime}ms) may indicate connection issues`);
            }
          } else {
            console.warn('Received pong for unknown ping timestamp:', pingId);
          }
        });
      } catch (error) {
        console.error('Socket initialization error:', error);
        this.reconnectAttempts++;
        reject(error);
      }
    });
  }

  /**
   * Re-join all rooms after a reconnection
   * @private
   */
  _rejoinRoomsAfterReconnect() {
    // Get current room from state manager
    const roomId = stateManager.get('roomId');
    const userId = stateManager.get('userId');
    
    // Rejoin rooms that we've previously joined
    if (this._roomsToJoin && this._roomsToJoin.size > 0) {
      console.log(`SocketClient: Rejoining ${this._roomsToJoin.size} rooms after reconnection`);
      
      this._roomsToJoin.forEach(room => {
        console.log(`SocketClient: Rejoining room ${room}`);
        
        // Join the room
        this.socket.emit('join', {
          room_id: room,
          visitor_id: userId || localStorage.getItem('user_id')
        });
        
        // Also subscribe to direct room events
        this.socket.emit('subscribe', { room: room });
        
        // Set user as active
        this.setUserActive({
          room_id: room,
          visitor_id: userId || localStorage.getItem('user_id')
        });
      });
    } else if (roomId) {
      console.log(`SocketClient: Rejoining room ${roomId} after reconnection`);
      
      // Join the room
      this.joinRoom({
        room_id: roomId,
        visitor_id: userId
      });
      
      // Set user as active
      this.setUserActive({
        room_id: roomId,
        visitor_id: userId
      });
    }
    
    // Trigger refresh event to get any missed messages
    setTimeout(() => {
      console.log('Triggering message refresh after reconnection');
      document.dispatchEvent(new CustomEvent('refresh-messages'));
    }, 1000);
  }

  /**
   * Trigger event handlers for a specific event
   * @param {string} event - Event name
   * @param {Object} data - Event data
   * @private
   */
  _triggerEvent(event, data) {
    console.log(`Socket received event "${event}"`, data);
    
    // Skip triggering if invalid data
    if (!data) {
      console.error(`Invalid data for event "${event}"`);
      return;
    }
    
    // For message events, make sure we trigger a refresh if the handlers array is empty
    if (event === 'message' && (!this.handlers[event] || this.handlers[event].length === 0)) {
      console.warn(`No handlers registered for message event - triggering refresh`);
      document.dispatchEvent(new CustomEvent('refresh-messages'));
      return;
    }
    
    if (this.handlers[event]) {
      console.log(`Triggering ${this.handlers[event].length} handlers for event "${event}"`);
      this.handlers[event].forEach(handler => {
        try {
          handler(data);
        } catch (error) {
          console.error(`Error in handler for event "${event}":`, error);
          
          // If we get an error handling a message, trigger a refresh
          if (event === 'message') {
            document.dispatchEvent(new CustomEvent('refresh-messages'));
          }
        }
      });
    } else {
      console.warn(`No handlers registered for event "${event}"`);
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
    // Store this room ID for future reconnections
    if (data.room_id) {
      this._roomsToJoin.add(data.room_id);
    }
    
    if (!this.connected) {
      console.error('Socket not connected when trying to join room');
      
      // Try reconnecting
      if (this.socket) {
        this.socket.connect();
      }
      
      // Queue up the join request to retry in 2 seconds
      setTimeout(() => {
        console.log('Retrying room join after delay:', data.room_id);
        this.joinRoom(data);
      }, 2000);
      
      return;
    }
    
    console.log('Joining room:', data.room_id, 'as user:', data.visitor_id || localStorage.getItem('user_id'));
    
    try {
      this.socket.emit('join', {
        room_id: data.room_id,
        visitor_id: data.visitor_id || localStorage.getItem('user_id'),
        visitor_name: data.visitor_name
      });
      
      // Also subscribe to direct room events using Socket.IO room functionality
      this.socket.emit('subscribe', { room: data.room_id });
    } catch (error) {
      console.error('Error joining room:', error);
      
      // Try again after a delay if socket was connected but emit failed
      if (this.connected) {
        setTimeout(() => {
          console.log('Retrying room join after error:', data.room_id);
          this.joinRoom(data);
        }, 2000);
      }
    }
  }

  /**
   * Send a message to a chat room
   * @param {Object} data - Message data
   * @returns {boolean} - Whether the message was sent successfully
   */
  sendMessage(data) {
    if (!this.connected) {
      console.error('Socket not connected, cannot send message');
      return false;
    }
    
    console.log('SocketClient: Sending message to server:', data);
    
    try {
      this.socket.emit('message', {
        room_id: data.room_id,
        message: data.message,
        message_id: data.message_id
      });
      
      console.log('SocketClient: Message sent to server');
      return true;
    } catch (error) {
      console.error('SocketClient: Error sending message:', error);
      return false;
    }
  }

  /**
   * Set user as active in a chat room
   * @param {Object} data - User active data
   */
  setUserActive(data) {
    if (!this.connected) {
      console.error('Socket not connected, cannot set user active');
      return;
    }
    
    try {
      this.socket.emit('user_active', {
        room_id: data.room_id,
        visitor_id: data.visitor_id || localStorage.getItem('user_id')
      });
    } catch (error) {
      console.error('Error setting user active:', error);
    }
  }

  /**
   * Set user as away in a chat room
   * @param {Object} data - User away data
   */
  setUserAway(data) {
    if (!this.connected) {
      console.error('Socket not connected, cannot set user away');
      return;
    }
    
    try {
      this.socket.emit('user_away', {
        room_id: data.room_id,
        visitor_id: data.visitor_id || localStorage.getItem('user_id')
      });
    } catch (error) {
      console.error('Error setting user away:', error);
    }
  }

  /**
   * Check status of users in a chat room
   * @param {Object} data - Check status data
   */
  checkStatus(data) {
    if (!this.connected) {
      console.error('Socket not connected, cannot check status');
      return;
    }
    
    try {
      this.socket.emit('check_status', {
        room_id: data.room_id
      });
    } catch (error) {
      console.error('Error checking status:', error);
    }
  }

  /**
   * Request unread message count for a user in a chat room
   * @param {Object} data - Request unread count data
   */
  requestUnreadCount(data) {
    if (!this.connected) {
      console.error('Socket not connected, cannot request unread count');
      return;
    }
    
    try {
      this.socket.emit('request_unread_count', {
        room_id: data.room_id,
        visitor_id: data.visitor_id || localStorage.getItem('user_id')
      });
    } catch (error) {
      console.error('Error requesting unread count:', error);
    }
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
    
    // Generate a unique ID for this ping
    const pingId = new Date().toISOString();
    
    // Store the current time in milliseconds
    this.pingTimestamps[pingId] = new Date().getTime();
    
    // Send a ping to test bidirectional communication
    try {
      this.socket.emit('ping', {
        timestamp: pingId
      });
      return true;
    } catch (error) {
      console.error('Error sending ping:', error);
      this.connected = false; // Mark as disconnected if ping fails
      return false;
    }
  }
}

// Create and export a singleton instance
const socketClient = new SocketClient(); 