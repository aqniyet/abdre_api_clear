/**
 * ABDRE Chat - Main Entry Point
 * 
 * This file serves as the main entry point for the application's JavaScript.
 * It initializes the app once the DOM is fully loaded and handles dependency order.
 */

// When DOM is fully loaded, initialize the application
document.addEventListener('DOMContentLoaded', function() {
    console.info('Initializing ABDRE Chat application...');
    
    const isDebugMode = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

    // Step 1: Initialize the Error Handler first to catch initialization errors
    if (ABDRE.ErrorHandler) {
        ABDRE.ErrorHandler.init({
            debug: isDebugMode,
            logToServer: !isDebugMode
        });
        console.info('✓ ErrorHandler initialized');
        
        // Also initialize Error Log Viewer in dev mode
        if (isDebugMode && ABDRE.Enhancers && ABDRE.Enhancers.ErrorLogViewer) {
            ABDRE.Enhancers.ErrorLogViewer.init({
                devMode: true,
                showOnInit: false // Only show when user presses Ctrl+Shift+L
            });
            console.info('✓ Error Log Viewer initialized (press Ctrl+Shift+L to open)');
        }
    } else {
        console.warn('⚠ ErrorHandler not available - error tracking will be limited');
    }

    // Step 2: Initialize the Event Bus as many components depend on it
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
        ABDRE.ApiClient.init('/api', {
            debug: isDebugMode
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
            debug: isDebugMode,
            reconnectInterval: 2000
        });
        console.info('✓ RealtimeService initialized');
        
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
    
    // Publish application ready event
    if (ABDRE.EventBus) {
        ABDRE.EventBus.publish('app:ready', {
            timestamp: new Date().toISOString(),
            location: window.location.pathname
        });
        
        // Test error reporting
        if (ABDRE.ErrorHandler) {
            // Generate a test error after 3 seconds
            setTimeout(() => {
                ABDRE.ErrorHandler.reportError(
                    'test_error',
                    'This is a test error to verify error logging',
                    { source: 'main.js', test: true }
                );
                console.info('Test error reported');
            }, 3000);
        }
    }
    
    console.info('ABDRE Chat application initialization complete');
});

// Handle service worker if present (for PWA support)
if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
        navigator.serviceWorker.register('/static/js/service-worker.js')
            .then(function(registration) {
                console.log('ServiceWorker registration successful with scope: ', registration.scope);
            })
            .catch(function(error) {
                console.log('ServiceWorker registration failed: ', error);
            });
    });
} 