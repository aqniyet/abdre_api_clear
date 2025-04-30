/**
 * Abdre Socket Client
 * Client-side WebSocket handler for real-time features
 */

class AbdreSocketClient {
  constructor() {
    this.socket = null;
    this.connected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectInterval = 2000; // Start with 2 seconds
    this.messageQueue = [];
    this.eventListeners = {
      'connect': [],
      'disconnect': [],
      'message': [],
      'error': [],
      'chat_message': [],
      'user_status': [],
      'typing': []
    };
    
    // Connection state
    this.currentRoomId = null;
  }
  
  /**
   * Initialize the socket connection
   */
  initialize() {
    if (!window.api || !window.api.isAuthenticated()) {
      console.error('Cannot initialize socket: User not authenticated');
      return false;
    }
    
    this.connect();
    return true;
  }
  
  /**
   * Connect to the WebSocket server
   */
  connect() {
    if (this.socket) {
      this.socket.close();
    }
    
    try {
      const token = window.api.getToken();
      if (!token) {
        console.error('Cannot connect: No authentication token');
        return false;
      }
      
      // Get WebSocket URL from API client
      const wsUrl = window.api.realtime.getWebSocketUrl();
      this.socket = new WebSocket(`${wsUrl}?token=${token}`);
      
      // Set up event handlers
      this.socket.onopen = this.handleOpen.bind(this);
      this.socket.onclose = this.handleClose.bind(this);
      this.socket.onmessage = this.handleMessage.bind(this);
      this.socket.onerror = this.handleError.bind(this);
      
      return true;
    } catch (error) {
      console.error('WebSocket connection error:', error);
      this.triggerEvent('error', { message: 'Failed to connect to WebSocket server' });
      return false;
    }
  }
  
  /**
   * Reconnect to the WebSocket server
   */
  reconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      this.triggerEvent('error', { message: 'Failed to reconnect after multiple attempts' });
      return;
    }
    
    this.reconnectAttempts++;
    const delay = this.reconnectInterval * Math.pow(1.5, this.reconnectAttempts - 1); // Exponential backoff
    
    console.log(`Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);
    
    setTimeout(() => {
      if (this.connect()) {
        console.log('Reconnection successful');
        this.triggerEvent('connect', { reconnected: true, attempts: this.reconnectAttempts });
      }
    }, delay);
  }
  
  /**
   * Disconnect from the WebSocket server
   */
  disconnect() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    
    this.connected = false;
    this.currentRoomId = null;
  }
  
  /**
   * Send a message to the WebSocket server
   */
  send(type, data = {}) {
    if (!this.connected) {
      // Queue message for later if not connected
      this.messageQueue.push({ type, data });
      console.log('Socket not connected. Message queued:', type);
      return false;
    }
    
    try {
      const message = JSON.stringify({
        type,
        data,
        timestamp: new Date().toISOString()
      });
      
      this.socket.send(message);
      return true;
    } catch (error) {
      console.error('Failed to send message:', error);
      return false;
    }
  }
  
  /**
   * Join a chat room
   */
  joinRoom(roomId) {
    this.currentRoomId = roomId;
    return this.send('join_room', { room_id: roomId });
  }
  
  /**
   * Leave the current chat room
   */
  leaveRoom() {
    if (!this.currentRoomId) return true;
    
    const result = this.send('leave_room', { room_id: this.currentRoomId });
    if (result) {
      this.currentRoomId = null;
    }
    
    return result;
  }
  
  /**
   * Send a chat message
   */
  sendChatMessage(content, roomId = null) {
    const targetRoom = roomId || this.currentRoomId;
    if (!targetRoom) {
      console.error('Cannot send message: No room joined');
      return false;
    }
    
    return this.send('chat_message', {
      room_id: targetRoom,
      content,
      sender_id: window.api.user?.id
    });
  }
  
  /**
   * Send typing indicator
   */
  sendTypingIndicator(isTyping, roomId = null) {
    const targetRoom = roomId || this.currentRoomId;
    if (!targetRoom) return false;
    
    return this.send('typing', {
      room_id: targetRoom,
      is_typing: isTyping
    });
  }
  
  /**
   * Add event listener
   */
  on(event, callback) {
    if (this.eventListeners.hasOwnProperty(event)) {
      this.eventListeners[event].push(callback);
      return true;
    }
    return false;
  }
  
  /**
   * Remove event listener
   */
  off(event, callback) {
    if (this.eventListeners.hasOwnProperty(event)) {
      this.eventListeners[event] = this.eventListeners[event].filter(cb => cb !== callback);
      return true;
    }
    return false;
  }
  
  /**
   * Trigger event callbacks
   */
  triggerEvent(event, data) {
    if (this.eventListeners.hasOwnProperty(event)) {
      this.eventListeners[event].forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`Error in ${event} event handler:`, error);
        }
      });
    }
  }
  
  /**
   * Handle WebSocket open event
   */
  handleOpen(event) {
    console.log('WebSocket connection established');
    this.connected = true;
    this.reconnectAttempts = 0;
    
    // Send any queued messages
    while (this.messageQueue.length > 0) {
      const { type, data } = this.messageQueue.shift();
      this.send(type, data);
    }
    
    // Rejoin room if previously connected
    if (this.currentRoomId) {
      this.joinRoom(this.currentRoomId);
    }
    
    this.triggerEvent('connect', { reconnected: this.reconnectAttempts > 0 });
  }
  
  /**
   * Handle WebSocket close event
   */
  handleClose(event) {
    const wasConnected = this.connected;
    this.connected = false;
    
    console.log(`WebSocket connection closed: ${event.code} - ${event.reason}`);
    
    // Only trigger disconnect event if we were previously connected
    if (wasConnected) {
      this.triggerEvent('disconnect', { 
        code: event.code, 
        reason: event.reason,
        clean: event.wasClean
      });
    }
    
    // Attempt to reconnect if the connection was established and then lost
    if (wasConnected && event.code !== 1000) { // 1000 is normal closure
      this.reconnect();
    }
  }
  
  /**
   * Handle WebSocket message event
   */
  handleMessage(event) {
    try {
      const message = JSON.parse(event.data);
      
      // Handle ping/pong for keeping connection alive
      if (message.type === 'ping') {
        this.send('pong');
        return;
      }
      
      // Trigger general message event
      this.triggerEvent('message', message);
      
      // Trigger specific event type if it exists
      if (this.eventListeners.hasOwnProperty(message.type)) {
        this.triggerEvent(message.type, message.data);
      }
    } catch (error) {
      console.error('Error handling message:', error);
    }
  }
  
  /**
   * Handle WebSocket error event
   */
  handleError(event) {
    console.error('WebSocket error:', event);
    this.triggerEvent('error', { message: 'WebSocket error occurred' });
  }
}

// Create and export global instance
const socketClient = new AbdreSocketClient();
window.socketClient = socketClient; // Make available globally 