/**
 * ABDRE Chat - Core Application Module
 * 
 * Handles application initialization, configuration and lifecycle management.
 */

// Create global namespace for application
window.ABDRE = window.ABDRE || {};

// App Module
ABDRE.App = (function() {
    // Private variables
    const CONFIG = {
        apiEndpoint: '/api',
        debug: false,
        version: '1.0.0',
        sessionRefreshInterval: 300000, // 5 minutes
    };
    
    // Store event listeners for cleanup
    const _eventListeners = {};

    // Private methods
    function _setupEventListeners() {
        // Mobile menu toggle
        const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
        if (mobileMenuToggle) {
            const mobileMenuHandler = function() {
                const mainMenu = document.getElementById('main-menu');
                const isExpanded = this.getAttribute('aria-expanded') === 'true';
                
                this.setAttribute('aria-expanded', !isExpanded);
                mainMenu.classList.toggle('active');
                document.body.classList.toggle('menu-open');
            };
            
            mobileMenuToggle.addEventListener('click', mobileMenuHandler);
            // Store reference for cleanup
            _eventListeners.mobileMenu = {
                element: mobileMenuToggle,
                event: 'click',
                handler: mobileMenuHandler
            };
        }

        // User dropdown toggle
        const userDropdownToggle = document.querySelector('.user-dropdown-toggle');
        if (userDropdownToggle) {
            const dropdownToggleHandler = function() {
                const dropdown = this.nextElementSibling;
                dropdown.classList.toggle('active');
                
                // Remove existing document click handler if any
                if (_eventListeners.documentClick) {
                    document.removeEventListener('click', _eventListeners.documentClick.handler);
                }
                
                // Only add document click handler if dropdown is active
                if (dropdown.classList.contains('active')) {
                    const closeDropdownHandler = function(e) {
                        if (!e.target.closest('.user-dropdown')) {
                            dropdown.classList.remove('active');
                            document.removeEventListener('click', closeDropdownHandler);
                            // Clean up reference
                            delete _eventListeners.documentClick;
                        }
                    };
                    
                    // Add with a slight delay to avoid immediate triggering
                    setTimeout(() => {
                        document.addEventListener('click', closeDropdownHandler);
                        // Store reference for cleanup
                        _eventListeners.documentClick = {
                            element: document,
                            event: 'click',
                            handler: closeDropdownHandler
                        };
                    }, 0);
                }
            };
            
            userDropdownToggle.addEventListener('click', dropdownToggleHandler);
            // Store reference for cleanup
            _eventListeners.userDropdown = {
                element: userDropdownToggle,
                event: 'click',
                handler: dropdownToggleHandler
            };
        }
    }

    function _initializeModules() {
        // Initialize API client
        if (ABDRE.ApiClient) {
            ABDRE.ApiClient.init(CONFIG.apiEndpoint);
        }
        
        // Initialize Event Bus
        if (ABDRE.EventBus) {
            ABDRE.EventBus.init();
        }
        
        // Check authentication state
        _checkAuthState();
    }
    
    function _setupSessionRefresh() {
        // Periodically refresh auth token if user is logged in
        if (document.cookie.includes('auth_token')) {
            const refreshInterval = setInterval(function() {
                ABDRE.ApiClient.post('/auth/refresh')
                    .then(response => {
                        if (CONFIG.debug) {
                            console.log('Session refreshed');
                        }
                    })
                    .catch(error => {
                        console.error('Session refresh failed:', error);
                        // Report error for monitoring
                        if (ABDRE.ErrorHandler) {
                            ABDRE.ErrorHandler.reportError('session_refresh_error', 'Failed to refresh session', error);
                        }
                    });
            }, CONFIG.sessionRefreshInterval);
            
            // Store interval for cleanup
            _eventListeners.sessionRefresh = refreshInterval;
        }
    }
    
    function _checkAuthState() {
        // Verify current authentication state
        ABDRE.ApiClient.get('/auth/check-session')
            .then(response => {
                if (response.authenticated) {
                    ABDRE.EventBus.publish('auth:authenticated', response.user);
                } else {
                    ABDRE.EventBus.publish('auth:unauthenticated');
                }
            })
            .catch(error => {
                console.error('Auth check failed:', error);
                ABDRE.EventBus.publish('auth:unauthenticated');
                
                // Report error
                if (ABDRE.ErrorHandler) {
                    ABDRE.ErrorHandler.reportError('auth_check_error', 'Failed to check authentication status', error);
                }
            });
    }
    
    // Cleanup event listeners and intervals
    function _cleanup() {
        // Remove event listeners
        Object.values(_eventListeners).forEach(listener => {
            if (listener.element && listener.event && listener.handler) {
                listener.element.removeEventListener(listener.event, listener.handler);
            } else if (typeof listener === 'number') {
                // It's an interval ID
                clearInterval(listener);
            }
        });
    }

    // Public API
    return {
        init: function(options = {}) {
            // Merge options with defaults
            Object.assign(CONFIG, options);
            
            // Enable debug mode if specified
            if (CONFIG.debug) {
                console.info('ABDRE Chat initializing in debug mode');
            }
            
            // Initialize components
            _setupEventListeners();
            _initializeModules();
            _setupSessionRefresh();
            
            // Publish application ready event
            if (ABDRE.EventBus) {
                ABDRE.EventBus.publish('app:ready');
            }
            
            console.info('ABDRE Chat initialized successfully');
        },
        
        getConfig: function(key) {
            return key ? CONFIG[key] : {...CONFIG};
        },
        
        destroy: function() {
            _cleanup();
            return null;
        }
    };
})(); 