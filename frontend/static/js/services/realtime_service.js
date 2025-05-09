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
    let _socketIoSessionId = null;
    let _transportType = 'websocket';
    
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
        _clearHeartbeat();
        
        // Setup new heartbeat
        _heartbeatInterval = setInterval(() => {
            if (_socket && _socket.readyState === WebSocket.OPEN) {
                // Send ping message
                _lastPingTime = Date.now();
                
                _socket.send(JSON.stringify({
                    type: 'ping',
                    timestamp: new Date().toISOString()
                }));
                
                // Setup timeout to detect missed pongs
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
                            _log('Connection stalled, attempting reconnect');
                            
                            // Force close socket and reconnect
                            if (_socket) {
                                _socket.close();
                                _socket = null;
                                
                                // Reset heartbeat counters
                                _heartbeatMissCount = 0;
                                _lastPingTime = null;
                                _lastPongTime = null;
                                
                                // Attempt reconnect
                                _reconnect();
                            }
                        }
                    } else {
                        // Reset heartbeat miss counter if we got a pong
                        _heartbeatMissCount = 0;
                    }
                }, 5000); // Wait 5 seconds for pong
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
    
    function _authenticate() {
        if (!_socket || _socket.readyState !== WebSocket.OPEN) {
            _log('Cannot authenticate: socket not connected');
            return;
        }
        
        if (!_authToken) {
            _log('Cannot authenticate: no auth token');
            return;
        }
        
        _log('Authenticating with token');
        
        // Send authentication message
        _socket.send(JSON.stringify({
            type: 'authenticate',
            token: _authToken
        }));
    }
    
    function _flushQueue() {
        // Check if we have messages in the queue
        if (_messageQueue.length === 0) return;
        
        // Only flush if connected
        if (_state !== STATES.CONNECTED) return;
        
        _log(`Flushing queue: ${_messageQueue.length} messages`);
        
        // Send all queued messages
        _messageQueue.forEach(message => {
            _socket.send(JSON.stringify(message));
        });
        
        // Clear queue
        _messageQueue = [];
    }
    
    function _queueMessage(message) {
        _log('Queuing message:', message);
        _messageQueue.push(message);
    }
    
    function _handleMessage(event) {
        try {
            const message = JSON.parse(event.data);
            
            _log('Received message:', message);
            
            // Handle special message types
            switch (message.type) {
                case 'pong':
                    _handlePong(message);
                    return;
                    
                case 'auth_success':
                    _log('Authentication successful');
                    _setConnectionState(STATES.CONNECTED);
                    
                    // Flush message queue after successful authentication
                    _flushQueue();
                    
                    // Publish authenticated event
                    if (ABDRE.EventBus) {
                        ABDRE.EventBus.publish(EVENTS.AUTHENTICATED, {
                            user_id: message.user_id,
                            is_guest: message.is_guest,
                            timestamp: new Date().toISOString()
                        });
                    }
                    return;
                    
                case 'auth_error':
                    _log('Authentication error:', message.error);
                    
                    // Publish error event
                    if (ABDRE.EventBus) {
                        ABDRE.EventBus.publish(EVENTS.ERROR, {
                            code: 'auth_error',
                            message: message.error || 'Authentication failed',
                            timestamp: new Date().toISOString()
                        });
                    }
                    return;
                    
                case 'error':
                    _log('Error from server:', message.error);
                    
                    // Publish error event
                    if (ABDRE.EventBus) {
                        ABDRE.EventBus.publish(EVENTS.ERROR, {
                            code: 'server_error',
                            message: message.error || 'Server error',
                            timestamp: new Date().toISOString(),
                            details: message.details || {}
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
        _log('Connection closed:', event);
        
        // Clean up
        _clearHeartbeat();
        
        // Set disconnect state
        _setConnectionState(STATES.DISCONNECTED);
        
        // Publish close event with details
        if (ABDRE.EventBus) {
            ABDRE.EventBus.publish(EVENTS.ERROR, {
                code: 'connection_closed',
                message: 'Connection lost unexpectedly',
                timestamp: new Date().toISOString(),
                details: {
                    code: event.code,
                    reason: event.reason || 'No reason provided',
                    timestamp: new Date().toISOString(),
                    wasClean: event.wasClean,
                    friendlyMessage: event.wasClean ? 'Connection closed normally' : 'Connection lost unexpectedly'
                }
            });
        }
        
        // Attempt reconnect if connection was lost unexpectedly
        if (!event.wasClean) {
            _reconnect();
        }
    }
    
    function _handleError(event) {
        _log('Connection error:', event);
        
        // Publish error event
        if (ABDRE.EventBus) {
            ABDRE.EventBus.publish(EVENTS.ERROR, {
                code: 'connection_error',
                message: 'WebSocket connection error',
                timestamp: new Date().toISOString(),
                details: event
            });
        }
    }
    
    function _reconnect() {
        // Don't attempt to reconnect if we exceeded max attempts
        if (_reconnectAttempts >= _maxReconnectAttempts) {
            _log('Max reconnect attempts reached');
            
            // Publish error event
            if (ABDRE.EventBus) {
                ABDRE.EventBus.publish(EVENTS.ERROR, {
                    code: 'max_reconnect_attempts',
                    message: 'Failed to reconnect after maximum attempts',
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
            _reconnectTimer = null;
        }
        
        // Calculate backoff delay with exponential increase (max 30s)
        const delay = Math.min(30000, _reconnectInterval * Math.pow(1.5, _reconnectAttempts));
        
        _reconnectAttempts++;
        
        _log(`Reconnecting (attempt ${_reconnectAttempts}) in ${delay}ms`);
        
        // Publish reconnecting event
        if (ABDRE.EventBus) {
            ABDRE.EventBus.publish(EVENTS.RECONNECTING, {
                attempt: _reconnectAttempts,
                maxAttempts: _maxReconnectAttempts,
                delay: delay,
                timestamp: new Date().toISOString()
            });
        }
        
        // Schedule reconnect
        _reconnectTimer = setTimeout(() => {
            _connect();
        }, delay);
    }
    
    // Function to initiate Socket.IO handshake via HTTP
    function _initiateSocketIOHandshake(url) {
        return new Promise((resolve, reject) => {
            // Extract base URL without path for Socket.IO handshake
            const urlObj = new URL(url);
            const baseUrl = `${urlObj.protocol}//${urlObj.host}`;
            
            // Perform Socket.IO handshake using fetch
            const handshakeUrl = `${baseUrl}/socket.io/?EIO=4&transport=polling`;
            
            fetch(handshakeUrl)
                .then(response => response.text())
                .then(text => {
                    // Socket.IO protocol prefixes responses with a number and JSON
                    // Example: "0{\"sid\":\"...\",\"upgrades\":[\"websocket\"],\"pingInterval\":25000,\"pingTimeout\":20000}"
                    const jsonStartIndex = text.indexOf('{');
                    if (jsonStartIndex === -1) throw new Error('Invalid Socket.IO response');
                    
                    const jsonData = text.substring(jsonStartIndex);
                    const data = JSON.parse(jsonData);
                    
                    if (!data.sid) throw new Error('No session ID in Socket.IO response');
                    
                    _log('Socket.IO handshake successful, sid:', data.sid);
                    resolve({
                        sid: data.sid,
                        pingInterval: data.pingInterval,
                        pingTimeout: data.pingTimeout,
                        upgrades: data.upgrades
                    });
                })
                .catch(error => {
                    _log('Socket.IO handshake failed:', error);
                    reject(error);
                });
        });
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
            let httpUrl;
            
            // Check if URL is properly formatted
            if (!wsUrl.startsWith('ws://') && !wsUrl.startsWith('wss://')) {
                // Determine protocol based on page protocol
                const isSecure = window.location.protocol === 'https:';
                const wsProtocol = isSecure ? 'wss://' : 'ws://';
                const httpProtocol = isSecure ? 'https://' : 'http://';
                
                // If URL starts with a slash, it's a relative path
                if (wsUrl.startsWith('/')) {
                    // Force the hostname+port to use port 5000 for socket.io
                    const hostname = window.location.hostname + ':5000';
                    wsUrl = `${wsProtocol}${hostname}${wsUrl}`;
                    httpUrl = `${httpProtocol}${hostname}${wsUrl.substring(wsUrl.indexOf('/'))}`;
                } 
                // If URL doesn't have a protocol but doesn't start with a slash,
                // assume it's a hostname or hostname+path
                else if (!wsUrl.includes('://')) {
                    // Ensure we're using port 5000 for Socket.IO
                    if (!wsUrl.includes(':5000')) {
                        // Replace port if it exists, or add port 5000
                        wsUrl = wsUrl.replace(/:\d+/, ':5000');
                        if (!wsUrl.includes(':5000')) {
                            wsUrl = wsUrl + ':5000';
                        }
                    }
                    wsUrl = `${wsProtocol}${wsUrl}`;
                    httpUrl = `${httpProtocol}${wsUrl.substring(wsProtocol.length)}`;
                }
            } else {
                // URL already has protocol (ws:// or wss://)
                // Ensure we're using port 5000 if it's a WebSocket URL
                if (!wsUrl.includes(':5000')) {
                    wsUrl = wsUrl.replace(/:\d+\//, ':5000/');
                    if (!wsUrl.match(/:\d+\//)) {
                        wsUrl = wsUrl.replace(/(ws[s]?:\/\/[^\/]+)/, '$1:5000');
                    }
                }
                
                // Convert to HTTP URL for handshake
                httpUrl = wsUrl.replace(/^ws/, 'http');
            }
            
            console.log('Connecting to WebSocket URL:', wsUrl);
            
            // For Socket.IO specifically
            // First perform HTTP handshake to get session ID
            _initiateSocketIOHandshake(httpUrl)
                .then(handshakeData => {
                    _socketIoSessionId = handshakeData.sid;
                    
                    // Now create WebSocket connection with session ID
                    let socketUrl = wsUrl;
                    if (!socketUrl.includes('?')) {
                        socketUrl += '?';
                    } else {
                        socketUrl += '&';
                    }
                    
                    // Ensure the path ends with a slash before the query parameters
                    if (!socketUrl.includes('/socket.io/')) {
                        socketUrl = socketUrl.replace('/socket.io', '/socket.io/');
                    }
                    
                    socketUrl += `EIO=4&transport=${_transportType}&sid=${_socketIoSessionId}`;
                    
                    // Add token for auth if available
                    if (_authToken) {
                        socketUrl += `&token=${encodeURIComponent(_authToken)}`;
                    }
                    
                    _log('Opening WebSocket connection to:', socketUrl);
                    _socket = new WebSocket(socketUrl);
                    
                    // Set up event handlers
                    _socket.onopen = _handleOpen;
                    _socket.onclose = _handleClose;
                    _socket.onmessage = _handleMessage;
                    _socket.onerror = _handleError;
                })
                .catch(error => {
                    _log('Failed to perform Socket.IO handshake:', error);
                    _setConnectionState(STATES.DISCONNECTED);
                    _reconnect();
                });
        } catch (error) {
            _log('Connection error:', error);
            
            // Publish error event
            if (ABDRE.EventBus) {
                ABDRE.EventBus.publish(EVENTS.ERROR, {
                    code: 'connection_error',
                    message: 'Failed to establish WebSocket connection',
                    timestamp: new Date().toISOString(),
                    details: {
                        timestamp: new Date().toISOString(),
                        url: wsUrl,
                        readyState: _socket ? _socket.readyState : null,
                        reconnectAttempts: _reconnectAttempts,
                        error: error
                    }
                });
            }
            
            // Set disconnect state
            _setConnectionState(STATES.DISCONNECTED);
            
            // Attempt reconnect
            _reconnect();
        }
    }
    
    function _testConnection() {
        if (_state !== STATES.CONNECTED) {
            return false;
        }
        
        // Send a test ping with timestamp as ID
        const testId = Date.now();
        
        _socket.send(JSON.stringify({
            type: 'ping',
            testId: testId
        }));
        
        return true;
    }
    
    // Public API
    return {
        STATES: STATES,
        EVENTS: EVENTS,
        
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
                // Always force port 5000 for socket.io
                const host = options.host || window.location.hostname + ':5000';
                const path = options.path || '/socket.io';
                const isSecure = window.location.protocol === 'https:';
                const wsProtocol = isSecure ? 'wss://' : 'ws://';
                
                // Ensure host has port 5000
                let hostWithPort = host;
                if (!hostWithPort.includes(':5000')) {
                    hostWithPort = hostWithPort.replace(/:\d+/, ':5000');
                    if (!hostWithPort.includes(':')) {
                        hostWithPort += ':5000';
                    }
                }
                
                _socketUrl = `${wsProtocol}${hostWithPort}${path}`;
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
            if (_socket) {
                _socket.close();
                _socket = null;
            }
            
            _setConnectionState(STATES.DISCONNECTED);
            return this;
        },
        
        reconnect: function() {
            _reconnectAttempts = 0; // Reset reconnect attempts
            _reconnect();
            return this;
        },
        
        sendMessage: function(message) {
            if (_state === STATES.CONNECTED && _socket && _socket.readyState === WebSocket.OPEN) {
                _socket.send(JSON.stringify(message));
            } else {
                _queueMessage(message);
            }
            return this;
        },
        
        testConnection: function() {
            return _testConnection();
        },
        
        getState: function() {
            return _state;
        },
        
        getLatency: function() {
            return _socketLatency;
        },
        
        setAuthToken: function(token) {
            _authToken = token;
            
            // If connected, send authentication with new token
            if (_state === STATES.CONNECTED && _socket && _socket.readyState === WebSocket.OPEN) {
                _authenticate();
            }
            
            return this;
        },
        
        getDebugInfo: function() {
            return {
                state: _state,
                socketUrl: _socketUrl,
                socketState: _socket ? _socket.readyState : null,
                reconnectAttempts: _reconnectAttempts,
                maxReconnectAttempts: _maxReconnectAttempts,
                queueLength: _messageQueue.length,
                latency: _socketLatency,
                heartbeatMissCount: _heartbeatMissCount,
                socketIoSessionId: _socketIoSessionId
            };
        }
    };
})(); 