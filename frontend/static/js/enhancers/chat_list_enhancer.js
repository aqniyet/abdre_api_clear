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
    }
    
    /**
     * Set up event listeners
     */
    function setupEventListeners() {
        // Set up filter buttons
        if (filterButtons) {
            filterButtons.forEach(button => {
                button.addEventListener('click', function() {
                    const filter = this.dataset.filter;
                    setActiveFilter(filter);
                });
            });
        }
        
        // Set up search form
        if (searchForm) {
            searchForm.addEventListener('submit', function(e) {
                e.preventDefault();
                const input = this.querySelector('input');
                searchQuery = input ? input.value.trim().toLowerCase() : '';
                filterChats();
            });
            
            // Add input handler for live search
            const searchInput = searchForm.querySelector('input');
            if (searchInput) {
                searchInput.addEventListener('input', function() {
                    searchQuery = this.value.trim().toLowerCase();
                    filterChats();
                });
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
            // Listen for new message events
            ABDRE.EventBus.subscribe('message:received', function(data) {
                updateChatWithNewMessage(data);
            });
            
            // Listen for message read events
            ABDRE.EventBus.subscribe('message:read', function(data) {
                updateChatReadStatus(data);
            });
        }
    }
    
    /**
     * Update chat list with new message
     * @param {Object} data - Message data
     */
    function updateChatWithNewMessage(data) {
        const { chat_id, message } = data;
        
        // Find the chat
        const chatIndex = chats.findIndex(chat => chat.chat_id === chat_id);
        
        if (chatIndex !== -1) {
            // Update existing chat
            const chat = chats[chatIndex];
            
            // Update last message and activity
            chat.last_message = message;
            chat.last_activity = message.timestamp;
            
            // Increment unread count if not from current user
            if (message.sender_id !== ABDRE.currentUserId) {
                chat.unread_count = (chat.unread_count || 0) + 1;
            }
            
            // Move to the top of the list
            chats.splice(chatIndex, 1);
            chats.unshift(chat);
        } else {
            // This is a new chat - we should fetch it
            // For now we'll create a placeholder
            const newChat = {
                chat_id: chat_id,
                last_message: message,
                last_activity: message.timestamp,
                unread_count: message.sender_id !== ABDRE.currentUserId ? 1 : 0,
                display_name: message.sender_name || 'New Chat',
                type: 'direct'
            };
            
            chats.unshift(newChat);
        }
        
        // Refilter and render
        filterChats();
    }
    
    /**
     * Update read status for a chat
     * @param {Object} data - Read status data
     */
    function updateChatReadStatus(data) {
        const { chat_id } = data;
        
        // Find the chat
        const chat = chats.find(c => c.chat_id === chat_id);
        
        if (chat) {
            // Reset unread count
            chat.unread_count = 0;
            
            // Refilter and render
            filterChats();
        }
    }
    
    /**
     * Add a new chat to the list 
     * @param {Object} chat - Chat data
     */
    function addChat(chat) {
        // Check if chat already exists
        const existingIndex = chats.findIndex(c => c.chat_id === chat.chat_id);
        
        if (existingIndex !== -1) {
            // Replace existing chat
            chats[existingIndex] = chat;
        } else {
            // Add new chat at the beginning
            chats.unshift(chat);
        }
        
        // Refilter and render
        filterChats();
    }
    
    /**
     * Remove a chat from the list
     * @param {string} chatId - Chat ID to remove
     */
    function removeChat(chatId) {
        chats = chats.filter(chat => chat.chat_id !== chatId);
        
        // Refilter and render
        filterChats();
    }
    
    // Public API
    return {
        init: init,
        addChat: addChat,
        removeChat: removeChat
    };
})(); 