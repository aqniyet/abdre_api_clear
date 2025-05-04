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
    
    console.log(`Initializing chat page with room ID: ${roomId}`);
    
    // Initialize state
    stateManager.setMultiple({
      roomId,
      userId: AuthHelper.getUserId(),
      messages: [],
      isConnected: false,
      lastMessageCheck: 0
    });
    
    // Initialize UI elements
    this.initUI();
    
    // Add refresh-messages event listener
    document.addEventListener('refresh-messages', () => {
      console.log('Received refresh-messages event, reloading messages');
      this.loadChatMessages()
        .then(() => console.log('Message refresh completed'))
        .catch(error => console.error('Message refresh failed:', error));
    });
    
    // First initialize socket connection
    this.initSocketConnection().then(() => {
      // After socket is connected, load chat messages
      this.loadChatMessages().catch(error => {
        console.error("Failed to load initial messages:", error);
      });
      
      // Set up visibility change listener
      document.addEventListener('visibilitychange', this.handleVisibilityChange.bind(this));
      
      // Set up window beforeunload listener
      window.addEventListener('beforeunload', this.handleBeforeUnload.bind(this));
      
      // Set up periodic message refresh (less frequent since we're relying more on WebSocket)
      this.setupPeriodicMessageRefresh();
    }).catch(error => {
      console.error("Failed to initialize socket:", error);
      
      // If socket fails, still try to load messages via HTTP
      this.loadChatMessages().catch(msgError => {
        console.error("Also failed to load messages:", msgError);
      });
      
      // Set up periodic message refresh with higher frequency since WebSocket failed
      this.setupPeriodicMessageRefresh(10000); // Every 10 seconds
    });
  },
  
  /**
   * Set up periodic message refresh to ensure we don't miss any messages
   * @param {number} interval - Interval in milliseconds (default: 30000)
   */
  setupPeriodicMessageRefresh(interval = 30000) {
    // Check for new messages at the specified interval
    setInterval(() => {
      // Only refresh if the tab is visible
      if (document.visibilityState === 'visible') {
        console.log('Performing periodic message refresh');
        this.loadChatMessages()
          .then(() => console.log('Periodic message refresh completed'))
          .catch(error => console.error('Periodic message refresh failed:', error));
      }
    }, interval);
  },
  
  /**
   * Initialize socket connection
   * @returns {Promise} - Promise that resolves when socket is connected
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
      
      console.log('Socket connection initialized successfully');
      return Promise.resolve();
    } catch (error) {
      console.error('Socket initialization failed:', error);
      this.showError('Could not connect to chat server. Messages will be sent via HTTP.');
      return Promise.reject(error);
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

    // Add share link functionality
    this.addShareLinkButton();
  },
  
  /**
   * Add a button to share the chat link
   */
  addShareLinkButton() {
    // Get the header section
    const header = document.querySelector('.card-header');
    if (!header) return;

    // Create share button
    const shareButton = document.createElement('button');
    shareButton.className = 'btn btn-primary btn-sm ms-2';
    shareButton.innerHTML = '<i class="bi bi-share"></i> Share Link (Required for others to join)';
    
    // Create share link container (hidden initially)
    const shareContainer = document.createElement('div');
    shareContainer.className = 'share-container mt-2 p-2 border rounded bg-light';
    shareContainer.innerHTML = `
      <div class="text-center mb-2"><strong>Important: Share this exact link with others to join this chat room</strong></div>
      <div class="input-group input-group-sm">
        <input type="text" id="share-link" class="form-control form-control-sm" value="${window.location.href}" readonly>
        <button class="btn btn-sm btn-success" id="copy-link-btn">
          <i class="bi bi-clipboard"></i> Copy Link
        </button>
      </div>
      <small class="text-muted">Both users must use the exact same link to see the same messages</small>
    `;
    
    // Add click event to share button
    shareButton.addEventListener('click', () => {
      shareContainer.classList.toggle('d-none');
    });
    
    // Add the elements to the DOM
    const statusContainer = header.querySelector('div');
    statusContainer.prepend(shareButton);
    header.appendChild(shareContainer);
    
    // Auto-show the share container on page load
    setTimeout(() => {
      shareContainer.classList.remove('d-none');
    }, 1000);
    
    // Add copy functionality
    const copyBtn = shareContainer.querySelector('#copy-link-btn');
    copyBtn.addEventListener('click', () => {
      const shareLink = shareContainer.querySelector('#share-link');
      shareLink.select();
      document.execCommand('copy');
      
      // Show copied notification
      const originalText = copyBtn.innerHTML;
      copyBtn.innerHTML = '<i class="bi bi-check"></i> Copied!';
      setTimeout(() => {
        copyBtn.innerHTML = originalText;
      }, 2000);
    });
  },
  
  /**
   * Handle incoming message
   * @param {Object} data - Message data
   */
  handleIncomingMessage(data) {
    console.log('Received incoming message via WebSocket:', data);
    
    // Validate the message data
    if (!data || !data.content || !data.sender_id) {
      console.error('Invalid message data received:', data);
      return;
    }
    
    // Skip duplicate messages
    const messages = stateManager.get('messages') || [];
    
    // Check for duplicates by ID or content+timestamp
    const isDuplicate = messages.some(msg => 
      msg.message_id === data.message_id || 
      (msg.content === data.content && 
       msg.sender_id === data.sender_id && 
       Math.abs(new Date(msg.created_at) - new Date(data.created_at)) < 5000)
    );
    
    if (isDuplicate) {
      console.log('Skipping duplicate message:', data.message_id);
      return;
    }
    
    // Format message object if needed
    const messageObj = {
      message_id: data.message_id,
      room_id: data.room_id,
      sender_id: data.sender_id,
      content: data.content,
      created_at: data.created_at || new Date().toISOString(),
      via_websocket: true // Mark that this came via WebSocket
    };
    
    console.log('Adding message to state and UI:', messageObj);
    
    // Add to state
    messages.push(messageObj);
    stateManager.set('messages', messages);
    
    // Get current user ID
    const userId = stateManager.get('userId');
    
    // Add to UI
    ChatMessage.addToContainer(this.chatContainer, messageObj, userId);
    
    // Always scroll to bottom when new message arrives
    ChatMessage.scrollToBottom(this.chatContainer);
    
    // Play notification sound
    this.playNotificationSound();
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
   * @returns {Promise} - Promise that resolves when messages are loaded
   */
  async loadChatMessages() {
    return new Promise(async (resolve, reject) => {
      try {
        const roomId = stateManager.get('roomId');
        console.log(`Loading messages for room: ${roomId}`);
        
        // Get user ID for displaying messages
        const userId = AuthHelper.getUserId();
        
        try {
          // Use the API client to fetch messages
          const response = await apiClient.getChatMessages(roomId);
          console.log('Messages API response:', response);
          
          if (response.messages && Array.isArray(response.messages) && response.messages.length > 0) {
            console.log(`Loaded ${response.messages.length} messages from history`);
            
            // Create a map of existing messages by message_id to avoid duplicates
            const existingMessages = {};
            const messages = stateManager.get('messages') || [];
            messages.forEach(msg => {
              if (msg.message_id) {
                existingMessages[msg.message_id] = true;
              }
            });
            
            // Add only new messages to the state
            const newMessages = [];
            response.messages.forEach(msg => {
              // Skip messages that are already in state
              if (msg.message_id && existingMessages[msg.message_id]) {
                return;
              }
              
              // Format message to match our expected structure
              const messageObj = {
                message_id: msg.message_id,
                room_id: msg.room_id || roomId,
                sender_id: msg.sender_id,
                content: msg.content,
                created_at: msg.created_at,
                via_http: true // Mark that this came via HTTP
              };
              
              newMessages.push(messageObj);
              existingMessages[msg.message_id] = true;
            });
            
            if (newMessages.length > 0) {
              // Add to existing messages
              const updatedMessages = [...messages, ...newMessages];
              
              // Sort by created_at
              updatedMessages.sort((a, b) => {
                const dateA = new Date(a.created_at || 0);
                const dateB = new Date(b.created_at || 0);
                return dateA - dateB;
              });
              
              // Update state
              stateManager.set('messages', updatedMessages);
              
              // Clear the container if this is the first render
              if (messages.length === 0) {
                this.chatContainer.innerHTML = '';
              }
              
              // Render the new messages
              newMessages.forEach(msg => {
                ChatMessage.addToContainer(this.chatContainer, msg, userId);
              });
              
              console.log(`Added ${newMessages.length} new messages from HTTP API`);
            } else {
              console.log('No new messages from HTTP API');
            }
          } else {
            console.log('No messages in history');
          }
          
          // Always resolve the promise, even if there are no messages
          resolve();
        } catch (fetchError) {
          console.error('Fetch error:', fetchError);
          this.showError(`Network error: ${fetchError.message}`);
          reject(fetchError);
        }
      } catch (error) {
        console.error('Failed to load chat messages:', error);
        this.showError('Could not load chat messages. Please try again later.');
        reject(error);
      }
    });
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
    
    console.log(`Sending message in room ${roomId} from user ${userId}`);
    
    // Generate a temporary ID for the message
    const tempId = Date.now().toString();
    
    // Create a message object
    const messageData = {
      room_id: roomId,
      message: messageContent,
      message_id: tempId,
      content: messageContent,
      sender_id: userId,
      created_at: new Date().toISOString(),
      sending: true // Mark as sending
    };
    
    console.log('Message data:', messageData);
    
    // Clear the input
    this.messageInput.value = '';
    
    // Add the message to the UI
    ChatMessage.addToContainer(this.chatContainer, messageData, userId);
    
    // Add the message to state
    const messages = stateManager.get('messages') || [];
    messages.push(messageData);
    stateManager.set('messages', messages);
    
    // Try WebSocket first
    const isSocketConnected = socketClient.connected;
    let websocketSent = false;
    
    if (isSocketConnected) {
      console.log('Sending message via WebSocket:', {
        room_id: roomId,
        message: messageContent,
        message_id: tempId
      });
      
      try {
        socketClient.sendMessage({
          room_id: roomId,
          message: messageContent,
          message_id: tempId
        });
        websocketSent = true;
        console.log('Message sent via WebSocket');
        
        // Update message status in state
        this.updateMessageStatus(tempId, { sending: false, sent_via_websocket: true });
      } catch (socketError) {
        console.error('Error sending message via WebSocket:', socketError);
        websocketSent = false;
      }
    }
    
    // If WebSocket failed or is not connected, send via HTTP immediately
    if (!websocketSent) {
      console.log('WebSocket unavailable, sending via HTTP immediately');
      this.sendMessageViaHttp(roomId, messageContent, tempId, userId);
    } else {
      // Use HTTP as a backup if no WebSocket confirmation after delay
      setTimeout(() => {
        // Get the current message from state to see if it's been confirmed
        const currentMessages = stateManager.get('messages') || [];
        const message = currentMessages.find(m => m.message_id === tempId);
        
        if (message && message.sending) {
          console.log('No WebSocket confirmation received, sending backup via HTTP');
          this.sendMessageViaHttp(roomId, messageContent, tempId, userId);
        }
      }, 1500); // 1.5 second delay for WebSocket confirmation
    }
  },
  
  /**
   * Update message status in state
   * @param {string} messageId - Message ID
   * @param {Object} updates - Status updates
   */
  updateMessageStatus(messageId, updates) {
    const messages = stateManager.get('messages') || [];
    const messageIndex = messages.findIndex(m => m.message_id === messageId);
    
    if (messageIndex >= 0) {
      messages[messageIndex] = { ...messages[messageIndex], ...updates };
      stateManager.set('messages', messages);
    }
  },
  
  /**
   * Send a message via HTTP as a backup
   * @param {string} roomId - Room ID
   * @param {string} message - Message content
   * @param {string} messageId - Message ID
   * @param {string} userId - User ID
   */
  async sendMessageViaHttp(roomId, message, messageId, userId) {
    try {
      console.log(`Sending message via HTTP to room ${roomId}`);
      
      // Update message status in state
      this.updateMessageStatus(messageId, { sending_via_http: true });
      
      const response = await fetch(`${window.location.origin}/api/chats/${roomId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('access_token')}`
        },
        body: JSON.stringify({
          message: message,
          message_id: messageId,
          sender_id: userId
        })
      });
      
      if (response.ok) {
        console.log('Message sent successfully via HTTP');
        this.updateMessageStatus(messageId, { 
          sending: false, 
          sending_via_http: false,
          sent_via_http: true 
        });
      } else {
        console.error('Failed to send message via HTTP:', await response.text());
        this.updateMessageStatus(messageId, { 
          sending_via_http: false,
          error: 'HTTP send failed' 
        });
      }
    } catch (error) {
      console.error('Error sending message via HTTP:', error);
      this.updateMessageStatus(messageId, { 
        sending_via_http: false,
        error: error.message 
      });
    }
  },
  
  /**
   * Show an error message
   * @param {string} message - Error message
   */
  showError(message) {
    console.error('Chat error:', message);
    
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
      if (mainContainer) {
        mainContainer.insertBefore(errorElement, mainContainer.firstChild);
      } else {
        // If main container not found, try adding to the chat container
        const chatContainer = document.getElementById('chat-container');
        if (chatContainer) {
          chatContainer.insertBefore(errorElement, chatContainer.firstChild);
        } else {
          // Last resort - add to body
          document.body.insertBefore(errorElement, document.body.firstChild);
        }
      }
    }
    
    // Set the message
    if (errorElement.querySelector('span')) {
      errorElement.querySelector('span').textContent = message;
    }
  },
  
  /**
   * Play notification sound
   */
  playNotificationSound() {
    try {
      // Create audio context
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      
      // Create oscillator for a simple beep sound
      const oscillator = audioContext.createOscillator();
      oscillator.type = 'sine';
      oscillator.frequency.value = 880; // A5 note
      
      // Create gain node to control volume
      const gainNode = audioContext.createGain();
      gainNode.gain.value = 0.1; // Low volume
      
      // Connect nodes
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      // Play sound
      oscillator.start();
      
      // Stop after 200ms
      setTimeout(() => {
        oscillator.stop();
      }, 200);
    } catch (error) {
      // Ignore errors with audio - not critical
      console.warn('Could not play notification sound:', error);
    }
  }
}; 