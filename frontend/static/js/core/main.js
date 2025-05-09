/**
 * ABDRE Chat - Main Application Entry Point
 * Initializes core services and components
 */

// Ensure namespace exists
window.ABDRE = window.ABDRE || {};

// When DOM is ready, initialize components
document.addEventListener('DOMContentLoaded', function() {
    console.info('Initializing ABDRE Chat application...');
    
    // Debug mode detection
    const isDebugMode = document.body.classList.contains('debug-mode') || 
                         window.location.search.includes('debug=true');
    
    // Step 1: Initialize ErrorHandler first for capturing initialization errors
    if (ABDRE.ErrorHandler) {
        ABDRE.ErrorHandler.init({
            debug: isDebugMode,
            logToServer: true
        });
        console.info('✓ ErrorHandler initialized');
    } else {
        console.error('✗ Failed to initialize ErrorHandler - module not found');
    }
    
    // Step 2: Initialize Event Bus as it's required by other services
    if (ABDRE.EventBus) {
        ABDRE.EventBus.init({
            debug: isDebugMode
        });
        console.info('✓ EventBus initialized');
    } else {
        console.error('✗ Failed to initialize EventBus - module not found');
        if (ABDRE.ErrorHandler) {
            ABDRE.ErrorHandler.reportError('initialization_error', 'Failed to initialize EventBus - module not found');
        }
    }
    
    // Step 3: Initialize the API Client as services depend on it
    if (ABDRE.ApiClient) {
        ABDRE.ApiClient.init({
            debug: isDebugMode,
            baseUrl: window.location.protocol + '//' + window.location.hostname + ':5001/api'
        });
        console.info('✓ ApiClient initialized');
    } else {
        console.error('✗ Failed to initialize ApiClient - module not found');
        if (ABDRE.ErrorHandler) {
            ABDRE.ErrorHandler.reportError('initialization_error', 'Failed to initialize ApiClient - module not found');
        }
    }
    
    // Step 4: Initialize the Realtime Service for WebSocket communication
    if (ABDRE.RealtimeService) {
        ABDRE.RealtimeService.init({
            debug: true,
            reconnectInterval: 2000,
            host: window.location.hostname + ':5000',
            path: '/socket.io/',
            // Add a guest token for testing
            authToken: 'guest'
        });
        console.info('✓ RealtimeService initialized with debug mode and trailing slash');
        
        // Connect after initialization
        ABDRE.RealtimeService.connect();
    } else {
        console.warn('⚠ RealtimeService not available - real-time features will be disabled');
        if (ABDRE.ErrorHandler) {
            ABDRE.ErrorHandler.reportError('initialization_error', 'RealtimeService not available - real-time features will be disabled');
        }
    }
    
    // Step 5: Initialize the App with configuration after core services are ready
    if (ABDRE.App) {
        ABDRE.App.init({
            debug: isDebugMode,
            version: '1.0.0'
        });
        console.info('✓ App initialized');
    } else {
        console.error('✗ Failed to initialize App - module not found');
        if (ABDRE.ErrorHandler) {
            ABDRE.ErrorHandler.reportError('initialization_error', 'Failed to initialize App - module not found');
        }
    }
    
    // Step 6: Initialize subscribers that listen for events
    if (ABDRE.Subscribers) {
        if (ABDRE.Subscribers.Chat) {
            ABDRE.Subscribers.Chat.init();
            console.info('✓ Chat subscriber initialized');
        }
        
        // Initialize other subscribers here
    }
    
    // If in debug mode, report a test error to verify error logging
    if (isDebugMode) {
        setTimeout(function() {
            if (ABDRE.ErrorHandler) {
                ABDRE.ErrorHandler.reportError('test_error', 'This is a test error to verify error logging', {
                    source: 'main.js',
                    test: true
                });
                console.info('Test error reported');
            }
        }, 3000);
    }
    
    // Register service worker for offline capabilities
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', function() {
            navigator.serviceWorker.register('/static/js/service-worker.js', {
                scope: '/static/js/'
            }).then(function(registration) {
                console.info('ServiceWorker registration successful with scope: ', registration.scope);
            }).catch(function(error) {
                console.error('ServiceWorker registration failed: ', error);
            });
        });
    }
    
    console.info('ABDRE Chat application initialization complete');
}); 