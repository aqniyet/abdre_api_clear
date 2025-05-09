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
    let _lastPongTime = null;
    let _stalledConnectionTimeout = null;
    let _maxHeartbeatMisses = 2;
    let _heartbeatMissCount = 0;
    let _initialized = false;
    
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
        
        // Clear any existing stalled connection detection
        if (_stalledConnectionTimeout) {
            clearTimeout(_stalledConnectionTimeout);
            _stalledConnectionTimeout = null;
        }
        
        // Reset heartbeat miss counter
        _heartbeatMissCount = 0;
        
        // Set up ping/pong for connection health monitoring
        _heartbeatInterval = setInterval(() => {
            if (_socket && _socket.readyState === WebSocket.OPEN) {
                _lastPingTime = Date.now();
                _socket.send(JSON.stringify({ type: 'ping' }));
                _log('Ping sent');
                
                // Set up stalled connection detection
                _stalledConnectionTimeout = setTimeout(() => {
                    // If we haven't received a pong since our last ping
                    if (!_lastPongTime || _lastPongTime < _lastPingTime) {
                        _heartbeatMissCount++;
                        _log(`Heartbeat missed (${_heartbeatMissCount}/${_maxHeartbeatMisses})`);
                        
                        // Publish heartbeat miss event
                        if (ABDRE.EventBus) {
                            ABDRE.EventBus.publish('realtime:heartbeat_missed', {
                                missCount: _heartbeatMissCount,
                                maxMisses: _maxHeartbeatMisses,
                                timestamp: new Date().toISOString()
                            });
                        }
                        
                        // If we've missed too many heartbeats, assume connection is stalled
                        if (_heartbeatMissCount >= _maxHeartbeatMisses) {
                            _log('Connection appears stalled, attempting reconnect');
                            
                            // Publish stalled connection event
                            if (ABDRE.EventBus) {
                                ABDRE.EventBus.publish(EVENTS.ERROR, {
                                    code: 'stalled_connection',
                                    message: 'Connection stalled (missing heartbeats)',
                                    timestamp: new Date().toISOString(),
                                    details: {
                                        missedHeartbeats: _heartbeatMissCount,
                                        lastPingTime: _lastPingTime ? new Date(_lastPingTime).toISOString() : null,
                                        lastPongTime: _lastPongTime ? new Date(_lastPongTime).toISOString() : null
                                    }
                                });
                            }
                            
                            // Force reconnection
                            if (_socket) {
                                try {
                                    _socket.close(4000, 'Stalled connection detected');
                                } catch (e) {
                                    _log('Error closing stalled socket:', e);
                                }
                            }
                            
                            _setConnectionState(STATES.DISCONNECTED);
                            _reconnect();
                        }
                    }
                }, 10000); // Wait 10 seconds for a pong response
            }
        }, 30000); // Send ping every 30 seconds
    }
    
    function _clearHeartbeat() {
        if (_heartbeatInterval) {
            clearInterval(_heartbeatInterval);
            _heartbeatInterval = null;
        }
        
        if (_stalledConnectionTimeout) {
            clearTimeout(_stalledConnectionTimeout);
            _stalledConnectionTimeout = null;
        }
    }
    
    function _handlePong(message) {
        // Calculate latency if we have a last ping time
        if (_lastPingTime) {
            _socketLatency = Date.now() - _lastPingTime;
            _log('Pong received, latency:', _socketLatency + 'ms');
            _lastPingTime = null;
            
            // Update last pong time to track heartbeat responses
            _lastPongTime = Date.now();
            
            // Reset heartbeat miss counter since we got a response
            _heartbeatMissCount = 0;
            
            // Publish latency update
            if (ABDRE.EventBus) {
                ABDRE.EventBus.publish('realtime:latency_update', {
                    latency: _socketLatency,
                    timestamp: new Date().toISOString()
                });
            }
        }
        
        // Check if this was a test ping (has a testId)
        if (message && message.testId) {
            const testLatency = Date.now() - parseInt(message.testId, 10);
            
            // Publish test result
            if (ABDRE.EventBus) {
                ABDRE.EventBus.publish('realtime:test_result', {
                    success: true,
                    latency: testLatency,
                    timestamp: new Date().toISOString()
                });
            }
        }
    }
    
    function _reconnect() {
        if (_reconnectAttempts >= _maxReconnectAttempts) {
            _log('Max reconnect attempts reached, giving up');
            
            // Publish terminal failure event
            if (ABDRE.EventBus) {
                ABDRE.EventBus.publish(EVENTS.ERROR, {
                    code: 'max_reconnect_attempts',
                    message: 'Failed to reconnect after maximum number of attempts',
                    timestamp: new Date().toISOString(),
                    details: {
                        attempts: _reconnectAttempts,
                        maxAttempts: _maxReconnectAttempts
                    }
                });
            }
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
                nextAttemptIn: backoffTime,
                timestamp: new Date().toISOString()
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
                    _handlePong(message);
                    return;
                    
                case 'auth_success':
                    _setConnectionState(STATES.CONNECTED);
                    // Publish authenticated event
                    if (ABDRE.EventBus) {
                        ABDRE.EventBus.publish(EVENTS.AUTHENTICATED, {
                            userId: message.user_id,
                            timestamp: new Date().toISOString()
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
                
                case 'connection_status':
                    // Handle connection status updates from server
                    _log('Connection status update:', message);
                    if (ABDRE.EventBus) {
                        ABDRE.EventBus.publish('realtime:server_status', {
                            serverTime: message.server_time,
                            activeConnections: message.active_connections,
                            serverLoad: message.server_load,
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
        
        // Create detailed close event information
        const closeInfo = {
            code: event.code,
            reason: event.reason || 'No reason provided',
            timestamp: new Date().toISOString(),
            wasClean: event.wasClean
        };
        
        // Handle different closure scenarios
        let shouldReconnect = true;
        
        switch (event.code) {
            case 1000: // Normal closure
                shouldReconnect = false;
                break;
                
            case 1001: // Going away (page navigation, etc.)
                shouldReconnect = false;
                break;
                
            case 1006: // Abnormal closure (connection lost)
                closeInfo.friendlyMessage = 'Connection lost unexpectedly';
                break;
                
            case 1008: // Policy violation
                closeInfo.friendlyMessage = 'Connection closed due to policy violation';
                break;
                
            case 1011: // Server error
                closeInfo.friendlyMessage = 'Server encountered an error';
                break;
                
            default:
                closeInfo.friendlyMessage = `Connection closed (code: ${event.code})`;
        }
        
        // Publish detailed close event
        if (ABDRE.EventBus) {
            ABDRE.EventBus.publish('realtime:connection_closed', closeInfo);
            
            // Also publish as error for unexpected closures
            if (event.code !== 1000 && event.code !== 1001) {
                ABDRE.EventBus.publish(EVENTS.ERROR, {
                    code: 'connection_closed',
                    message: closeInfo.friendlyMessage,
                    timestamp: closeInfo.timestamp,
                    details: closeInfo
                });
            }
        }
        
        // Attempt to reconnect if needed
        if (shouldReconnect) {
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
            // Validate the WebSocket URL
            let wsUrl = _socketUrl;
            
            // Check if URL is properly formatted
            if (!wsUrl.startsWith('ws://') && !wsUrl.startsWith('wss://')) {
                // Determine protocol based on page protocol
                const isSecure = window.location.protocol === 'https:';
                const wsProtocol = isSecure ? 'wss://' : 'ws://';
                
                // If URL starts with a slash, it's a relative path
                if (wsUrl.startsWith('/')) {
                    wsUrl = `${wsProtocol}${window.location.host}${wsUrl}`;
                } 
                // If URL doesn't have a protocol but doesn't start with a slash,
                // assume it's a hostname or hostname+path
                else if (!wsUrl.includes('://')) {
                    wsUrl = `${wsProtocol}${wsUrl}`;
                }
            }
            
            _log('Connecting to', wsUrl);
            _socket = new WebSocket(wsUrl);
            
            // Set up event handlers
            _socket.onopen = _handleOpen;
            _socket.onclose = _handleClose;
            _socket.onerror = function(error) {
                // Enhanced error handling with more details
                const errorDetails = {
                    timestamp: new Date().toISOString(),
                    url: wsUrl,
                    readyState: _socket ? _socket.readyState : 'null',
                    reconnectAttempts: _reconnectAttempts
                };
                
                _log('WebSocket connection error:', error, errorDetails);
                
                // Publish detailed error event
                if (ABDRE.EventBus) {
                    ABDRE.EventBus.publish(EVENTS.ERROR, {
                        code: 'connection_error',
                        message: 'Failed to establish WebSocket connection',
                        timestamp: errorDetails.timestamp,
                        details: errorDetails
                    });
                }
                
                _handleError(error);
            };
            _socket.onmessage = _handleMessage;
            
        } catch (error) {
            _log('Failed to create WebSocket:', error);
            
            // Publish detailed error about the failure
            if (ABDRE.EventBus) {
                ABDRE.EventBus.publish(EVENTS.ERROR, {
                    code: 'websocket_creation_error',
                    message: 'Failed to create WebSocket connection',
                    timestamp: new Date().toISOString(),
                    details: {
                        errorMessage: error.message,
                        url: _socketUrl
                    }
                });
            }
            
            _setConnectionState(STATES.DISCONNECTED);
            _reconnect();
        }
    }
    
    // Public API
    return {
        init: function(options = {}) {
            // Don't re-initialize if already initialized
            if (_initialized) {
                console.warn('RealtimeService already initialized');
                return this;
            }
            
            // Properly construct the WebSocket URL
            if (options.url) {
                _socketUrl = options.url;
            } else {
                const host = options.host || window.location.host;
                const path = options.path || '/ws';
                const isSecure = window.location.protocol === 'https:';
                const wsProtocol = isSecure ? 'wss://' : 'ws://';
                
                _socketUrl = `${wsProtocol}${host}${path}`;
            }
            
            // Set configuration options
            _debug = options.debug || false;
            if (options.authToken) _authToken = options.authToken;
            _maxReconnectAttempts = options.maxReconnectAttempts || 10;
            _reconnectInterval = options.reconnectInterval || 1000;
            _maxHeartbeatMisses = options.maxHeartbeatMisses || 2;
            
            _log('Initialized with options:', options, 'WebSocket URL:', _socketUrl);
            
            // Subscribe to auth events
            if (ABDRE.EventBus) {
                ABDRE.EventBus.subscribe('auth:authenticated', (data) => {
                    this.setAuthToken(data.token);
                });
                
                ABDRE.EventBus.subscribe('auth:unauthenticated', () => {
                    this.setAuthToken(null);
                });
            }
            
            _initialized = true;
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
        
        testConnection: function() {
            _log('Testing connection');
            
            // If not connected, return connection state
            if (!_socket || _socket.readyState !== WebSocket.OPEN) {
                return {
                    connected: false,
                    state: _state,
                    reason: 'Not connected'
                };
            }
            
            // Send a ping to test connection
            const pingStart = Date.now();
            _socket.send(JSON.stringify({ type: 'ping', testId: pingStart }));
            
            // Return current state
            return {
                connected: true,
                state: _state,
                latency: _socketLatency,
                lastTestTime: new Date().toISOString()
            };
        },
        
        resetReconnectAttempts: function() {
            _reconnectAttempts = 0;
            _log('Reconnect attempts counter reset');
            return this;
        },
        
        // Constants that can be used by subscribers
        STATES: STATES,
        EVENTS: EVENTS
    };
})(); 