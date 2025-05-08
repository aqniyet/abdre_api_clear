/**
 * Chat Service
 * Provides high-level methods for chat operations combining both API and Socket functionality
 */

const ChatService = {
    /**
     * Get list of user chats
     * 
     * @returns {Promise<Array>} List of chat rooms
     */
    async getChats() {
        return ApiClient.getChats();
    },
    
    /**
     * Connect to a chat room
     * 
     * @param {string} roomId - Chat room ID
     * @param {Function} onMessage - Message handler
     * @param {Function} onUserJoin - User join handler
     * @param {Function} onUserStatus - User status handler
     * @returns {Object} - Subscription handlers
     */
    connectToRoom(roomId, onMessage, onUserJoin, onUserStatus) {
        if (!roomId) {
            console.error('Room ID is required');
            return { unsubscribe: () => {} };
        }
        
        // Join the room via socket
        SocketClient.joinRoom(roomId);
        
        // Set up event handlers
        const messageHandler = data => {
            if (data.room_id === roomId && onMessage) {
                onMessage(data);
            }
        };
        
        const joinHandler = data => {
            if (data.room_id === roomId && onUserJoin) {
                onUserJoin(data);
            }
        };
        
        const userActiveHandler = data => {
            if (data.room_id === roomId && onUserStatus) {
                onUserStatus(data, true);
            }
        };
        
        const userAwayHandler = data => {
            if (data.room_id === roomId && onUserStatus) {
                onUserStatus(data, false);
            }
        };
        
        // Subscribe to events
        const messageUnsubscribe = SocketClient.on(SocketClient.config.eventTypes.MESSAGE, messageHandler);
        const joinUnsubscribe = SocketClient.on(SocketClient.config.eventTypes.JOIN, joinHandler);
        const userActiveUnsubscribe = SocketClient.on(SocketClient.config.eventTypes.USER_ACTIVE, userActiveHandler);
        const userAwayUnsubscribe = SocketClient.on(SocketClient.config.eventTypes.USER_AWAY, userAwayHandler);
        
        // Return unsubscribe function
        return {
            unsubscribe: () => {
                messageUnsubscribe();
                joinUnsubscribe();
                userActiveUnsubscribe();
                userAwayUnsubscribe();
                SocketClient.leaveRoom(roomId);
            }
        };
    },
    
    /**
     * Load message history for a room
     * 
     * @param {string} roomId - Chat room ID
     * @param {Object} options - Query options
     * @returns {Promise<Array>} - List of messages
     */
    async getMessageHistory(roomId, options = {}) {
        return ApiClient.getChatMessages(roomId, options);
    },
    
    /**
     * Send a message to a chat room
     * 
     * @param {string} roomId - Chat room ID
     * @param {string} message - Message content
     * @returns {Promise<Object>} - Message data
     */
    async sendMessage(roomId, message) {
        if (!roomId || !message) {
            throw new Error('Room ID and message are required');
        }
        
        // Generate a unique ID for this message
        const messageId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
        
        // First send via socket for instant display
        SocketClient.sendMessage(roomId, message, messageId);
        
        // Then persist via API
        try {
            return await ApiClient.sendMessage(roomId, message);
        } catch (error) {
            console.error('Error sending message via API:', error);
            // Even if API fails, socket might have succeeded
            return { message_id: messageId, pending: true, error };
        }
    },
    
    /**
     * Send typing indicator
     * 
     * @param {string} roomId - Chat room ID
     * @param {boolean} isTyping - Whether user is typing
     */
    sendTypingIndicator(roomId, isTyping = true) {
        SocketClient.sendTypingStatus(roomId, isTyping);
    },
    
    /**
     * Generate a QR code invitation
     * 
     * @returns {Promise<Object>} Invitation data
     */
    async createInvitation() {
        // Generate invitation via API
        const invitation = await ApiClient.createChatInvitation();
        
        // Ensure we have a valid token
        if (!invitation || (!invitation.invitation_token && !invitation.token)) {
            console.error('Invalid invitation data:', invitation);
            throw new Error('No invitation token received from server');
        }
        
        // Use either invitation_token or token field
        const token = invitation.invitation_token || invitation.token;
        
        // Notify realtime service about new invitation
        SocketClient.notifyInvitationCreated(token);
        
        return invitation;
    },
    
    /**
     * Check invitation status
     * 
     * @param {string} token - Invitation token
     * @returns {Promise<Object>} Invitation status
     */
    async checkInvitationStatus(token) {
        if (!token) {
            console.error('Cannot check invitation status: Invalid or missing token');
            throw new Error('Invalid invitation token');
        }
        
        // Check via API for current status
        const status = await ApiClient.getInvitationStatus(token);
        
        // Also request status via socket for realtime updates
        SocketClient.checkInvitationStatus(token);
        
        return status;
    },
    
    /**
     * Set up listeners for invitation status updates
     * 
     * @param {string} token - Invitation token
     * @param {Function} onStatusChange - Status change handler
     * @param {Function} onAccepted - Invitation accepted handler
     * @param {Function} onScanned - QR code scanned handler
     * @returns {Object} - Subscription handlers
     */
    listenForInvitationUpdates(token, onStatusChange, onAccepted, onScanned) {
        if (!token) {
            return { unsubscribe: () => {} };
        }
        
        const statusHandler = data => {
            if (data.invitation_token === token && onStatusChange) {
                onStatusChange(data);
            }
        };
        
        const acceptedHandler = data => {
            if (data.invitation_token === token && onAccepted) {
                onAccepted(data);
            }
        };
        
        const scannedHandler = data => {
            if (data.invitation_token === token && onScanned) {
                onScanned(data);
            }
        };
        
        // Subscribe to events
        const statusUnsubscribe = SocketClient.on(SocketClient.config.eventTypes.INVITATION_STATUS, statusHandler);
        const acceptedUnsubscribe = SocketClient.on(SocketClient.config.eventTypes.INVITATION_ACCEPTED, acceptedHandler);
        const scannedUnsubscribe = SocketClient.on(SocketClient.config.eventTypes.QR_SCANNED_NOTIFICATION, scannedHandler);
        
        // Check status immediately
        SocketClient.checkInvitationStatus(token);
        
        // Return unsubscribe function
        return {
            unsubscribe: () => {
                statusUnsubscribe();
                acceptedUnsubscribe();
                scannedUnsubscribe();
            }
        };
    },
    
    /**
     * Join a chat using an invitation token
     * 
     * @param {string} token - Invitation token
     * @returns {Promise<Object>} - Chat data
     */
    async joinChatByInvitation(token) {
        // First, notify about QR scan
        SocketClient.notifyQrScanned(token);
        
        // Then join via API
        const result = await ApiClient.joinChatByToken(token);
        
        return result;
    },
    
    /**
     * Create a new chat
     * 
     * @param {Array<string>} participants - List of participant IDs
     * @returns {Promise<Object>} - Chat data
     */
    async createChat(participants) {
        return ApiClient.createChat(participants);
    }
};

// Export for use in other modules
window.ChatService = ChatService; 