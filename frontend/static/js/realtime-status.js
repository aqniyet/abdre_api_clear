/**
 * ABDRE Chat - Real-time Status Module
 * 
 * Handles online status and typing indicators for the chat application.
 * This module integrates with your existing WebSocket implementation
 * to properly display user status and typing indicators in the UI.
 */

// Ensure ABDRE namespace exists
window.ABDRE = window.ABDRE || {};

// Real-time Status Module
ABDRE.RealtimeStatus = (function() {
    // Private variables
    let _initialized = false;
    let _websocket = null;
    let _userStatusMap = {};     // Maps user_id to online status
    let _typingStatusMap = {};   // Maps chat_id -> user_id -> {isTyping, timestamp}
    let _typingTimeouts = {};    // Stores timeouts for clearing typing indicators
    let _statusUpdateCallbacks = [];  // Callbacks for status updates
    let _typingUpdateCallbacks = [];  // Callbacks for typing updates
    let _currentUserId = null;        // Current user's ID
    
    // Constants
    const TYPING_TIMEOUT = 5000;  // Clear typing indicator after 5 seconds of inactivity
    
    // Private methods
    /**
     * Process a user status message from the server
     * @param {Object} data - Status message data
     */
    function _processStatusMessage(data) {
        console.log('Processing status message:', data);
        
        const event = data.event;
        
        if (event === 'user_status') {
            // Handle user online/offline status update
            const userId = data.data?.user_id || data.user_id;
            const status = data.data?.status || data.status;
            
            if (userId && status) {
                _updateUserStatus(userId, status);
            }
        } else if (event === 'typing') {
            // Handle typing indicator update
            let chatId, userId, username, isTyping;
            
            // Extract data from different message formats
            if (data.data) {
                // Nested structure (data property contains the values)
                chatId = data.data.chat_id;
                userId = data.data.user_id;
                username = data.data.username || 'User';
                isTyping = !!data.data.is_typing;
            } else {
                // Flat structure (properties are direct)
                chatId = data.chat_id;
                userId = data.user_id;
                username = data.username || 'User';
                isTyping = !!data.is_typing;
            }
            
            // Skip processing if it's the current user's typing status
            if (userId === _currentUserId) {
                console.log('Ignoring typing status from self');
                return;
            }
            
            if (chatId && userId) {
                _updateTypingStatus(chatId, userId, username, isTyping);
            }
        }
    }
    
    /**
     * Update a user's online status
     * @param {string} userId - User ID
     * @param {string} status - Status ('online' or 'offline')
     */
    function _updateUserStatus(userId, status) {
        // Skip if this is the current user
        if (userId === _currentUserId) {
            return;
        }
        
        console.log(`User ${userId} status changed to ${status}`);
        
        // Update status map
        _userStatusMap[userId] = status;
        
        // Notify all registered callbacks
        _statusUpdateCallbacks.forEach(callback => {
            try {
                callback(userId, status);
            } catch (e) {
                console.error('Error in status update callback:', e);
            }
        });
        
        // Update UI elements
        _updateUserStatusUI(userId, status);
    }
    
    /**
     * Update a user's typing status
     * @param {string} chatId - Chat ID
     * @param {string} userId - User ID
     * @param {string} username - User's display name
     * @param {boolean} isTyping - Whether the user is typing
     */
    function _updateTypingStatus(chatId, userId, username, isTyping) {
        console.log(`User ${userId} (${username}) typing status in chat ${chatId}: ${isTyping}`);
        
        // Initialize chat map if needed
        if (!_typingStatusMap[chatId]) {
            _typingStatusMap[chatId] = {};
        }
        
        // Get previous status
        const previousStatus = _typingStatusMap[chatId][userId]?.isTyping || false;
        
        // Only process if status has changed
        if (previousStatus !== isTyping) {
            // Update typing status map
            _typingStatusMap[chatId][userId] = {
                isTyping: isTyping,
                username: username,
                timestamp: Date.now()
            };
            
            // Clear any existing timeout for this user/chat
            const timeoutKey = `${chatId}:${userId}`;
            if (_typingTimeouts[timeoutKey]) {
                clearTimeout(_typingTimeouts[timeoutKey]);
                delete _typingTimeouts[timeoutKey];
            }
            
            // Set timeout to clear typing indicator
            if (isTyping) {
                _typingTimeouts[timeoutKey] = setTimeout(() => {
                    // Auto-clear typing status after timeout
                    _updateTypingStatus(chatId, userId, username, false);
                }, TYPING_TIMEOUT);
            }
            
            // Notify typing update callbacks
            _typingUpdateCallbacks.forEach(callback => {
                try {
                    callback(chatId, userId, username, isTyping);
                } catch (e) {
                    console.error('Error in typing update callback:', e);
                }
            });
            
            // Update UI
            _updateTypingStatusUI(chatId, userId, username, isTyping);
        }
    }
    
    /**
     * Update the UI to reflect a user's online status
     * @param {string} userId - User ID
     * @param {string} status - Status ('online' or 'offline')
     */
    function _updateUserStatusUI(userId, status) {
        // Update user's online indicator in chat header
        const chatStatusElement = document.querySelector('.chat-window .chat-info .chat-details p');
        const chatAvatar = document.querySelector('.chat-window .chat-info .chat-avatar');
        
        // Check if this element has the correct user ID stored in its data attribute
        if (chatStatusElement && chatStatusElement.dataset.otherUserId === userId) {
            console.log(`Updating chat header status for user ${userId} to ${status}`);
            
            // Don't override typing status
            if (!chatStatusElement.classList.contains('typing')) {
                if (status === 'online') {
                    chatStatusElement.textContent = 'Online';
                    // Add the appropriate CSS class
                    chatStatusElement.classList.add('online');
                    chatStatusElement.classList.remove('offline');
                    // Also update avatar
                    if (chatAvatar) {
                        chatAvatar.classList.add('online');
                    }
                } else {
                    chatStatusElement.textContent = 'Offline';
                    // Add the appropriate CSS class
                    chatStatusElement.classList.add('offline');
                    chatStatusElement.classList.remove('online');
                    // Also update avatar
                    if (chatAvatar) {
                        chatAvatar.classList.remove('online');
                    }
                }
            }
        }
        
        // Also update the status in chat list
        const chatItems = document.querySelectorAll(`.chat-item[data-creator-id="${userId}"], .chat-item[data-scanner-id="${userId}"]`);
        chatItems.forEach(chatItem => {
            const avatar = chatItem.querySelector('.chat-avatar');
            if (avatar) {
                if (status === 'online') {
                    avatar.classList.add('online');
                } else {
                    avatar.classList.remove('online');
                }
            }
        });
    }
    
    /**
     * Update the UI to show or hide typing indicator
     * @param {string} chatId - Chat ID
     * @param {string} userId - User ID
     * @param {string} username - User's display name
     * @param {boolean} isTyping - Whether the user is typing
     */
    function _updateTypingStatusUI(chatId, userId, username, isTyping) {
        // Check if this is for the active chat
        const activeChat = document.getElementById('messages-container')?.dataset?.chatId;
        if (activeChat !== chatId) {
            console.log('Typing indicator not for active chat, ignoring');
            return;
        }
        
        // Get chat status element from the header
        const chatStatusElement = document.querySelector('.chat-window .chat-info .chat-details p');
        if (!chatStatusElement) {
            return;
        }
        
        // Update typing status in UI
        if (isTyping) {
            console.log(`Setting typing status to: "${username} is typing..."`);
            chatStatusElement.textContent = `${username} is typing...`;
            // Add typing class and remove other classes
            chatStatusElement.classList.add('typing');
            chatStatusElement.classList.remove('online', 'offline');
        } else {
            console.log(`Clearing typing status`);
            // Revert to showing online status
            if (_userStatusMap[userId] === 'online') {
                chatStatusElement.textContent = 'Online';
                chatStatusElement.classList.add('online');
                chatStatusElement.classList.remove('typing', 'offline');
            } else {
                chatStatusElement.textContent = 'Offline';
                chatStatusElement.classList.add('offline');
                chatStatusElement.classList.remove('typing', 'online');
            }
        }
        
        // Also handle typing indicator in the message area
        let typingIndicator = document.querySelector(`.message.typing[data-user-id="${userId}"]`);
        
        if (isTyping) {
            // Create or show typing indicator
            if (!typingIndicator) {
                typingIndicator = document.createElement('div');
                typingIndicator.className = 'message incoming typing';
                typingIndicator.dataset.userId = userId;
                typingIndicator.innerHTML = `
                    <div class="message-bubble">
                        <div class="dots">
                            <span>.</span>
                            <span>.</span>
                            <span>.</span>
                        </div>
                    </div>
                    <div class="message-info">
                        ${username} is typing...
                    </div>
                `;
                
                // Add to messages container
                const messagesContainer = document.getElementById('messages-container');
                if (messagesContainer) {
                    messagesContainer.appendChild(typingIndicator);
                    // Scroll to bottom
                    messagesContainer.scrollTop = messagesContainer.scrollHeight;
                }
            }
        } else {
            // Remove typing indicator
            if (typingIndicator) {
                typingIndicator.remove();
            }
        }
    }
    
    /**
     * Send typing status via WebSocket
     * @param {string} chatId - Chat ID
     * @param {boolean} isTyping - Whether the user is typing
     */
    function _sendTypingStatus(chatId, isTyping) {
        if (!_websocket || _websocket.readyState !== WebSocket.OPEN) {
            console.warn('WebSocket not connected, cannot send typing status');
            return false;
        }
        
        console.log(`Sending typing status: user=${_currentUserId}, isTyping=${isTyping}, chatId=${chatId}`);
        
        // Create typing status payload
        const payload = {
            type: 'status',
            event: 'typing',
            chat_id: chatId,
            user_id: _currentUserId,
            username: localStorage.getItem('userDisplayName') || localStorage.getItem('username') || 'User',
            is_typing: isTyping
        };
        
        // Send via WebSocket
        try {
            _websocket.send(JSON.stringify(payload));
            return true;
        } catch (e) {
            console.error('Error sending typing status:', e);
            return false;
        }
    }
    
    // Public API
    return {
        /**
         * Initialize the Realtime Status module
         * @param {Object} options - Configuration options
         * @param {WebSocket} options.websocket - WebSocket instance to use
         * @param {string} options.userId - Current user's ID
         */
        init: function(options = {}) {
            if (_initialized) {
                console.warn('Realtime Status module already initialized');
                return this;
            }
            
            console.log('Initializing Realtime Status module');
            
            // Store websocket reference
            _websocket = options.websocket || window.chatSocket;
            
            // Store current user ID
            _currentUserId = options.userId || localStorage.getItem('userId');
            
            if (!_currentUserId) {
                console.error('No user ID provided, status features will be limited');
            }
            
            // Set up message handlers if websocket exists
            if (_websocket) {
                const originalOnMessage = _websocket.onmessage;
                
                _websocket.onmessage = function(event) {
                    // Call original handler if it exists
                    if (typeof originalOnMessage === 'function') {
                        originalOnMessage(event);
                    }
                    
                    // Process message for status updates
                    try {
                        const message = JSON.parse(event.data);
                        
                        if (message.type === 'status') {
                            _processStatusMessage(message);
                        }
                    } catch (e) {
                        console.error('Error processing WebSocket message:', e);
                    }
                };
                
                console.log('WebSocket message handler attached');
            } else {
                console.warn('No WebSocket found, status features will be limited');
            }
            
            // Set up UI enhancements
            this.setupUI();
            
            _initialized = true;
            return this;
        },
        
        /**
         * Set up UI elements and event handlers
         */
        setupUI: function() {
            // Set up message input typing detection
            const textarea = document.getElementById('message-text');
            if (textarea) {
                let typingTimeout = null;
                let isTyping = false;
                
                textarea.addEventListener('input', function() {
                    // Get active chat ID
                    const chatId = document.getElementById('messages-container')?.dataset?.chatId;
                    if (!chatId) return;
                    
                    // Clear existing timeout
                    if (typingTimeout) {
                        clearTimeout(typingTimeout);
                    }
                    
                    // If content is not empty and not already typing, set typing to true
                    if (this.value.trim().length > 0 && !isTyping) {
                        isTyping = true;
                        _sendTypingStatus(chatId, true);
                    } 
                    // If content is empty and currently typing, set typing to false
                    else if (this.value.trim().length === 0 && isTyping) {
                        isTyping = false;
                        _sendTypingStatus(chatId, false);
                    }
                    
                    // Set timeout to clear typing status after inactivity
                    typingTimeout = setTimeout(() => {
                        if (isTyping) {
                            isTyping = false;
                            _sendTypingStatus(chatId, false);
                        }
                    }, 2000);
                });
                
                // Also handle blur event
                textarea.addEventListener('blur', function() {
                    // Get active chat ID
                    const chatId = document.getElementById('messages-container')?.dataset?.chatId;
                    if (!chatId) return;
                    
                    // Clear typing status when user leaves the input
                    if (isTyping) {
                        isTyping = false;
                        _sendTypingStatus(chatId, false);
                    }
                    
                    // Clear timeout
                    if (typingTimeout) {
                        clearTimeout(typingTimeout);
                        typingTimeout = null;
                    }
                });
            }
            
            // Enhance chat selection to properly track chat IDs
            const chatItems = document.querySelectorAll('.chat-item');
            chatItems.forEach(item => {
                // Get original click handler
                const originalClickHandler = item.onclick;
                
                // Replace with enhanced handler
                item.onclick = function(event) {
                    // First try to call original handler
                    if (typeof originalClickHandler === 'function') {
                        originalClickHandler.call(this, event);
                    }
                    
                    // Then ensure we've properly set up the chat header
                    const chatId = this.getAttribute('data-chat-id');
                    if (chatId) {
                        // Store as active chat ID
                        localStorage.setItem('activeChatId', chatId);
                        
                        // Find the other user ID for this chat
                        const creatorId = this.getAttribute('data-creator-id');
                        const scannerId = this.getAttribute('data-scanner-id');
                        
                        let otherUserId = null;
                        if (creatorId && creatorId !== _currentUserId) {
                            otherUserId = creatorId;
                        } else if (scannerId && scannerId !== _currentUserId) {
                            otherUserId = scannerId;
                        }
                        
                        // Update chat header with user status
                        if (otherUserId) {
                            const chatStatusElement = document.querySelector('.chat-window .chat-info .chat-details p');
                            if (chatStatusElement) {
                                // Store other user ID for status updates
                                chatStatusElement.dataset.otherUserId = otherUserId;
                                
                                // Update status text based on current status
                                const status = _userStatusMap[otherUserId];
                                if (status === 'online') {
                                    chatStatusElement.textContent = 'Online';
                                    chatStatusElement.classList.add('online');
                                    chatStatusElement.classList.remove('offline', 'typing');
                                } else {
                                    chatStatusElement.textContent = 'Offline';
                                    chatStatusElement.classList.add('offline');
                                    chatStatusElement.classList.remove('online', 'typing');
                                }
                            }
                        }
                    }
                };
            });
            
            console.log('UI enhancement setup complete');
        },
        
        /**
         * Register a callback for user status updates
         * @param {Function} callback - Function to call when status changes
         */
        onStatusUpdate: function(callback) {
            if (typeof callback === 'function') {
                _statusUpdateCallbacks.push(callback);
            }
            return this;
        },
        
        /**
         * Register a callback for typing status updates
         * @param {Function} callback - Function to call when typing status changes
         */
        onTypingUpdate: function(callback) {
            if (typeof callback === 'function') {
                _typingUpdateCallbacks.push(callback);
            }
            return this;
        },
        
        /**
         * Get a user's online status
         * @param {string} userId - User ID to check
         * @returns {string|null} Status ('online', 'offline') or null if unknown
         */
        getUserStatus: function(userId) {
            return _userStatusMap[userId] || null;
        },
        
        /**
         * Check if a user is currently typing in a chat
         * @param {string} chatId - Chat ID
         * @param {string} userId - User ID
         * @returns {boolean} True if typing, false otherwise
         */
        isUserTyping: function(chatId, userId) {
            return !!(_typingStatusMap[chatId] && _typingStatusMap[chatId][userId]?.isTyping);
        },
        
        /**
         * Get all users who are currently typing in a chat
         * @param {string} chatId - Chat ID
         * @returns {Array} Array of {userId, username} objects for typing users
         */
        getTypingUsers: function(chatId) {
            if (!_typingStatusMap[chatId]) {
                return [];
            }
            
            const typingUsers = [];
            
            for (const userId in _typingStatusMap[chatId]) {
                const userData = _typingStatusMap[chatId][userId];
                if (userData.isTyping) {
                    typingUsers.push({
                        userId: userId,
                        username: userData.username
                    });
                }
            }
            
            return typingUsers;
        },
        
        /**
         * Send typing status for current user
         * @param {string} chatId - Chat ID
         * @param {boolean} isTyping - Whether the user is typing
         */
        sendTypingStatus: function(chatId, isTyping) {
            return _sendTypingStatus(chatId, isTyping);
        }
    };
})();

// Initialize the module when the DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    // Check if there's a WebSocket connection already
    if (window.chatSocket) {
        // Initialize with existing socket
        ABDRE.RealtimeStatus.init({
            websocket: window.chatSocket,
            userId: localStorage.getItem('userId')
        });
    } else {
        // Wait for WebSocket to be created
        // This is a simple approach - in a real app, you might use an event system
        const checkInterval = setInterval(function() {
            if (window.chatSocket) {
                clearInterval(checkInterval);
                ABDRE.RealtimeStatus.init({
                    websocket: window.chatSocket,
                    userId: localStorage.getItem('userId')
                });
            }
        }, 500);
        
        // Stop checking after 10 seconds
        setTimeout(function() {
            clearInterval(checkInterval);
        }, 10000);
    }
}); 