/**
 * ABDRE Chat - User Service
 * 
 * Provides user profile and settings management functionality.
 */

// Ensure ABDRE namespace exists
window.ABDRE = window.ABDRE || {};

// User Service Module
ABDRE.UserService = (function() {
    // Constants
    const EVENTS = {
        PROFILE_UPDATED: 'user:profile_updated',
        SETTINGS_UPDATED: 'user:settings_updated',
        USER_ERROR: 'user:error'
    };
    
    // Default endpoints
    const DEFAULT_ENDPOINTS = {
        profile: '/api/users/profile',
        userProfile: '/api/users/profile/:userId',
        usernameProfile: '/api/users/profile/username/:username',
        settings: '/api/users/settings',
        userSettings: '/api/users/settings/:userId',
        search: '/api/users/search',
        avatar: '/api/users/avatar'
    };
    
    // Private variables
    let _endpoints = { ...DEFAULT_ENDPOINTS };
    let _currentProfile = null;
    let _userSettings = null;
    let _profileCache = {}; // Cache for user profiles
    let _userServiceUrl = ''; // User service URL from init
    
    // Private methods
    function _prepareUrl(urlTemplate, params = {}) {
        let url = urlTemplate;
        
        // Replace URL parameters
        Object.keys(params).forEach(key => {
            url = url.replace(`:${key}`, params[key]);
        });
        
        return url;
    }
    
    function _publishEvent(eventName, data) {
        if (ABDRE.EventBus) {
            ABDRE.EventBus.publish(eventName, data);
        }
    }
    
    function _handleError(error, errorCode, errorMessage, reject) {
        console.error(errorMessage, error);
        
        // Publish error event
        _publishEvent(EVENTS.USER_ERROR, {
            code: errorCode,
            message: error.message || errorMessage,
            details: error
        });
        
        // Reject the promise with error details
        reject(error);
    }
    
    // Public API
    return {
        /**
         * Whether the service has been initialized
         */
        isInitialized: false,
        
        /**
         * Initialize the User Service
         * 
         * @param {object} apiClient - Instance of ApiClient
         * @param {object} [options] - Configuration options
         * @returns {object} - This module for chaining
         */
        init: function(apiClient, options = {}) {
            // Merge custom endpoints with defaults
            if (options && options.endpoints) {
                _endpoints = {
                    ...DEFAULT_ENDPOINTS,
                    ...options.endpoints
                };
            }
            
            // Set user service URL if provided
            if (options && options.userServiceUrl) {
                _userServiceUrl = options.userServiceUrl;
            }
            
            this.isInitialized = true;
            console.log('User Service initialized');
            
            return this;
        },
        
        /**
         * Get current user's profile
         * 
         * @returns {Promise} - Promise resolving with user profile
         */
        getCurrentProfile: function() {
            return new Promise((resolve, reject) => {
                if (!ABDRE.ApiClient) {
                    reject(new Error('API Client not available'));
                    return;
                }
                
                // If profile is already loaded, return it
                if (_currentProfile) {
                    resolve(_currentProfile);
                    return;
                }
                
                ABDRE.ApiClient.get(_endpoints.profile)
                    .then(response => {
                        _currentProfile = response;
                        
                        // Add to cache
                        if (_currentProfile && _currentProfile.user_id) {
                            _profileCache[_currentProfile.user_id] = _currentProfile;
                        }
                        
                        resolve(_currentProfile);
                    })
                    .catch(error => {
                        _handleError(
                            error, 
                            'get_profile_failed', 
                            'Failed to get user profile', 
                            reject
                        );
                    });
            });
        },
        
        /**
         * Update current user's profile
         * 
         * @param {object} profileData - Profile data to update
         * @returns {Promise} - Promise resolving with updated profile
         */
        updateProfile: function(profileData) {
            return new Promise((resolve, reject) => {
                if (!profileData) {
                    reject(new Error('Profile data is required'));
                    return;
                }
                
                if (!ABDRE.ApiClient) {
                    reject(new Error('API Client not available'));
                    return;
                }
                
                ABDRE.ApiClient.put(_endpoints.profile, profileData)
                    .then(response => {
                        // Update local cache
                        _currentProfile = response;
                        
                        // Update cache
                        if (_currentProfile && _currentProfile.user_id) {
                            _profileCache[_currentProfile.user_id] = _currentProfile;
                        }
                        
                        // Publish profile updated event
                        _publishEvent(EVENTS.PROFILE_UPDATED, {
                            profile: _currentProfile
                        });
                        
                        resolve(_currentProfile);
                    })
                    .catch(error => {
                        _handleError(
                            error, 
                            'update_profile_failed', 
                            'Failed to update user profile', 
                            reject
                        );
                    });
            });
        },
        
        /**
         * Get a user's profile by ID
         * 
         * @param {string} userId - ID of the user
         * @param {boolean} [forceRefresh=false] - Whether to force a refresh from server
         * @returns {Promise} - Promise resolving with user profile
         */
        getUserProfile: function(userId, forceRefresh = false) {
            return new Promise((resolve, reject) => {
                if (!userId) {
                    reject(new Error('User ID is required'));
                    return;
                }
                
                if (!ABDRE.ApiClient) {
                    reject(new Error('API Client not available'));
                    return;
                }
                
                // Check cache first if not forcing refresh
                if (!forceRefresh && _profileCache[userId]) {
                    resolve(_profileCache[userId]);
                    return;
                }
                
                const url = _prepareUrl(_endpoints.userProfile, { userId });
                
                ABDRE.ApiClient.get(url)
                    .then(profile => {
                        // Update cache
                        if (profile && profile.user_id) {
                            _profileCache[profile.user_id] = profile;
                        }
                        
                        resolve(profile);
                    })
                    .catch(error => {
                        _handleError(
                            error, 
                            'get_user_profile_failed', 
                            `Failed to get user profile for ${userId}`, 
                            reject
                        );
                    });
            });
        },
        
        /**
         * Get a user's profile by username
         * 
         * @param {string} username - Username of the user
         * @returns {Promise} - Promise resolving with user profile
         */
        getUserProfileByUsername: function(username) {
            return new Promise((resolve, reject) => {
                if (!username) {
                    reject(new Error('Username is required'));
                    return;
                }
                
                if (!ABDRE.ApiClient) {
                    reject(new Error('API Client not available'));
                    return;
                }
                
                const url = _prepareUrl(_endpoints.usernameProfile, { username });
                
                ABDRE.ApiClient.get(url)
                    .then(profile => {
                        // Update cache
                        if (profile && profile.user_id) {
                            _profileCache[profile.user_id] = profile;
                        }
                        
                        resolve(profile);
                    })
                    .catch(error => {
                        _handleError(
                            error, 
                            'get_user_profile_by_username_failed', 
                            `Failed to get user profile for username ${username}`, 
                            reject
                        );
                    });
            });
        },
        
        /**
         * Admin update a user's profile
         * 
         * @param {string} userId - ID of the user to update
         * @param {object} profileData - Profile data to update
         * @returns {Promise} - Promise resolving with updated profile
         */
        adminUpdateProfile: function(userId, profileData) {
            return new Promise((resolve, reject) => {
                if (!userId) {
                    reject(new Error('User ID is required'));
                    return;
                }
                
                if (!profileData) {
                    reject(new Error('Profile data is required'));
                    return;
                }
                
                if (!ABDRE.ApiClient) {
                    reject(new Error('API Client not available'));
                    return;
                }
                
                const url = _prepareUrl(_endpoints.userProfile, { userId });
                
                ABDRE.ApiClient.put(url, profileData)
                    .then(profile => {
                        // Update cache
                        if (profile && profile.user_id) {
                            _profileCache[profile.user_id] = profile;
                        }
                        
                        resolve(profile);
                    })
                    .catch(error => {
                        _handleError(
                            error, 
                            'admin_update_profile_failed', 
                            `Failed to update user profile for ${userId}`, 
                            reject
                        );
                    });
            });
        },
        
        /**
         * Delete a user's profile (admin only)
         * 
         * @param {string} userId - ID of the user to delete
         * @returns {Promise} - Promise resolving with success message
         */
        deleteProfile: function(userId) {
            return new Promise((resolve, reject) => {
                if (!userId) {
                    reject(new Error('User ID is required'));
                    return;
                }
                
                if (!ABDRE.ApiClient) {
                    reject(new Error('API Client not available'));
                    return;
                }
                
                const url = _prepareUrl(_endpoints.userProfile, { userId });
                
                ABDRE.ApiClient.delete(url)
                    .then(response => {
                        // Remove from cache
                        if (_profileCache[userId]) {
                            delete _profileCache[userId];
                        }
                        
                        resolve(response);
                    })
                    .catch(error => {
                        _handleError(
                            error, 
                            'delete_profile_failed', 
                            `Failed to delete user profile for ${userId}`, 
                            reject
                        );
                    });
            });
        },
        
        /**
         * Get current user's settings
         * 
         * @returns {Promise} - Promise resolving with user settings
         */
        getSettings: function() {
            return new Promise((resolve, reject) => {
                if (!ABDRE.ApiClient) {
                    reject(new Error('API Client not available'));
                    return;
                }
                
                // If settings are already loaded, return them
                if (_userSettings) {
                    resolve(_userSettings);
                    return;
                }
                
                ABDRE.ApiClient.get(_endpoints.settings)
                    .then(response => {
                        _userSettings = response;
                        resolve(_userSettings);
                    })
                    .catch(error => {
                        _handleError(
                            error, 
                            'get_settings_failed', 
                            'Failed to get user settings', 
                            reject
                        );
                    });
            });
        },
        
        /**
         * Update current user's settings
         * 
         * @param {object} settingsData - Settings data to update
         * @returns {Promise} - Promise resolving with updated settings
         */
        updateSettings: function(settingsData) {
            return new Promise((resolve, reject) => {
                if (!settingsData) {
                    reject(new Error('Settings data is required'));
                    return;
                }
                
                if (!ABDRE.ApiClient) {
                    reject(new Error('API Client not available'));
                    return;
                }
                
                ABDRE.ApiClient.put(_endpoints.settings, settingsData)
                    .then(response => {
                        // Update local cache
                        _userSettings = response;
                        
                        // Publish settings updated event
                        _publishEvent(EVENTS.SETTINGS_UPDATED, {
                            settings: _userSettings
                        });
                        
                        resolve(_userSettings);
                    })
                    .catch(error => {
                        _handleError(
                            error, 
                            'update_settings_failed', 
                            'Failed to update user settings', 
                            reject
                        );
                    });
            });
        },
        
        /**
         * Get settings for a specific user (admin only)
         * 
         * @param {string} userId - ID of the user
         * @returns {Promise} - Promise resolving with user settings
         */
        getUserSettings: function(userId) {
            return new Promise((resolve, reject) => {
                if (!userId) {
                    reject(new Error('User ID is required'));
                    return;
                }
                
                if (!ABDRE.ApiClient) {
                    reject(new Error('API Client not available'));
                    return;
                }
                
                const url = _prepareUrl(_endpoints.userSettings, { userId });
                
                ABDRE.ApiClient.get(url)
                    .then(resolve)
                    .catch(error => {
                        _handleError(
                            error, 
                            'get_user_settings_failed', 
                            `Failed to get settings for user ${userId}`, 
                            reject
                        );
                    });
            });
        },
        
        /**
         * Update settings for a specific user (admin only)
         * 
         * @param {string} userId - ID of the user
         * @param {object} settingsData - Settings data to update
         * @returns {Promise} - Promise resolving with updated settings
         */
        updateUserSettings: function(userId, settingsData) {
            return new Promise((resolve, reject) => {
                if (!userId) {
                    reject(new Error('User ID is required'));
                    return;
                }
                
                if (!settingsData) {
                    reject(new Error('Settings data is required'));
                    return;
                }
                
                if (!ABDRE.ApiClient) {
                    reject(new Error('API Client not available'));
                    return;
                }
                
                const url = _prepareUrl(_endpoints.userSettings, { userId });
                
                ABDRE.ApiClient.put(url, settingsData)
                    .then(resolve)
                    .catch(error => {
                        _handleError(
                            error, 
                            'update_user_settings_failed', 
                            `Failed to update settings for user ${userId}`, 
                            reject
                        );
                    });
            });
        },
        
        /**
         * Get cached user profile (doesn't make a network request)
         * 
         * @param {string} userId - ID of the user
         * @returns {object|null} - User profile or null if not in cache
         */
        getCachedProfile: function(userId) {
            return _profileCache[userId] || null;
        },
        
        /**
         * Clear the profile cache
         * 
         * @returns {void}
         */
        clearProfileCache: function() {
            _profileCache = {};
            _currentProfile = null;
        },
        
        /**
         * Upload a user avatar
         * 
         * @param {File} file - The image file to upload
         * @returns {Promise} - Promise resolving with the avatar URL
         */
        uploadAvatar: function(file) {
            return new Promise((resolve, reject) => {
                if (!file) {
                    reject(new Error('File is required'));
                    return;
                }
                
                if (!ABDRE.ApiClient) {
                    reject(new Error('API Client not available'));
                    return;
                }
                
                // Create form data
                const formData = new FormData();
                formData.append('avatar', file);
                
                ABDRE.ApiClient.post(_endpoints.avatar, formData, {
                    'Content-Type': 'multipart/form-data'
                })
                    .then(response => {
                        // Update current profile with new avatar URL
                        if (_currentProfile) {
                            _currentProfile.avatar_url = response.avatar_url;
                            
                            // Update cache
                            if (_currentProfile.user_id) {
                                _profileCache[_currentProfile.user_id] = _currentProfile;
                            }
                            
                            // Publish profile updated event
                            _publishEvent(EVENTS.PROFILE_UPDATED, {
                                profile: _currentProfile
                            });
                        }
                        
                        resolve(response);
                    })
                    .catch(error => {
                        _handleError(
                            error, 
                            'upload_avatar_failed', 
                            'Failed to upload avatar', 
                            reject
                        );
                    });
            });
        },
        
        /**
         * Search for users
         * 
         * @param {string} query - Search query
         * @param {object} options - Search options (limit, offset)
         * @returns {Promise} - Promise resolving with search results
         */
        searchUsers: function(query, options = {}) {
            return new Promise((resolve, reject) => {
                if (!query) {
                    reject(new Error('Search query is required'));
                    return;
                }
                
                if (!ABDRE.ApiClient) {
                    reject(new Error('API Client not available'));
                    return;
                }
                
                // Add query parameters
                const queryParams = new URLSearchParams();
                queryParams.append('q', query);
                
                if (options.limit) {
                    queryParams.append('limit', options.limit);
                }
                
                if (options.offset) {
                    queryParams.append('offset', options.offset);
                }
                
                // Build URL
                const url = `${_endpoints.search}?${queryParams.toString()}`;
                
                ABDRE.ApiClient.get(url)
                    .then(result => {
                        // Cache search results
                        if (result && result.users && Array.isArray(result.users)) {
                            result.users.forEach(user => {
                                if (user.user_id) {
                                    _profileCache[user.user_id] = user;
                                }
                            });
                        }
                        
                        resolve(result);
                    })
                    .catch(error => {
                        _handleError(
                            error, 
                            'search_users_failed', 
                            'Failed to search users', 
                            reject
                        );
                    });
            });
        }
    };
})(); 