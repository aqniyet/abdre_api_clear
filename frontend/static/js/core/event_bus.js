/**
 * ABDRE Chat - Event Bus Module
 * 
 * Implements a publish/subscribe (pub/sub) event system to enable
 * decoupled communication between different parts of the application.
 */

// Ensure ABDRE namespace exists
window.ABDRE = window.ABDRE || {};

// Event Bus Module
ABDRE.EventBus = (function() {
    // Private variables
    const _subscribers = {};
    let _debug = false;
    
    // Private methods
    function _logEvent(action, event, data) {
        if (!_debug) return;
        
        const timestamp = new Date().toISOString();
        console.groupCollapsed(`[EventBus] ${action}: ${event} @ ${timestamp}`);
        console.log('Event:', event);
        console.log('Data:', data);
        console.groupEnd();
    }
    
    function _validateEventName(event) {
        if (typeof event !== 'string' || event.trim() === '') {
            throw new Error('Event name must be a non-empty string');
        }
        return event.trim();
    }
    
    // Public API
    return {
        init: function(options = {}) {
            _debug = options.debug || false;
            console.info('Event Bus initialized');
        },
        
        /**
         * Subscribe to an event
         * 
         * @param {string} event - The event name to subscribe to
         * @param {function} callback - Function to execute when event is published
         * @returns {object} Subscription object with unsubscribe method
         */
        subscribe: function(event, callback) {
            event = _validateEventName(event);
            
            if (typeof callback !== 'function') {
                throw new Error('Callback must be a function');
            }
            
            // Initialize event array if it doesn't exist
            if (!_subscribers[event]) {
                _subscribers[event] = [];
            }
            
            // Add callback to subscribers list
            _subscribers[event].push(callback);
            
            _logEvent('SUBSCRIBE', event, { callbackFn: callback.name || 'anonymous' });
            
            // Return subscription object with unsubscribe method
            return {
                unsubscribe: function() {
                    const index = _subscribers[event].indexOf(callback);
                    if (index !== -1) {
                        _subscribers[event].splice(index, 1);
                        _logEvent('UNSUBSCRIBE', event, { callbackFn: callback.name || 'anonymous' });
                    }
                }
            };
        },
        
        /**
         * Publish an event with data
         * 
         * @param {string} event - The event name to publish
         * @param {*} data - Data to pass to subscribers
         * @returns {boolean} True if the event had subscribers
         */
        publish: function(event, data) {
            event = _validateEventName(event);
            
            // If no subscribers, return false
            if (!_subscribers[event] || _subscribers[event].length === 0) {
                _logEvent('PUBLISH (no subscribers)', event, data);
                return false;
            }
            
            _logEvent('PUBLISH', event, data);
            
            // Execute all subscriber callbacks
            _subscribers[event].forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`Error in subscriber callback for event '${event}':`, error);
                }
            });
            
            return true;
        },
        
        /**
         * Check if an event has subscribers
         * 
         * @param {string} event - The event name to check
         * @returns {boolean} True if the event has subscribers
         */
        hasSubscribers: function(event) {
            event = _validateEventName(event);
            return !!(_subscribers[event] && _subscribers[event].length > 0);
        },
        
        /**
         * Clear all subscribers for an event
         * 
         * @param {string} event - The event name to clear subscribers for
         * @returns {boolean} True if subscribers were cleared
         */
        clear: function(event) {
            event = _validateEventName(event);
            
            if (_subscribers[event]) {
                _logEvent('CLEAR', event, { count: _subscribers[event].length });
                delete _subscribers[event];
                return true;
            }
            return false;
        },
        
        /**
         * Clear all subscribers for all events
         */
        clearAll: function() {
            const eventCount = Object.keys(_subscribers).length;
            _logEvent('CLEAR ALL', 'all events', { eventCount });
            
            // Reset subscribers object
            for (const event in _subscribers) {
                delete _subscribers[event];
            }
        }
    };
})(); 