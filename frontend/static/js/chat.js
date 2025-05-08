/**
 * ABDRE Chat Client
 * Handles WebSocket connections and messaging for the chat system
 * Updated to support server-side rendering and full-width layout
 */

const ChatClient = {
  // Configuration
  config: {
    wsProtocol: window.location.protocol === 'https:' ? 'wss:' : 'ws:',
    wsHost: window.location.host,
    wsBasePath: '/ws/chat',
    reconnectInterval: 3000,
    maxReconnectAttempts: 5
  },
  
  // State
  socket: null,
  chatId: null,
  isConnected: false,
  reconnectAttempts: 0,
  messages: [],
  
  // DOM Elements
  elements: {
    chatMessages: null,
    messageForm: null,
    messageInput: null,
    sendButton: null,
    connectionStatus: null,
    connectionMessage: null,
    errorContainer: null,
    currentChatName: null,
    statusIndicator: null,
    chatStatus: null,
    reconnectButton: null,
    clearChatBtn: null
  },
  
  // Error modal
  connectionErrorModal: null,
  
  /**
   * Initialize the chat client
   */
  init: function() {
    console.log('Initializing Chat Client...');
    
    // Check for server-side rendering
    const isServerRendered = document.getElementById('messages-json') !== null;
    
    if (isServerRendered) {
      console.log('Server-side rendering detected, delegating to ChatEnhancer');
      // Let the enhancer handle everything for server-rendered pages
      if (typeof ChatEnhancer !== 'undefined') {
        // ChatEnhancer will initialize itself on DOMContentLoaded
        return;
      }
      
      console.warn('ChatEnhancer not available for server-rendered page, falling back to client-side rendering');
    }
    
    // Check if we should use the ChatPage module
    if (typeof ChatPage !== 'undefined') {
      console.log('ChatPage module detected, delegating initialization');
      ChatPage.init();
      return;
    }
    
    // Cache DOM elements
    this.cacheElements();
    
    // Setup event listeners
    this.setupEventListeners();
    
    // Check authentication
    if (!AuthHelper || !AuthHelper.isAuthenticated) {
      this.showError('You must be logged in to use the chat.');
      return;
    }
    
    // Get chat ID from URL
    this.chatId = this.getChatIdFromUrl();
    if (this.chatId) {
      // Connect to the chat socket
      this.connectToChat(this.chatId);
      
      // Load chat details
      this.loadChatDetails(this.chatId);
    } else {
      // Redirect to chats page if no chat ID
      window.location.href = '/my-chats';
    }
    
    console.log('Chat Client initialized');
  },
  
  /**
   * Cache DOM elements
   */
  cacheElements: function() {
    this.elements.chatMessages = document.getElementById('chat-messages');
    this.elements.messageForm = document.getElementById('message-form');
    this.elements.messageInput = document.getElementById('message-input');
    this.elements.sendButton = document.getElementById('send-button');
    this.elements.connectionStatus = document.getElementById('connection-status');
    this.elements.connectionMessage = document.getElementById('connection-message');
    this.elements.errorContainer = document.getElementById('error-container');
    this.elements.currentChatName = document.getElementById('current-chat-name');
    this.elements.statusIndicator = document.getElementById('status-indicator');
    this.elements.chatStatus = document.getElementById('chat-status');
    this.elements.reconnectButton = document.getElementById('reconnect-button');
    this.elements.clearChatBtn = document.getElementById('clear-chat-btn');
    
    // Initialize connection error modal
    this.connectionErrorModal = new bootstrap.Modal(document.getElementById('connection-error-modal'));
  },
  
  /**
   * Setup event listeners
   */
  setupEventListeners: function() {
    // Message form submission
    if (this.elements.messageForm) {
      this.elements.messageForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.sendMessage();
      });
    }
    
    // Reconnect button
    if (this.elements.reconnectButton) {
      this.elements.reconnectButton.addEventListener('click', () => {
        this.connectionErrorModal.hide();
        this.reconnect();
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
    
    // Window focus/blur to handle connection resume
    window.addEventListener('focus', () => {
      if (!this.isConnected && this.chatId) {
        this.reconnect();
      }
    });
  },
  
  /**
   * Connect to chat WebSocket
   * @param {string} chatId ID of the chat to connect to
   */
  connectToChat: function(chatId) {
    // Don't connect if already connected to this chat
    if (this.isConnected && this.chatId === chatId) {
      return;
    }
    
    // Close existing connection if any
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    
    try {
      // Get auth token
      const token = AuthHelper.getToken();
      if (!token) {
        this.showError('Authentication required. Please log in again.');
        window.location.href = '/login';
        return;
      }
      
      // Update UI
      this.updateConnectionStatus('connecting');
      
      // Create WebSocket URL with token
      const wsUrl = `${this.config.wsProtocol}//${this.config.wsHost}${this.config.wsBasePath}/${chatId}?token=${token}`;
      
      console.log('Getting WebSocket connection info from:', wsUrl);
      
      // Use XMLHttpRequest instead of fetch for better error handling
      const xhr = new XMLHttpRequest();
      const httpUrl = wsUrl.replace('ws://', 'http://').replace('wss://', 'https://');
      xhr.open('GET', httpUrl, true);
      
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText);
            console.log('Received WebSocket connection info:', data);
            
            if (data.status === 'redirect' && data.connection_url) {
              console.log('Redirecting to WebSocket endpoint:', data.connection_url);
              
              // Check if we should use Socket.IO
              if (data.connection_type === 'socketio' && typeof SocketIOHelper !== 'undefined') {
                try {
                  // Wait for Socket.IO library to load if necessary
                  if (typeof io === 'undefined') {
                    console.log('Socket.IO not yet loaded, adding event listener');
                    document.addEventListener('socketio-loaded', () => {
                      this.setupSocketIOConnection(data, chatId, token);
                    }, {once: true});
                    
                    document.addEventListener('socketio-error', () => {
                      console.log('Socket.IO failed to load, falling back to WebSocket');
                      this.setupWebSocketConnection(data.connection_url, chatId);
                    }, {once: true});
                  } else {
                    // Socket.IO already loaded
                    this.setupSocketIOConnection(data, chatId, token);
                  }
                } catch (e) {
                  console.error('Error setting up Socket.IO:', e);
                  console.log('Falling back to WebSocket connection');
                  this.setupWebSocketConnection(data.connection_url, chatId);
                }
              } else {
                // Use standard WebSocket
                this.setupWebSocketConnection(data.connection_url, chatId);
              }
            } else {
              // No redirect or missing URL
              console.log('No redirect information, using direct WebSocket connection');
              this.setupWebSocketConnection(wsUrl, chatId);
            }
          } catch (e) {
            console.error('Error parsing WebSocket connection info:', e);
            this.showConnectionError('Failed to parse connection information.');
          }
        } else {
          console.error('Failed to get WebSocket connection info:', xhr.status, xhr.statusText);
          this.showConnectionError(`Connection error: ${xhr.status} ${xhr.statusText}`);
        }
      };
      
      xhr.onerror = () => {
        console.error('Network error when fetching WebSocket connection info');
        this.showConnectionError('Network error when connecting to the chat server.');
      };
      
      xhr.ontimeout = () => {
        console.error('Timeout when fetching WebSocket connection info');
        this.showConnectionError('Connection timeout when connecting to the chat server.');
      };
      
      xhr.timeout = 10000; // 10 second timeout
      xhr.send();
    } catch (error) {
      console.error('WebSocket connection error:', error);
      this.showConnectionError('Failed to establish a connection to the chat server.');
    }
  },
  
  /**
   * Set up Socket.IO connection
   * @param {Object} data Connection data
   * @param {string} chatId ID of the chat to connect to
   * @param {string} token Authentication token
   */
  setupSocketIOConnection: function(data, chatId, token) {
    try {
      console.log('Setting up Socket.IO connection');
      
      // Extract the base URL from the connection_url
      let connectionUrl = '';
      try {
        // Parse the WebSocket URL to extract host and protocol
        const wsUrl = new URL(data.connection_url);
        const host = wsUrl.hostname;
        const port = wsUrl.port;
        // Convert ws:// to http:// and wss:// to https://
        const protocol = wsUrl.protocol === 'ws:' ? 'http:' : 'https:';
        // Rebuild the URL with the HTTP protocol
        connectionUrl = `${protocol}//${host}${port ? ':' + port : ''}`;
        console.log('Converted Socket.IO URL:', connectionUrl);
      } catch (urlError) {
        console.warn('Failed to parse connection URL:', urlError);
        // Fallback to original connection URL with protocol conversion
        connectionUrl = data.connection_url.split('/socket.io')[0].replace('ws://', 'http://').replace('wss://', 'https://');
      }
      
      const options = {
        path: data.socket_path || '/socket.io',
        transports: ['websocket', 'polling'], // Allow polling as fallback
        autoConnect: true,
        reconnection: true,
        reconnectionAttempts: 10, // Increase attempts
        reconnectionDelay: 1000,
        timeout: 10000, // Add timeout
        query: {
          token: token,
          chat_id: chatId
        }
      };
      
      console.log('Socket.IO connection URL:', connectionUrl);
      console.log('Socket.IO options:', options);
      
      this.socket = io(connectionUrl, options);
      
      // Set up Socket.IO event handlers
      this.socket.on('connect', () => {
        console.log('Socket.IO connected!');
        this.handleSocketOpen();
        
        // Join the chat room
        this.socket.emit('join', {room: chatId});
      });
      
      this.socket.on('disconnect', (reason) => {
        console.log('Socket.IO disconnected:', reason);
        this.handleSocketClose({code: 1000, reason: reason});
      });
      
      this.socket.on('connect_error', (error) => {
        console.error('Socket.IO connection error:', error);
        this.handleSocketError(error);
      });
      
      this.socket.on('message', (data) => {
        console.log('Socket.IO message received:', data);
        this.handleSocketMessage({data: JSON.stringify(data)});
      });
      
      this.socket.on('chat_message', (data) => {
        console.log('Socket.IO chat_message received:', data);
        this.handleSocketMessage({data: JSON.stringify({
          type: 'chat_message',
          ...data
        })});
      });
      
      this.socket.on('system_message', (data) => {
        console.log('Socket.IO system_message received:', data);
        this.handleSocketMessage({data: JSON.stringify({
          type: 'system_message',
          ...data
        })});
      });
      
      // Add handlers for user status events
      this.socket.on('user_joined', (data) => {
        this.handleSocketUserJoined(data);
      });
      
      this.socket.on('user_active', (data) => {
        this.handleSocketUserActive(data);
      });
      
      this.socket.on('user_away', (data) => {
        this.handleSocketUserAway(data);
      });
      
      // Store chat ID
      this.chatId = chatId;
    } catch (e) {
      console.error('Error in Socket.IO setup:', e);
      this.showConnectionError('Failed to establish a Socket.IO connection. Trying WebSocket fallback...');
      
      // Fall back to WebSocket connection
      this.setupWebSocketConnection(data.connection_url, chatId);
    }
  },
  
  /**
   * Set up traditional WebSocket connection
   * @param {string} url WebSocket URL
   * @param {string} chatId ID of the chat to connect to
   */
  setupWebSocketConnection: function(url, chatId) {
    try {
      console.log('Setting up WebSocket connection to', url);
      
      this.socket = new WebSocket(url);
      
      // Set up event handlers
      this.socket.onopen = this.handleSocketOpen.bind(this);
      this.socket.onmessage = this.handleSocketMessage.bind(this);
      this.socket.onclose = this.handleSocketClose.bind(this);
      this.socket.onerror = this.handleSocketError.bind(this);
      
      // Store chat ID
      this.chatId = chatId;
    } catch (e) {
      console.error('Error in WebSocket setup:', e);
      this.showConnectionError('Failed to establish a WebSocket connection: ' + e.message);
    }
  },
  
  /**
   * Handle WebSocket connection open
   */
  handleSocketOpen: function() {
    console.log('WebSocket connection established');
    this.isConnected = true;
    this.reconnectAttempts = 0;
    this.updateConnectionStatus('connected');
    
    // Enable message input and button
    if (this.elements.messageInput) this.elements.messageInput.disabled = false;
    if (this.elements.sendButton) this.elements.sendButton.disabled = false;
  },
  
  /**
   * Handle WebSocket message
   * @param {MessageEvent} event The WebSocket message event
   */
  handleSocketMessage: function(event) {
    try {
      const message = JSON.parse(event.data);
      console.log('Received message:', message);
      
      switch (message.type) {
        case 'chat_message':
          this.displayMessage(message);
          break;
        case 'system_message':
          this.displaySystemMessage(message);
          break;
        case 'participant_update':
          this.updateParticipants(message.participants);
          break;
        case 'error':
          this.showError(message.message || 'An error occurred.');
          break;
        default:
          console.log('Unknown message type:', message.type);
      }
    } catch (error) {
      console.error('Error processing message:', error);
    }
  },
  
  /**
   * Handle WebSocket connection close
   * @param {CloseEvent} event The WebSocket close event
   */
  handleSocketClose: function(event) {
    console.log('WebSocket connection closed:', event.code, event.reason);
    this.isConnected = false;
    this.updateConnectionStatus('disconnected');
    
    // Disable message input and button
    if (this.elements.messageInput) this.elements.messageInput.disabled = true;
    if (this.elements.sendButton) this.elements.sendButton.disabled = true;
    
    // Auto-reconnect if not closed cleanly (not code 1000)
    if (event.code !== 1000 && this.reconnectAttempts < this.config.maxReconnectAttempts) {
      this.scheduleReconnect();
    } else if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      this.showConnectionError('Maximum reconnection attempts reached. Please try again later.');
    }
  },
  
  /**
   * Handle WebSocket error
   * @param {Event} error The WebSocket error event
   */
  handleSocketError: function(error) {
    console.error('WebSocket error:', error);
    this.showError('Connection error. Please check your internet connection.');
  },
  
  /**
   * Schedule reconnection
   */
  scheduleReconnect: function() {
    this.reconnectAttempts++;
    const timeout = this.reconnectAttempts * this.config.reconnectInterval;
    
    console.log(`Scheduling reconnect attempt ${this.reconnectAttempts} in ${timeout}ms`);
    this.updateConnectionStatus('reconnecting');
    
    setTimeout(() => {
      if (!this.isConnected) {
        this.reconnect();
      }
    }, timeout);
  },
  
  /**
   * Reconnect to the WebSocket
   */
  reconnect: function() {
    if (this.chatId) {
      console.log('Attempting to reconnect...');
      this.connectToChat(this.chatId);
    }
  },
  
  /**
   * Send a message
   */
  sendMessage: function() {
    if (!this.isConnected || !this.elements.messageInput) {
      this.showError('Cannot send message: not connected to chat server');
      return false;
    }
    
    // Get message text
    const messageText = this.elements.messageInput.value.trim();
    if (!messageText) return false;
    
    console.log('Sending message via WebSocket:', messageText);
    
    // Generate temporary ID for message
    const tempId = `tmp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    
    // Create message object
    const messageData = {
      message_id: tempId,
      room_id: this.chatId,
      sender_id: AuthHelper.getUserId(),
      content: messageText,
      created_at: new Date().toISOString(),
      message_type: 'text',
      status: 'sending'
    };
    
    // Add to local messages array for optimistic UI update
    this.messages.push(messageData);
    
    // Add to UI immediately for responsive feel
    if (this.elements.chatMessages) {
      this.displayMessage(messageData, true);
    }
    
    // Clear input field right away
    this.elements.messageInput.value = '';
    this.elements.messageInput.focus();
    
    try {
      // Use SocketClient if available (preferred)
      if (window.SocketClient && window.SocketClient.sendMessage) {
        window.SocketClient.sendMessage(this.chatId, messageText, tempId)
          .then(result => {
            console.log('Message sent successfully via SocketClient:', result);
            this.updateMessageStatus(tempId, 'sent');
          })
          .catch(error => {
            console.error('Error sending message via SocketClient:', error);
            this.updateMessageStatus(tempId, 'failed');
            this.showError('Failed to send message. Please try again.');
          });
      } 
      // Fallback to Socket.IO if available
      else if (this.socket && this.socket.emit) {
        this.socket.emit('message', {
          room_id: this.chatId,
          content: messageText,
          message_id: tempId,
          sender_id: AuthHelper.getUserId()
        });
        
        // Set timeout to check if message was sent successfully
        setTimeout(() => {
          const message = this.messages.find(m => m.message_id === tempId);
          if (message && message.status === 'sending') {
            // Message still in sending state after timeout
            this.updateMessageStatus(tempId, 'uncertain');
            this.showError('Message delivery status unknown. The message may not have been received.');
          }
        }, 10000);
      } 
      // No WebSocket connection available
      else {
        console.error('No WebSocket connection method available');
        this.updateMessageStatus(tempId, 'failed');
        this.showError('Cannot send message: connection to chat server not available.');
      }
    } catch (error) {
      console.error('Error sending message:', error);
      this.updateMessageStatus(tempId, 'failed');
      this.showError('Failed to send message. Please try again.');
    }
    
    return false; // Prevent form submission
  },
  
  /**
   * Update message status in UI
   * @param {string} messageId The message ID
   * @param {string} status The new status ('sent', 'delivered', 'read', 'failed', 'uncertain')
   */
  updateMessageStatus: function(messageId, status) {
    // Update in messages array
    const messageIndex = this.messages.findIndex(m => m.message_id === messageId);
    if (messageIndex >= 0) {
      this.messages[messageIndex].status = status;
    }
    
    // Update in UI
    const messageElement = document.querySelector(`.message[data-message-id="${messageId}"]`);
    if (messageElement) {
      // Remove existing status classes
      messageElement.classList.remove('status-sending', 'status-sent', 'status-delivered', 'status-read', 'status-failed', 'status-uncertain');
      
      // Add new status class
      messageElement.classList.add(`status-${status}`);
      
      // Update status indicator if exists
      const statusIndicator = messageElement.querySelector('.message-status');
      if (statusIndicator) {
        let statusHTML = '';
        
        switch (status) {
          case 'sending':
            statusHTML = '<i class="fas fa-clock"></i>';
            break;
          case 'sent':
            statusHTML = '<i class="fas fa-check"></i>';
            break;
          case 'delivered':
            statusHTML = '<i class="fas fa-check-double"></i>';
            break;
          case 'read':
            statusHTML = '<i class="fas fa-check-double" style="color: #0d6efd;"></i>';
            break;
          case 'failed':
            statusHTML = '<i class="fas fa-exclamation-circle" style="color: #dc3545;"></i>';
            break;
          case 'uncertain':
            statusHTML = '<i class="fas fa-question-circle" style="color: #ffc107;"></i>';
            break;
        }
        
        statusIndicator.innerHTML = statusHTML;
      }
    }
  },
  
  /**
   * Display a message in the chat window
   * @param {Object} message The message to display
   */
  displayMessage: function(message) {
    if (!this.elements.chatMessages) return;
    
    const isCurrentUser = message.user?.id === AuthHelper.user?.id 
      || message.username === AuthHelper.user?.username;
    
    const messageElement = document.createElement('div');
    messageElement.className = `message ${isCurrentUser ? 'message-outgoing' : 'message-incoming'} mb-3`;
    
    messageElement.innerHTML = `
      <div class="message-bubble p-3 ${isCurrentUser ? 'bg-primary text-white' : 'bg-light'}">
        <div class="message-header d-flex justify-content-between mb-1">
          <span class="message-sender fw-bold">${message.username || 'Unknown'}</span>
          <span class="message-time small">${this.formatTime(message.timestamp)}</span>
        </div>
        <div class="message-content">${this.escapeHtml(message.content)}</div>
      </div>
    `;
    
    this.elements.chatMessages.appendChild(messageElement);
    this.scrollToBottom();
  },
  
  /**
   * Display a system message in the chat window
   * @param {Object} message The system message to display
   */
  displaySystemMessage: function(message) {
    if (!this.elements.chatMessages) return;
    
    const messageElement = document.createElement('div');
    messageElement.className = 'message message-system my-2 text-center';
    
    messageElement.innerHTML = `
      <div class="message-bubble system-message small py-1 px-3 d-inline-block bg-secondary bg-opacity-10 rounded">
        ${this.escapeHtml(message.content)}
      </div>
    `;
    
    this.elements.chatMessages.appendChild(messageElement);
    this.scrollToBottom();
  },
  
  /**
   * Update the participants display
   * @param {Array} participants List of chat participants
   */
  updateParticipants: function(participants) {
    if (!this.elements.chatParticipants) return;
    
    const count = participants?.length || 0;
    this.elements.chatParticipants.textContent = `${count} participant${count !== 1 ? 's' : ''}`;
  },
  
  /**
   * Update connection status UI
   * @param {string} status The connection status ('connected', 'disconnected', etc)
   */
  updateConnectionStatus: function(status) {
    if (!this.elements.connectionStatus || !this.elements.connectionMessage) return;
    
    let statusText = 'Unknown';
    let statusClass = 'bg-secondary';
    let messageText = '';
    
    switch (status) {
      case 'connected':
        statusText = 'Connected';
        statusClass = 'bg-success';
        messageText = 'Connected to chat server.';
        break;
      case 'disconnected':
        statusText = 'Disconnected';
        statusClass = 'bg-danger';
        messageText = 'Disconnected from chat server.';
        break;
      case 'connecting':
        statusText = 'Connecting...';
        statusClass = 'bg-warning';
        messageText = 'Connecting to chat server...';
        break;
      case 'reconnecting':
        statusText = 'Reconnecting...';
        statusClass = 'bg-warning';
        messageText = `Reconnecting to chat server... (Attempt ${this.reconnectAttempts}/${this.config.maxReconnectAttempts})`;
        break;
      default:
        statusText = 'Unknown';
        statusClass = 'bg-secondary';
        messageText = 'Connection status unknown.';
    }
    
    // Update status badge
    this.elements.connectionStatus.textContent = statusText;
    this.elements.connectionStatus.className = `badge ${statusClass}`;
    
    // Update connection message
    if (status === 'connected') {
      // Hide the connection message when connected
      this.elements.connectionMessage.classList.add('d-none');
    } else {
      this.elements.connectionMessage.classList.remove('d-none');
      this.elements.connectionMessage.textContent = messageText;
      
      if (status === 'disconnected' || status === 'reconnecting') {
        this.elements.connectionMessage.className = 'alert alert-warning text-center';
      } else if (status === 'connecting') {
        this.elements.connectionMessage.className = 'alert alert-info text-center';
      }
    }
  },
  
  /**
   * Load chat details from the API
   * @param {string} chatId ID of the chat
   */
  loadChatDetails: function(chatId) {
    if (!this.elements.currentChatName) return;
    
    fetch(`/api/chats/${chatId}`, {
      headers: AuthHelper.getAuthHeaders()
    })
    .then(response => {
      if (!response.ok) {
        throw new Error('Failed to load chat details');
      }
      return response.json();
    })
    .then(data => {
      if (data && data.name) {
        // Set the chat name in the header
        this.elements.currentChatName.textContent = data.name;
      }
      
      // Handle opponent name and status indicators
      if (data && data.participants && Array.isArray(data.participants)) {
        const currentUserId = AuthHelper.getUserId();
        
        // Find opponent (not the current user)
        const opponent = data.participants.find(p => p.user_id !== currentUserId);
        
        if (opponent) {
          // Set opponent name
          const opponentName = opponent.display_name || opponent.username || 'Chat Participant';
          this.elements.currentChatName.textContent = opponentName;
          
          // Initialize status as offline
          this.updateStatusIndicator('offline');
        }
      }
    })
    .catch(error => {
      console.error('Error loading chat details:', error);
    });
  },
  
  /**
   * Update the status indicator
   * @param {string} status - The status: 'online', 'away', or 'offline'
   */
  updateStatusIndicator: function(status) {
    if (!this.elements.statusIndicator || !this.elements.chatStatus) return;
    
    // Remove all status classes
    this.elements.statusIndicator.classList.remove('online', 'away', 'offline');
    
    // Add the appropriate class and text
    switch (status) {
      case 'online':
        this.elements.statusIndicator.classList.add('online');
        this.elements.chatStatus.textContent = 'Online';
        break;
      case 'away':
        this.elements.statusIndicator.classList.add('away');
        this.elements.chatStatus.textContent = 'Away';
        break;
      case 'offline':
      default:
        this.elements.statusIndicator.classList.add('offline');
        this.elements.chatStatus.textContent = 'Offline';
        break;
    }
  },
  
  /**
   * Handle Socket.IO 'user_joined' event
   * @param {Object} data - Event data
   */
  handleSocketUserJoined: function(data) {
    console.log('User joined:', data);
    
    // Get current user ID to identify if the joined user is the opponent
    const currentUserId = AuthHelper.getUserId();
    
    // If the joined user is not the current user, update status to online
    if (data.user_id !== currentUserId) {
      this.updateStatusIndicator('online');
    }
  },
  
  /**
   * Handle Socket.IO 'user_active' event
   * @param {Object} data - Event data
   */
  handleSocketUserActive: function(data) {
    console.log('User active:', data);
    
    // Get current user ID to identify if the active user is the opponent
    const currentUserId = AuthHelper.getUserId();
    
    // If the active user is not the current user, update status to online
    if (data.user_id !== currentUserId) {
      this.updateStatusIndicator('online');
    }
  },
  
  /**
   * Handle Socket.IO 'user_away' event
   * @param {Object} data - Event data
   */
  handleSocketUserAway: function(data) {
    console.log('User away:', data);
    
    // Get current user ID to identify if the away user is the opponent
    const currentUserId = AuthHelper.getUserId();
    
    // If the away user is not the current user, update status to away
    if (data.user_id !== currentUserId) {
      this.updateStatusIndicator('away');
    }
  },
  
  /**
   * Load available chats from the API
   * Note: This function is no longer used in full-width layout
   */
  loadAvailableChats: function() {
    // This function is no longer needed since the chat list is removed
    console.log('Chat list panel has been removed, skipping loadAvailableChats');
  },
  
  /**
   * Render the list of available chats
   * Note: This function is no longer used in full-width layout
   * @param {Array} chats List of chat rooms
   */
  renderChatList: function(chats) {
    // This function is no longer needed since the chat list is removed
    console.log('Chat list panel has been removed, skipping renderChatList');
  },
  
  /**
   * Show an error message in the error container
   * @param {string} message Error message to display
   */
  showError: function(message) {
    if (!this.elements.errorContainer) return;
    
    this.elements.errorContainer.textContent = message;
    this.elements.errorContainer.classList.remove('d-none');
    
    // Hide after 5 seconds
    setTimeout(() => {
      this.elements.errorContainer.classList.add('d-none');
    }, 5000);
  },
  
  /**
   * Show connection error modal
   * @param {string} message Error message to display
   */
  showConnectionError: function(message) {
    const errorMessageElement = document.getElementById('connection-error-message');
    if (errorMessageElement) {
      errorMessageElement.textContent = message;
    }
    
    this.connectionErrorModal.show();
  },
  
  /**
   * Get chat ID from URL
   * @returns {string|null} Chat ID or null if not found
   */
  getChatIdFromUrl: function() {
    const pathParts = window.location.pathname.split('/');
    if (pathParts.length >= 3 && pathParts[1] === 'chat') {
      return pathParts[2];
    }
    return null;
  },
  
  /**
   * Format timestamp to human-readable time
   * @param {string|number} timestamp Timestamp to format
   * @returns {string} Formatted time
   */
  formatTime: function(timestamp) {
    if (!timestamp) return '';
    
    try {
      const date = new Date(timestamp);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (error) {
      return '';
    }
  },
  
  /**
   * Format date for chat list
   * @param {string|number} timestamp Timestamp to format
   * @returns {string} Formatted date
   */
  formatDate: function(timestamp) {
    if (!timestamp) return '';
    
    try {
      const date = new Date(timestamp);
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      
      if (date.toDateString() === today.toDateString()) {
        return 'Today';
      } else if (date.toDateString() === yesterday.toDateString()) {
        return 'Yesterday';
      } else {
        return date.toLocaleDateString();
      }
    } catch (error) {
      return '';
    }
  },
  
  /**
   * Escape HTML special characters
   * @param {string} text Text to escape
   * @returns {string} Escaped text
   */
  escapeHtml: function(text) {
    if (!text) return '';
    
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    
    return text.replace(/[&<>"']/g, m => map[m]);
  },
  
  /**
   * Scroll chat container to the bottom
   */
  scrollToBottom: function() {
    const container = document.getElementById('message-container');
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  },
  
  /**
   * Clear all messages in current chat
   */
  clearChat: function() {
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
        <div id="connection-message" class="alert alert-info text-center">
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
   * Show a success message in the error container (reuses the container)
   * @param {string} message Success message to display
   */
  showSuccess: function(message) {
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
  }
};

// Initialize chat client when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  ChatClient.init();
}); 