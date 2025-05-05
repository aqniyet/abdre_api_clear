/**
 * Socket Client for ABDRE Realtime Service
 * Provides a unified interface for WebSocket communication with robust
 * connection management, event handling, and room subscriptions.
 */

const SocketClient = {
    // Configuration
    config: {
        url: '/api/realtime',
        directUrl: null, // Will be populated from API gateway response
        options: {
            path: '/socket.io',
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionAttempts: 5,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            timeout: 20000,
            autoConnect: false
        },
        // Time between heartbeat pings (ms)
        pingInterval: 30000,
        // Event types for standardization
        eventTypes: {
            // System events
            CONNECT: 'connect',
            DISCONNECT: 'disconnect',
            RECONNECT: 'reconnect',
            RECONNECT_ATTEMPT: 'reconnect_attempt',
            ERROR: 'error',
            PING: 'ping',
            PONG: 'pong',
            // Chat events
            MESSAGE: 'message',
            JOIN: 'join',
            LEAVE: 'leave',
            USER_ACTIVE: 'user_active',
            USER_AWAY: 'user_away',
            TYPING: 'typing',
            STOP_TYPING: 'stop_typing',
            MESSAGE_READ: 'message_read',
            // Invitation events
            INVITATION_CREATED: 'invitation_created',
            INVITATION_STATUS: 'invitation_status',
            QR_SCANNED: 'qr_scanned',
            QR_SCANNED_NOTIFICATION: 'qr_scanned_notification',
            INVITATION_ACCEPTED: 'invitation_accepted',
            ROOM_CREATED: 'room_created'
        }
    },
    
    // Internal state
    _socket: null,
    _connected: false,
    _heartbeatTimer: null,
    _reconnecting: false,
    _subscribedRooms: new Set(),
    _eventHandlers: new Map(),
    _queuedMessages: [],
    _connectionListeners: new Set(),
    _directConnectionUrl: null,
    
    /**
     * Initialize the socket client
     * 
     * @param {Object} options - Custom options for socket connection
     * @returns {SocketClient} - The initialized client for chaining
     */
    init(options = {}) {
        // Merge default options with custom options
        const socketOptions = {
            ...this.config.options,
            ...options
        };
        
        // Add authentication token if available
        const token = AuthHelper.getToken() || 'guest';
        socketOptions.query = { token };
        socketOptions.auth = { token };
        
        // Create socket instance
        try {
            // Use socket.io-client from CDN (already loaded in HTML)
            if (typeof io === 'undefined') {
                console.error('Socket.IO client not loaded. Make sure to include socket.io-client.js');
                return this;
            }
            
            // First check if we should connect through the API gateway
            // or directly to the realtime service
            this._checkConnectionMethod(socketOptions)
                .then(() => {
                    console.log('Socket connection method determined, connecting...');
                })
                .catch(error => {
                    console.error('Error determining connection method:', error);
                    // Fall back to standard connection
                    this._initializeSocketConnection(this.config.url, socketOptions);
                });
            
            return this;
        } catch (error) {
            console.error('Error initializing socket client:', error);
            return this;
        }
    },
    
    /**
     * Check if we should connect directly to the realtime service
     * or through the API gateway
     */
    async _checkConnectionMethod(socketOptions) {
        try {
            // Call the API gateway's WebSocket proxy endpoint
            const response = await fetch(`${this.config.url}/socket.io/?token=${socketOptions.query.token}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${socketOptions.query.token}`,
                    'Accept': 'application/json'
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                
                // Check if API gateway wants us to connect directly
                if (data.status === 'redirect' && data.connection_url) {
                    console.log('Using direct connection to realtime service:', data.connection_url);
                    this._directConnectionUrl = data.connection_url;
                    
                    // Update socket options with any additional query params
                    if (data.query_params) {
                        socketOptions.query = {
                            ...socketOptions.query,
                            ...data.query_params
                        };
                    }
                    
                    // Initialize with direct connection
                    this._initializeSocketConnection(data.connection_url, socketOptions);
                } else {
                    // Use the proxy through API gateway
                    console.log('Using API gateway proxy for WebSocket connection');
                    this._initializeSocketConnection(this.config.url, socketOptions);
                }
            } else {
                // Fallback to API gateway proxy
                console.warn('Failed to get WebSocket connection info, using API gateway proxy');
                this._initializeSocketConnection(this.config.url, socketOptions);
            }
        } catch (error) {
            console.error('Error checking connection method:', error);
            // Fallback to API gateway proxy
            this._initializeSocketConnection(this.config.url, socketOptions);
        }
    },
    
    /**
     * Initialize the actual Socket.IO connection
     */
    _initializeSocketConnection(url, options) {
        // Create the socket connection
        this._socket = io(url, options);
        
        // Set up event listeners
        this._setupEventListeners();
        
        // Start connection
        this.connect();
        
        console.log('Socket client initialized with URL:', url);
    },
    
    /**
     * Connect to the Socket.IO server
     */
    connect() {
        if (!this._socket) {
            console.error('Socket not initialized. Call init() first.');
            return;
        }
        
        if (!this._socket.connected) {
            console.log('Connecting to socket server...');
            this._socket.connect();
        }
    },
    
    /**
     * Disconnect from the Socket.IO server
     */
    disconnect() {
        if (this._socket && this._socket.connected) {
            console.log('Disconnecting from socket server...');
            this._socket.disconnect();
        }
        
        // Clear heartbeat timer
        this._stopHeartbeat();
    },
    
    /**
     * Check if socket is connected
     */
    isConnected() {
        return this._socket && this._socket.connected;
    },
    
    /**
     * Set up internal event listeners
     */
    _setupEventListeners() {
        if (!this._socket) return;
        
        // Connection events
        this._socket.on(this.config.eventTypes.CONNECT, () => {
            console.log('Socket connected');
            this._connected = true;
            this._reconnecting = false;
            
            // Start heartbeat
            this._startHeartbeat();
            
            // Resubscribe to rooms after reconnection
            this._resubscribeRooms();
            
            // Process queued messages
            this._processQueue();
            
            // Notify connection listeners
            this._notifyConnectionListeners(true);
        });
        
        this._socket.on(this.config.eventTypes.DISCONNECT, (reason) => {
            console.log(`Socket disconnected: ${reason}`);
            this._connected = false;
            
            // Stop heartbeat
            this._stopHeartbeat();
            
            // Notify connection listeners
            this._notifyConnectionListeners(false);
        });
        
        this._socket.on(this.config.eventTypes.RECONNECT_ATTEMPT, (attempt) => {
            console.log(`Socket reconnection attempt ${attempt}`);
            this._reconnecting = true;
        });
        
        this._socket.on(this.config.eventTypes.ERROR, (error) => {
            console.error('Socket error:', error);
        });
        
        // Setup pong handler for heartbeat
        this._socket.on(this.config.eventTypes.PONG, (data) => {
            const latency = Date.now() - new Date(data.received_ping).getTime();
            console.log(`Socket heartbeat: latency ${latency}ms`);
        });
        
        // Setup handlers for invitation flow
        this._socket.on(this.config.eventTypes.INVITATION_STATUS, (data) => {
            this._triggerHandlers(this.config.eventTypes.INVITATION_STATUS, data);
        });
        
        this._socket.on(this.config.eventTypes.QR_SCANNED_NOTIFICATION, (data) => {
            this._triggerHandlers(this.config.eventTypes.QR_SCANNED_NOTIFICATION, data);
        });
        
        this._socket.on(this.config.eventTypes.INVITATION_ACCEPTED, (data) => {
            this._triggerHandlers(this.config.eventTypes.INVITATION_ACCEPTED, data);
        });
        
        // Chat message handler
        this._socket.on(this.config.eventTypes.MESSAGE, (data) => {
            this._triggerHandlers(this.config.eventTypes.MESSAGE, data);
        });
        
        // User presence handlers
        this._socket.on(this.config.eventTypes.JOIN, (data) => {
            this._triggerHandlers(this.config.eventTypes.JOIN, data);
        });
        
        this._socket.on(this.config.eventTypes.USER_ACTIVE, (data) => {
            this._triggerHandlers(this.config.eventTypes.USER_ACTIVE, data);
        });
        
        this._socket.on(this.config.eventTypes.USER_AWAY, (data) => {
            this._triggerHandlers(this.config.eventTypes.USER_AWAY, data);
        });
        
        // Typing indicators
        this._socket.on(this.config.eventTypes.TYPING, (data) => {
            this._triggerHandlers(this.config.eventTypes.TYPING, data);
        });
        
        this._socket.on(this.config.eventTypes.STOP_TYPING, (data) => {
            this._triggerHandlers(this.config.eventTypes.STOP_TYPING, data);
        });
        
        // Read receipts
        this._socket.on(this.config.eventTypes.MESSAGE_READ, (data) => {
            this._triggerHandlers(this.config.eventTypes.MESSAGE_READ, data);
        });
        
        // Room creation
        this._socket.on(this.config.eventTypes.ROOM_CREATED, (data) => {
            this._triggerHandlers(this.config.eventTypes.ROOM_CREATED, data);
        });
    },
    
    /**
     * Start heartbeat to keep connection alive and detect disconnects
     */
    _startHeartbeat() {
        this._stopHeartbeat();
        
        this._heartbeatTimer = setInterval(() => {
            if (this._socket && this._socket.connected) {
                this._socket.emit(this.config.eventTypes.PING, {
                    timestamp: new Date().toISOString()
                });
            } else {
                this._stopHeartbeat();
            }
        }, this.config.pingInterval);
    },
    
    /**
     * Stop heartbeat timer
     */
    _stopHeartbeat() {
        if (this._heartbeatTimer) {
            clearInterval(this._heartbeatTimer);
            this._heartbeatTimer = null;
        }
    },
    
    /**
     * Resubscribe to rooms after reconnection
     */
    _resubscribeRooms() {
        if (!this._socket || !this._socket.connected) return;
        
        // Get user ID for join requests
        const userData = AuthHelper.getUserData();
        const visitorId = userData ? userData.user_id : AuthHelper.getOrCreateVisitorId();
        
        // Resubscribe to all rooms
        this._subscribedRooms.forEach(roomId => {
            console.log(`Resubscribing to room: ${roomId}`);
            this._socket.emit('join', {
                room_id: roomId,
                visitor_id: visitorId
            });
        });
    },
    
    /**
     * Process queued messages after reconnection
     */
    _processQueue() {
        if (!this._socket || !this._socket.connected) return;
        
        if (this._queuedMessages.length > 0) {
            console.log(`Processing ${this._queuedMessages.length} queued messages`);
            
            this._queuedMessages.forEach(item => {
                this._socket.emit(item.event, item.data);
            });
            
            // Clear queue
            this._queuedMessages = [];
        }
    },
    
    /**
     * Trigger event handlers for a specific event
     */
    _triggerHandlers(eventType, data) {
        const handlers = this._eventHandlers.get(eventType) || [];
        handlers.forEach(handler => {
            try {
                handler(data);
            } catch (error) {
                console.error(`Error in ${eventType} handler:`, error);
            }
        });
    },
    
    /**
     * Notify connection state listeners
     */
    _notifyConnectionListeners(connected) {
        this._connectionListeners.forEach(listener => {
            try {
                listener(connected);
            } catch (error) {
                console.error('Error in connection listener:', error);
            }
        });
    },
    
    /**
     * Subscribe to events
     * 
     * @param {string} eventType - Event type from config.eventTypes
     * @param {Function} handler - Event handler function
     * @returns {Function} - Unsubscribe function
     */
    on(eventType, handler) {
        if (!handler || typeof handler !== 'function') {
            console.error('Event handler must be a function');
            return () => {};
        }
        
        // Create handler collection if it doesn't exist
        if (!this._eventHandlers.has(eventType)) {
            this._eventHandlers.set(eventType, new Set());
        }
        
        // Add handler
        this._eventHandlers.get(eventType).add(handler);
        
        // Return unsubscribe function
        return () => {
            const handlers = this._eventHandlers.get(eventType);
            if (handlers) {
                handlers.delete(handler);
                if (handlers.size === 0) {
                    this._eventHandlers.delete(eventType);
                }
            }
        };
    },
    
    /**
     * Remove event handler
     * 
     * @param {string} eventType - Event type
     * @param {Function} handler - Event handler to remove
     */
    off(eventType, handler) {
        const handlers = this._eventHandlers.get(eventType);
        if (handlers && handler) {
            handlers.delete(handler);
            if (handlers.size === 0) {
                this._eventHandlers.delete(eventType);
            }
        } else if (!handler) {
            // Remove all handlers for this event type
            this._eventHandlers.delete(eventType);
        }
    },
    
    /**
     * Add connection state listener
     * 
     * @param {Function} listener - Connection state listener
     * @returns {Function} - Unsubscribe function
     */
    onConnectionChange(listener) {
        if (!listener || typeof listener !== 'function') {
            console.error('Connection listener must be a function');
            return () => {};
        }
        
        this._connectionListeners.add(listener);
        
        // Return unsubscribe function
        return () => {
            this._connectionListeners.delete(listener);
        };
    },
    
    /**
     * Join a chat room
     * 
     * @param {string} roomId - Room ID to join
     */
    joinRoom(roomId) {
        if (!roomId) {
            console.error('Room ID is required');
            return;
        }
        
        // Track subscribed room
        this._subscribedRooms.add(roomId);
        
        if (!this._socket || !this._socket.connected) {
            console.warn(`Socket not connected, joining room ${roomId} will be queued`);
            this.connect();
            return;
        }
        
        // Get visitor ID for join request
        const userData = AuthHelper.getUserData();
        const visitorId = userData ? userData.user_id : AuthHelper.getOrCreateVisitorId();
        
        console.log(`Joining room: ${roomId}`);
        this._socket.emit('join', {
            room_id: roomId,
            visitor_id: visitorId
        });
    },
    
    /**
     * Leave a chat room
     * 
     * @param {string} roomId - Room ID to leave
     */
    leaveRoom(roomId) {
        if (!roomId) {
            console.error('Room ID is required');
            return;
        }
        
        // Remove from tracked rooms
        this._subscribedRooms.delete(roomId);
        
        if (!this._socket || !this._socket.connected) {
            return;
        }
        
        console.log(`Leaving room: ${roomId}`);
        this._socket.emit('leave', { room_id: roomId });
    },
    
    /**
     * Send a message to a room
     * 
     * @param {string} roomId - The room ID to send to
     * @param {string} content - The message content
     * @param {string} messageId - Optional message ID (generates UUID if not provided)
     * @returns {Promise} - Resolves when message is acknowledged
     */
    sendMessage(roomId, content, messageId = null) {
        return new Promise((resolve, reject) => {
            if (!this._socket || !this.isConnected()) {
                console.error('Socket not connected. Cannot send message.');
                // Queue the message for later sending
                const msg = { roomId, content, messageId: messageId || crypto.randomUUID() };
                this._queuedMessages.push({ type: 'message', data: msg });
                reject(new Error('Socket not connected'));
                return;
            }
            
            if (!roomId) {
                console.error('Room ID is required to send a message.');
                reject(new Error('Room ID is required'));
                return;
            }
            
            // Ensure we're in the room
            if (!this._subscribedRooms.has(roomId)) {
                console.log(`Not in room ${roomId}, joining before sending message.`);
                this.joinRoom(roomId);
            }
            
            // Generate message ID if not provided
            const msgId = messageId || crypto.randomUUID();
            
            // Send the message
            try {
                this._socket.emit('message', {
                    room_id: roomId,
                    message: content,
                    message_id: msgId
                });
                
                // Set up one-time handler for acknowledgment
                const ackHandler = (data) => {
                    if (data.message_id === msgId) {
                        // Remove the handler after receiving ack
                        this._socket.off('message_ack', ackHandler);
                        resolve(data);
                    }
                };
                
                // Listen for acknowledgment
                this._socket.on('message_ack', ackHandler);
                
                // Set timeout to reject if no ack received
                setTimeout(() => {
                    // Check if still waiting for ack
                    if (this._socket.hasListeners('message_ack')) {
                        this._socket.off('message_ack', ackHandler);
                        reject(new Error('Message acknowledgment timeout'));
                    }
                }, 5000); // 5 second timeout
            } catch (error) {
                console.error('Error sending message:', error);
                reject(error);
            }
        });
    },
    
    /**
     * Send typing indicator
     * 
     * @param {string} roomId - Room ID
     * @param {boolean} isTyping - Whether user is typing
     */
    sendTypingStatus(roomId, isTyping = true) {
        if (!roomId) {
            console.error('Room ID is required');
            return;
        }
        
        if (!this._socket || !this._socket.connected) {
            return;
        }
        
        const eventType = isTyping ? 
            this.config.eventTypes.TYPING : 
            this.config.eventTypes.STOP_TYPING;
            
        this._socket.emit(eventType, { room_id: roomId });
    },
    
    /**
     * Send read receipt for messages
     * 
     * @param {string} roomId - Room ID
     * @param {Array<string>} messageIds - IDs of read messages
     */
    sendReadReceipt(roomId, messageIds) {
        if (!roomId || !messageIds || !messageIds.length) {
            console.error('Room ID and message IDs are required');
            return;
        }
        
        if (!this._socket || !this._socket.connected) {
            return;
        }
        
        this._socket.emit(this.config.eventTypes.MESSAGE_READ, {
            room_id: roomId,
            message_ids: messageIds
        });
    },
    
    /**
     * Send user active/away status
     * 
     * @param {string} roomId - Room ID
     * @param {boolean} isActive - Whether user is active
     */
    sendUserStatus(roomId, isActive = true) {
        if (!roomId) {
            console.error('Room ID is required');
            return;
        }
        
        if (!this._socket || !this._socket.connected) {
            return;
        }
        
        const eventType = isActive ?
            this.config.eventTypes.USER_ACTIVE :
            this.config.eventTypes.USER_AWAY;
            
        this._socket.emit(eventType, { room_id: roomId });
    },
    
    /**
     * Send invitation created event
     * 
     * @param {string} token - Invitation token
     */
    notifyInvitationCreated(token) {
        if (!token) {
            console.error('Invitation token is required');
            return;
        }
        
        if (!this._socket || !this._socket.connected) {
            this._queuedMessages.push({
                event: this.config.eventTypes.INVITATION_CREATED,
                data: { invitation_token: token }
            });
            
            this.connect();
            return;
        }
        
        this._socket.emit(this.config.eventTypes.INVITATION_CREATED, {
            invitation_token: token
        });
    },
    
    /**
     * Check invitation status
     * 
     * @param {string} token - Invitation token
     */
    checkInvitationStatus(token) {
        if (!token) {
            console.error('Invitation token is required');
            return;
        }
        
        if (!this._socket || !this._socket.connected) {
            this._queuedMessages.push({
                event: 'check_invitation_status',
                data: { invitation_token: token }
            });
            
            this.connect();
            return;
        }
        
        this._socket.emit('check_invitation_status', {
            invitation_token: token
        });
    },
    
    /**
     * Notify that a QR code was scanned
     * 
     * @param {string} token - Invitation token
     */
    notifyQrScanned(token) {
        if (!token) {
            console.error('Invitation token is required');
            return;
        }
        
        if (!this._socket || !this._socket.connected) {
            this._queuedMessages.push({
                event: this.config.eventTypes.QR_SCANNED,
                data: { invitation_token: token }
            });
            
            this.connect();
            return;
        }
        
        this._socket.emit(this.config.eventTypes.QR_SCANNED, {
            invitation_token: token
        });
    },
    
    /**
     * Run a connection test to verify WebSocket functionality
     * @returns {Promise} - Resolves with connection status
     */
    testConnection() {
        return new Promise((resolve, reject) => {
            if (!this._socket || !this.isConnected()) {
                reject(new Error('Socket not connected'));
                return;
            }
            
            const testData = {
                timestamp: new Date().toISOString(),
                test_id: crypto.randomUUID()
            };
            
            // Send ping and wait for pong
            this._socket.emit('ping', testData);
            
            // Set up one-time handler for pong
            const pongHandler = (data) => {
                // Remove the handler after receiving pong
                this._socket.off('pong', pongHandler);
                resolve({
                    success: true,
                    latency: Date.now() - new Date(testData.timestamp).getTime(),
                    data
                });
            };
            
            // Listen for pong
            this._socket.on('pong', pongHandler);
            
            // Set timeout to reject if no pong received
            setTimeout(() => {
                // Check if still waiting for pong
                if (this._socket.hasListeners('pong')) {
                    this._socket.off('pong', pongHandler);
                    reject(new Error('WebSocket test timeout'));
                }
            }, 5000); // 5 second timeout
        });
    }
};

// Initialize the socket client when the page loads
document.addEventListener('DOMContentLoaded', () => {
    // Delay initialization slightly to ensure AuthHelper is fully loaded
    setTimeout(() => {
        SocketClient.init();
    }, 300); // Increase timeout to 300ms
});

// Handle page visibility changes
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        // Page is hidden, consider disconnecting to save resources
        // but only if we're not in the middle of a chat
        if (SocketClient._subscribedRooms.size === 0) {
            SocketClient.disconnect();
        }
    } else {
        // Page is visible again, reconnect if needed
        if (!SocketClient.isConnected()) {
            SocketClient.connect();
        }
    }
});

// Handle page unload
window.addEventListener('beforeunload', () => {
    SocketClient.disconnect();
});

// Export for use in other modules
window.SocketClient = SocketClient; 