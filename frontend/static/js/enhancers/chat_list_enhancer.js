/**
 * Chat List Enhancer for ABDRE Chat
 * Handles chat list display and interactions
 */

// Make sure ABDRE namespace exists
window.ABDRE = window.ABDRE || {};
window.ABDRE.Enhancers = window.ABDRE.Enhancers || {};

/**
 * Chat List Enhancer
 */
ABDRE.Enhancers.ChatList = (function() {
    'use strict';

    // DOM Elements
    let chatListContainer;
    let emptyStateContainer;
    let filterButtons;
    let searchForm;
    let chatList;
    
    // State
    let chats = [];
    let filteredChats = [];
    let activeFilter = 'all';
    let searchQuery = '';
    
    // Event subscriptions for cleanup
    let eventSubscriptions = [];
    
    /**
     * Initialize enhancer
     * @param {Array} initialChats - Array of chat objects
     */
    function init(initialChats = []) {
        // Find DOM elements
        chatListContainer = document.querySelector('.chat-list');
        emptyStateContainer = document.querySelector('.empty-state');
        filterButtons = document.querySelectorAll('.filter-btn');
        searchForm = document.querySelector('.search-bar form');
        
        // Set initial chats
        chats = initialChats || [];
        filteredChats = [...chats];
        
        // Set up event listeners
        setupEventListeners();
        
        // Filter chats (initial view)
        filterChats();
        
        // Subscribe to events
        subscribeToEvents();
        
        if (ABDRE.EventBus) {
            ABDRE.EventBus.publish('chatList:initialized');
        }
        
        return this;
    }
    
    /**
     * Set up event listeners
     */
    function setupEventListeners() {
        // Set up filter buttons
        if (filterButtons && filterButtons.length) {
            filterButtons.forEach(button => {
                // Create named handler for cleanup
                const filterButtonHandler = function() {
                    const filter = this.dataset.filter;
                    setActiveFilter(filter);
                };
                
                button.addEventListener('click', filterButtonHandler);
                
                // Store reference for cleanup
                button._filterHandler = filterButtonHandler;
            });
        }
        
        // Set up search form
        if (searchForm) {
            // Create named handler for cleanup
            const searchFormHandler = function(e) {
                e.preventDefault();
                const input = this.querySelector('input');
                searchQuery = input ? input.value.trim().toLowerCase() : '';
                filterChats();
            };
            
            searchForm.addEventListener('submit', searchFormHandler);
            
            // Store reference for cleanup
            searchForm._submitHandler = searchFormHandler;
            
            // Add input handler for live search
            const searchInput = searchForm.querySelector('input');
            if (searchInput) {
                // Create named handler for cleanup
                const searchInputHandler = function() {
                    searchQuery = this.value.trim().toLowerCase();
                    filterChats();
                };
                
                searchInput.addEventListener('input', searchInputHandler);
                
                // Store reference for cleanup
                searchInput._inputHandler = searchInputHandler;
            }
        }
    }
    
    /**
     * Set active filter
     * @param {string} filter - Filter name
     */
    function setActiveFilter(filter) {
        // Update active filter
        activeFilter = filter;
        
        // Update UI
        filterButtons.forEach(button => {
            if (button.dataset.filter === filter) {
                button.classList.add('active');
            } else {
                button.classList.remove('active');
            }
        });
        
        // Filter chats
        filterChats();
    }
    
    /**
     * Filter chats based on active filter and search query
     */
    function filterChats() {
        // First filter by type
        let filtered = chats;
        
        if (activeFilter === 'unread') {
            filtered = chats.filter(chat => chat.unread_count > 0);
        } else if (activeFilter === 'direct') {
            filtered = chats.filter(chat => chat.type === 'direct');
        } else if (activeFilter === 'group') {
            filtered = chats.filter(chat => chat.type === 'group');
        }
        
        // Then filter by search query if present
        if (searchQuery) {
            filtered = filtered.filter(chat => {
                const chatName = chat.display_name ? chat.display_name.toLowerCase() : '';
                const lastMessage = chat.last_message ? chat.last_message.content.toLowerCase() : '';
                return chatName.includes(searchQuery) || lastMessage.includes(searchQuery);
            });
        }
        
        // Update filtered chats
        filteredChats = filtered;
        
        // Render the filtered list
        renderChatList();
    }
    
    /**
     * Render the chat list
     */
    function renderChatList() {
        if (!chatListContainer) return;
        
        // Show empty state if no chats
        if (filteredChats.length === 0) {
            chatListContainer.innerHTML = '';
            
            if (emptyStateContainer) {
                // Different empty state based on filter and search
                let emptyStateMessage = 'No chats found';
                
                if (searchQuery) {
                    emptyStateMessage = 'No chats found matching your search.';
                } else if (activeFilter === 'unread') {
                    emptyStateMessage = 'No unread messages.';
                } else if (activeFilter === 'direct') {
                    emptyStateMessage = 'No direct messages.';
                } else if (activeFilter === 'group') {
                    emptyStateMessage = 'No group chats.';
                } else if (chats.length === 0) {
                    emptyStateMessage = 'You have no chats yet.';
                }
                
                emptyStateContainer.querySelector('p').textContent = emptyStateMessage;
                emptyStateContainer.style.display = 'flex';
            }
            return;
        }
        
        // Hide empty state
        if (emptyStateContainer) {
            emptyStateContainer.style.display = 'none';
        }
        
        // Build chat list HTML
        const chatListHTML = filteredChats.map(chat => {
            // Format time
            const time = formatTime(chat.last_activity);
            
            // Set CSS classes
            let classes = 'chat-item';
            if (chat.unread_count > 0) classes += ' unread';
            
            // Determine avatar display
            let avatarHTML = '';
            if (chat.type === 'direct') {
                if (chat.avatar_url) {
                    avatarHTML = `<img src="${chat.avatar_url}" alt="${chat.display_name || 'Chat'}" />`;
                } else {
                    const initial = (chat.display_name || 'C').charAt(0).toUpperCase();
                    avatarHTML = `<div class="avatar-placeholder">${initial}</div>`;
                }
            } else {
                // Group chat avatar
                avatarHTML = `<div class="avatar-placeholder">G</div>`;
            }
            
            // Build chat item HTML
            return `
                <a href="/chat/${chat.chat_id}" class="${classes}">
                    <div class="chat-avatar">
                        ${avatarHTML}
                    </div>
                    <div class="chat-info">
                        <div class="chat-name">${chat.display_name || 'Chat'}</div>
                        <div class="chat-last-message">${chat.last_message ? chat.last_message.content : 'No messages yet'}</div>
                    </div>
                    <div class="chat-meta">
                        <div class="chat-time">${time}</div>
                        ${chat.unread_count > 0 ? `<div class="chat-unread-badge">${chat.unread_count}</div>` : ''}
                    </div>
                </a>
            `;
        }).join('');
        
        // Update DOM
        chatListContainer.innerHTML = chatListHTML;
    }
    
    /**
     * Format timestamp to readable time
     * @param {string} timestamp - ISO timestamp
     * @returns {string} Formatted time
     */
    function formatTime(timestamp) {
        if (!timestamp) return '';
        
        const date = new Date(timestamp);
        const now = new Date();
        
        // Check if same day
        if (date.toDateString() === now.toDateString()) {
            // Return time only for today
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else if (now.getTime() - date.getTime() < 7 * 24 * 60 * 60 * 1000) {
            // Return day name for within the last week
            return date.toLocaleDateString([], { weekday: 'short' });
        } else {
            // Return date for older messages
            return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
        }
    }
    
    /**
     * Subscribe to relevant events
     */
    function subscribeToEvents() {
        if (ABDRE.EventBus) {
            // Subscribe to chat message events
            const newMessageSubscription = ABDRE.EventBus.subscribe('chat:new_message', updateChatWithNewMessage);
            eventSubscriptions.push(newMessageSubscription);
            
            // Subscribe to chat read status events
            const readStatusSubscription = ABDRE.EventBus.subscribe('chat:read_status', updateChatReadStatus);
            eventSubscriptions.push(readStatusSubscription);
            
            // Subscribe to chat add/remove events
            const chatAddedSubscription = ABDRE.EventBus.subscribe('chat:added', addChat);
            eventSubscriptions.push(chatAddedSubscription);
            
            const chatRemovedSubscription = ABDRE.EventBus.subscribe('chat:removed', removeChat);
            eventSubscriptions.push(chatRemovedSubscription);
        }
    }
    
    /**
     * Cleanup event listeners and subscriptions
     */
    function cleanup() {
        // Clean up filter button event listeners
        if (filterButtons && filterButtons.length) {
            filterButtons.forEach(button => {
                if (button._filterHandler) {
                    button.removeEventListener('click', button._filterHandler);
                    delete button._filterHandler;
                }
            });
        }
        
        // Clean up search form event listeners
        if (searchForm) {
            if (searchForm._submitHandler) {
                searchForm.removeEventListener('submit', searchForm._submitHandler);
                delete searchForm._submitHandler;
            }
            
            const searchInput = searchForm.querySelector('input');
            if (searchInput && searchInput._inputHandler) {
                searchInput.removeEventListener('input', searchInput._inputHandler);
                delete searchInput._inputHandler;
            }
        }
        
        // Clean up event subscriptions
        eventSubscriptions.forEach(subscription => {
            if (subscription && typeof subscription.unsubscribe === 'function') {
                subscription.unsubscribe();
            }
        });
        
        // Reset state
        eventSubscriptions = [];
        chats = [];
        filteredChats = [];
        activeFilter = 'all';
        searchQuery = '';
    }
    
    /**
     * Update chat with new message
     * @param {Object} data - Message data
     */
    function updateChatWithNewMessage(data) {
        // Find the chat in the list
        const chatIndex = chats.findIndex(chat => chat.chat_id === data.chat_id);
        
        if (chatIndex !== -1) {
            // Update chat with new message
            const updatedChat = {
                ...chats[chatIndex],
                last_message: {
                    content: data.message.content,
                    sender_id: data.message.sender_id,
                    timestamp: data.message.timestamp
                },
                last_activity: data.message.timestamp
            };
            
            // Update unread count if not the sender
            if (data.message.sender_id !== ABDRE.App.getConfig('user_id')) {
                updatedChat.unread_count = (updatedChat.unread_count || 0) + 1;
            }
            
            // Update chat in list
            chats[chatIndex] = updatedChat;
            
            // Re-sort chats by most recent activity
            chats.sort((a, b) => {
                const aTime = new Date(a.last_activity || 0).getTime();
                const bTime = new Date(b.last_activity || 0).getTime();
                return bTime - aTime;
            });
            
            // Re-filter and render
            filterChats();
        }
    }
    
    /**
     * Update chat read status
     * @param {Object} data - Read status data
     */
    function updateChatReadStatus(data) {
        // Find the chat in the list
        const chatIndex = chats.findIndex(chat => chat.chat_id === data.chat_id);
        
        if (chatIndex !== -1) {
            // Update chat read status
            chats[chatIndex] = {
                ...chats[chatIndex],
                unread_count: 0
            };
            
            // Re-filter and render
            filterChats();
        }
    }
    
    /**
     * Add a new chat to the list
     * @param {Object} chat - Chat data
     */
    function addChat(chat) {
        // Check if chat already exists
        const exists = chats.some(c => c.chat_id === chat.chat_id);
        
        if (!exists) {
            // Add chat to list
            chats.push(chat);
            
            // Sort chats
            chats.sort((a, b) => {
                const aTime = new Date(a.last_activity || 0).getTime();
                const bTime = new Date(b.last_activity || 0).getTime();
                return bTime - aTime;
            });
            
            // Re-filter and render
            filterChats();
        }
    }
    
    /**
     * Remove a chat from the list
     * @param {string} chatId - Chat ID
     */
    function removeChat(chatId) {
        // Filter out the chat
        chats = chats.filter(chat => chat.chat_id !== chatId);
        
        // Re-filter and render
        filterChats();
    }
    
    // Public API
    return {
        init: init,
        
        /**
         * Add a chat to the list
         * @param {Object} chat - Chat data
         */
        addChat: addChat,
        
        /**
         * Remove a chat from the list
         * @param {string} chatId - Chat ID
         */
        removeChat: removeChat,
        
        /**
         * Update chats with new data
         * @param {Array} newChats - Array of chat objects
         */
        updateChats: function(newChats) {
            if (Array.isArray(newChats)) {
                chats = newChats;
                filterChats();
            }
        },
        
        /**
         * Destroy the enhancer and clean up
         */
        destroy: function() {
            cleanup();
            return null;
        }
    };
})();

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    // Only initialize if the chat list container exists on the page
    if (document.querySelector('.chat-list')) {
        ABDRE.Enhancers.ChatList.init();
    }
}); 