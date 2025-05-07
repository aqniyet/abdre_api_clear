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
            ROOM_CREATED: 'room_created',
            // New event types
            READ_RECEIPT: 'read_receipt',
            MESSAGE_STATUS: 'message_status',
            JOIN_SUCCESS: 'join_success',
            USER_JOINED: 'user_joined'
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
    _typingTimeouts: new Map(),
    _messagesAwaitingDelivery: new Map(),
    
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
            // First attempt to check with the API gateway to get the correct connection URL
            console.log('Checking connection details with API gateway...');
            const response = await fetch('/api/realtime/socket.io/', {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'Authorization': `Bearer ${AuthHelper.getToken() || 'guest'}`
                }
            });
            
            // Log the status code to debug
            console.log(`API gateway response status: ${response.status}`);
            
            if (response.ok) {
                try {
                    const data = await response.json();
                    console.log('Received connection details from API gateway:', data);
                    
                    if (data.connection_url) {
                        console.log('Using API-provided connection URL:', data.connection_url);
                        this._directConnectionUrl = data.connection_url;
                        
                        // Extract base URL without query parameters for Socket.IO
                        let connectionBase = data.connection_url.split('?')[0];
                        if (connectionBase.endsWith('/socket.io/')) {
                            connectionBase = connectionBase.substring(0, connectionBase.length - 10);
                        }
                        
                        // Handle WebSocket protocol in URL
                        if (connectionBase.startsWith('ws://') || connectionBase.startsWith('wss://')) {
                            // Socket.IO requires http:// or https:// in the constructor
                            // It will handle the protocol upgrade to WebSocket
                            connectionBase = connectionBase.replace('ws://', 'http://');
                            connectionBase = connectionBase.replace('wss://', 'https://');
                        }
                        
                        console.log('Using Socket.IO connection base URL:', connectionBase);
                        
                        // Add any additional query params from the API response
                        if (data.query_params) {
                            socketOptions.query = {
                                ...socketOptions.query,
                                ...data.query_params
                            };
                        }
                        
                        // Add transport preference
                        if (data.transport) {
                            socketOptions.transports = [data.transport, 'polling'];
                        }
                        
                        // Initialize Socket.IO connection with the provided URL
                        this._initializeSocketConnection(connectionBase, socketOptions);
                        return;
                    }
                } catch (jsonError) {
                    console.error('Error parsing API response JSON:', jsonError);
                }
            }
            
            // Fallback to direct connection if API gateway doesn't provide URL
            console.warn('API gateway did not provide a valid connection URL, falling back to direct connection');
            console.log('Connecting directly to realtime service');
            
            // Determine host and protocol - use WebSocket for direct connection
            const isSecure = window.location.protocol === 'https:';
            const host = window.location.hostname;
            const port = '5506'; // Default port for realtime service
            
            // Socket.IO requires http:// or https:// in the constructor
            // It will handle the protocol upgrade to WebSocket
            const protocol = isSecure ? 'https' : 'http';
            
            this._directConnectionUrl = `${protocol}://${host}:${port}`;
            console.log('Using direct connection URL:', this._directConnectionUrl);
            
            // Initialize Socket.IO connection
            this._initializeSocketConnection(this._directConnectionUrl, socketOptions);
        } catch (error) {
            console.error('Error determining connection method:', error);
            console.log('Falling back to standard connection');
            
            // Last resort fallback to current host with default realtime port
            const isSecure = window.location.protocol === 'https:';
            const host = window.location.hostname;
            const port = '5506'; // Default port for realtime service
            const protocol = isSecure ? 'https' : 'http';
            
            this._directConnectionUrl = `${protocol}://${host}:${port}`;
            console.log('Using fallback connection URL:', this._directConnectionUrl);
            
            // Initialize Socket.IO connection
            this._initializeSocketConnection(this._directConnectionUrl, socketOptions);
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
            
            // Retry any messages that were pending delivery when disconnected
            this._retryPendingMessages();
            
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
        
        this._socket.on(this.config.eventTypes.RECONNECT, () => {
            console.log('Socket reconnected');
            this._connected = true;
            this._reconnecting = false;
            
            // Start heartbeat
            this._startHeartbeat();
            
            // Resubscribe to rooms
            this._resubscribeRooms();
            
            // Process queued messages
            this._processQueue();
            
            // Retry any messages that were pending delivery
            this._retryPendingMessages();
            
            // Notify connection listeners
            this._notifyConnectionListeners(true);
        });
        
        this._socket.on(this.config.eventTypes.ERROR, (error) => {
            console.error('Socket error:', error);
            
            // If not connected or reconnecting, try to reconnect
            if (!this._connected && !this._reconnecting) {
                console.log('Attempting to reconnect after error...');
                this._socket.connect();
            }
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
            // Trigger handlers for typing event
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
        
        // Handle message status updates
        this._socket.on(this.config.eventTypes.MESSAGE_STATUS, (data) => {
            // Update any tracked message status
            if (data.client_message_id && this._messagesAwaitingDelivery.has(data.client_message_id)) {
                const tracking = this._messagesAwaitingDelivery.get(data.client_message_id);
                tracking.status = data.status;
                
                // Update resolver if message was delivered successfully
                if (data.status === 'delivered' || data.status === 'read') {
                    const responseData = {
                        ...tracking.data,
                        status: data.status,
                        server_message_id: data.server_message_id
                    };
                    tracking.resolver(responseData);
                } else if (data.status === 'failed') {
                    tracking.rejecter(new Error(data.error || 'Message delivery failed'));
                }
            }
            
            // Trigger handlers for message status event
            this._triggerHandlers(this.config.eventTypes.MESSAGE_STATUS, data);
        });
        
        // Handle room events
        this._socket.on(this.config.eventTypes.JOIN_SUCCESS, (data) => {
            // Trigger handlers for join success event
            this._triggerHandlers(this.config.eventTypes.JOIN_SUCCESS, data);
        });
        
        this._socket.on(this.config.eventTypes.USER_JOINED, (data) => {
            // Trigger handlers for user joined event
            this._triggerHandlers(this.config.eventTypes.USER_JOINED, data);
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
        if (this._subscribedRooms.size > 0) {
            console.log(`Resubscribing to ${this._subscribedRooms.size} rooms`);
            
            for (const roomId of this._subscribedRooms) {
                this._socket.emit('join', { room_id: roomId });
                console.log(`Resubscribed to room ${roomId}`);
            }
        }
    },
    
    /**
     * Retry sending any messages that were pending delivery when disconnected
     */
    _retryPendingMessages() {
        // Check if we have any pending messages
        if (this._messagesAwaitingDelivery.size > 0) {
            console.log(`Retrying ${this._messagesAwaitingDelivery.size} pending messages`);
            
            // Retry each pending message
            for (const [messageId, tracking] of this._messagesAwaitingDelivery.entries()) {
                // Only retry if status is pending or timeout
                if (tracking.status === 'pending' || tracking.status === 'timeout' || tracking.status === 'queued') {
                    console.log(`Retrying message ${messageId}`);
                    
                    // Clear any existing timeout
                    if (tracking.timeout) {
                        clearTimeout(tracking.timeout);
                    }
                    
                    // Retry sending
                    this._socket.emit('message', tracking.data);
                    
                    // Update tracking
                    tracking.attempts += 1;
                    tracking.status = 'pending';
                    tracking.timeout = setTimeout(() => {
                        this._checkMessageDelivery(messageId);
                    }, 10000);
                    
                    this._messagesAwaitingDelivery.set(messageId, tracking);
                }
            }
        }
    },
    
    /**
     * Process queued messages
     */
    _processQueue() {
        if (this._queuedMessages.length > 0) {
            console.log(`Processing ${this._queuedMessages.length} queued messages`);
            
            // Process messages in FIFO order
            while (this._queuedMessages.length > 0) {
                const item = this._queuedMessages.shift();
                
                // Handle different types of queued actions
                switch (item.type) {
                    case 'message':
                        console.log('Sending queued message:', item.data.message_id);
                        this._socket.emit('message', item.data);
                        break;
                    case 'typing':
                        this._socket.emit('typing', item.data);
                        break;
                    case 'stop_typing':
                        this._socket.emit('typing', {...item.data, typing: false});
                        break;
                    case this.config.eventTypes.MESSAGE_READ:
                        this._socket.emit(this.config.eventTypes.MESSAGE_READ, item.data);
                        break;
                    case 'user_active':
                    case 'user_away':
                        this._socket.emit(item.type, item.data);
                        break;
                    default:
                        console.warn('Unknown queued message type:', item.type);
                }
            }
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
     * Send typing status to a room
     * 
     * @param {string} roomId - The room ID to send typing status to
     * @param {boolean} isTyping - Whether the user is typing or stopped typing
     * @returns {Promise} - Promise that resolves when typing status is sent
     */
    sendTypingStatus(roomId, isTyping = true) {
        return new Promise((resolve, reject) => {
            if (!this.isConnected()) {
                this._queuedMessages.push({
                    type: isTyping ? 'typing' : 'stop_typing',
                    data: { room_id: roomId, typing: isTyping }
                });
                return reject(new Error('Socket not connected'));
            }

            if (!roomId) {
                return reject(new Error('Room ID is required'));
            }

            // Clear any existing typing timeout
            const timeoutKey = `${roomId}-typing`;
            if (this._typingTimeouts.has(timeoutKey)) {
                clearTimeout(this._typingTimeouts.get(timeoutKey));
            }

            // If typing, set timeout to automatically clear the typing status after 5 seconds
            if (isTyping) {
                this._typingTimeouts.set(timeoutKey, setTimeout(() => {
                    this.sendTypingStatus(roomId, false)
                        .catch(error => console.error('Error clearing typing status:', error));
                }, 5000));
            }

            this._socket.emit('typing', {
                room_id: roomId,
                typing: isTyping
            });

            resolve();
        });
    },

    /**
     * Send read receipt for messages
     * 
     * @param {string} roomId - The room ID where messages were read
     * @param {string[]} messageIds - Array of message IDs that were read
     * @returns {Promise} - Promise that resolves when read receipt is sent
     */
    sendReadReceipt(roomId, messageIds) {
        return new Promise((resolve, reject) => {
            if (!this.isConnected()) {
                this._queuedMessages.push({
                    type: this.config.eventTypes.MESSAGE_READ,
                    data: { room_id: roomId, message_ids: messageIds }
                });
                return reject(new Error('Socket not connected'));
            }

            if (!roomId) {
                return reject(new Error('Room ID is required'));
            }

            if (!messageIds || !Array.isArray(messageIds) || messageIds.length === 0) {
                return reject(new Error('Message IDs must be a non-empty array'));
            }

            this._socket.emit(this.config.eventTypes.MESSAGE_READ, {
                room_id: roomId,
                message_ids: messageIds
            });

            resolve();
        });
    },

    /**
     * Send user status (active/away) to a room
     * 
     * @param {string} roomId - The room ID to send status to
     * @param {boolean} isActive - Whether the user is active (true) or away (false)
     * @returns {Promise} - Promise that resolves when status is sent
     */
    sendUserStatus(roomId, isActive = true) {
        return new Promise((resolve, reject) => {
            if (!this.isConnected()) {
                this._queuedMessages.push({
                    type: isActive ? 'user_active' : 'user_away',
                    data: { room_id: roomId }
                });
                return reject(new Error('Socket not connected'));
            }

            if (!roomId) {
                return reject(new Error('Room ID is required'));
            }

            const eventType = isActive ? 'user_active' : 'user_away';
            this._socket.emit(eventType, {
                room_id: roomId
            });

            resolve();
        });
    },

    /**
     * Enhanced message sending with delivery tracking and retries
     * 
     * @param {string} roomId - The room ID to send message to
     * @param {string} content - Message content
     * @param {string} messageId - Optional message ID (will be generated if not provided)
     * @param {string} messageType - Optional message type (default: 'text')
     * @returns {Promise} - Promise that resolves with message data when sent
     */
    sendMessage(roomId, content, messageId = null, messageType = 'text') {
        return new Promise((resolve, reject) => {
            if (!roomId) {
                return reject(new Error('Room ID is required'));
            }

            if (!content) {
                return reject(new Error('Message content is required'));
            }

            // Generate message ID if not provided
            const msgId = messageId || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            // Create message data
            const messageData = {
                room_id: roomId,
                content: content,
                message_id: msgId,
                message_type: messageType,
                timestamp: new Date().toISOString(),
                status: 'pending'
            };

            // If not connected, queue the message
            if (!this.isConnected()) {
                console.log('Socket not connected, queueing message:', msgId);
                this._queuedMessages.push({
                    type: 'message',
                    data: messageData,
                    timestamp: Date.now()
                });
                
                // Track message waiting for delivery
                this._messagesAwaitingDelivery.set(msgId, {
                    data: messageData,
                    attempts: 0,
                    status: 'queued',
                    resolver: resolve,
                    rejecter: reject
                });
                
                return;
            }

            // Setup delivery tracking with timeout
            const deliveryTimeout = setTimeout(() => {
                // If we have a delivery tracking for this message
                if (this._messagesAwaitingDelivery.has(msgId)) {
                    const tracking = this._messagesAwaitingDelivery.get(msgId);
                    
                    // If status is still pending, consider it undelivered
                    if (tracking.status === 'pending') {
                        tracking.status = 'timeout';
                        tracking.attempts += 1;
                        
                        // If we've tried less than 3 times, retry
                        if (tracking.attempts < 3) {
                            console.log(`Message delivery timeout, retrying (${tracking.attempts}/3):`, msgId);
                            
                            // Retry sending
                            this._socket.emit('message', messageData);
                            
                            // Set a new timeout
                            tracking.timeout = setTimeout(() => {
                                // Use recursion to retry the timeout check
                                this._checkMessageDelivery(msgId);
                            }, 5000);
                            
                            this._messagesAwaitingDelivery.set(msgId, tracking);
                        } else {
                            // Give up after 3 attempts
                            console.error('Message delivery failed after 3 attempts:', msgId);
                            
                            // Notify the promiser
                            tracking.rejecter(new Error('Message delivery timeout after 3 attempts'));
                            
                            // Remove from tracking
                            this._messagesAwaitingDelivery.delete(msgId);
                        }
                    }
                }
            }, 10000); // 10 second timeout for delivery
            
            // Track message waiting for delivery confirmation
            this._messagesAwaitingDelivery.set(msgId, {
                data: messageData,
                attempts: 1,
                status: 'pending',
                timeout: deliveryTimeout,
                resolver: resolve,
                rejecter: reject
            });
            
            // Send the message
            this._socket.emit('message', messageData);
            
            // Listen for acknowledgment
            const ackHandler = (data) => {
                if (data.client_message_id === msgId) {
                    // Clear delivery timeout
                    clearTimeout(deliveryTimeout);
                    
                    // Update tracking status
                    if (this._messagesAwaitingDelivery.has(msgId)) {
                        const tracking = this._messagesAwaitingDelivery.get(msgId);
                        tracking.status = data.status;
                        
                        // Resolve or reject based on status
                        if (data.status === 'delivered' || data.status === 'read') {
                            const responseData = {
                                ...messageData,
                                status: data.status,
                                server_message_id: data.server_message_id
                            };
                            tracking.resolver(responseData);
                        } else {
                            tracking.rejecter(new Error(data.error || `Message delivery failed: ${data.status}`));
                        }
                        
                        // Remove from tracking after a delay to allow for read receipts
                        setTimeout(() => {
                            this._messagesAwaitingDelivery.delete(msgId);
                        }, 60000); // Keep tracking for 1 minute for read receipts
                    }
                    
                    // Remove this specific listener
                    this._socket.off('message_status', ackHandler);
                }
            };
            
            // Set up the acknowledgment listener
            this._socket.on('message_status', ackHandler);
        });
    },

    /**
     * Check message delivery status and handle retries/timeouts
     * @private
     */
    _checkMessageDelivery(messageId) {
        if (this._messagesAwaitingDelivery.has(messageId)) {
            const tracking = this._messagesAwaitingDelivery.get(messageId);
            
            // If still pending after timeout
            if (tracking.status === 'pending') {
                tracking.status = 'timeout';
                tracking.attempts += 1;
                
                // If we've tried less than 3 times, retry
                if (tracking.attempts < 3) {
                    console.log(`Retrying message delivery (${tracking.attempts}/3):`, messageId);
                    
                    // Retry sending
                    this._socket.emit('message', tracking.data);
                    
                    // Set a new timeout
                    tracking.timeout = setTimeout(() => {
                        this._checkMessageDelivery(messageId);
                    }, 5000);
                    
                    this._messagesAwaitingDelivery.set(messageId, tracking);
                } else {
                    // Give up after 3 attempts
                    console.error('Message delivery failed after 3 attempts:', messageId);
                    
                    // Notify the promiser
                    tracking.rejecter(new Error('Message delivery timeout after 3 attempts'));
                    
                    // Remove from tracking
                    this._messagesAwaitingDelivery.delete(messageId);
                }
            }
        }
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