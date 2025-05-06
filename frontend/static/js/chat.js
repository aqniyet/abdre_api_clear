/**
 * ABDRE Chat Client
 * Handles WebSocket connections and messaging for the chat system
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
    chatList: null,
    currentChatName: null,
    chatParticipants: null,
    reconnectButton: null
  },
  
  // Error modal
  connectionErrorModal: null,
  
  /**
   * Initialize the chat client
   */
  init: function() {
    console.log('Initializing Chat Client...');
    
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
      // Load available chats
      this.loadAvailableChats();
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
    this.elements.chatList = document.getElementById('chat-list');
    this.elements.currentChatName = document.getElementById('current-chat-name');
    this.elements.chatParticipants = document.getElementById('chat-participants');
    this.elements.reconnectButton = document.getElementById('reconnect-button');
    
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
    
    // New chat button
    const newChatBtn = document.getElementById('new-chat-btn');
    if (newChatBtn) {
      newChatBtn.addEventListener('click', () => {
        window.location.href = '/chat/new';
      });
    }
    
    // Reconnect button
    if (this.elements.reconnectButton) {
      this.elements.reconnectButton.addEventListener('click', () => {
        this.connectionErrorModal.hide();
        this.reconnect();
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
   * Send a message through the WebSocket
   */
  sendMessage: function() {
    if (!this.isConnected || !this.elements.messageInput) {
      return;
    }
    
    const messageText = this.elements.messageInput.value.trim();
    if (!messageText) {
      return;
    }
    
    try {
      const message = {
        type: 'chat_message',
        content: messageText,
        chat_id: this.chatId
      };
      
      // Check if we're using Socket.IO or traditional WebSocket
      if (this.socket.emit) {
        // Socket.IO
        console.log('Sending message via Socket.IO:', message);
        this.socket.emit('message', message);
      } else {
        // Traditional WebSocket
        console.log('Sending message via WebSocket:', message);
        this.socket.send(JSON.stringify(message));
      }
      
      this.elements.messageInput.value = '';
    } catch (error) {
      console.error('Error sending message:', error);
      this.showError('Failed to send message. Please try again.');
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
        this.elements.currentChatName.textContent = data.name;
      }
    })
    .catch(error => {
      console.error('Error loading chat details:', error);
    });
  },
  
  /**
   * Load available chats from the API
   */
  loadAvailableChats: function() {
    if (!this.elements.chatList) return;
    
    fetch('/api/chats', {
      headers: AuthHelper.getAuthHeaders()
    })
    .then(response => {
      if (!response.ok) {
        throw new Error('Failed to load chats');
      }
      return response.json();
    })
    .then(data => {
      this.renderChatList(data.chats || []);
    })
    .catch(error => {
      console.error('Error loading chats:', error);
      this.elements.chatList.innerHTML = `
        <div class="p-3 text-center text-danger">
          <p class="mb-0">Failed to load chats. Please try again.</p>
        </div>
      `;
    });
  },
  
  /**
   * Render the list of available chats
   * @param {Array} chats List of chat rooms
   */
  renderChatList: function(chats) {
    if (!this.elements.chatList) return;
    
    if (!chats || chats.length === 0) {
      this.elements.chatList.innerHTML = `
        <div class="p-3 text-center text-muted small">
          <p class="mb-0">No chats available.</p>
          <p class="mb-0 mt-2">Create a new chat to get started.</p>
        </div>
      `;
      return;
    }
    
    let html = '';
    chats.forEach(chat => {
      const isActive = chat.id === this.chatId;
      html += `
        <a href="/chat/${chat.id}" class="list-group-item list-group-item-action ${isActive ? 'active' : ''}">
          <div class="d-flex w-100 justify-content-between">
            <h6 class="mb-1">${this.escapeHtml(chat.name)}</h6>
            <small>${this.formatDate(chat.last_activity)}</small>
          </div>
          <small>${chat.participant_count} participant${chat.participant_count !== 1 ? 's' : ''}</small>
        </a>
      `;
    });
    
    this.elements.chatList.innerHTML = html;
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
  }
};

// Initialize chat client when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  ChatClient.init();
});
// End of ChatClient object
document.addEventListener('DOMContentLoaded', () => {
  ChatClient.init();
}); 