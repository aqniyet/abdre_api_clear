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

    // Private methods
    function _setupEventListeners() {
        // Mobile menu toggle
        const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
        if (mobileMenuToggle) {
            mobileMenuToggle.addEventListener('click', function() {
                const mainMenu = document.getElementById('main-menu');
                const isExpanded = this.getAttribute('aria-expanded') === 'true';
                
                this.setAttribute('aria-expanded', !isExpanded);
                mainMenu.classList.toggle('active');
                document.body.classList.toggle('menu-open');
            });
        }

        // User dropdown toggle
        const userDropdownToggle = document.querySelector('.user-dropdown-toggle');
        if (userDropdownToggle) {
            userDropdownToggle.addEventListener('click', function() {
                const dropdown = this.nextElementSibling;
                dropdown.classList.toggle('active');
                
                // Close when clicking outside
                document.addEventListener('click', function closeDropdown(e) {
                    if (!e.target.closest('.user-dropdown')) {
                        dropdown.classList.remove('active');
                        document.removeEventListener('click', closeDropdown);
                    }
                });
            });
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
            setInterval(function() {
                ABDRE.ApiClient.post('/auth/refresh')
                    .then(response => {
                        console.log('Session refreshed');
                    })
                    .catch(error => {
                        console.error('Session refresh failed:', error);
                    });
            }, CONFIG.sessionRefreshInterval);
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
        }
    };
})(); 