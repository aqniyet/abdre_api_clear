/**
 * ABDRE Chat - Error Handler Module
 * 
 * Provides centralized error handling for the application.
 * Captures errors from component integration, API calls, and WebSocket connections.
 */

// Ensure ABDRE namespace exists
window.ABDRE = window.ABDRE || {};

// Error Handler Module
ABDRE.ErrorHandler = (function() {
    // Private variables
    let _initialized = false;
    let _debug = false;
    let _logToServer = true;
    let _errorLog = [];
    const MAX_LOG_SIZE = 50;
    
    // Private methods
    function _logError(error) {
        // Add timestamp to error
        const errorWithMeta = {
            timestamp: new Date().toISOString(),
            ...error
        };
        
        // Log to console in debug mode
        if (_debug) {
            console.error('[ErrorHandler]', errorWithMeta);
        }
        
        // Add to error log, maintaining maximum size
        _errorLog.push(errorWithMeta);
        if (_errorLog.length > MAX_LOG_SIZE) {
            _errorLog.shift();
        }
        
        // Log to server if enabled
        if (_logToServer && ABDRE.ApiClient) {
            // Log to server endpoint
            ABDRE.ApiClient.post('/logs/client-error', errorWithMeta)
                .catch(e => {
                    // Silent catch to avoid infinite loops
                    if (_debug) {
                        console.error('Failed to log error to server:', e);
                    }
                });
            
            // Also log to dedicated file via endpoint
            ABDRE.ApiClient.post('/logs/file-log', {
                file: 'error_tracking.log',
                message: `${errorWithMeta.timestamp} - ${errorWithMeta.type}: ${errorWithMeta.message || 'No message'}`,
                level: 'ERROR'
            }).catch(() => { /* Silent catch */ });
        }
    }
    
    function _handleApiError(error) {
        _logError({
            type: 'api_error',
            details: error
        });
        
        // Notify user based on error type
        if (error.status === 401 || error.status === 403) {
            _showAuthError();
        } else if (error.status === 429) {
            _showRateLimitError();
        } else if (error.status >= 500) {
            _showServerError();
        }
    }
    
    function _handleWebSocketError(error) {
        _logError({
            type: 'websocket_error',
            details: error
        });
        
        // Notify user only if there's a terminal connection failure
        if (error.code === 'max_reconnect_attempts') {
            _showConnectionError();
        }
    }
    
    function _handleComponentError(error) {
        _logError({
            type: 'component_error',
            details: error
        });
        
        // Optionally show user feedback based on severity
        if (error.severity === 'critical') {
            _showComponentError(error);
        }
    }
    
    function _showAuthError() {
        // Show authentication error UI
        const errorContainer = document.getElementById('error-container');
        if (errorContainer) {
            errorContainer.innerHTML = `
                <div class="error-message auth-error">
                    <p>Your session has expired. Please refresh the page or log in again.</p>
                    <button id="refresh-auth-btn" class="btn btn-primary">Refresh</button>
                </div>
            `;
            
            // Add event listener for refresh button
            const refreshBtn = document.getElementById('refresh-auth-btn');
            if (refreshBtn) {
                refreshBtn.addEventListener('click', () => {
                    window.location.reload();
                });
            }
            
            errorContainer.style.display = 'block';
        }
    }
    
    function _showConnectionError() {
        // Show connection error UI
        const errorContainer = document.getElementById('error-container');
        if (errorContainer) {
            errorContainer.innerHTML = `
                <div class="error-message connection-error">
                    <p>Connection to the server has been lost. Please check your internet connection and try again.</p>
                    <button id="reconnect-btn" class="btn btn-primary">Reconnect</button>
                </div>
            `;
            
            // Add event listener for reconnect button
            const reconnectBtn = document.getElementById('reconnect-btn');
            if (reconnectBtn) {
                reconnectBtn.addEventListener('click', () => {
                    if (ABDRE.RealtimeService) {
                        ABDRE.RealtimeService.reconnect();
                    }
                    errorContainer.style.display = 'none';
                });
            }
            
            errorContainer.style.display = 'block';
        }
    }
    
    function _showServerError() {
        // Show server error UI
        const errorContainer = document.getElementById('error-container');
        if (errorContainer) {
            errorContainer.innerHTML = `
                <div class="error-message server-error">
                    <p>The server encountered an error. Please try again later.</p>
                    <button id="close-error-btn" class="btn btn-secondary">Close</button>
                </div>
            `;
            
            // Add event listener for close button
            const closeBtn = document.getElementById('close-error-btn');
            if (closeBtn) {
                closeBtn.addEventListener('click', () => {
                    errorContainer.style.display = 'none';
                });
            }
            
            errorContainer.style.display = 'block';
        }
    }
    
    function _showRateLimitError() {
        // Show rate limit error UI
        const errorContainer = document.getElementById('error-container');
        if (errorContainer) {
            errorContainer.innerHTML = `
                <div class="error-message rate-limit-error">
                    <p>You've made too many requests. Please wait a moment and try again.</p>
                    <button id="close-error-btn" class="btn btn-secondary">Close</button>
                </div>
            `;
            
            // Add event listener for close button
            const closeBtn = document.getElementById('close-error-btn');
            if (closeBtn) {
                closeBtn.addEventListener('click', () => {
                    errorContainer.style.display = 'none';
                });
            }
            
            errorContainer.style.display = 'block';
        }
    }
    
    function _showComponentError(error) {
        // Show component error UI
        const errorContainer = document.getElementById('error-container');
        if (errorContainer) {
            errorContainer.innerHTML = `
                <div class="error-message component-error">
                    <p>An error occurred in the application. ${error.message || ''}</p>
                    <button id="close-error-btn" class="btn btn-secondary">Close</button>
                </div>
            `;
            
            // Add event listener for close button
            const closeBtn = document.getElementById('close-error-btn');
            if (closeBtn) {
                closeBtn.addEventListener('click', () => {
                    errorContainer.style.display = 'none';
                });
            }
            
            errorContainer.style.display = 'block';
        }
    }
    
    function _setupGlobalErrorHandler() {
        // Capture unhandled JavaScript errors
        window.addEventListener('error', (event) => {
            _logError({
                type: 'unhandled_error',
                message: event.message,
                filename: event.filename,
                lineno: event.lineno,
                colno: event.colno,
                stack: event.error ? event.error.stack : null
            });
        });
        
        // Capture unhandled promise rejections
        window.addEventListener('unhandledrejection', (event) => {
            _logError({
                type: 'unhandled_promise_rejection',
                reason: event.reason ? event.reason.toString() : 'Unknown reason',
                stack: event.reason && event.reason.stack ? event.reason.stack : null
            });
        });
    }
    
    function _setupEventBusListeners() {
        if (!ABDRE.EventBus) {
            console.error('EventBus not available for error handler');
            return;
        }
        
        // Listen for API errors
        ABDRE.EventBus.subscribe('api:error', _handleApiError);
        
        // Listen for WebSocket errors
        ABDRE.EventBus.subscribe('realtime:error', _handleWebSocketError);
        
        // Listen for component errors
        ABDRE.EventBus.subscribe('component:error', _handleComponentError);
    }
    
    // Public API
    return {
        init: function(options = {}) {
            if (_initialized) {
                console.warn('Error handler already initialized');
                return this;
            }
            
            // Set configuration options
            _debug = options.debug !== undefined ? options.debug : false;
            _logToServer = options.logToServer !== undefined ? options.logToServer : true;
            
            // Setup global error handlers
            _setupGlobalErrorHandler();
            
            // Setup event bus listeners if available
            if (ABDRE.EventBus) {
                _setupEventBusListeners();
            } else {
                console.warn('EventBus not available, error handling will be limited');
                
                // Try again when app is ready
                document.addEventListener('DOMContentLoaded', () => {
                    if (ABDRE.EventBus) {
                        _setupEventBusListeners();
                    }
                });
            }
            
            _initialized = true;
            console.info('Error handler initialized');
            
            return this;
        },
        
        /**
         * Manually report an error
         * 
         * @param {string} type - The type of error
         * @param {string} message - Error message
         * @param {Object} details - Additional error details
         */
        reportError: function(type, message, details = {}) {
            _logError({
                type: type,
                message: message,
                details: details
            });
        },
        
        /**
         * Get the error log
         * 
         * @returns {Array} Array of logged errors
         */
        getErrorLog: function() {
            return [..._errorLog];
        },
        
        /**
         * Clear the error log
         */
        clearErrorLog: function() {
            _errorLog = [];
        }
    };
})(); 