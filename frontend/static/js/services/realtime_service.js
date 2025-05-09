/**
 * ABDRE Chat - Realtime Service
 * 
 * Manages WebSocket connections to the realtime backend for live updates.
 * Handles connection state management, reconnection logic, and heartbeat.
 */

// Ensure ABDRE namespace exists
window.ABDRE = window.ABDRE || {};

// Realtime Service Module
ABDRE.RealtimeService = (function() {
    // Constants
    const STATES = {
        DISCONNECTED: 'disconnected',
        CONNECTING: 'connecting',
        CONNECTED: 'connected'
    };
    
    const EVENTS = {
        STATE_CHANGED: 'realtime:state_changed',
        MESSAGE_RECEIVED: 'realtime:message_received',
        ERROR: 'realtime:error',
        RECONNECTING: 'realtime:reconnecting',
        AUTHENTICATED: 'realtime:authenticated'
    };
    
    // Private variables
    let _socket = null;
    let _state = STATES.DISCONNECTED;
    let _authToken = null;
    let _reconnectAttempts = 0;
    let _maxReconnectAttempts = 10;
    let _reconnectInterval = 1000; // Starting at 1 second
    let _heartbeatInterval = null;
    let _messageQueue = [];
    let _debug = false;
    let _socketUrl = '';
    let _lastPingTime = null;
    let _socketLatency = null;
    let _reconnectTimer = null;
    
    // Private methods
    function _log(...args) {
        if (!_debug) return;
        console.log('[RealtimeService]', ...args);
    }
    
    function _setConnectionState(newState) {
        if (_state === newState) return;
        
        _state = newState;
        _log('Connection state changed:', _state);
        
        // Publish state change event
        if (ABDRE.EventBus) {
            ABDRE.EventBus.publish(EVENTS.STATE_CHANGED, {
                state: _state,
                timestamp: new Date().toISOString(),
                latency: _socketLatency
            });
        }
    }
    
    function _setupHeartbeat() {
        // Clear any existing heartbeat
        if (_heartbeatInterval) {
            clearInterval(_heartbeatInterval);
        }
        
        // Set up ping/pong for connection health monitoring
        _heartbeatInterval = setInterval(() => {
            if (_socket && _socket.readyState === WebSocket.OPEN) {
                _lastPingTime = Date.now();
                _socket.send(JSON.stringify({ type: 'ping' }));
                _log('Ping sent');
            }
        }, 30000); // Send ping every 30 seconds
    }
    
    function _clearHeartbeat() {
        if (_heartbeatInterval) {
            clearInterval(_heartbeatInterval);
            _heartbeatInterval = null;
        }
    }
    
    function _handlePong() {
        if (_lastPingTime) {
            _socketLatency = Date.now() - _lastPingTime;
            _log('Pong received, latency:', _socketLatency + 'ms');
            _lastPingTime = null;
        }
    }
    
    function _reconnect() {
        if (_reconnectAttempts >= _maxReconnectAttempts) {
            _log('Max reconnect attempts reached, giving up');
            return;
        }
        
        // Clear any existing reconnect timer
        if (_reconnectTimer) {
            clearTimeout(_reconnectTimer);
        }
        
        _reconnectAttempts++;
        
        // Calculate backoff time using exponential backoff
        const backoffTime = Math.min(30000, _reconnectInterval * Math.pow(1.5, _reconnectAttempts - 1));
        
        _log(`Reconnecting (attempt ${_reconnectAttempts}/${_maxReconnectAttempts}) in ${backoffTime}ms`);
        
        // Publish reconnecting event
        if (ABDRE.EventBus) {
            ABDRE.EventBus.publish(EVENTS.RECONNECTING, {
                attempt: _reconnectAttempts,
                maxAttempts: _maxReconnectAttempts,
                nextAttemptIn: backoffTime
            });
        }
        
        // Schedule reconnect
        _reconnectTimer = setTimeout(() => {
            _connect();
        }, backoffTime);
    }
    
    function _flushQueue() {
        // Send any queued messages
        if (_messageQueue.length > 0 && _socket && _socket.readyState === WebSocket.OPEN) {
            _log(`Flushing message queue (${_messageQueue.length} messages)`);
            
            _messageQueue.forEach(message => {
                _socket.send(JSON.stringify(message));
            });
            
            // Clear the queue
            _messageQueue = [];
        }
    }
    
    function _handleMessage(event) {
        try {
            const message = JSON.parse(event.data);
            _log('Message received:', message);
            
            // Handle special message types
            switch (message.type) {
                case 'pong':
                    _handlePong();
                    return;
                    
                case 'auth_success':
                    _setConnectionState(STATES.CONNECTED);
                    // Publish authenticated event
                    if (ABDRE.EventBus) {
                        ABDRE.EventBus.publish(EVENTS.AUTHENTICATED, {
                            userId: message.user_id
                        });
                    }
                    // Flush message queue after authentication
                    _flushQueue();
                    return;
                    
                case 'auth_error':
                    _log('Authentication error:', message.error);
                    // Publish error event
                    if (ABDRE.EventBus) {
                        ABDRE.EventBus.publish(EVENTS.ERROR, {
                            code: 'auth_error',
                            message: message.error,
                            timestamp: new Date().toISOString()
                        });
                    }
                    return;
            }
            
            // Publish regular message event for subscribers
            if (ABDRE.EventBus) {
                ABDRE.EventBus.publish(EVENTS.MESSAGE_RECEIVED, message);
            }
            
        } catch (error) {
            _log('Error parsing message:', error);
        }
    }
    
    function _handleOpen() {
        _log('Connection opened');
        _reconnectAttempts = 0; // Reset reconnect counter on successful connection
        
        // Send authentication if token available
        if (_authToken) {
            _authenticate();
        } else {
            _setConnectionState(STATES.CONNECTED);
            _flushQueue();
        }
        
        // Setup heartbeat
        _setupHeartbeat();
    }
    
    function _handleClose(event) {
        _log('Connection closed:', event.code, event.reason);
        _setConnectionState(STATES.DISCONNECTED);
        _clearHeartbeat();
        
        // Attempt to reconnect if closure wasn't intentional
        if (event.code !== 1000) {
            _reconnect();
        }
    }
    
    function _handleError(error) {
        _log('Connection error:', error);
        
        // Publish error event
        if (ABDRE.EventBus) {
            ABDRE.EventBus.publish(EVENTS.ERROR, {
                code: 'connection_error',
                message: 'WebSocket connection error',
                timestamp: new Date().toISOString(),
                details: error
            });
        }
    }
    
    function _authenticate() {
        if (_socket && _socket.readyState === WebSocket.OPEN && _authToken) {
            _log('Authenticating connection');
            _socket.send(JSON.stringify({
                type: 'authenticate',
                token: _authToken
            }));
        }
    }
    
    function _connect() {
        // Don't attempt to connect if already connecting/connected
        if (_socket && (_socket.readyState === WebSocket.CONNECTING || _socket.readyState === WebSocket.OPEN)) {
            return;
        }
        
        // Reset existing connection if any
        if (_socket) {
            _socket.close();
        }
        
        _setConnectionState(STATES.CONNECTING);
        
        try {
            _log('Connecting to', _socketUrl);
            _socket = new WebSocket(_socketUrl);
            
            // Set up event handlers
            _socket.onopen = _handleOpen;
            _socket.onclose = _handleClose;
            _socket.onerror = _handleError;
            _socket.onmessage = _handleMessage;
            
        } catch (error) {
            _log('Failed to create WebSocket:', error);
            _setConnectionState(STATES.DISCONNECTED);
            _reconnect();
        }
    }
    
    // Public API
    return {
        init: function(options = {}) {
            _socketUrl = options.url || (window.location.protocol === 'https:' ? 
                `wss://${window.location.host}/ws` : 
                `ws://${window.location.host}/ws`);
            
            _debug = options.debug || false;
            _maxReconnectAttempts = options.maxReconnectAttempts || 10;
            _reconnectInterval = options.reconnectInterval || 1000;
            
            _log('Initialized with options:', options);
            
            // Subscribe to auth events
            if (ABDRE.EventBus) {
                ABDRE.EventBus.subscribe('auth:authenticated', (data) => {
                    this.setAuthToken(data.token);
                });
                
                ABDRE.EventBus.subscribe('auth:unauthenticated', () => {
                    this.setAuthToken(null);
                });
            }
            
            // Return this for chaining
            return this;
        },
        
        connect: function() {
            _connect();
            return this;
        },
        
        disconnect: function() {
            _log('Disconnecting');
            
            // Clear reconnect timer if active
            if (_reconnectTimer) {
                clearTimeout(_reconnectTimer);
                _reconnectTimer = null;
            }
            
            // Clear heartbeat
            _clearHeartbeat();
            
            // Close socket if it exists
            if (_socket) {
                _socket.close(1000, 'Normal closure');
                _socket = null;
            }
            
            _setConnectionState(STATES.DISCONNECTED);
            return this;
        },
        
        reconnect: function() {
            _log('Manual reconnect triggered');
            this.disconnect();
            _reconnectAttempts = 0; // Reset counter for manual reconnect
            _connect();
            return this;
        },
        
        sendMessage: function(message) {
            if (!message.type) {
                throw new Error('Message must have a type property');
            }
            
            // If connected, send immediately
            if (_socket && _socket.readyState === WebSocket.OPEN && _state === STATES.CONNECTED) {
                _log('Sending message:', message);
                _socket.send(JSON.stringify(message));
                return true;
            }
            
            // Otherwise queue the message
            _log('Queuing message:', message);
            _messageQueue.push(message);
            return false;
        },
        
        getState: function() {
            return _state;
        },
        
        getLatency: function() {
            return _socketLatency;
        },
        
        setAuthToken: function(token) {
            _authToken = token;
            
            // If connected, send authentication
            if (_socket && _socket.readyState === WebSocket.OPEN) {
                _authenticate();
            }
            
            return this;
        },
        
        // Expose constants
        STATES: STATES,
        EVENTS: EVENTS
    };
})(); 