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
    
    // Wait for DOM to be fully loaded before initializing UI
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        console.log('DOM loaded - initializing UI elements');
        this.initUI();
        this.continueInit(roomId);
      });
    } else {
      // DOM already loaded
      console.log('DOM already loaded - initializing UI elements immediately');
      this.initUI();
      this.continueInit(roomId);
    }
  },
  
  /**
   * Continue initialization after UI elements are set up
   * @param {string} roomId - The room ID
   */
  continueInit(roomId) {
    // Make sure message input and send button are initially disabled
    if (this.messageInput) {
      this.messageInput.disabled = true;
    }
    if (this.sendButton) {
      this.sendButton.disabled = true;
    }
    
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
        
        // Enable message input and send button when online
        if (this.messageInput) {
          this.messageInput.disabled = false;
        }
        if (this.sendButton) {
          this.sendButton.disabled = false;
        }
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
        
        // Disable message input and send button when offline
        if (this.messageInput) {
          this.messageInput.disabled = true;
        }
        if (this.sendButton) {
          this.sendButton.disabled = true;
        }
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
   * Initialize socket connection to the chat server
   * @returns {Promise} Promise that resolves when connected
   */
  initSocketConnection() {
    return new Promise((resolve, reject) => {
      try {
        console.log('Initializing socket connection to the chat server');
        
        // Update UI connection status
        this.updateStatusIndicator('connecting');
        const statusText = document.getElementById('chat-status');
        if (statusText) {
          statusText.textContent = 'Connecting to chat server...';
        }
        
        // Create connection timeout
        const connectionTimeout = setTimeout(() => {
          console.error('Socket connection timeout after 15 seconds');
          if (!this.isSocketConnected()) {
            // Update UI with connection error
            if (statusText) {
              statusText.textContent = 'Failed to connect to chat server. Trying to reconnect...';
            }
            
            // Show error message to user
            this.showError('Connection to chat server timed out. Please check your internet connection.');
            
            // Try to reconnect
            this.attemptReconnection();
            
            // Reject promise
            reject(new Error('Connection timeout'));
          }
        }, 15000);
        
        // Helper function to check socket connection
        this.isSocketConnected = () => {
          // Check both possible ways the socket client might be available
          return (window.SocketClient && window.SocketClient.isConnected && window.SocketClient.isConnected()) || 
                 (this.socketClient && this.socketClient.isConnected && this.socketClient.isConnected()) ||
                 (typeof io !== 'undefined' && io.socket && io.socket.connected);
        };
        
        // Attempt to get socket connection info from API
        this.getSocketConnectionInfo()
          .then(connectionInfo => {
            // Check if client is already initialized and connected
            if (this.isSocketConnected()) {
              console.log('Socket client already connected, joining room...');
              
              // Clear timeout
              clearTimeout(connectionTimeout);
              
              // Get the socket client reference
              const socketClient = window.SocketClient || this.socketClient;
              
              // Join the room
              const roomId = this.state.roomId;
              socketClient.joinRoom(roomId);
              
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
            console.log('Initializing socket client with connection info:', connectionInfo);
            
            // Store a reference to SocketClient (global or local)
            this.socketClient = window.SocketClient || this.socketClient;
            
            if (!this.socketClient) {
              console.warn('SocketClient is not defined in window. Looking for Socket.IO client...');
              
              // Check if Socket.IO client is loaded directly
              if (typeof io !== 'undefined') {
                console.log('Socket.IO client found');
                // Connect using Socket.IO with the connection URL from API
                this.connectWithSocketIO(connectionInfo, connectionTimeout, resolve, reject);
                return;
              } else {
                console.error('Neither SocketClient nor Socket.IO client found. Cannot establish connection.');
                reject(new Error('Socket client not found'));
                return;
              }
            }
            
            // Initialize the socket client
            this.socketClient.init();
            
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
                this.socketClient.joinRoom(roomId);
                
                // Set up event handlers
                this._setupSocketEventHandlers();
                
                // Enable message input
                if (this.messageInput) {
                  this.messageInput.disabled = false;
                  this.messageInput.focus();
                }
                if (this.sendButton) {
                  this.sendButton.disabled = false;
                }
                
                // Resolve the promise (only once)
                resolve();
                
                // Remove this handler to prevent multiple resolves
                this.socketClient.off('connect', connectionHandler);
              } else {
                // Update UI connection status
                this.updateStatusIndicator('offline');
                if (statusText) {
                  statusText.textContent = 'Disconnected from chat server. Reconnecting...';
                }
                
                // Disable inputs
                if (this.messageInput) {
                  this.messageInput.disabled = true;
                }
                if (this.sendButton) {
                  this.sendButton.disabled = true;
                }
              }
            };
            
            // Register the connection handler
            this.socketClient.onConnectionChange(connectionHandler);
          })
          .catch(error => {
            console.error('Error getting socket connection info:', error);
            reject(error);
          });
        
      } catch (error) {
        console.error('Error setting up socket connection:', error);
        
        // Update UI with connection error
        this.updateStatusIndicator('offline');
        const statusText = document.getElementById('chat-status');
        if (statusText) {
          statusText.textContent = 'Failed to connect to chat server. Using HTTP fallback.';
        }
        
        // Show error message to user
        this.showError('An error occurred connecting to chat server. Please try refreshing the page.');
        
        reject(error);
      }
    });
  },
  
  /**
   * Get WebSocket connection information from API
   * @returns {Promise} Promise that resolves with connection info
   */
  getSocketConnectionInfo() {
    return new Promise((resolve, reject) => {
      const apiUrl = '/api/realtime/check-connection';
      
      fetch(apiUrl)
        .then(response => {
          if (!response.ok) {
            throw new Error(`API returned ${response.status}: ${response.statusText}`);
          }
          return response.json();
        })
        .then(data => {
          console.log('Socket connection info:', data);
          resolve(data);
        })
        .catch(error => {
          console.error('Error fetching socket connection info:', error);
          reject(error);
        });
    });
  },
  
  /**
   * Connect using Socket.IO directly
   * @param {Object} connectionInfo Connection info from API
   * @param {number} connectionTimeout Timeout ID to clear on success
   * @param {Function} resolve Promise resolve function
   * @param {Function} reject Promise reject function
   */
  connectWithSocketIO(connectionInfo, connectionTimeout, resolve, reject) {
    try {
      if (typeof io === 'undefined') {
        console.error('Socket.IO client not loaded');
        reject(new Error('Socket.IO client not loaded'));
        return;
      }
      
      // Get connection URL and parameters
      const url = connectionInfo.websocket_url || connectionInfo.realtime_service;
      const path = connectionInfo.socket_io_path || '/socket.io';
      
      console.log(`Connecting to Socket.IO at ${url} with path ${path}`);
      
      // Get auth token
      const token = AuthHelper.getToken() || 'guest';
      
      // Connect to Socket.IO
      const socket = io(url, {
        path: path,
        transports: ['websocket', 'polling'],
        query: { token, chat_id: this.state.roomId },
        auth: { token }
      });
      
      // Store socket reference
      this.socket = socket;
      
      // Create adapter to match SocketClient interface
      this.socketClient = {
        _socket: socket,
        isConnected: () => socket.connected,
        init: () => {
          // Socket.IO already initializes on creation
        },
        onConnectionChange: (callback) => {
          socket.on('connect', () => callback(true));
          socket.on('disconnect', () => callback(false));
        },
        joinRoom: (roomId) => {
          socket.emit('join', { room_id: roomId });
        },
        on: (event, handler) => {
          socket.on(event, handler);
        },
        off: (event, handler) => {
          socket.off(event, handler);
        },
        sendMessage: (roomId, content, messageId) => {
          return new Promise((resolve, reject) => {
            const messageData = {
              room_id: roomId,
              content: content,
              message_id: messageId,
              sender_id: AuthHelper.getUserId()
            };
            
            socket.emit('message', messageData);
            
            // Set up a handler for message status
            const statusHandler = (data) => {
              if (data.message_id === messageId) {
                if (data.status === 'delivered') {
                  resolve(data);
                } else {
                  reject(new Error(data.error || 'Message sending failed'));
                }
                socket.off('message_status', statusHandler);
              }
            };
            
            socket.on('message_status', statusHandler);
            
            // Set timeout for status response
            setTimeout(() => {
              socket.off('message_status', statusHandler);
              resolve({ message_id: messageId, status: 'sent' });
            }, 5000);
          });
        }
      };
      
      // Handle socket connect event
      socket.on('connect', () => {
        console.log('Socket.IO connected');
        
        // Clear connection timeout
        clearTimeout(connectionTimeout);
        
        // Join the room
        socket.emit('join', { room_id: this.state.roomId });
        
        // Set up event handlers
        this._setupSocketEventHandlers();
        
        // Update UI
        this.updateStatusIndicator('online');
        const statusText = document.getElementById('chat-status');
        if (statusText) {
          statusText.textContent = 'Connected to chat server';
        }
        
        // Enable message input
        if (this.messageInput) {
          this.messageInput.disabled = false;
          this.messageInput.focus();
        }
        if (this.sendButton) {
          this.sendButton.disabled = false;
        }
        
        // Resolve the promise
        resolve();
      });
      
      // Handle socket error event
      socket.on('connect_error', (error) => {
        console.error('Socket.IO connection error:', error);
        
        // Update UI
        this.updateStatusIndicator('offline');
        const statusText = document.getElementById('chat-status');
        if (statusText) {
          statusText.textContent = 'Failed to connect to chat server';
        }
        
        // Show error
        this.showError('Error connecting to chat server: ' + error.message);
        
        // Reject promise if this is the initial connection
        reject(error);
      });
      
    } catch (error) {
      console.error('Error connecting with Socket.IO:', error);
      reject(error);
    }
  },
  
  /**
   * Attempt to reconnect to the socket server
   */
  attemptReconnection() {
    console.log('Attempting to reconnect to socket server...');
    
    // Update UI
    const statusText = document.getElementById('chat-status');
    if (statusText) {
      statusText.textContent = 'Attempting to reconnect...';
    }
    
    // Try to reconnect after a delay
    setTimeout(() => {
      this.initSocketConnection()
        .then(() => {
          console.log('Reconnection successful');
          
          // Load messages to ensure we didn't miss any
          this.loadChatMessages()
            .then(() => console.log('Messages loaded after reconnection'))
            .catch(error => console.error('Error loading messages after reconnection:', error));
        })
        .catch(error => {
          console.error('Reconnection failed:', error);
          
          // Update UI
          if (statusText) {
            statusText.textContent = 'Reconnection failed. Will try again...';
          }
          
          // Try again
          this.attemptReconnection();
        });
    }, 5000);
  },
  
  /**
   * Set up socket event handlers
   * @private
   */
  _setupSocketEventHandlers() {
    // Get the socket client reference
    const socketClient = this.socketClient || window.SocketClient;
    
    if (!socketClient) {
      console.error('SocketClient is not defined. Cannot set up event handlers.');
      return;
    }
    
    // Set up message handler
    socketClient.on('message', this.handleIncomingMessage.bind(this));
    
    // Set up user status handlers
    socketClient.on('user_active', this.handleUserActive.bind(this));
    socketClient.on('user_away', this.handleUserAway.bind(this));
    socketClient.on('user_joined', this.handleUserJoined.bind(this));
    
    // Set up connection event handlers for the room
    socketClient.on('join_success', (data) => {
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
        
        // Enable message input and send button
        if (this.messageInput) {
          this.messageInput.disabled = false;
          this.messageInput.focus();
        }
        if (this.sendButton) {
          this.sendButton.disabled = false;
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
    this.messageForm = document.getElementById('message-form');
    
    console.log('Initializing chat UI with elements:', {
      chatContainer: !!this.chatContainer,
      messageInput: !!this.messageInput,
      sendButton: !!this.sendButton,
      messageForm: !!this.messageForm
    });
    
    // CRITICAL: Fix form submission to prevent page refresh
    if (this.messageForm) {
      // Remove any existing event listeners by cloning and replacing the form
      const oldForm = this.messageForm;
      const newForm = oldForm.cloneNode(true);
      oldForm.parentNode.replaceChild(newForm, oldForm);
      this.messageForm = newForm;
      
      // Re-fetch input and button elements after form replacement
      this.messageInput = document.getElementById('message-input');
      this.sendButton = document.getElementById('send-button');
      
      // Log elements after refresh
      console.log('Re-initialized chat UI elements:', {
        messageInput: !!this.messageInput,
        sendButton: !!this.sendButton
      });
      
      // Add submit event listener with preventDefault to stop page refresh
      this.messageForm.addEventListener('submit', (e) => {
        console.log('Form submit intercepted');
        e.preventDefault();
        e.stopPropagation();
        this.sendMessage();
        return false; // Extra prevention of default behavior
      });
    }
    
    // Add button click event directly (not through the form)
    if (this.sendButton) {
      this.sendButton.addEventListener('click', (e) => {
        console.log('Send button clicked directly');
        e.preventDefault();
        e.stopPropagation();
        this.sendMessage();
        return false;
      });
    }
    
    // For Enter key in input field
    if (this.messageInput) {
      this.messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          console.log('Enter key pressed in input field');
          e.preventDefault();
          e.stopPropagation();
          this.sendMessage();
          return false;
        }
      });
    }

    // Add share link functionality
    this.addShareLinkButton();
    
    // Log initialization of UI elements
    console.log('Chat UI elements initialized with form submission prevention');
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
    
    try {
      // Validate the message data
      if (!data || !data.content) {
        console.error('Invalid message data received:', data);
        return;
      }
      
      // Skip duplicate messages
      const messages = this.state.messages || [];
      
      // Check for duplicates by ID or content+timestamp+sender
      const isDuplicate = messages.some(msg => 
        msg.message_id === data.message_id || 
        (msg.content === data.content && 
         msg.sender_id === data.sender_id && 
         Math.abs(new Date(msg.timestamp || msg.created_at) - new Date(data.timestamp || data.created_at)) < 5000)
      );
      
      if (isDuplicate) {
        console.log('Skipping duplicate message:', data.message_id || data.content);
        return;
      }
      
      // Format message object if needed
      const messageObj = {
        message_id: data.message_id || `recv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        room_id: data.room_id || this.state.roomId,
        sender_id: data.sender_id || data.user_id,
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
      
      // Only render if it's not our own message (to avoid duplicates)
      if (userId !== messageObj.sender_id) {
        // Add to UI
        this.renderMessage(messageObj, true); // true = incoming message
        
        // Play notification sound if the message is from someone else and tab is not visible
        if (document.visibilityState !== 'visible') {
          this.playNotificationSound();
        }
      } else {
        // If it's our message coming back from the server, update the status
        const existingMessage = messages.find(
          m => m.content === messageObj.content && 
               m.sender_id === messageObj.sender_id && 
               m.status === 'sending'
        );
        
        if (existingMessage) {
          this.updateMessageStatus(existingMessage.message_id, 'delivered');
        }
      }
    } catch (error) {
      console.error('Error handling incoming message:', error);
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
    
    console.log(`Rendering ${isIncoming ? 'incoming' : 'outgoing'} message:`, message);
    
    try {
      // Create message element
      const messageEl = document.createElement('div');
      messageEl.className = `message ${isIncoming ? 'message-received' : 'message-sent'}`;
      messageEl.dataset.messageId = message.message_id;
      
      // Add status class for outgoing messages
      if (!isIncoming && message.status) {
        messageEl.classList.add(`status-${message.status}`);
      }
      
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
      if (!isIncoming) {
        const statusEl = document.createElement('div');
        statusEl.className = 'message-status';
        
        switch (message.status) {
          case 'sending':
            statusEl.innerHTML = '<i class="fas fa-clock"></i>';
            break;
          case 'sent':
            statusEl.innerHTML = '<i class="fas fa-check"></i>';
            break;
          case 'delivered':
            statusEl.innerHTML = '<i class="fas fa-check-double"></i>';
            break;
          case 'read':
            statusEl.innerHTML = '<i class="fas fa-check-double text-primary"></i>';
            break;
          case 'failed':
            statusEl.innerHTML = '<i class="fas fa-exclamation-circle text-danger"></i>';
            break;
          default:
            statusEl.innerHTML = '';
        }
        
        messageEl.appendChild(statusEl);
      }
      
      // Add to container
      this.chatContainer.appendChild(messageEl);
      
      // Scroll to bottom
      this.scrollToBottom();
    } catch (error) {
      console.error('Error rendering message:', error);
    }
  },
  
  /**
   * Scroll the chat container to the bottom
   */
  scrollToBottom() {
    try {
      if (this.chatContainer) {
        this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
      }
    } catch (error) {
      console.error('Error scrolling to bottom:', error);
    }
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
    try {
      console.log('ChatPage.sendMessage called');
      
      // Direct DOM query for message input as a fallback
      let messageInput = this.messageInput;
      
      if (!messageInput) {
        console.warn('Message input not found in ChatPage object, trying direct DOM query');
        messageInput = document.getElementById('message-input');
        
        // If found, update the object reference
        if (messageInput) {
          this.messageInput = messageInput;
        }
      }
      
      // Final check if input was found
      if (!messageInput) {
        console.error('Message input element not found. Cannot send message.');
        this.showError('Message input not found. Please refresh the page.');
        return;
      }
      
      // Get message content
      const content = messageInput.value.trim();
      if (!content) {
        console.log('Empty message, not sending');
        return;
      }
      
      console.log(`Attempting to send message: "${content}"`);
      
      // Verify socket connection - making sure the method exists
      if (typeof this.isSocketConnected !== 'function') {
        console.warn('this.isSocketConnected is not a function, defining it now');
        
        // Define the isSocketConnected function if it doesn't exist
        this.isSocketConnected = () => {
          // Check both possible ways the socket client might be available
          return (window.SocketClient && window.SocketClient.isConnected && window.SocketClient.isConnected()) || 
                 (this.socketClient && this.socketClient.isConnected && this.socketClient.isConnected()) ||
                 (typeof io !== 'undefined' && io.socket && io.socket.connected);
        };
      }
      
      // Now check the connection
      if (!this.isSocketConnected()) {
        console.error('Cannot send message: Socket not connected');
        this.showError('Cannot send message: No connection to chat server. Please wait for connection or refresh the page.');
        return;
      }
      
      // Clear input field immediately for better UX
      messageInput.value = '';
      messageInput.focus();
      
      // Check if state exists, initialize if needed
      if (!this.state) {
        console.warn('State object is undefined, initializing it now');
        // Get room ID from URL as fallback
        const pathParts = window.location.pathname.split('/');
        const roomId = pathParts[pathParts.length - 1];
        
        this.state = {
          roomId: roomId,
          userId: typeof AuthHelper !== 'undefined' && AuthHelper.getUserId ? AuthHelper.getUserId() : 'unknown',
          messages: [],
          isConnected: this.isSocketConnected(),
          lastMessageCheck: 0,
          opponentId: null,
          opponentName: null,
          opponentStatus: 'offline'
        };
        
        console.log('Initialized state object with roomId:', roomId);
      }
      
      const roomId = this.state.roomId;
      const userId = this.state.userId;
      
      console.log(`Sending message in room ${roomId} from user ${userId} via WebSocket`);
      
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
      
      // Add the message to state and UI immediately for responsive UX
      if (!this.state.messages) {
        this.state.messages = [];
      }
      
      this.state.messages.push(messageData);
      
      // Render the message optimistically with our own user ID as sender
      this.renderMessage(messageData, false); // false = not an incoming message (we sent it)
      
      // Send message via WebSocket
      const socketClient = this.socketClient || window.SocketClient;
      
      if (socketClient && typeof socketClient.sendMessage === 'function') {
        console.log('Using socketClient.sendMessage to send message:', {roomId, content, tempId});
        
        socketClient.sendMessage(roomId, content, tempId)
          .then(result => {
            console.log('Message sent successfully via WebSocket:', result);
            
            // Update message status in UI
            this.updateMessageStatus(tempId, 'sent');
            
            // Play send sound if available
            if (typeof this.playMessageSentSound === 'function') {
              this.playMessageSentSound();
            }
          })
          .catch(error => {
            console.error('Failed to send message via WebSocket:', error);
            
            // Update message status in UI
            this.updateMessageStatus(tempId, 'failed');
            
            // Show error message
            this.showError('Failed to send message. Please check your connection and try again.');
          });
      } else if (window.io && this.socket) {
        // Direct Socket.IO fallback
        console.log('Using direct Socket.IO emit to send message');
        
        this.socket.emit('message', {
          room_id: roomId,
          content: content,
          message_id: tempId,
          sender_id: userId
        });
        
        // Update the message status to sent since we don't have proper delivery confirmation
        setTimeout(() => {
          this.updateMessageStatus(tempId, 'sent');
        }, 500);
      } else {
        console.error('No WebSocket connection method available');
        
        // Update message status in UI
        this.updateMessageStatus(tempId, 'failed');
        
        // Show error message
        this.showError('Connection to chat server is not available. Please refresh the page.');
      }
    } catch (error) {
      console.error('Error in sendMessage:', error);
      this.showError('An error occurred while sending the message.');
    }
  },
  
  /**
   * Update the status of a message in the UI
   * @param {string} messageId - Message ID
   * @param {string} status - New status ('sending', 'sent', 'delivered', 'read', 'failed')
   */
  updateMessageStatus(messageId, status) {
    console.log(`Updating message ${messageId} status to ${status}`);
    
    try {
      // Update in state
      const messages = this.state.messages || [];
      const messageIndex = messages.findIndex(m => m.message_id === messageId);
      
      if (messageIndex >= 0) {
        messages[messageIndex].status = status;
        this.state.messages = messages;
        
        // Update in DOM
        const messageElement = document.querySelector(`.message[data-message-id="${messageId}"]`);
        if (messageElement) {
          // Remove previous status classes
          messageElement.classList.remove('status-sending', 'status-sent', 'status-delivered', 'status-read', 'status-failed');
          
          // Add new status class
          messageElement.classList.add(`status-${status}`);
          
          // Update status icon if it exists
          const statusIcon = messageElement.querySelector('.message-status');
          if (statusIcon) {
            let iconHTML = '';
            
            switch (status) {
              case 'sending':
                iconHTML = '<i class="fas fa-clock"></i>';
                break;
              case 'sent':
                iconHTML = '<i class="fas fa-check"></i>';
                break;
              case 'delivered':
                iconHTML = '<i class="fas fa-check-double"></i>';
                break;
              case 'read':
                iconHTML = '<i class="fas fa-check-double text-primary"></i>';
                break;
              case 'failed':
                iconHTML = '<i class="fas fa-exclamation-circle text-danger"></i>';
                break;
              default:
                iconHTML = '';
            }
            
            statusIcon.innerHTML = iconHTML;
          }
        }
      }
    } catch (error) {
      console.error('Error updating message status:', error);
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
  },
  
  /**
   * Play a message sent sound
   */
  playMessageSentSound() {
    try {
      // Create audio context
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      
      // Create oscillator for a simple beep sound
      const oscillator = audioContext.createOscillator();
      oscillator.type = 'sine';
      oscillator.frequency.value = 1000; // Higher frequency for sent sound
      
      // Create gain node to control volume
      const gainNode = audioContext.createGain();
      gainNode.gain.value = 0.05; // Low volume
      
      // Connect nodes
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      // Play sound
      oscillator.start();
      
      // Stop after 100ms
      setTimeout(() => {
        oscillator.stop();
      }, 100);
    } catch (error) {
      console.warn('Could not play message sent sound:', error);
    }
  },
  
  /**
   * Check if socket is connected
   * @returns {boolean} True if socket is connected
   */
  isSocketConnected() {
    try {
      // Check both possible ways the socket client might be available
      return (window.SocketClient && window.SocketClient.isConnected && window.SocketClient.isConnected()) || 
             (this.socketClient && this.socketClient.isConnected && this.socketClient.isConnected()) ||
             (typeof io !== 'undefined' && io.socket && io.socket.connected);
    } catch (error) {
      console.error('Error checking socket connection:', error);
      return false;
    }
  }
}; 