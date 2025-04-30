/**
 * My Chats Page Module for ABDRE Chat Application
 * Handles the list of user's chats
 */

const MyChatsPage = {
  /**
   * Initialize the my chats page
   */
  init() {
    // Check if user is authenticated
    if (AuthHelper.requireAuth(window.location.pathname)) {
      return;
    }
    
    // Initialize state
    stateManager.setMultiple({
      chats: [],
      isLoading: true,
      isConnected: false
    });
    
    // Initialize UI elements
    this.initUI();
    
    // Load user chats
    this.loadChats();
    
    // Initialize socket connection for real-time updates
    this.initSocketConnection();
  },
  
  /**
   * Initialize UI elements
   */
  initUI() {
    // Get UI elements
    this.chatListContainer = document.getElementById('chat-list-container');
    this.createChatButton = document.getElementById('create-chat-button');
    this.refreshButton = document.getElementById('refresh-button');
    this.searchInput = document.getElementById('search-input');
    
    // Add event listeners
    if (this.createChatButton) {
      this.createChatButton.addEventListener('click', () => {
        window.location.href = '/new';
      });
    }
    
    if (this.refreshButton) {
      this.refreshButton.addEventListener('click', () => {
        this.loadChats();
      });
    }
    
    if (this.searchInput) {
      this.searchInput.addEventListener('input', this.handleSearch.bind(this));
    }
  },
  
  /**
   * Initialize socket connection
   */
  async initSocketConnection() {
    try {
      await socketClient.init();
      stateManager.set('isConnected', true);
      
      // Set up event handlers for real-time updates
      socketClient.on('message', this.handleNewMessage.bind(this));
      socketClient.on('user_active', this.handleUserActive.bind(this));
      socketClient.on('user_away', this.handleUserAway.bind(this));
    } catch (error) {
      console.error('Socket initialization failed:', error);
      // Show error message - non-critical for this page
    }
  },
  
  /**
   * Load user chats from the API
   */
  async loadChats() {
    try {
      stateManager.set('isLoading', true);
      this.showLoadingState();
      
      const response = await apiClient.getChats();
      
      if (response.chats) {
        stateManager.set('chats', response.chats);
        ChatList.renderList(this.chatListContainer, response.chats);
      }
    } catch (error) {
      console.error('Failed to load chats:', error);
      this.showError('Could not load your chats. Please try again later.');
    } finally {
      stateManager.set('isLoading', false);
      this.hideLoadingState();
    }
  },
  
  /**
   * Handle search input
   * @param {Event} event - Input event
   */
  handleSearch(event) {
    const searchTerm = event.target.value.trim().toLowerCase();
    const allChats = stateManager.get('chats') || [];
    
    if (!searchTerm) {
      // Show all chats if search term is empty
      ChatList.renderList(this.chatListContainer, allChats);
      return;
    }
    
    // Filter chats by title or last message
    const filteredChats = allChats.filter(chat => {
      const title = (chat.title || '').toLowerCase();
      const lastMessage = (chat.last_message || '').toLowerCase();
      
      return title.includes(searchTerm) || lastMessage.includes(searchTerm);
    });
    
    ChatList.renderList(this.chatListContainer, filteredChats);
  },
  
  /**
   * Handle new message event from socket
   * @param {Object} data - Message data
   */
  handleNewMessage(data) {
    const allChats = stateManager.get('chats') || [];
    const chatId = data.room_id;
    
    // Find the chat and update it with the new message
    const chatIndex = allChats.findIndex(chat => chat.id === chatId);
    
    if (chatIndex !== -1) {
      const chat = allChats[chatIndex];
      
      // Update chat with new message info
      chat.last_message = data.content;
      chat.last_message_time = data.created_at;
      
      // Increment unread count if the message is not from current user
      if (data.sender_id !== AuthHelper.getUserId()) {
        chat.unread_count = (chat.unread_count || 0) + 1;
      }
      
      // Move chat to top of the list
      allChats.splice(chatIndex, 1);
      allChats.unshift(chat);
      
      // Update state and UI
      stateManager.set('chats', allChats);
      ChatList.renderList(this.chatListContainer, allChats);
    }
  },
  
  /**
   * Handle user active event from socket
   * @param {Object} data - User active data
   */
  handleUserActive(data) {
    const allChats = stateManager.get('chats') || [];
    const chatId = data.room_id;
    
    // Find the chat and update its active status
    const chat = allChats.find(chat => chat.id === chatId);
    
    if (chat) {
      chat.is_active = true;
      ChatList.setActiveStatus(this.chatListContainer, chatId, true);
    }
  },
  
  /**
   * Handle user away event from socket
   * @param {Object} data - User away data
   */
  handleUserAway(data) {
    const allChats = stateManager.get('chats') || [];
    const chatId = data.room_id;
    
    // Find the chat and update its active status
    const chat = allChats.find(chat => chat.id === chatId);
    
    if (chat) {
      chat.is_active = false;
      ChatList.setActiveStatus(this.chatListContainer, chatId, false);
    }
  },
  
  /**
   * Show loading state
   */
  showLoadingState() {
    // Add a loading spinner or indicator
    if (this.chatListContainer) {
      this.chatListContainer.innerHTML = `
        <div class="text-center p-4">
          <div class="spinner-border text-primary" role="status">
            <span class="visually-hidden">Loading...</span>
          </div>
          <p class="mt-2">Loading your chats...</p>
        </div>
      `;
    }
  },
  
  /**
   * Hide loading state
   */
  hideLoadingState() {
    // Remove loading indicator if it exists
    const loadingIndicator = this.chatListContainer.querySelector('.spinner-border');
    if (loadingIndicator) {
      loadingIndicator.parentElement.remove();
    }
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
      errorElement.className = 'error-message alert alert-danger alert-dismissible fade show mt-3';
      errorElement.setAttribute('role', 'alert');
      
      // Add a close button
      errorElement.innerHTML = `
        <span></span>
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
      `;
      
      // Add it to the page
      const container = document.querySelector('.container');
      container.insertBefore(errorElement, this.chatListContainer);
    }
    
    // Set the message
    errorElement.querySelector('span').textContent = message;
  }
}; 