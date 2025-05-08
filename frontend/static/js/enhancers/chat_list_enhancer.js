/**
 * Chat List Enhancer
 * Provides client-side enhancements for server-rendered chat list pages
 * Part of the ABDRE Server-Side Rendering migration
 */

const ChatListEnhancer = {
    /**
     * Initialize the chat list enhancer
     */
    init() {
        // Check if we're on the chat list page
        if (!this.isChatListPage()) {
            return;
        }
        
        console.log('Initializing Chat List Enhancer for server-rendered page');
        
        // Initialize state
        this.initializeState();
        
        // Set up event listeners
        this.setupEventListeners();
        
        // Connect to websocket for real-time updates if available
        this.connectRealtime();
        
        console.log('Chat List Enhancer initialized');
    },
    
    /**
     * Check if we're on the chat list page
     */
    isChatListPage() {
        return window.location.pathname === '/my-chats';
    },
    
    /**
     * Initialize state
     */
    initializeState() {
        // Get chats data from server-rendered JSON if available
        const chatsJsonElement = document.getElementById('chats-json');
        
        if (chatsJsonElement) {
            try {
                this.chats = JSON.parse(chatsJsonElement.textContent);
                console.log(`Loaded ${this.chats.length} chats from server-rendered JSON`);
            } catch (e) {
                console.error('Error parsing server-rendered chats:', e);
                this.chats = [];
            }
        } else {
            // No pre-rendered chats, will need to fetch
            this.chats = [];
        }
        
        // Get user ID if available
        const userElement = document.getElementById('current-user-id');
        this.userId = userElement ? userElement.value : null;
        
        // Cache DOM elements
        this.cacheElements();
    },
    
    /**
     * Cache DOM elements for faster access
     */
    cacheElements() {
        this.elements = {
            chatList: document.getElementById('chat-list'),
            searchInput: document.getElementById('chat-search'),
            createChatBtn: document.getElementById('create-chat-btn'),
            refreshBtn: document.getElementById('refresh-btn'),
            statusBadge: document.getElementById('connection-status'),
            errorContainer: document.getElementById('error-container')
        };
    },
    
    /**
     * Set up event listeners
     */
    setupEventListeners() {
        // Refresh button
        if (this.elements.refreshBtn) {
            this.elements.refreshBtn.addEventListener('click', () => {
                this.refreshChats();
            });
        }
        
        // Search input
        if (this.elements.searchInput) {
            this.elements.searchInput.addEventListener('input', (e) => {
                this.filterChats(e.target.value);
            });
        }
        
        // Create chat button
        if (this.elements.createChatBtn) {
            this.elements.createChatBtn.addEventListener('click', () => {
                window.location.href = '/create';
            });
        }
    },
    
    /**
     * Connect to realtime service for updates
     */
    connectRealtime() {
        if (typeof SocketIOHelper === 'undefined') {
            console.log('SocketIOHelper not available, skipping realtime connection');
            return;
        }
        
        try {
            // Get socket connection
            this.socket = SocketIOHelper.getSocket();
            
            if (!this.socket) {
                console.error('Failed to get socket from SocketIOHelper');
                return;
            }
            
            // Set up socket event handlers
            this.setupSocketHandlers();
            
        } catch (e) {
            console.error('Error connecting to realtime service:', e);
        }
    },
    
    /**
     * Set up socket event handlers
     */
    setupSocketHandlers() {
        // When connected, join user's broadcast channel
        this.socket.on('connect', () => {
            console.log('Socket connected for chat list');
            this.updateConnectionStatus('online');
            
            // Join user's broadcast channel if user ID available
            if (this.userId) {
                this.socket.emit('join_user_channel', {user_id: this.userId});
            }
        });
        
        // Handle disconnects
        this.socket.on('disconnect', () => {
            console.log('Socket disconnected for chat list');
            this.updateConnectionStatus('offline');
        });
        
        // Handle reconnects
        this.socket.on('reconnect', () => {
            console.log('Socket reconnected for chat list');
            this.updateConnectionStatus('online');
            
            // Refresh chats to get latest
            this.refreshChats();
        });
        
        // Handle new message notifications
        this.socket.on('new_message', (data) => {
            console.log('New message notification received:', data);
            this.updateChatPreview(data.chat_id, data);
        });
        
        // Handle chat updates (new chat, participants changed, etc)
        this.socket.on('chat_updated', (data) => {
            console.log('Chat updated notification received:', data);
            this.refreshChats();
        });
    },
    
    /**
     * Update chat preview when new message arrives
     */
    updateChatPreview(chatId, messageData) {
        // Find the chat in the list
        const chatIndex = this.chats.findIndex(c => c.chat_id === chatId);
        
        if (chatIndex >= 0) {
            // Update chat with new message data
            const chat = this.chats[chatIndex];
            
            // Update last message
            chat.last_message = {
                content: messageData.content,
                sender_id: messageData.sender_id,
                created_at: messageData.created_at,
                time_formatted: this.formatTime(messageData.created_at),
                date_formatted: this.formatDate(messageData.created_at)
            };
            
            // Update preview
            chat.preview = {
                text: messageData.content.substring(0, 60) + (messageData.content.length > 60 ? '...' : ''),
                timestamp: messageData.created_at,
                sender_id: messageData.sender_id
            };
            
            // Mark as unread if it's not from current user
            if (messageData.sender_id !== this.userId) {
                chat.unread = true;
            }
            
            // Move chat to top of list
            this.chats.splice(chatIndex, 1);
            this.chats.unshift(chat);
            
            // Re-render chat list
            this.renderChatList();
        } else {
            // Chat not in list, refresh to get latest
            this.refreshChats();
        }
    },
    
    /**
     * Refresh chats from API
     */
    refreshChats() {
        // Show loading indicator
        this.showLoading();
        
        fetch('/api/chats', {
            headers: this.getAuthHeaders()
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`Failed to fetch chats: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            // Update chats with new data
            this.chats = data.chats || [];
            
            // Re-render chat list
            this.renderChatList();
            
            // Hide loading indicator
            this.hideLoading();
        })
        .catch(error => {
            console.error('Error refreshing chats:', error);
            this.showError('Failed to load chats. Please try again.');
            this.hideLoading();
        });
    },
    
    /**
     * Filter chats based on search input
     */
    filterChats(searchText) {
        // If no search text, show all chats
        if (!searchText) {
            Array.from(this.elements.chatList.querySelectorAll('.chat-list-item')).forEach(el => {
                el.classList.remove('d-none');
            });
            return;
        }
        
        // Convert to lowercase for case-insensitive search
        const search = searchText.toLowerCase();
        
        // Filter chat items in DOM
        Array.from(this.elements.chatList.querySelectorAll('.chat-list-item')).forEach(el => {
            const chatName = el.querySelector('.chat-title').textContent.toLowerCase();
            const chatPreview = el.querySelector('.chat-preview').textContent.toLowerCase();
            
            // Show if matches name or preview
            if (chatName.includes(search) || chatPreview.includes(search)) {
                el.classList.remove('d-none');
            } else {
                el.classList.add('d-none');
            }
        });
    },
    
    /**
     * Render the chat list
     */
    renderChatList() {
        // Skip if element doesn't exist
        if (!this.elements.chatList) return;
        
        // Check if we have chats
        if (!this.chats || this.chats.length === 0) {
            this.elements.chatList.innerHTML = `
                <div class="text-center p-5">
                    <div class="text-muted mb-3">
                        <i class="fas fa-comments fa-3x"></i>
                    </div>
                    <p>No chats yet. Start a new conversation!</p>
                    <a href="/create" class="btn btn-primary mt-3">
                        <i class="fas fa-plus me-2"></i> New Chat
                    </a>
                </div>
            `;
            return;
        }
        
        // Sort chats by last message time
        this.chats.sort((a, b) => {
            const timeA = a.last_message?.created_at || a.created_at || '';
            const timeB = b.last_message?.created_at || b.created_at || '';
            return timeB.localeCompare(timeA);
        });
        
        // Generate HTML for chat list
        let html = '';
        
        this.chats.forEach(chat => {
            const displayName = chat.name || chat.other_participant?.display_name || 
                                chat.other_participant?.username || 'Chat';
            
            html += `
                <a href="/chat/${chat.chat_id}" class="chat-list-item ${chat.unread ? 'unread' : ''}" 
                   data-chat-id="${chat.chat_id}">
                    <div class="d-flex align-items-center py-2">
                        <!-- Chat avatar with status indicator -->
                        <div class="chat-avatar me-3">
                            ${chat.other_participant?.profile_image ? 
                                `<img src="${chat.other_participant.profile_image}" alt="${displayName}" class="avatar">` :
                                `<div class="avatar-fallback">${displayName.charAt(0)}</div>`
                            }
                            
                            ${chat.other_participant ? 
                                `<span class="status-indicator ${chat.other_participant.status || 'offline'}"></span>` : 
                                ''
                            }
                        </div>
                        
                        <!-- Chat details -->
                        <div class="chat-info flex-grow-1">
                            <div class="d-flex justify-content-between align-items-start">
                                <h3 class="chat-title fs-6 mb-1">${this.escapeHtml(displayName)}</h3>
                                <small class="chat-time text-muted">
                                    ${chat.last_message?.time_formatted || ''}
                                </small>
                            </div>
                            
                            <div class="d-flex justify-content-between align-items-center">
                                <p class="chat-preview text-truncate mb-0 text-muted">
                                    ${this.escapeHtml(chat.preview?.text || 'No messages yet')}
                                </p>
                                
                                ${chat.unread ? 
                                    '<span class="badge bg-primary rounded-pill ms-2">New</span>' : 
                                    ''
                                }
                            </div>
                        </div>
                    </div>
                </a>
            `;
        });
        
        // Set HTML
        this.elements.chatList.innerHTML = html;
        
        // Apply active search filter if exists
        if (this.elements.searchInput && this.elements.searchInput.value) {
            this.filterChats(this.elements.searchInput.value);
        }
    },
    
    /**
     * Update connection status indicator
     */
    updateConnectionStatus(status) {
        if (!this.elements.statusBadge) return;
        
        // Remove existing status classes
        this.elements.statusBadge.classList.remove('bg-success', 'bg-danger', 'bg-warning');
        
        // Update based on status
        switch (status) {
            case 'online':
                this.elements.statusBadge.classList.add('bg-success');
                this.elements.statusBadge.textContent = 'Connected';
                break;
            case 'offline':
                this.elements.statusBadge.classList.add('bg-danger');
                this.elements.statusBadge.textContent = 'Disconnected';
                break;
            case 'connecting':
                this.elements.statusBadge.classList.add('bg-warning');
                this.elements.statusBadge.textContent = 'Connecting...';
                break;
        }
    },
    
    /**
     * Show loading indicator
     */
    showLoading() {
        if (this.elements.chatList) {
            this.elements.chatList.classList.add('loading');
        }
    },
    
    /**
     * Hide loading indicator
     */
    hideLoading() {
        if (this.elements.chatList) {
            this.elements.chatList.classList.remove('loading');
        }
    },
    
    /**
     * Show error message
     */
    showError(message) {
        if (this.elements.errorContainer) {
            this.elements.errorContainer.textContent = message;
            this.elements.errorContainer.classList.remove('d-none');
            
            // Hide after 5 seconds
            setTimeout(() => {
                this.elements.errorContainer.classList.add('d-none');
            }, 5000);
        }
    },
    
    /**
     * Format time for display
     */
    formatTime(timestamp) {
        if (!timestamp) return '';
        
        try {
            const date = new Date(timestamp);
            const now = new Date();
            
            // If today, show time only
            if (date.toDateString() === now.toDateString()) {
                return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            }
            
            // If this year, show month and day
            if (date.getFullYear() === now.getFullYear()) {
                return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
            }
            
            // Otherwise show date with year
            return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
        } catch (e) {
            console.error('Error formatting time:', e);
            return '';
        }
    },
    
    /**
     * Format date for display
     */
    formatDate(timestamp) {
        if (!timestamp) return '';
        
        try {
            const date = new Date(timestamp);
            const now = new Date();
            
            // Calculate days difference
            const daysDiff = Math.floor((now - date) / (1000 * 60 * 60 * 24));
            
            if (daysDiff === 0) {
                return 'Today';
            } else if (daysDiff === 1) {
                return 'Yesterday';
            } else if (daysDiff < 7) {
                return date.toLocaleDateString([], { weekday: 'long' });
            } else if (date.getFullYear() === now.getFullYear()) {
                return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
            } else {
                return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
            }
        } catch (e) {
            console.error('Error formatting date:', e);
            return '';
        }
    },
    
    /**
     * Get authentication headers
     */
    getAuthHeaders() {
        let headers = {
            'Content-Type': 'application/json'
        };
        
        if (typeof AuthHelper !== 'undefined' && AuthHelper.getToken) {
            const token = AuthHelper.getToken();
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }
        }
        
        return headers;
    },
    
    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    ChatListEnhancer.init();
}); 