/**
 * Chat Service for ABDRE Chat
 * Handles API interactions for chat functionality
 */

// Make sure ABDRE namespace exists
window.ABDRE = window.ABDRE || {};
window.ABDRE.Services = window.ABDRE.Services || {};

/**
 * Chat Service
 */
ABDRE.Services.Chat = (function() {
    'use strict';

    const API_ENDPOINTS = {
        MY_CHATS: '/api/my-chats',
        CHAT: (chatId) => `/api/chats/${chatId}`,
        MESSAGES: (chatId) => `/api/chats/${chatId}/messages`,
        MESSAGE: (chatId, messageId) => `/api/chats/${chatId}/messages/${messageId}`,
        CREATE_CHAT: '/api/chats',
        READ_RECEIPTS: (chatId) => `/api/chats/${chatId}/read`
    };
    
    /**
     * Fetch user's chat list
     * @returns {Promise<Array>} Chat list
     */
    async function getChats() {
        try {
            const response = await fetch(API_ENDPOINTS.MY_CHATS, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                credentials: 'include'
            });
            
            if (!response.ok) {
                throw new Error(`Failed to fetch chats: ${response.status}`);
            }
            
            const data = await response.json();
            return data.chats || [];
        } catch (error) {
            console.error('Error fetching chats:', error);
            throw error;
        }
    }
    
    /**
     * Get details for a specific chat
     * @param {string} chatId - Chat ID
     * @returns {Promise<Object>} Chat details
     */
    async function getChat(chatId) {
        try {
            const response = await fetch(API_ENDPOINTS.CHAT(chatId), {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                credentials: 'include'
            });
            
            if (!response.ok) {
                throw new Error(`Failed to fetch chat: ${response.status}`);
            }
            
            return await response.json();
        } catch (error) {
            console.error(`Error fetching chat ${chatId}:`, error);
            throw error;
        }
    }
    
    /**
     * Get messages for a specific chat
     * @param {string} chatId - Chat ID
     * @param {Object} options - Fetch options
     * @returns {Promise<Array>} Chat messages
     */
    async function getMessages(chatId, options = {}) {
        try {
            const { before, limit = 50 } = options;
            
            let url = API_ENDPOINTS.MESSAGES(chatId);
            const params = new URLSearchParams();
            
            if (before) {
                params.append('before', before);
            }
            
            params.append('limit', limit.toString());
            
            if (params.toString()) {
                url += `?${params.toString()}`;
            }
            
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                credentials: 'include'
            });
            
            if (!response.ok) {
                throw new Error(`Failed to fetch messages: ${response.status}`);
            }
            
            const data = await response.json();
            return data.messages || [];
        } catch (error) {
            console.error(`Error fetching messages for chat ${chatId}:`, error);
            throw error;
        }
    }
    
    /**
     * Send a new message
     * @param {string} chatId - Chat ID
     * @param {Object} message - Message object
     * @returns {Promise<Object>} Created message
     */
    async function sendMessage(chatId, message) {
        try {
            const response = await fetch(API_ENDPOINTS.MESSAGES(chatId), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify(message)
            });
            
            if (!response.ok) {
                throw new Error(`Failed to send message: ${response.status}`);
            }
            
            return await response.json();
        } catch (error) {
            console.error(`Error sending message to chat ${chatId}:`, error);
            throw error;
        }
    }
    
    /**
     * Mark messages as read
     * @param {string} chatId - Chat ID
     * @returns {Promise<Object>} Result
     */
    async function markAsRead(chatId) {
        try {
            const response = await fetch(API_ENDPOINTS.READ_RECEIPTS(chatId), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify({
                    timestamp: new Date().toISOString()
                })
            });
            
            if (!response.ok) {
                throw new Error(`Failed to mark chat as read: ${response.status}`);
            }
            
            return await response.json();
        } catch (error) {
            console.error(`Error marking chat ${chatId} as read:`, error);
            throw error;
        }
    }
    
    /**
     * Create a new chat
     * @param {Object} chatData - Chat creation data
     * @returns {Promise<Object>} Created chat
     */
    async function createChat(chatData) {
        try {
            const response = await fetch(API_ENDPOINTS.CREATE_CHAT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify(chatData)
            });
            
            if (!response.ok) {
                throw new Error(`Failed to create chat: ${response.status}`);
            }
            
            return await response.json();
        } catch (error) {
            console.error('Error creating chat:', error);
            throw error;
        }
    }
    
    /**
     * Update a chat
     * @param {string} chatId - Chat ID
     * @param {Object} chatData - Updated chat data
     * @returns {Promise<Object>} Updated chat
     */
    async function updateChat(chatId, chatData) {
        try {
            const response = await fetch(API_ENDPOINTS.CHAT(chatId), {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify(chatData)
            });
            
            if (!response.ok) {
                throw new Error(`Failed to update chat: ${response.status}`);
            }
            
            return await response.json();
        } catch (error) {
            console.error(`Error updating chat ${chatId}:`, error);
            throw error;
        }
    }
    
    /**
     * Delete a chat
     * @param {string} chatId - Chat ID
     * @returns {Promise<Object>} Result
     */
    async function deleteChat(chatId) {
        try {
            const response = await fetch(API_ENDPOINTS.CHAT(chatId), {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                credentials: 'include'
            });
            
            if (!response.ok) {
                throw new Error(`Failed to delete chat: ${response.status}`);
            }
            
            return await response.json();
        } catch (error) {
            console.error(`Error deleting chat ${chatId}:`, error);
            throw error;
        }
    }
    
    // Public API
    return {
        getChats,
        getChat,
        getMessages,
        sendMessage,
        markAsRead,
        createChat,
        updateChat,
        deleteChat
    };
})(); 