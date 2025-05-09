/**
 * ABDRE Chat - Connection Status Enhancer
 * 
 * Enhances the connection status component to display the current state
 * of the WebSocket connection and provides visual feedback.
 */

// Ensure ABDRE namespace exists
window.ABDRE = window.ABDRE || {};
window.ABDRE.Enhancers = window.ABDRE.Enhancers || {};

// Connection Status Enhancer
ABDRE.Enhancers.ConnectionStatus = (function() {
    // Constants
    const STATUS_LABELS = {
        'disconnected': 'Disconnected',
        'connecting': 'Connecting...',
        'connected': 'Connected'
    };
    
    const STATUS_CLASSES = {
        'disconnected': 'connection-status--disconnected',
        'connecting': 'connection-status--connecting',
        'connected': 'connection-status--connected'
    };
    
    // DOM elements
    let _container = null;
    let _statusText = null;
    let _statusLatency = null;
    let _reconnectButton = null;
    
    // Variables for latency display
    let _isLatencyVisible = false;
    let _currentLatency = null;
    
    // Private methods
    function _updateStatusDisplay(state) {
        if (!_container) return;
        
        // Remove all state classes
        Object.values(STATUS_CLASSES).forEach(cls => {
            _container.classList.remove(cls);
        });
        
        // Add class for current state
        const stateClass = STATUS_CLASSES[state] || STATUS_CLASSES.disconnected;
        _container.classList.add(stateClass);
        
        // Update status text
        if (_statusText) {
            _statusText.textContent = STATUS_LABELS[state] || STATUS_LABELS.disconnected;
        }
        
        // Show/hide reconnect button
        if (_reconnectButton) {
            _reconnectButton.style.display = state === 'disconnected' ? 'flex' : 'none';
        }
        
        // Update latency display
        _updateLatencyDisplay();
    }
    
    function _updateLatencyDisplay() {
        if (!_statusLatency) return;
        
        if (_currentLatency !== null && _isLatencyVisible) {
            _statusLatency.textContent = `${_currentLatency} ms`;
            _statusLatency.style.display = 'inline';
            
            // Add color class based on latency value
            _statusLatency.classList.remove('latency--good', 'latency--medium', 'latency--poor');
            
            if (_currentLatency < 100) {
                _statusLatency.classList.add('latency--good');
            } else if (_currentLatency < 300) {
                _statusLatency.classList.add('latency--medium');
            } else {
                _statusLatency.classList.add('latency--poor');
            }
        } else {
            _statusLatency.style.display = 'none';
        }
    }
    
    function _handleReconnectClick() {
        // Add active class for button press animation
        _reconnectButton.classList.add('connection-status__reconnect-btn--active');
        
        // Remove after animation completes
        setTimeout(() => {
            _reconnectButton.classList.remove('connection-status__reconnect-btn--active');
        }, 300);
        
        // Trigger reconnect
        if (ABDRE.RealtimeService) {
            ABDRE.RealtimeService.reconnect();
        }
    }
    
    function _setupEvents() {
        // Subscribe to realtime service events
        if (ABDRE.EventBus && ABDRE.RealtimeService) {
            ABDRE.EventBus.subscribe(ABDRE.RealtimeService.EVENTS.STATE_CHANGED, (data) => {
                _updateStatusDisplay(data.state);
                
                // Update latency if available
                if (data.latency) {
                    _currentLatency = data.latency;
                    _updateLatencyDisplay();
                }
            });
            
            // Show current state on init
            const currentState = ABDRE.RealtimeService.getState();
            _updateStatusDisplay(currentState);
            
            // Get current latency if available
            _currentLatency = ABDRE.RealtimeService.getLatency();
        }
        
        // Setup reconnect button click handler
        if (_reconnectButton) {
            _reconnectButton.addEventListener('click', _handleReconnectClick);
        }
    }
    
    // Public API
    return {
        init: function(options = {}) {
            // Get DOM elements
            _container = document.getElementById('connection-status');
            
            if (!_container) {
                console.error('Connection status container not found');
                return this;
            }
            
            _statusText = _container.querySelector('.connection-status__text');
            _statusLatency = _container.querySelector('.connection-status__latency');
            _reconnectButton = _container.querySelector('#connection-reconnect');
            
            // Configure options
            _isLatencyVisible = options.showLatency !== false; // Default to true
            
            // Setup event handlers
            _setupEvents();
            
            return this;
        },
        
        showLatency: function(show) {
            _isLatencyVisible = show;
            _updateLatencyDisplay();
            return this;
        },
        
        getElement: function() {
            return _container;
        }
    };
})(); 