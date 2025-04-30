/**
 * Chat Page Module for ABDRE Chat Application
 * Handles the chat room functionality
 */

const ChatPage = {
  /**
   * Initialize the chat page
   */
  init() {
    // Check if user is authenticated
    if (AuthHelper.requireAuth(window.location.pathname)) {
      return;
    }

    // Get room ID from URL
    const pathParts = window.location.pathname.split('/');
    const roomId = pathParts[pathParts.length - 1];
    
    // Initialize state
    stateManager.setMultiple({
      roomId,
      userId: AuthHelper.getUserId(),
      messages: [],
      isConnected: false
    });
    
    // Initialize socket connection
    this.initSocketConnection();
    
    // Initialize UI elements
    this.initUI();
    
    // Load chat messages
    this.loadChatMessages();
    
    // Set up visibility change listener
    document.addEventListener('visibilitychange', this.handleVisibilityChange.bind(this));
    
    // Set up window beforeunload listener
    window.addEventListener('beforeunload', this.handleBeforeUnload.bind(this));
  },
  
  /**
   * Initialize socket connection
   */
  async initSocketConnection() {
    try {
      await socketClient.init();
      stateManager.set('isConnected', true);
      
      // Join the room
      const roomId = stateManager.get('roomId');
      const userId = stateManager.get('userId');
      
      socketClient.joinRoom({
        room_id: roomId,
        visitor_id: userId
      });
      
      // Set up message handler
      socketClient.on('message', this.handleIncomingMessage.bind(this));
      
      // Set up user status handlers
      socketClient.on('user_active', this.handleUserActive.bind(this));
      socketClient.on('user_away', this.handleUserAway.bind(this));
      
      // Request current status
      socketClient.checkStatus({
        room_id: roomId
      });
      
      // Request unread count
      socketClient.requestUnreadCount({
        room_id: roomId,
        visitor_id: userId
      });
      
      // Set user as active
      socketClient.setUserActive({
        room_id: roomId,
        visitor_id: userId
      });
    } catch (error) {
      console.error('Socket initialization failed:', error);
      this.showError('Could not connect to chat server. Please try again later.');
    }
  },
  
  /**
   * Initialize UI elements
   */
  initUI() {
    // Get UI elements
    this.chatContainer = document.getElementById('chat-container');
    this.messageInput = document.getElementById('message-input');
    this.sendButton = document.getElementById('send-button');
    
    // Add event listeners
    this.sendButton.addEventListener('click', this.sendMessage.bind(this));
    this.messageInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.sendMessage();
      }
    });
  },
  
  /**
   * Handle incoming message
   * @param {Object} data - Message data
   */
  handleIncomingMessage(data) {
    const messages = stateManager.get('messages') || [];
    messages.push(data);
    stateManager.set('messages', messages);
    
    const userId = stateManager.get('userId');
    ChatMessage.addToContainer(this.chatContainer, data, userId);
  },
  
  /**
   * Handle user active event
   * @param {Object} data - User active data
   */
  handleUserActive(data) {
    // Update UI to show user is active
    const statusElement = document.getElementById('user-status');
    if (statusElement) {
      statusElement.textContent = 'Active';
      statusElement.classList.add('active');
      statusElement.classList.remove('away');
    }
  },
  
  /**
   * Handle user away event
   * @param {Object} data - User away data
   */
  handleUserAway(data) {
    // Update UI to show user is away
    const statusElement = document.getElementById('user-status');
    if (statusElement) {
      statusElement.textContent = 'Away';
      statusElement.classList.add('away');
      statusElement.classList.remove('active');
    }
  },
  
  /**
   * Handle document visibility change
   * Used to detect when the user switches tabs or windows
   */
  handleVisibilityChange() {
    const roomId = stateManager.get('roomId');
    const userId = stateManager.get('userId');
    
    if (document.visibilityState === 'visible') {
      socketClient.setUserActive({
        room_id: roomId,
        visitor_id: userId
      });
    } else {
      socketClient.setUserAway({
        room_id: roomId,
        visitor_id: userId
      });
    }
  },
  
  /**
   * Handle before unload event
   * Used to detect when the user closes the browser or navigates away
   */
  handleBeforeUnload() {
    const roomId = stateManager.get('roomId');
    const userId = stateManager.get('userId');
    
    // Use navigator.sendBeacon for reliable delivery even when page is unloading
    if (navigator.sendBeacon) {
      const data = {
        room_id: roomId,
        visitor_id: userId
      };
      
      navigator.sendBeacon('/api/user-away', JSON.stringify(data));
    } else {
      // Fallback for browsers that don't support sendBeacon
      apiClient.setUserAway({
        room_id: roomId,
        visitor_id: userId
      });
    }
  },
  
  /**
   * Load chat messages from the API
   */
  async loadChatMessages() {
    try {
      const roomId = stateManager.get('roomId');
      const response = await apiClient.getChatMessages(roomId);
      
      if (response.messages) {
        stateManager.set('messages', response.messages);
        
        const userId = stateManager.get('userId');
        ChatMessage.renderMessages(this.chatContainer, response.messages, userId);
      }
    } catch (error) {
      console.error('Failed to load chat messages:', error);
      this.showError('Could not load chat messages. Please try again later.');
    }
  },
  
  /**
   * Send a message
   */
  sendMessage() {
    const messageContent = this.messageInput.value.trim();
    
    if (!messageContent) {
      return;
    }
    
    const roomId = stateManager.get('roomId');
    const userId = stateManager.get('userId');
    
    // Generate a temporary ID for the message
    const tempId = Date.now().toString();
    
    // Create a message object
    const messageData = {
      room_id: roomId,
      message: messageContent,
      message_id: tempId,
      content: messageContent,
      sender_id: userId,
      created_at: new Date().toISOString()
    };
    
    // Clear the input
    this.messageInput.value = '';
    
    // Add the message to the UI
    ChatMessage.addToContainer(this.chatContainer, messageData, userId);
    
    // Add the message to state
    const messages = stateManager.get('messages') || [];
    messages.push(messageData);
    stateManager.set('messages', messages);
    
    // Send the message via socket
    socketClient.sendMessage({
      room_id: roomId,
      message: messageContent,
      message_id: tempId
    });
  },
  
  /**
   * Show an error message
   * @param {string} message - Error message
   */
  showError(message) {
    // Check if there's already an error message
    let errorElement = document.querySelector('.error-message');
    
    if (!errorElement) {
      errorElement = document.createElement('div');
      errorElement.className = 'error-message alert alert-danger alert-dismissible fade show';
      errorElement.setAttribute('role', 'alert');
      
      // Add a close button
      errorElement.innerHTML = `
        <span></span>
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
      `;
      
      // Add it to the page
      const mainContainer = document.querySelector('.main-container');
      mainContainer.insertBefore(errorElement, mainContainer.firstChild);
    }
    
    // Set the message
    errorElement.querySelector('span').textContent = message;
  }
}; 