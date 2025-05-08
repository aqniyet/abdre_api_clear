/**
 * Chat Enhancer
 * Provides client-side enhancements for server-rendered chat pages
 * Part of the ABDRE Server-Side Rendering migration
 * Updated for full-width layout
 */

const ChatEnhancer = {
    /**
     * Initialize the chat enhancer
     */
    init() {
        // Check if we're on a chat page
        if (!this.isChatPage()) {
            return;
        }
        
        console.log('Initializing Chat Enhancer for server-rendered page');
        
        // Initialize state from server-rendered content
        this.initializeState();
        
        // Set up event listeners
        this.setupEventListeners();
        
        // Connect to websocket for real-time updates
        this.connectRealtime();
        
        console.log('Chat Enhancer initialized');
    },
    
    /**
     * Check if we're on a chat page
     */
    isChatPage() {
        return window.location.pathname.includes('/chat/');
    },
    
    /**
     * Initialize state from server-rendered content
     */
    initializeState() {
        // Get chat ID from URL
        const pathParts = window.location.pathname.split('/');
        this.chatId = pathParts[pathParts.length - 1];
        
        // Get pre-rendered messages
        const messagesElement = document.getElementById('chat-messages');
        const messagesJsonElement = document.getElementById('messages-json');
        
        if (messagesJsonElement) {
            try {
                this.messages = JSON.parse(messagesJsonElement.textContent);
                console.log(`Loaded ${this.messages.length} messages from server-rendered JSON`);
            } catch (e) {
                console.error('Error parsing server-rendered messages:', e);
                this.messages = [];
            }
        } else {
            // Extract messages from the DOM if no JSON data
            this.messages = this.extractMessagesFromDOM();
            console.log(`Extracted ${this.messages.length} messages from DOM`);
        }
        
        // Get user ID
        const userElement = document.getElementById('current-user-id');
        this.userId = userElement ? userElement.value : null;
        
        // Set initial connection status
        this.connectionStatus = 'connecting';
        
        // Cache DOM elements
        this.cacheElements();
    },
    
    /**
     * Extract messages from DOM elements
     */
    extractMessagesFromDOM() {
        const messages = [];
        const messageElements = document.querySelectorAll('.message-wrapper');
        
        messageElements.forEach(el => {
            const messageId = el.getAttribute('data-message-id');
            const timestamp = el.getAttribute('data-timestamp');
            const isOwn = el.querySelector('.message').classList.contains('message-sent');
            const content = el.querySelector('.message-content').innerHTML;
            
            // Extract basic message data
            messages.push({
                message_id: messageId,
                created_at: timestamp,
                is_own: isOwn,
                content: this.stripHtml(content),
                content_formatted: content
            });
        });
        
        return messages;
    },
    
    /**
     * Cache DOM elements for faster access
     */
    cacheElements() {
        this.elements = {
            chatMessages: document.getElementById('chat-messages'),
            messageForm: document.getElementById('message-form'),
            messageInput: document.getElementById('message-input'),
            sendButton: document.getElementById('send-button'),
            connectionMessage: document.getElementById('connection-message'),
            statusIndicator: document.getElementById('status-indicator'),
            chatStatus: document.getElementById('chat-status'),
            currentChatName: document.getElementById('current-chat-name'),
            errorContainer: document.getElementById('error-container'),
            clearChatBtn: document.getElementById('clear-chat-btn')
        };
    },
    
    /**
     * Set up event listeners
     */
    setupEventListeners() {
        // Handle message form submission
        if (this.elements.messageForm) {
            this.elements.messageForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.sendMessage();
            });
        }
        
        // Clear chat button
        if (this.elements.clearChatBtn) {
            this.elements.clearChatBtn.addEventListener('click', (e) => {
                e.preventDefault();
                if (confirm('Are you sure you want to clear all messages in this chat?')) {
                    this.clearChat();
                }
            });
        }
        
        // Window visibility changes
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                // When tab becomes visible, tell the server we're active
                this.setUserActive();
            } else {
                // When tab is hidden, tell the server we're away
                this.setUserAway();
            }
        });
        
        // Before unload
        window.addEventListener('beforeunload', () => {
            // Notify server when user is leaving the page
            if (this.socket && this.socket.connected) {
                this.socket.emit('user_leaving', {
                    room_id: this.chatId,
                    user_id: this.userId
                });
            }
        });
    },
    
    /**
     * Connect to realtime service via socket.io
     */
    connectRealtime() {
        // Check if we already have socket.io client loaded
        if (typeof io === 'undefined') {
            console.log('Socket.IO not loaded yet, adding load event listener');
            
            document.addEventListener('socketio-loaded', () => {
                this.initSocketConnection();
            }, { once: true });
            
            // Load socket.io dynamically
            const script = document.createElement('script');
            script.src = '/static/js/libs/socket.io.min.js';
            script.onload = () => {
                document.dispatchEvent(new Event('socketio-loaded'));
            };
            script.onerror = () => {
                console.error('Failed to load Socket.IO');
                this.updateConnectionStatus('offline');
            };
            document.head.appendChild(script);
        } else {
            // Initialize socket connection
            this.initSocketConnection();
        }
    },
    
    /**
     * Initialize socket connection
     */
    initSocketConnection() {
        // Check if we have SocketIOHelper
        if (typeof SocketIOHelper === 'undefined') {
            console.error('SocketIOHelper not available');
            this.updateConnectionStatus('offline');
            return;
        }
        
        // Get socket connection
        this.socket = SocketIOHelper.getSocket();
        
        if (!this.socket) {
            console.error('Failed to get socket from SocketIOHelper');
            this.updateConnectionStatus('offline');
            return;
        }
        
        // Set up socket event handlers
        this.setupSocketHandlers();
        
        // Join chat room
        this.joinChatRoom();
    },
    
    /**
     * Set up socket event handlers
     */
    setupSocketHandlers() {
        // Connection events
        this.socket.on('connect', () => {
            console.log('Socket connected');
            this.updateConnectionStatus('online');
            
            // Re-join room if needed
            if (this.chatId) {
                this.joinChatRoom();
            }
            
            // Set user as active
            this.setUserActive();
        });
        
        this.socket.on('disconnect', () => {
            console.log('Socket disconnected');
            this.updateConnectionStatus('offline');
        });
        
        this.socket.on('reconnect', () => {
            console.log('Socket reconnected');
            this.updateConnectionStatus('online');
            
            // Re-join room
            if (this.chatId) {
                this.joinChatRoom();
            }
        });
        
        // Chat events
        this.socket.on('new_message', (data) => {
            console.log('New message received:', data);
            this.handleIncomingMessage(data);
        });
        
        this.socket.on('message_status', (data) => {
            console.log('Message status update:', data);
            this.updateMessageStatus(data.message_id, data.status);
        });
        
        this.socket.on('user_joined', (data) => {
            console.log('User joined:', data);
            this.updateUserStatus('online');
        });
        
        this.socket.on('user_left', (data) => {
            console.log('User left:', data);
            this.updateUserStatus('offline');
        });
        
        this.socket.on('user_active', (data) => {
            console.log('User active:', data);
            this.updateUserStatus('online');
        });
        
        this.socket.on('user_away', (data) => {
            console.log('User away:', data);
            this.updateUserStatus('away');
        });
    },
    
    /**
     * Join chat room
     */
    joinChatRoom() {
        if (!this.socket || !this.chatId || !this.userId) {
            console.error('Cannot join chat: missing socket, chatId, or userId');
            return;
        }
        
        this.socket.emit('join', {
            room_id: this.chatId,
            user_id: this.userId
        });
        
        console.log(`Joined chat room: ${this.chatId}`);
    },
    
    /**
     * Send a message
     */
    sendMessage() {
        if (!this.elements.messageInput.value.trim()) {
            return;
        }
        
        const content = this.elements.messageInput.value.trim();
        const messageId = this.generateId();
        
        // Create message object
        const message = {
            message_id: messageId,
            chat_id: this.chatId,
            sender_id: this.userId,
            content: content,
            created_at: new Date().toISOString(),
            status: 'sending'
        };
        
        // Add to local messages
        this.messages.push(message);
        
        // Render immediately with "sending" status
        this.renderMessage(message, false);
        
        // Clear input
        this.elements.messageInput.value = '';
        
        // Send via socket
        if (this.socket && this.socket.connected) {
            this.socket.emit('message', {
                message_id: messageId,
                room_id: this.chatId,
                content: content
            });
        } else {
            // Socket not connected, send via API fallback
            this.sendMessageViaApi(message);
        }
        
        // Scroll to bottom
        this.scrollToBottom();
    },
    
    /**
     * Handle incoming message
     */
    handleIncomingMessage(data) {
        // Don't add our own messages again
        if (data.sender_id === this.userId) {
            // Just update status if it's our message
            this.updateMessageStatus(data.message_id, 'delivered');
            return;
        }
        
        // Check if message already exists
        const existingIndex = this.messages.findIndex(m => m.message_id === data.message_id);
        if (existingIndex >= 0) {
            // Update existing message
            this.messages[existingIndex] = Object.assign({}, this.messages[existingIndex], data);
        } else {
            // Add new message
            this.messages.push(data);
            
            // Render the new message
            this.renderMessage(data, true);
            
            // Scroll to bottom if user is at the bottom already
            this.scrollIfAtBottom();
            
            // Play notification sound if tab is not active
            if (document.visibilityState !== 'visible') {
                this.playNotificationSound();
            }
        }
    },
    
    /**
     * Render a message in the UI
     */
    renderMessage(message, isIncoming = false) {
        // Format the message
        const isOwn = message.sender_id === this.userId;
        const cssClass = isOwn ? 'message-sent' : 'message-received';
        const statusClass = isOwn ? `status-${message.status || 'sent'}` : '';
        
        // Format the content (convert URLs to links, etc.)
        const content = this.formatMessageContent(message.content);
        
        // Format the time
        const time = this.formatTime(message.created_at);
        
        // Create message HTML
        const messageHtml = `
            <div class="message-wrapper" id="message-${message.message_id}" data-message-id="${message.message_id}" data-timestamp="${message.created_at}">
                <div class="message ${cssClass} ${statusClass}">
                    <div class="message-content">${content}</div>
                    <div class="message-time">${time}</div>
                    ${isOwn ? `<div class="message-status">${this.getStatusIcon(message.status)}</div>` : ''}
                </div>
            </div>
        `;
        
        // Check if we need to add a date separator
        const messageDate = this.formatDate(message.created_at);
        let dateGroup = document.querySelector(`.date-separator:contains('${messageDate}')`);
        
        if (!dateGroup) {
            // Need to add a new date group
            const dateSeparatorHtml = `
                <div class="message-date-group">
                    <div class="date-separator">
                        <span class="date-label">${messageDate}</span>
                    </div>
                </div>
            `;
            
            // Append date separator
            this.elements.chatMessages.insertAdjacentHTML('beforeend', dateSeparatorHtml);
            
            // Get the newly added date group
            dateGroup = this.elements.chatMessages.lastElementChild;
        } else {
            // Get the parent date group
            dateGroup = dateGroup.closest('.message-date-group');
        }
        
        // Add message to the date group
        dateGroup.insertAdjacentHTML('beforeend', messageHtml);
        
        // If this is a new incoming message, highlight it briefly
        if (isIncoming) {
            const messageElement = document.getElementById(`message-${message.message_id}`);
            messageElement.classList.add('new-message');
            
            // Remove highlight after animation
            setTimeout(() => {
                messageElement.classList.remove('new-message');
            }, 2000);
        }
    },
    
    /**
     * Update message status in UI
     */
    updateMessageStatus(messageId, status) {
        // Update in messages array
        const messageIndex = this.messages.findIndex(m => m.message_id === messageId);
        if (messageIndex >= 0) {
            this.messages[messageIndex].status = status;
        }
        
        // Update in DOM
        const messageElement = document.getElementById(`message-${messageId}`);
        if (messageElement) {
            const messageDiv = messageElement.querySelector('.message');
            if (messageDiv) {
                // Remove old status classes
                messageDiv.classList.remove('status-sending', 'status-sent', 'status-delivered', 'status-read', 'status-failed');
                
                // Add new status class
                messageDiv.classList.add(`status-${status}`);
                
                // Update status icon
                const statusElement = messageDiv.querySelector('.message-status');
                if (statusElement) {
                    statusElement.innerHTML = this.getStatusIcon(status);
                }
            }
        }
    },
    
    /**
     * Update connection status in UI
     */
    updateConnectionStatus(status) {
        this.connectionStatus = status;
        
        // Update status indicator
        if (this.elements.statusIndicator) {
            // Remove all status classes
            this.elements.statusIndicator.classList.remove('online', 'offline', 'away', 'connecting');
            
            // Add appropriate class
            this.elements.statusIndicator.classList.add(status);
        }
        
        // Update status text
        if (this.elements.chatStatus) {
            let statusText = 'Offline';
            
            switch (status) {
                case 'online':
                    statusText = 'Online';
                    break;
                case 'connecting':
                    statusText = 'Connecting...';
                    break;
                case 'away':
                    statusText = 'Away';
                    break;
            }
            
            this.elements.chatStatus.textContent = statusText;
        }
        
        // Update connection message
        if (this.elements.connectionMessage) {
            if (status === 'connecting') {
                this.elements.connectionMessage.classList.remove('visually-hidden');
                this.elements.connectionMessage.textContent = 'Connecting to chat server...';
            } else if (status === 'offline') {
                this.elements.connectionMessage.classList.remove('visually-hidden');
                this.elements.connectionMessage.textContent = 'Disconnected from chat server. Trying to reconnect...';
            } else {
                this.elements.connectionMessage.classList.add('visually-hidden');
            }
        }
        
        // Enable/disable input and send button
        if (this.elements.messageInput) {
            this.elements.messageInput.disabled = status !== 'online';
        }
        
        if (this.elements.sendButton) {
            this.elements.sendButton.disabled = status !== 'online';
        }
    },
    
    /**
     * Update user status in UI
     */
    updateUserStatus(status) {
        // Update opponent status indicator
        if (this.elements.statusIndicator) {
            // Remove all status classes
            this.elements.statusIndicator.classList.remove('online', 'offline', 'away', 'connecting');
            
            // Add appropriate class
            this.elements.statusIndicator.classList.add(status);
        }
        
        // Update status text
        if (this.elements.chatStatus) {
            let statusText = 'Offline';
            
            switch (status) {
                case 'online':
                    statusText = 'Online';
                    break;
                case 'away':
                    statusText = 'Away';
                    break;
            }
            
            this.elements.chatStatus.textContent = statusText;
        }
    },
    
    /**
     * Set user as active
     */
    setUserActive() {
        if (this.socket && this.socket.connected && this.chatId && this.userId) {
            this.socket.emit('user_active', {
                room_id: this.chatId,
                user_id: this.userId
            });
        }
    },
    
    /**
     * Set user as away
     */
    setUserAway() {
        if (this.socket && this.socket.connected && this.chatId && this.userId) {
            this.socket.emit('user_away', {
                room_id: this.chatId,
                user_id: this.userId
            });
        }
    },
    
    /**
     * Send message via API as fallback
     */
    sendMessageViaApi(message) {
        // Use fetch API to send message
        const token = this.getAuthToken();
        
        if (!token) {
            console.error('No auth token available for API request');
            this.updateMessageStatus(message.message_id, 'failed');
            return;
        }
        
        fetch(`/api/chats/${this.chatId}/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                message_id: message.message_id,
                content: message.content
            })
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            console.log('Message sent via API:', data);
            this.updateMessageStatus(message.message_id, 'sent');
        })
        .catch(error => {
            console.error('Error sending message via API:', error);
            this.updateMessageStatus(message.message_id, 'failed');
        });
    },
    
    /**
     * Scroll to bottom of chat
     */
    scrollToBottom() {
        if (this.elements.chatMessages) {
            this.elements.chatMessages.scrollTop = this.elements.chatMessages.scrollHeight;
        }
    },
    
    /**
     * Scroll to bottom if user is already at the bottom
     */
    scrollIfAtBottom() {
        if (this.elements.chatMessages) {
            const { scrollTop, scrollHeight, clientHeight } = this.elements.chatMessages;
            
            // If user is close to bottom (within 100px), scroll to bottom
            if (scrollHeight - scrollTop - clientHeight < 100) {
                this.scrollToBottom();
            }
        }
    },
    
    /**
     * Play notification sound
     */
    playNotificationSound() {
        try {
            const sound = new Audio('/static/sounds/notification.mp3');
            sound.volume = 0.5;
            sound.play();
        } catch (e) {
            console.error('Error playing notification sound:', e);
        }
    },
    
    /**
     * Get status icon HTML
     */
    getStatusIcon(status) {
        switch (status) {
            case 'sending':
                return '<i class="fas fa-clock"></i>';
            case 'sent':
                return '<i class="fas fa-check"></i>';
            case 'delivered':
                return '<i class="fas fa-check-double"></i>';
            case 'read':
                return '<i class="fas fa-check-double" style="color: #0d6efd;"></i>';
            case 'failed':
                return '<i class="fas fa-exclamation-triangle"></i>';
            default:
                return '';
        }
    },
    
    /**
     * Format message content
     */
    formatMessageContent(content) {
        if (!content) return '';
        
        // Escape HTML
        let formatted = this.escapeHtml(content);
        
        // Convert URLs to links
        const urlPattern = /(https?:\/\/[^\s]+)/g;
        formatted = formatted.replace(urlPattern, url => {
            return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
        });
        
        // Convert line breaks to <br>
        formatted = formatted.replace(/\n/g, '<br>');
        
        return formatted;
    },
    
    /**
     * Format date
     */
    formatDate(timestamp) {
        if (!timestamp) return '';
        
        const date = new Date(timestamp);
        const now = new Date();
        
        // Check if date is today
        if (date.toDateString() === now.toDateString()) {
            return 'Today';
        }
        
        // Check if date is yesterday
        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);
        if (date.toDateString() === yesterday.toDateString()) {
            return 'Yesterday';
        }
        
        // Otherwise use full date
        return date.toLocaleDateString();
    },
    
    /**
     * Format time
     */
    formatTime(timestamp) {
        if (!timestamp) return '';
        
        const date = new Date(timestamp);
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    },
    
    /**
     * Generate unique ID
     */
    generateId() {
        return 'msg_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
    },
    
    /**
     * Get auth token
     */
    getAuthToken() {
        if (typeof AuthHelper !== 'undefined' && AuthHelper.getToken) {
            return AuthHelper.getToken();
        }
        
        // Fallback: get from cookie
        return this.getCookie('auth_token');
    },
    
    /**
     * Get cookie value
     */
    getCookie(name) {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) return parts.pop().split(';').shift();
        return null;
    },
    
    /**
     * Escape HTML
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },
    
    /**
     * Strip HTML
     */
    stripHtml(html) {
        const div = document.createElement('div');
        div.innerHTML = html;
        return div.textContent || div.innerText || '';
    },
    
    /**
     * Clear all messages in the current chat
     */
    clearChat() {
        if (!this.chatId) return;
        
        // Clear messages in the UI
        if (this.elements.chatMessages) {
            this.elements.chatMessages.innerHTML = `
                <div class="text-center p-5">
                    <div class="text-muted mb-3">
                        <i class="fas fa-comments fa-3x"></i>
                    </div>
                    <p>No messages yet. Start the conversation!</p>
                </div>
                <div id="connection-message" class="alert alert-info text-center visually-hidden">
                    Connected to chat server.
                </div>
            `;
        }
        
        // Clear messages array
        this.messages = [];
        
        // Show success message
        this.showSuccess('Chat cleared successfully');
    },
    
    /**
     * Show a success message
     */
    showSuccess(message) {
        if (!this.elements.errorContainer) return;
        
        this.elements.errorContainer.textContent = message;
        this.elements.errorContainer.classList.remove('d-none', 'text-danger');
        this.elements.errorContainer.classList.add('text-success');
        
        // Hide after 5 seconds
        setTimeout(() => {
            this.elements.errorContainer.classList.add('d-none');
            this.elements.errorContainer.classList.remove('text-success');
            this.elements.errorContainer.classList.add('text-danger');
        }, 5000);
    },

    /**
     * Show error message
     */
    showError(message) {
        if (!this.elements.errorContainer) return;
        
        this.elements.errorContainer.textContent = message;
        this.elements.errorContainer.classList.remove('d-none', 'text-success');
        this.elements.errorContainer.classList.add('text-danger');
        
        // Hide after 5 seconds
        setTimeout(() => {
            this.elements.errorContainer.classList.add('d-none');
        }, 5000);
    }
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    ChatEnhancer.init();
}); 