/**
 * API Client for ABDRE Microservices
 * Provides a unified interface for all API endpoints with consistent error handling,
 * authentication, and request/response formatting.
 */

const ApiClient = {
    // Configuration
    config: {
        baseUrl: '/api',
        endpoints: {
            // Auth Service
            auth: {
                login: '/auth/login',
                register: '/auth/register',
                logout: '/auth/logout',
                refresh: '/auth/refresh',
                status: '/auth/status',
                guest: '/auth/visitor',
                oauth: {
                    google: '/auth/oauth/google',
                    apple: '/auth/oauth/apple'
                }
            },
            // User Service
            users: {
                profile: '/users/profile',
                update: '/users/update',
                search: '/users/search',
                notifications: '/users/notifications',
                unreadCount: '/users/unread-count'
            },
            // Chat Service
            chats: {
                list: '/chats',
                get: '/chats/{id}',
                create: '/chats',
                messages: '/chats/{id}/messages',
                invitation: {
                    generate: '/chats/generate-invitation',
                    status: '/chats/invitation-status/{token}',
                    accept: '/chats/accept-invitation/{token}'
                }
            },
            // Realtime Service
            realtime: {
                notify: '/realtime/notify',
                broadcast: '/realtime/broadcast'
            }
        },
        // Request configuration
        request: {
            timeout: 30000, // 30 seconds
            retries: 3,
            retryDelay: 1000, // Base delay in ms (exponential backoff applied)
            validateStatus: status => status >= 200 && status < 300
        }
    },

    // Request tracking for debugging and abort control
    _pendingRequests: new Map(),
    _requestId: 0,

    /**
     * Internal method to make API requests with retry logic and authentication
     * 
     * @param {string} url - API endpoint URL
     * @param {Object} options - Request options
     * @param {number} retryCount - Current retry attempt
     * @returns {Promise<Object>} - Response data
     */
    async _request(url, options = {}, retryCount = 0) {
        // Generate unique request ID for tracking
        const requestId = ++this._requestId;
        const startTime = Date.now();
        
        // Create abort controller for timeout handling
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            controller.abort();
        }, options.timeout || this.config.request.timeout);
        
        // Create full URL
        const fullUrl = url.startsWith('http') ? url : this.config.baseUrl + url;
        
        // Add signal to options
        const requestOptions = {
            ...options,
            signal: controller.signal
        };
        
        // Add auth headers if available
        if (!options.skipAuth) {
            requestOptions.headers = {
                ...requestOptions.headers,
                ...AuthHelper.getAuthHeaders()
            };
        }
        
        // Log request for debugging
        this._logRequest('Request', requestId, fullUrl, requestOptions);
        
        // Track pending request
        this._pendingRequests.set(requestId, { url: fullUrl, startTime, controller });
        
        try {
            // Make the request
            const response = await fetch(fullUrl, requestOptions);
            
            // Clear timeout
            clearTimeout(timeoutId);
            
            // Log response
            this._logRequest('Response', requestId, fullUrl, null, response.status);
            
            // Handle successful response
            if (this.config.request.validateStatus(response.status)) {
                // Parse response
                let data;
                const contentType = response.headers.get('content-type');
                if (contentType && contentType.includes('application/json')) {
                    data = await response.json();
                } else {
                    data = await response.text();
                }
                
                return {
                    data,
                    status: response.status,
                    headers: Object.fromEntries(response.headers.entries()),
                    statusText: response.statusText
                };
            }
            
            // Handle 401 Unauthorized - potential token expiration
            if (response.status === 401 && !options.skipAuth) {
                // Only handle once to prevent infinite loops
                if (retryCount === 0) {
                    try {
                        // Try to refresh token
                        await AuthHelper.refreshToken();
                        
                        // Retry request with new token
                        return this._request(url, options, retryCount + 1);
                    } catch (refreshError) {
                        console.error('Token refresh failed:', refreshError);
                        // Clear auth on refresh failure
                        AuthHelper.clearAuth();
                        throw this._createApiError('Authorization error', 401, url);
                    }
                } else {
                    // Already tried with fresh token, still failing
                    throw this._createApiError('Authorization error', 401, url);
                }
            }
            
            // Handle other errors
            let errorData;
            try {
                errorData = await response.json();
            } catch (e) {
                errorData = { message: response.statusText };
            }
            
            const error = this._createApiError(
                errorData.message || 'API request failed',
                response.status,
                url,
                errorData
            );
            
            // Retry logic for server errors (5xx)
            if (response.status >= 500 && retryCount < this.config.request.retries) {
                return this._retryRequest(url, options, retryCount, error);
            }
            
            throw error;
        } catch (error) {
            // Clear timeout
            clearTimeout(timeoutId);
            
            // Check if abort error (timeout)
            if (error.name === 'AbortError') {
                const timeoutError = this._createApiError('Request timeout', 408, url);
                // Retry logic for timeouts
                if (retryCount < this.config.request.retries) {
                    return this._retryRequest(url, options, retryCount, timeoutError);
                }
                throw timeoutError;
            }
            
            // Check if network error
            if (error.message && error.message.includes('Network error')) {
                const networkError = this._createApiError('Network error', 0, url);
                // Retry logic for network errors
                if (retryCount < this.config.request.retries) {
                    return this._retryRequest(url, options, retryCount, networkError);
                }
                throw networkError;
            }
            
            // If already an API error, throw as is
            if (error.isApiError) {
                throw error;
            }
            
            // Create API error for other errors
            const apiError = this._createApiError(error.message, 0, url);
            
            // Retry for unknown errors
            if (retryCount < this.config.request.retries) {
                return this._retryRequest(url, options, retryCount, apiError);
            }
            
            throw apiError;
        } finally {
            // Remove from pending requests
            this._pendingRequests.delete(requestId);
        }
    },
    
    /**
     * Handle request retry with exponential backoff
     */
    async _retryRequest(url, options, retryCount, error) {
        // Calculate backoff delay with jitter
        const delay = this.config.request.retryDelay * Math.pow(2, retryCount) + 
                      Math.random() * 1000;
        
        console.warn(`Retrying request to ${url} in ${Math.round(delay)}ms (attempt ${retryCount + 1} of ${this.config.request.retries})`);
        
        await new Promise(resolve => setTimeout(resolve, delay));
        return this._request(url, options, retryCount + 1);
    },
    
    /**
     * Create standardized API error objects
     */
    _createApiError(message, status, url, data = {}) {
        const error = new Error(message);
        error.status = status;
        error.url = url;
        error.data = data;
        error.isApiError = true;
        error.timestamp = new Date().toISOString();
        return error;
    },
    
    /**
     * Log requests for debugging
     */
    _logRequest(type, id, url, options, status) {
        const prefix = `[ApiClient:${id}] ${type}`;
        
        if (type === 'Request') {
            console.log(`${prefix} ${options?.method || 'GET'} ${url}`);
            if (options && options.body && typeof options.body === 'string') {
                try {
                    const data = JSON.parse(options.body);
                    console.log(`${prefix} Body:`, data);
                } catch (e) {
                    // Not JSON, skip detailed logging
                }
            }
        } else if (type === 'Response') {
            console.log(`${prefix} Status: ${status} for ${url}`);
        }
    },
    
    /**
     * Replace URL parameters with values
     */
    _replaceUrlParams(url, params = {}) {
        let processedUrl = url;
        Object.keys(params).forEach(key => {
            processedUrl = processedUrl.replace(`{${key}}`, encodeURIComponent(params[key]));
        });
        return processedUrl;
    },

    // PUBLIC API METHODS

    /**
     * User authentication
     */
    async login(credentials) {
        try {
            const { username, password } = credentials;
            
            const response = await this._request(
                this.config.endpoints.auth.login,
                {
                    method: 'POST',
                    skipAuth: true,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                }
            );
            
            // Save authentication data
            if (response.data && response.data.access_token) {
                AuthHelper.saveAuth(response.data);
            }
            
            return response.data;
        } catch (error) {
            console.error('Login error:', error);
            throw error;
        }
    },
    
    /**
     * Logout current user
     */
    /**
     * User registration
     * 
     * @param {Object} userData - User registration data
     * @returns {Promise<Object>} Registration result
     */
    async register(userData) {
        try {
            const response = await this._request(
                this.config.endpoints.auth.register,
                {
                    method: "POST",
                    skipAuth: true,
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(userData)
                }
            );
            
            // Do not auto-login after registration
            return response.data;
        } catch (error) {
            console.error("Registration error:", error);
            throw error;
        }
    },

    async logout() {
        try {
            await this._request(
                this.config.endpoints.auth.logout,
                { method: 'POST' }
            );
        } catch (error) {
            console.warn('Logout error:', error);
            // Proceed with local logout even if server logout fails
        } finally {
            AuthHelper.clearAuth();
        }
        
        return { success: true };
    },
    
    /**
     * Get current user's chat list
     */
    async getChats() {
        try {
            const response = await this._request(this.config.endpoints.chats.list);
            return response.data.chats || [];
        } catch (error) {
            console.error('Error fetching chats:', error);
            throw error;
        }
    },
    
    /**
     * Get a specific chat by ID
     */
    async getChat(chatId) {
        try {
            const url = this._replaceUrlParams(this.config.endpoints.chats.get, { id: chatId });
            const response = await this._request(url);
            return response.data;
        } catch (error) {
            console.error(`Error fetching chat ${chatId}:`, error);
            throw error;
        }
    },
    
    /**
     * Create a chat invitation for QR code
     */
    async createChatInvitation() {
        try {
            // Get user ID from auth helper
            const userData = AuthHelper.getUserData();
            const userId = userData ? userData.user_id : AuthHelper.getOrCreateVisitorId();
            
            const response = await this._request(
                this.config.endpoints.chats.invitation.generate,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ host_id: userId })
                }
            );
            
            // Check if we have a valid token in the response
            const data = response.data;
            if (!data || !data.token) {
                console.error('Invalid invitation data received:', data);
                throw new Error('No invitation token received from server');
            }
            
            // Ensure we always have an invitation_token field for consistent usage across the app
            if (!data.invitation_token && data.token) {
                data.invitation_token = data.token;
            }
            
            return data;
        } catch (error) {
            console.error('Error creating chat invitation:', error);
            throw error;
        }
    },
    
    /**
     * Check invitation status by token
     */
    async getInvitationStatus(token) {
        try {
            const url = this._replaceUrlParams(
                this.config.endpoints.chats.invitation.status, 
                { token }
            );
            
            console.log(`Checking invitation status from URL: ${url}`);
            
            const response = await this._request(url);
            return response.data;
        } catch (error) {
            console.error(`Error checking invitation status ${token}:`, error);
            throw error;
        }
    },
    
    /**
     * Join chat by invitation token
     */
    async joinChatByToken(token) {
        try {
            // Get user ID from auth helper
            const userData = AuthHelper.getUserData();
            const guestId = userData ? userData.user_id : AuthHelper.getOrCreateVisitorId();
            
            // Use the correct API endpoint with token
            const url = this._replaceUrlParams(
                this.config.endpoints.chats.invitation.accept, 
                { token }
            );
            
            console.log(`Joining chat with token ${token} using URL: ${url}`);
            
            const response = await this._request(
                url,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ guest_id: guestId })
                }
            );
            
            return response.data;
        } catch (error) {
            console.error(`Error joining chat with token ${token}:`, error);
            throw error;
        }
    },
    
    /**
     * Get messages for a specific chat
     */
    async getChatMessages(roomId, options = {}) {
        try {
            const url = this._replaceUrlParams(
                this.config.endpoints.chats.messages, 
                { id: roomId }
            );
            
            // Add query parameters if provided
            const queryParams = new URLSearchParams();
            if (options.limit) queryParams.append('limit', options.limit);
            if (options.before) queryParams.append('before', options.before);
            if (options.after) queryParams.append('after', options.after);
            
            const queryString = queryParams.toString();
            const fullUrl = queryString ? `${url}?${queryString}` : url;
            
            const response = await this._request(fullUrl);
            return response.data.messages || [];
        } catch (error) {
            console.error(`Error fetching messages for chat ${roomId}:`, error);
            throw error;
        }
    },
    
    /**
     * Send a message to a chat
     */
    async sendMessage(roomId, content) {
        try {
            // Get user ID from auth helper
            const userData = AuthHelper.getUserData();
            const senderId = userData ? userData.user_id : AuthHelper.getOrCreateVisitorId();
            
            // Generate unique message ID
            const messageId = 'msg_' + Math.random().toString(36).substring(2, 15) + 
                              Math.random().toString(36).substring(2, 15);
            
            const url = this._replaceUrlParams(
                this.config.endpoints.chats.messages, 
                { id: roomId }
            );
            
            const response = await this._request(
                url,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        message_id: messageId,
                        message: content,
                        sender_id: senderId
                    })
                }
            );
            
            return response.data;
        } catch (error) {
            console.error(`Error sending message to chat ${roomId}:`, error);
            throw error;
        }
    },
    
    /**
     * Mark messages as read in a chat
     */
    async markMessagesRead(roomId, messageIds = []) {
        try {
            // Construct endpoint for marking messages read
            // This might be a custom endpoint depending on your API design
            const url = `${this.config.endpoints.chats.list}/${roomId}/mark-read`;
            
            const response = await this._request(
                url,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message_ids: messageIds })
                }
            );
            
            return response.data;
        } catch (error) {
            console.error(`Error marking messages read in chat ${roomId}:`, error);
            throw error;
        }
    },
    
    /**
     * Create a new chat (direct creation, not via invitation)
     */
    async createChat(participants) {
        try {
            const response = await this._request(
                this.config.endpoints.chats.create,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ participants })
                }
            );
            
            return response.data;
        } catch (error) {
            console.error('Error creating chat:', error);
            throw error;
        }
    },
    
    /**
     * Search for users
     */
    async searchUsers(query) {
        try {
            const url = `${this.config.endpoints.users.search}?q=${encodeURIComponent(query)}`;
            const response = await this._request(url);
            return response.data.users || [];
        } catch (error) {
            console.error(`Error searching users with query "${query}":`, error);
            throw error;
        }
    },
    
    /**
     * Get current user profile
     */
    async getUserProfile() {
        try {
            const response = await this._request(this.config.endpoints.users.profile);
            return response.data;
        } catch (error) {
            console.error('Error fetching user profile:', error);
            throw error;
        }
    },
    
    /**
     * Update user profile
     */
    async updateUserProfile(profileData) {
        try {
            const response = await this._request(
                this.config.endpoints.users.update,
                {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(profileData)
                }
            );
            
            return response.data;
        } catch (error) {
            console.error('Failed to update profile:', error);
            throw error;
        }
    },
    
    /**
     * Get unread message count for current user
     * 
     * @returns {Promise<Object>} - Count data with total and per-chat counts
     */
    async getUnreadMessageCount() {
        try {
            const response = await this._request(
                this.config.endpoints.users.unreadCount,
                {
                    method: 'GET'
                }
            );
            
            return response.data;
        } catch (error) {
            console.error('Failed to get unread count:', error);
            // Return zero count on error to prevent UI issues
            return { count: 0, chats: {} };
        }
    },
    
    /**
     * Login as a guest/visitor
     * 
     * @returns {Promise<Object>} Guest user data
     */
    async loginAsGuest() {
        try {
            const response = await this._request(
                this.config.endpoints.auth.guest,
                {
                    method: 'POST',
                    skipAuth: true,
                    headers: { 'Content-Type': 'application/json' }
                }
            );
            
            // Save authentication data
            if (response.data) {
                AuthHelper.saveAuth(response.data);
            }
            
            return response.data;
        } catch (error) {
            console.error('Guest login error:', error);
            throw error;
        }
    },
    
    /**
     * OAuth authentication methods
     */
    oauth: {
        /**
         * Redirect to Google OAuth
         */
        google() {
            return new Promise((resolve, reject) => {
                try {
                    window.location.href = ApiClient.config.endpoints.auth.oauth.google;
                    // This won't actually resolve since we're redirecting
                    resolve();
                } catch (error) {
                    reject(error);
                }
            });
        },
        
        /**
         * Redirect to Apple OAuth
         */
        apple() {
            return new Promise((resolve, reject) => {
                try {
                    window.location.href = ApiClient.config.endpoints.auth.oauth.apple;
                    // This won't actually resolve since we're redirecting
                    resolve();
                } catch (error) {
                    reject(error);
                }
            });
        }
    },
    
    /**
     * Helper to abort all pending requests
     * Useful when navigating away from a page
     */
    abortAllRequests(reason = 'User navigated away') {
        this._pendingRequests.forEach((request, id) => {
            console.log(`Aborting request #${id} to ${request.url}`);
            request.controller.abort(reason);
        });
        this._pendingRequests.clear();
    }
};

// Initialize the client
document.addEventListener('DOMContentLoaded', () => {
    // Set up global error handlers
    window.addEventListener('offline', () => {
        console.warn('Network went offline. API requests will be queued until connection is restored.');
    });
    
    window.addEventListener('online', () => {
        console.log('Network connection restored.');
    });
    
    // Clean up pending requests when navigating away
    window.addEventListener('beforeunload', () => {
        ApiClient.abortAllRequests('Page unload');
    });
    
    console.log('ApiClient initialized');
});

// Export for use in other modules
window.ApiClient = ApiClient; 