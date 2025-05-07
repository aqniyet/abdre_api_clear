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
    this.state = {
      roomId,
      userId: AuthHelper.getUserId(),
      messages: [],
      isConnected: false,
      lastMessageCheck: 0,
      opponentId: null,
      opponentName: null,
      opponentStatus: 'offline'
    };
    
    // Initialize UI elements
    this.initUI();
    
    // Fetch chat details to get opponent information
    this.fetchChatDetails(roomId).then(() => {
      // After getting chat details, connect to socket
      return this.initSocketConnection();
    }).then(() => {
      // After socket is connected, load chat messages
      return this.loadChatMessages();
    }).catch(error => {
      console.error("Setup failed:", error);
      // If socket fails, still try to load messages via HTTP
      this.loadChatMessages().catch(msgError => {
        console.error("Also failed to load messages:", msgError);
      });
      
      // Set up periodic message refresh with higher frequency since WebSocket failed
      this.setupPeriodicMessageRefresh(10000); // Every 10 seconds
    });
    
    // Add refresh-messages event listener
    document.addEventListener('refresh-messages', () => {
      console.log('Received refresh-messages event, reloading messages');
      this.loadChatMessages()
        .then(() => console.log('Message refresh completed'))
        .catch(error => console.error('Message refresh failed:', error));
    });
    
    // Set up visibility change listener
    document.addEventListener('visibilitychange', this.handleVisibilityChange.bind(this));
    
    // Set up window beforeunload listener
    window.addEventListener('beforeunload', this.handleBeforeUnload.bind(this));
    
    // Set up periodic message refresh
    this.setupPeriodicMessageRefresh();
  },
  
  /**
   * Fetch chat details including participants
   * @param {string} chatId - The chat ID
   */
  async fetchChatDetails(chatId) {
    try {
      const chatData = await apiClient.getChat(chatId);
      console.log('Chat details:', chatData);
      
      if (chatData && chatData.participants) {
        const currentUserId = AuthHelper.getUserId();
        
        // Find the opponent (not the current user)
        const opponent = chatData.participants.find(p => p.user_id !== currentUserId);
        
        if (opponent) {
          this.state.opponentId = opponent.user_id;
          this.state.opponentName = opponent.display_name || opponent.username || 'Chat Participant';
          
          // Update the UI with opponent's name
          this.updateOpponentDisplay();
        } else {
          console.warn('Could not find opponent in chat participants');
          // Set a default name
          this.state.opponentName = 'Chat Participant';
          this.updateOpponentDisplay();
        }
      }
    } catch (error) {
      console.error('Error fetching chat details:', error);
      // Set a fallback name
      this.state.opponentName = 'Chat Participant';
      this.updateOpponentDisplay();
    }
  },
  
  /**
   * Update the opponent's display name and status in the UI
   */
  updateOpponentDisplay() {
    const opponentName = this.state.opponentName;
    const opponentStatus = this.state.opponentStatus;
    
    // Update name
    const nameElement = document.getElementById('current-chat-name');
    if (nameElement && opponentName) {
      nameElement.textContent = opponentName;
    }
    
    // Update status indicator
    this.updateStatusIndicator(opponentStatus);
  },
  
  /**
   * Update the status indicator in the UI
   * @param {string} status - The status: 'online', 'away', 'offline', or 'connecting'
   */
  updateStatusIndicator(status) {
    const statusIndicator = document.getElementById('status-indicator');
    const statusText = document.getElementById('chat-status');
    
    if (!statusIndicator || !statusText) return;
    
    // Remove all status classes
    statusIndicator.classList.remove('online', 'away', 'offline', 'connecting');
    
    // Add the appropriate class and text
    switch (status) {
      case 'online':
        statusIndicator.classList.add('online');
        statusText.textContent = 'Online';
        break;
      case 'connecting':
        statusIndicator.classList.add('connecting');
        statusText.textContent = 'Connecting to chat server...';
        break;
      case 'away':
        statusIndicator.classList.add('away');
        statusText.textContent = 'Away';
        break;
      case 'offline':
      default:
        statusIndicator.classList.add('offline');
        statusText.textContent = 'Offline';
        break;
    }
    
    // Store the status in state
    this.state.opponentStatus = status;
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
   * Initialize socket connection with improved error handling and timeout
   * @returns {Promise} - Promise that resolves when socket is connected
   */
  async initSocketConnection() {
    return new Promise((resolve, reject) => {
      try {
        console.log('Initializing socket connection to chat server...');
        
        // Update UI connection status
        this.updateStatusIndicator('connecting');
        const statusText = document.getElementById('chat-status');
        if (statusText) {
          statusText.textContent = 'Connecting to chat server...';
        }
        
        // Create connection timeout
        const connectionTimeout = setTimeout(() => {
          console.error('Socket connection timeout after 15 seconds');
          if (!window.SocketClient.isConnected()) {
            // Update UI with connection error
            if (statusText) {
              statusText.textContent = 'Failed to connect to chat server. Trying to reconnect...';
            }
            
            // Show error message to user
            this.showError('Connection to chat server timed out. Messages will be sent via HTTP.');
            
            // Try HTTP fallback
            reject(new Error('Connection timeout'));
          }
        }, 15000);
        
        // Check if client is already initialized and connected
        if (window.SocketClient && window.SocketClient.isConnected()) {
          console.log('Socket client already connected, joining room...');
          
          // Clear timeout
          clearTimeout(connectionTimeout);
          
          // Join the room
          const roomId = this.state.roomId;
          window.SocketClient.joinRoom(roomId);
          
          // Set up event handlers
          this._setupSocketEventHandlers();
          
          // Update UI
          this.updateStatusIndicator('online');
          if (statusText) {
            statusText.textContent = 'Connected to chat server';
          }
          
          // Resolve the promise
          resolve();
          return;
        }
        
        // Initialize socket with event handlers
        console.log('Initializing socket client...');
        if (!window.SocketClient) {
          console.error('SocketClient is not defined. Make sure socket-client.js is properly loaded.');
          reject(new Error('SocketClient not found'));
          return;
        }
        
        window.SocketClient.init();
        
        // Set up connection change handler
        const connectionHandler = (connected) => {
          console.log(`Socket connection status changed: ${connected ? 'connected' : 'disconnected'}`);
          
          if (connected) {
            // Clear timeout
            clearTimeout(connectionTimeout);
            
            // Update UI connection status
            this.updateStatusIndicator('online');
            if (statusText) {
              statusText.textContent = 'Connected to chat server';
            }
            
            // Join the room
            const roomId = this.state.roomId;
            console.log(`Joining room ${roomId}...`);
            window.SocketClient.joinRoom(roomId);
            
            // Set up event handlers
            this._setupSocketEventHandlers();
            
            // Resolve the promise (only once)
            resolve();
            
            // Remove this handler to prevent multiple resolves
            window.SocketClient.off('connect', connectionHandler);
          } else {
            // Update UI connection status
            this.updateStatusIndicator('offline');
            if (statusText) {
              statusText.textContent = 'Disconnected from chat server. Reconnecting...';
            }
          }
        };
        
        // Register the connection handler
        window.SocketClient.onConnectionChange(connectionHandler);
        
      } catch (error) {
        console.error('Error setting up socket connection:', error);
        
        // Update UI with connection error
        this.updateStatusIndicator('offline');
        const statusText = document.getElementById('chat-status');
        if (statusText) {
          statusText.textContent = 'Failed to connect to chat server. Using HTTP fallback.';
        }
        
        // Show error message to user
        this.showError('An error occurred connecting to chat server. Messages will be sent via HTTP.');
        
        reject(error);
      }
    });
  },
  
  /**
   * Set up socket event handlers
   * @private
   */
  _setupSocketEventHandlers() {
    if (!window.SocketClient) {
      console.error('SocketClient is not defined. Cannot set up event handlers.');
      return;
    }
    
    // Set up message handler
    window.SocketClient.on('message', this.handleIncomingMessage.bind(this));
    
    // Set up user status handlers
    window.SocketClient.on('user_active', this.handleUserActive.bind(this));
    window.SocketClient.on('user_away', this.handleUserAway.bind(this));
    window.SocketClient.on('user_joined', this.handleUserJoined.bind(this));
    
    // Set up connection event handlers for the room
    window.SocketClient.on('join_success', (data) => {
      console.log('Successfully joined room:', data);
      
      // Update room state if needed
      if (data.room_id === this.state.roomId) {
        console.log('Room join confirmed by server');
        
        // Update UI to show connected status
        this.updateStatusIndicator('online');
        const statusText = document.getElementById('chat-status');
        if (statusText) {
          statusText.textContent = 'Connected to chat room';
        }
      }
    });
  },
  
  /**
   * Initialize UI elements
   */
  initUI() {
    // Get UI elements
    this.chatContainer = document.getElementById('chat-container') || document.getElementById('chat-messages');
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
    const messages = this.state.messages || [];
    
    // Check for duplicates by ID or content+timestamp
    const isDuplicate = messages.some(msg => 
      msg.message_id === data.message_id || 
      (msg.content === data.content && 
       msg.sender_id === data.sender_id && 
       Math.abs(new Date(msg.timestamp || msg.created_at) - new Date(data.timestamp || data.created_at)) < 5000)
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
      message_type: data.message_type || 'text',
      created_at: data.timestamp || data.created_at || new Date().toISOString(),
      status: 'received'
    };
    
    // Add to state
    messages.push(messageObj);
    this.state.messages = messages;
    
    // Get current user ID
    const userId = this.state.userId;
    
    // Add to UI
    this.renderMessage(messageObj, userId !== messageObj.sender_id);
    
    // Play notification sound if the message is from someone else and tab is not visible
    if (userId !== messageObj.sender_id && document.visibilityState !== 'visible') {
      this.playNotificationSound();
    }
  },
  
  /**
   * Render a message in the chat container
   * @param {Object} message - The message to render
   * @param {boolean} isIncoming - Whether the message is incoming (from someone else)
   */
  renderMessage(message, isIncoming = false) {
    if (!this.chatContainer) {
      console.error('Chat container not found');
      return;
    }
    
    // Create message element
    const messageEl = document.createElement('div');
    messageEl.className = `message ${isIncoming ? 'message-received' : 'message-sent'}`;
    messageEl.dataset.messageId = message.message_id;
    
    // Format timestamp
    const timestamp = new Date(message.created_at).toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
    
    // Set HTML content
    messageEl.innerHTML = `
      <div class="message-content">${message.content}</div>
      <div class="message-time">${timestamp}</div>
    `;
    
    // Add status indicator for outgoing messages
    if (!isIncoming && message.status) {
      const statusEl = document.createElement('div');
      statusEl.className = 'message-status';
      
      switch (message.status) {
        case 'sending':
          statusEl.innerHTML = '<i class="fa fa-clock-o"></i>';
          break;
        case 'sent':
          statusEl.innerHTML = '<i class="fa fa-check"></i>';
          break;
        case 'delivered':
          statusEl.innerHTML = '<i class="fa fa-check-double"></i>';
          break;
        case 'read':
          statusEl.innerHTML = '<i class="fa fa-check-double" style="color: blue;"></i>';
          break;
        case 'failed':
          statusEl.innerHTML = '<i class="fa fa-exclamation-circle" style="color: red;"></i>';
          break;
        default:
          statusEl.innerHTML = '';
      }
      
      messageEl.appendChild(statusEl);
    }
    
    // Add to container
    this.chatContainer.appendChild(messageEl);
    
    // Scroll to bottom
    this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
  },
  
  /**
   * Handle user joined event
   * @param {Object} data - User joined data
   */
  handleUserJoined(data) {
    console.log('User joined:', data);
    const opponentId = this.state.opponentId;
    
    // Check if the joined user is our opponent
    if (data.user_id === opponentId) {
      this.updateStatusIndicator('online');
    }
  },
  
  /**
   * Handle user active event
   * @param {Object} data - User active data
   */
  handleUserActive(data) {
    console.log('User active:', data);
    const opponentId = this.state.opponentId;
    
    // Check if the active user is our opponent
    if (data.user_id === opponentId) {
      this.updateStatusIndicator('online');
    }
  },
  
  /**
   * Handle user away event
   * @param {Object} data - User away data
   */
  handleUserAway(data) {
    console.log('User away:', data);
    const opponentId = this.state.opponentId;
    
    // Check if the away user is our opponent
    if (data.user_id === opponentId) {
      this.updateStatusIndicator('away');
    }
  },
  
  /**
   * Handle document visibility change
   * Used to detect when the user switches tabs or windows
   */
  handleVisibilityChange() {
    const roomId = this.state.roomId;
    const userId = this.state.userId;
    
    if (document.visibilityState === 'visible') {
      this.setUserActive(roomId, userId);
    } else {
      this.setUserAway(roomId, userId);
    }
  },
  
  /**
   * Set user as active in the chat
   * @param {string} roomId - The room ID
   * @param {string} userId - The user ID
   */
  setUserActive(roomId, userId) {
    if (window.SocketClient && window.SocketClient.sendUserStatus) {
      window.SocketClient.sendUserStatus(roomId, true).catch(error => {
        console.error('Error sending active status:', error);
      });
    } else {
      console.warn('Socket client not initialized or missing sendUserStatus method');
    }
  },
  
  /**
   * Set user as away in the chat
   * @param {string} roomId - The room ID
   * @param {string} userId - The user ID
   */
  setUserAway(roomId, userId) {
    if (window.SocketClient && window.SocketClient.sendUserStatus) {
      window.SocketClient.sendUserStatus(roomId, false).catch(error => {
        console.error('Error sending away status:', error);
      });
    } else {
      console.warn('Socket client not initialized or missing sendUserStatus method');
    }
  },
  
  /**
   * Handle before unload event
   * Used to detect when the user closes the browser or navigates away
   */
  handleBeforeUnload() {
    const roomId = this.state.roomId;
    const userId = this.state.userId;
    
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
   * Load chat messages from API
   * @returns {Promise} - Promise that resolves when messages are loaded
   */
  async loadChatMessages() {
    return new Promise(async (resolve, reject) => {
      try {
        const roomId = this.state.roomId;
        console.log(`Loading messages for room: ${roomId}`);
        
        // Check if chat container exists
        if (!this.chatContainer) {
          console.error('Chat container not found');
          return reject(new Error('Chat container not found'));
        }
        
        // Get messages from API
        const result = await apiClient.getMessages(roomId);
        
        if (result && Array.isArray(result)) {
          console.log(`Loaded ${result.length} messages`);
          
          if (result.length > 0) {
            // Create a map of existing messages by message_id to avoid duplicates
            const existingMessages = {};
            const messages = this.state.messages || [];
            messages.forEach(msg => {
              if (msg.message_id) {
                existingMessages[msg.message_id] = true;
              }
            });
            
            // Filter out duplicates and format new messages
            const newMessages = result
              .filter(msg => !existingMessages[msg.message_id])
              .map(msg => ({
                message_id: msg.message_id,
                room_id: msg.room_id || roomId,
                sender_id: msg.sender_id,
                content: msg.content,
                message_type: msg.message_type || 'text',
                created_at: msg.created_at || msg.timestamp || new Date().toISOString(),
                status: 'received'
              }));
              
            // Get userId for checking if message is incoming  
            const userId = this.state.userId;
            
            // Sort messages by created_at
            const allMessages = [...messages, ...newMessages].sort((a, b) => {
              return new Date(a.created_at) - new Date(b.created_at);
            });
            
            // Update state
            this.state.messages = allMessages;
            
            // Clear the container if this is the first render
            if (messages.length === 0) {
              this.chatContainer.innerHTML = '';
              
              // Render all messages
              allMessages.forEach(msg => {
                this.renderMessage(msg, msg.sender_id !== userId);
              });
            } else {
              // Only render new messages
              newMessages.forEach(msg => {
                this.renderMessage(msg, msg.sender_id !== userId);
              });
            }
          }
          
          // Resolve with messages
          resolve(result);
        } else {
          console.warn('No messages or invalid response:', result);
          resolve([]);
        }
      } catch (error) {
        console.error('Error loading messages:', error);
        this.showError('Failed to load messages. Please try again.');
        reject(error);
      }
    });
  },
  
  /**
   * Send a message in the chat
   */
  sendMessage() {
    // Get message content
    const content = this.messageInput.value.trim();
    if (!content) return;
    
    // Clear input field
    this.messageInput.value = '';
    this.messageInput.focus();
    
    const roomId = this.state.roomId;
    const userId = this.state.userId;
    
    console.log(`Sending message in room ${roomId} from user ${userId}`);
    
    // Create a temporary ID for the message
    const tempId = `tmp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Create message data object
    const messageData = {
      message_id: tempId,
      room_id: roomId,
      sender_id: userId,
      content: content,
      message_type: 'text',
      created_at: new Date().toISOString(),
      status: 'sending'
    };
    
    // Add the message to state
    const messages = this.state.messages || [];
    messages.push(messageData);
    this.state.messages = messages;
    
    // Try WebSocket first
    if (window.SocketClient && window.SocketClient.isConnected()) {
      console.log('Sending message via WebSocket');
      window.SocketClient.sendMessage(roomId, content, tempId)
        .then(result => {
          console.log('Message sent successfully via WebSocket:', result);
          this.updateMessageStatus(tempId, { status: 'sent' });
        })
        .catch(error => {
          console.error('Failed to send message via WebSocket:', error);
          
          // Fallback to HTTP
          this.sendMessageViaHttp(roomId, content, tempId, userId)
            .then(result => {
              console.log('Message sent successfully via HTTP:', result);
              this.updateMessageStatus(tempId, { status: 'sent', server_message_id: result.message_id });
            })
            .catch(httpError => {
              console.error('Failed to send message via HTTP:', httpError);
              this.updateMessageStatus(tempId, { status: 'failed' });
              this.showError('Failed to send message. Please try again.');
            });
        });
    } else {
      // If no WebSocket connection, use HTTP directly
      console.log('No WebSocket connection, sending message via HTTP');
      this.sendMessageViaHttp(roomId, content, tempId, userId)
        .then(result => {
          console.log('Message sent successfully via HTTP:', result);
          this.updateMessageStatus(tempId, { status: 'sent', server_message_id: result.message_id });
        })
        .catch(error => {
          console.error('Failed to send message via HTTP:', error);
          this.updateMessageStatus(tempId, { status: 'failed' });
          this.showError('Failed to send message. Please try again.');
        });
    }
    
    // Check message delivery status after a delay
    setTimeout(() => {
      // Get the current message from state to see if it's been confirmed
      const currentMessages = this.state.messages || [];
      const message = currentMessages.find(m => m.message_id === tempId);
      
      if (message && message.status === 'sending') {
        // Message is still in sending state after timeout, mark as uncertain
        this.updateMessageStatus(tempId, { status: 'uncertain' });
        this.showError('Message delivery status unknown. It may or may not have been delivered.');
      }
    }, 10000);
  },
  
  /**
   * Update message status in state
   * @param {string} messageId - Message ID
   * @param {Object} updates - Status updates
   */
  updateMessageStatus(messageId, updates) {
    const messages = this.state.messages || [];
    const messageIndex = messages.findIndex(m => m.message_id === messageId);
    
    if (messageIndex >= 0) {
      messages[messageIndex] = { ...messages[messageIndex], ...updates };
      this.state.messages = messages;
    }
  },
  
  /**
   * Send a message via HTTP (used as fallback when WebSocket is not available)
   * @param {string} roomId - Chat room ID
   * @param {string} message - Message content
   * @param {string} messageId - Temporary message ID
   * @param {string} userId - Sender user ID
   * @returns {Promise} - Promise that resolves with message data when sent
   */
  async sendMessageViaHttp(roomId, message, messageId, userId) {
    try {
      console.log(`Sending message via HTTP API: ${message.substring(0, 30)}...`);
      
      // Create request body
      const requestBody = {
        room_id: roomId,
        content: message,
        client_message_id: messageId,
        sender_id: userId
      };
      
      // Call API to send message
      const response = await apiClient.sendMessage(roomId, requestBody);
      
      // Update message status
      this.updateMessageStatus(messageId, { 
        status: 'sent', 
        server_message_id: response.message_id || messageId,
        sent_via: 'http'
      });
      
      // Return response
      return response;
    } catch (error) {
      console.error('Error sending message via HTTP:', error);
      
      // Update message status
      this.updateMessageStatus(messageId, { status: 'failed', error: error.message });
      
      // Rethrow error
      throw error;
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