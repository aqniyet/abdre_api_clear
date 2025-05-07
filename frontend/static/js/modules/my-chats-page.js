/**
 * ABDRE My Chats Page
 * Handles fetching, displaying, and updating user chat conversations
 */

const MyChatsList = {
  // Configuration
  config: {
    apiBase: '/api',
    chatsEndpoint: '/api/chats',
    wsEndpoint: '/api/realtime/socket.io',
    refreshInterval: 60000, // 1 minute in milliseconds
    maxRetries: 3,
    defaultAvatar: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%235C6BC0"><circle cx="12" cy="12" r="12" fill="%23E8EAF6"/><path d="M12 6c1.1 0 2 .9 2 2s-.9 2-2 2-2-.9-2-2 .9-2 2-2zm0 10c2.7 0 5.8 1.29 6 2H6c.23-.72 3.31-2 6-2zm0-12C6.48 4 2 8.48 2 14s4.48 10 10 10 10-4.48 10-10S17.52 4 12 4zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" fill="%235C6BC0"/></svg>'
  },
  
  // State
  state: {
    chats: [],
    socket: null,
    isLoading: true,
    hasError: false,
    errorMessage: '',
    retryCount: 0,
    searchQuery: '',
    autoRefreshTimer: null,
    connected: false,
    unreadCounts: {}
  },
  
  // DOM Elements
  elements: {
    chatsContainer: null,
    chatsLoader: null,
    emptyChats: null,
    errorState: null,
    errorMessage: null,
    retryBtn: null,
    emptyNewChatBtn: null,
    chatSearch: null,
    newChatModal: null,
    newChatForm: null,
    createChatBtn: null,
    newChatError: null,
    qrInviteBtn: null,
    qrInvitationModal: null,
    regenerateQrBtn: null,
    copyLinkBtn: null,
    invitationLinkInput: null,
    copyStatusText: null
  },
  
  /**
   * Initialize the My Chats page
   */
  init: function() {
    console.log('Initializing My Chats page...');
    
    // Make sure AuthHelper is available, with a short retry
    if (!window.AuthHelper) {
      console.warn('AuthHelper not found, retrying in 500ms...');
      
      // Try again after a small delay
      setTimeout(() => {
        if (!window.AuthHelper) {
          console.error('AuthHelper not found after retry. Redirecting to login page...');
          window.location.href = '/login';
          return;
        }
        
        // Initialize if AuthHelper is now available
        this.initPageAfterAuth();
      }, 500);
      
      return;
    }
    
    // Initialize immediately if AuthHelper is available
    this.initPageAfterAuth();
  },
  
  /**
   * Initialize page after confirming AuthHelper is available
   */
  initPageAfterAuth: function() {
    // Cache DOM elements
    this.cacheElements();
    
    // Setup event listeners
    this.setupEventListeners();
    
    // Fetch chats
    this.fetchChats();
    
    // Connect to WebSocket for real-time updates
    this.connectWebSocket();
    
    // Setup auto-refresh
    this.setupAutoRefresh();
    
    console.log('My Chats page initialized');
  },
  
  /**
   * Cache DOM elements
   */
  cacheElements: function() {
    this.elements.chatsContainer = document.getElementById('chats-container');
    this.elements.chatsLoader = document.getElementById('chats-loader');
    this.elements.emptyChats = document.getElementById('empty-chats');
    this.elements.errorState = document.getElementById('error-state');
    this.elements.errorMessage = document.getElementById('error-message');
    this.elements.retryBtn = document.getElementById('retry-btn');
    this.elements.emptyNewChatBtn = document.getElementById('empty-new-chat-btn');
    this.elements.chatSearch = document.getElementById('chat-search');
    this.elements.newChatModal = document.getElementById('new-chat-modal');
    this.elements.newChatForm = document.getElementById('new-chat-form');
    this.elements.createChatBtn = document.getElementById('create-chat-btn');
    this.elements.newChatError = document.getElementById('new-chat-error');
    
    // QR invitation elements
    this.elements.qrInviteBtn = document.getElementById('qr-invite-btn');
    this.elements.qrInvitationModal = document.getElementById('qr-invitation-modal');
    this.elements.regenerateQrBtn = document.getElementById('regenerate-qr-btn');
    this.elements.copyLinkBtn = document.getElementById('copy-link-btn');
    this.elements.invitationLinkInput = document.getElementById('invitation-link');
    this.elements.copyStatusText = document.getElementById('copy-status');
  },
  
  /**
   * Setup event listeners
   */
  setupEventListeners: function() {
    // Retry button
    if (this.elements.retryBtn) {
      this.elements.retryBtn.addEventListener('click', () => {
        this.fetchChats();
      });
    }
    
    // Empty state new chat button
    if (this.elements.emptyNewChatBtn) {
      this.elements.emptyNewChatBtn.addEventListener('click', () => {
        this.showNewChatModal();
      });
    }
    
    // QR Code Invitation button
    if (this.elements.qrInviteBtn) {
      this.elements.qrInviteBtn.addEventListener('click', () => {
        this.showQrInvitationModal();
      });
    }
    
    // Regenerate QR button
    if (this.elements.regenerateQrBtn) {
      this.elements.regenerateQrBtn.addEventListener('click', () => {
        this.generateQrInvitation();
      });
    }
    
    // Copy link button
    if (this.elements.copyLinkBtn) {
      this.elements.copyLinkBtn.addEventListener('click', () => {
        this.copyInvitationLink();
      });
    }
    
    // Chat search
    if (this.elements.chatSearch) {
      this.elements.chatSearch.addEventListener('input', (e) => {
        this.handleSearch(e.target.value);
      });
    }
    
    // Create chat button
    if (this.elements.createChatBtn) {
      this.elements.createChatBtn.addEventListener('click', () => {
        this.createNewChat();
      });
    }
    
    // Window focus/blur for auto-refresh management
    window.addEventListener('focus', () => {
      console.log('Window focused - refreshing chats');
      this.fetchChats();
      this.setupAutoRefresh();
    });
    
    window.addEventListener('blur', () => {
      console.log('Window blurred - pausing auto-refresh');
      this.clearAutoRefresh();
    });
    
    // QR invitation modal events
    if (this.elements.qrInvitationModal) {
      this.elements.qrInvitationModal.addEventListener('hidden.bs.modal', () => {
        if (window.InvitationManager) {
          InvitationManager.cancelActiveInvitation();
        }
      });
    }
    
    // Invitation events
    if (window.InvitationManager) {
      document.addEventListener('invitationAccepted', (event) => {
        this.handleInvitationAccepted(event);
      });
    }
    
    // Setup mutation observer to handle fallback avatars
    this.setupAvatarFallbackObserver();
  },
  
  /**
   * Setup mutation observer to handle fallback avatars
   */
  setupAvatarFallbackObserver: function() {
    // Create a mutation observer to watch for changes to the DOM
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          // Check for any fallback avatars that need initials
          const fallbackAvatars = document.querySelectorAll('img.avatar-fallback[data-initials]');
          fallbackAvatars.forEach(this.applyInitialsToAvatar);
        }
      });
    });
    
    // Start observing the chat container for added nodes
    if (this.elements.chatsContainer) {
      observer.observe(this.elements.chatsContainer, { childList: true, subtree: true });
    }
    
    // Also handle any existing fallback avatars
    document.addEventListener('DOMContentLoaded', () => {
      const fallbackAvatars = document.querySelectorAll('img.avatar-fallback[data-initials]');
      fallbackAvatars.forEach(this.applyInitialsToAvatar);
    });
  },
  
  /**
   * Apply initials to a fallback avatar image
   * @param {HTMLImageElement} img - The image element
   */
  applyInitialsToAvatar: function(img) {
    const initials = img.getAttribute('data-initials');
    if (!initials) return;
    
    // Create a canvas to draw the initials
    const canvas = document.createElement('canvas');
    canvas.width = 48;
    canvas.height = 48;
    const ctx = canvas.getContext('2d');
    
    // Draw background
    ctx.fillStyle = '#E8EAF6';
    ctx.fillRect(0, 0, 48, 48);
    
    // Draw initials
    ctx.fillStyle = '#5C6BC0';
    ctx.font = 'bold 20px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initials, 24, 24);
    
    // Set canvas as image source
    img.src = canvas.toDataURL('image/png');
  },
  
  /**
   * Fetch chats from the API
   */
  fetchChats: function() {
    this.hideError();
    this.showLoader();
    this.state.hasError = false;
    this.state.errorMessage = '';
    
    // Check if user is authenticated
    if (!window.AuthHelper || !AuthHelper.isAuthenticated()) {
      console.error("Authentication required to fetch chats");
      this.state.hasError = true;
      this.state.errorMessage = 'Please log in to view your conversations';
      this.showError();
      this.hideLoader();
      return;
    }
    
    // Get auth headers
    const headers = AuthHelper.getAuthHeaders();
    
    console.log('Fetching chats for current user...');
    
    fetch('/api/my-chats', {
      method: 'GET',
      headers: headers,
    })
    .then(response => {
      if (response.status === 401) {
        // Authentication error
        throw new Error('Authentication required');
      }
      
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      
      return response.json();
    })
    .then(data => {
      console.log('Chats fetched successfully:', data);
      
      // Store chats in state - handle both array and object formats
      if (Array.isArray(data)) {
        this.state.chats = data;
      } else if (data && Array.isArray(data.chats)) {
        this.state.chats = data.chats;
      } else {
        // Invalid data format, set to empty array
        console.warn('Invalid data format received from API:', data);
        this.state.chats = [];
      }
      
      // Sort chats by last message timestamp
      this.sortChats();
      
      // Reset retry count
      this.state.retryCount = 0;
      
      // Render chats
      this.renderChats();
    })
    .catch(error => {
      console.error('Error fetching chats:', error);
      
      if (error.message === 'Authentication required') {
        // Authentication error
        this.state.hasError = true;
        this.state.errorMessage = 'Please log in to view your conversations';
        this.showError();
        
        // Redirect to login after a short delay
        setTimeout(() => {
          window.location.href = '/login';
        }, 2000);
        
        return;
      }
      
      // Increment retry count for other errors
      this.state.retryCount++;
      
      if (this.state.retryCount <= this.config.maxRetries) {
        console.log(`Retry ${this.state.retryCount}/${this.config.maxRetries}...`);
        setTimeout(() => this.fetchChats(), 1000 * this.state.retryCount);
      } else {
        // Show error state
        this.state.hasError = true;
        this.state.errorMessage = error.message || 'Failed to load your conversations.';
        this.showError();
      }
    })
    .finally(() => {
      // Hide loader
      this.hideLoader();
    });
  },
  
  /**
   * Sort chats by last message timestamp
   */
  sortChats: function() {
    this.state.chats.sort((a, b) => {
      const timeA = a.last_message_time ? new Date(a.last_message_time).getTime() : 0;
      const timeB = b.last_message_time ? new Date(b.last_message_time).getTime() : 0;
      return timeB - timeA; // Sort in descending order (newest first)
    });
  },
  
  /**
   * Render chats in the DOM
   */
  renderChats: function() {
    // Clear existing content except loader, empty state, and error state
    const existingChatItems = this.elements.chatsContainer.querySelectorAll('.chat-item');
    existingChatItems.forEach(item => item.remove());
    
    // If no chats, show empty state
    if (this.state.chats.length === 0) {
      this.showEmptyState();
      return;
    }
    
    // Hide empty state
    this.hideEmptyState();
    
    // Filter chats based on search query
    const filteredChats = this.state.searchQuery ? 
      this.state.chats.filter(chat => {
        const searchLower = this.state.searchQuery.toLowerCase();
        const titleLower = (chat.title || '').toLowerCase();
        const recipientLower = (chat.recipient_name || '').toLowerCase();
        const lastMessageLower = (chat.last_message || '').toLowerCase();
        
        return titleLower.includes(searchLower) || 
               recipientLower.includes(searchLower) || 
               lastMessageLower.includes(searchLower);
      }) : this.state.chats;
    
    // If no matching chats after filtering
    if (filteredChats.length === 0) {
      const noResults = document.createElement('div');
      noResults.className = 'list-group-item border-0 text-center p-4';
      noResults.innerHTML = `
        <p class="text-muted mb-0">No conversations matching "${this.state.searchQuery}"</p>
      `;
      this.elements.chatsContainer.appendChild(noResults);
      return;
    }
    
    // Render each chat
    filteredChats.forEach(chat => {
      const chatElement = this.createChatElement(chat);
      this.elements.chatsContainer.appendChild(chatElement);
    });
  },
  
  /**
   * Create chat element for a single chat
   * @param {Object} chat - Chat data
   * @returns {HTMLElement} - Chat element
   */
  createChatElement: function(chat) {
    // Create chat list item
    const chatItem = document.createElement('a');
    chatItem.className = 'list-group-item chat-item list-group-item-action border-0 py-3';
    chatItem.href = `/chat/${chat.id}`;
    
    // Calculate last message time display
    const timeDisplay = this.formatTimeDisplay(chat.last_message_time);
    
    // Calculate expiry time display if present
    const expiryDisplay = chat.expires_at ? 
      `<div class="text-muted small mt-1" title="Chat expires on ${new Date(chat.expires_at).toLocaleString()}">
         <i class="far fa-clock me-1"></i> Expires in ${this.formatExpiryTime(chat.expires_at)}
       </div>` : '';
    
    // Get unread count for this chat
    const unreadCount = this.state.unreadCounts[chat.id] || 0;
    const unreadBadge = unreadCount > 0 ? 
      `<span class="badge bg-primary rounded-pill ms-2">${unreadCount}</span>` : '';
    
    // Create online status indicator
    const isOnline = chat.recipient_status === 'online';
    const statusIndicator = `
      <span class="status-indicator ${isOnline ? 'status-online' : 'status-offline'}" 
            title="${isOnline ? 'Online' : 'Offline'}"></span>
    `;
    
    // Get avatar URL with fallback
    const avatarUrl = this.getAvatarUrl(chat);
    const defaultAvatarPath = this.config.defaultAvatar;
    const chatName = chat.title || chat.recipient_name || 'Unnamed Chat';
    const initials = this.getInitials(chatName);
    
    // Determine if the chat is encrypted
    const encryptionBadge = chat.encrypted ? 
      `<span class="badge bg-success rounded-pill ms-2" title="End-to-end encrypted">
         <i class="fas fa-lock"></i>
       </span>` : '';
    
    // Build chat item HTML
    chatItem.innerHTML = `
      <div class="d-flex align-items-start">
        <div class="chat-avatar me-3 position-relative">
          <img src="${avatarUrl}" alt="${chatName}" 
               class="rounded-circle" width="48" height="48" 
               onerror="this.src='${defaultAvatarPath}'; this.classList.add('avatar-fallback'); this.setAttribute('data-initials', '${initials}');">
          ${statusIndicator}
        </div>
        <div class="flex-grow-1 min-width-0">
          <div class="d-flex justify-content-between align-items-center">
            <h6 class="mb-0 text-truncate">
              ${chatName}
              ${encryptionBadge}
            </h6>
            <small class="text-muted ms-2 flex-shrink-0">${timeDisplay}</small>
          </div>
          <p class="mb-0 text-truncate text-muted small">
            ${chat.last_message || 'No messages yet'}
            ${unreadBadge}
          </p>
          ${expiryDisplay}
        </div>
      </div>
    `;
    
    return chatItem;
  },
  
  /**
   * Get avatar URL for a chat
   * @param {Object} chat - Chat data
   * @returns {string} - Avatar URL
   */
  getAvatarUrl: function(chat) {
    // First try recipient_avatar
    if (chat.recipient_avatar && typeof chat.recipient_avatar === 'string' && chat.recipient_avatar.trim() !== '') {
      // If it's a data URL or absolute URL, use it directly
      if (chat.recipient_avatar.startsWith('data:') || chat.recipient_avatar.startsWith('http')) {
        return chat.recipient_avatar;
      }
      
      // Otherwise, it's a relative path, make sure it's properly formatted
      if (!chat.recipient_avatar.startsWith('/')) {
        return '/' + chat.recipient_avatar;
      }
      
      return chat.recipient_avatar;
    }
    
    // Try group_avatar for group chats
    if (chat.group_avatar && typeof chat.group_avatar === 'string' && chat.group_avatar.trim() !== '') {
      if (chat.group_avatar.startsWith('data:') || chat.group_avatar.startsWith('http')) {
        return chat.group_avatar;
      }
      
      if (!chat.group_avatar.startsWith('/')) {
        return '/' + chat.group_avatar;
      }
      
      return chat.group_avatar;
    }
    
    // Use default avatar
    return this.config.defaultAvatar;
  },
  
  /**
   * Get initials from name for fallback avatar display
   * @param {string} name - Name to get initials from
   * @returns {string} - Initials (1-2 characters)
   */
  getInitials: function(name) {
    if (!name || typeof name !== 'string') return '?';
    
    const names = name.trim().split(' ');
    
    if (names.length === 1) {
      // Single name, get first character
      return names[0].charAt(0).toUpperCase();
    }
    
    // Multiple names, get first character of first and last name
    return (names[0].charAt(0) + names[names.length - 1].charAt(0)).toUpperCase();
  },
  
  /**
   * Format timestamp for display
   * @param {string} timestamp - ISO timestamp
   * @returns {string} - Formatted time string
   */
  formatTimeDisplay: function(timestamp) {
    if (!timestamp) return '';
    
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    // Today: show time
    if (diffDays < 1 && date.getDate() === now.getDate()) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    
    // Yesterday: show "Yesterday"
    if (diffDays < 2 && date.getDate() === now.getDate() - 1) {
      return 'Yesterday';
    }
    
    // Within last week: show day name
    if (diffDays < 7) {
      return date.toLocaleDateString([], { weekday: 'short' });
    }
    
    // Older: show date
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  },
  
  /**
   * Format expiry time for display
   * @param {string} expiry - ISO timestamp for expiry
   * @returns {string} - Formatted expiry string
   */
  formatExpiryTime: function(expiry) {
    if (!expiry) return '';
    
    const expiryDate = new Date(expiry);
    const now = new Date();
    const diffMs = expiryDate - now;
    
    // Already expired
    if (diffMs <= 0) {
      return 'Expired';
    }
    
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    
    // More than 7 days
    if (diffDays > 7) {
      return `${diffDays} days`;
    }
    
    // More than 1 day
    if (diffDays >= 1) {
      return `${diffDays}d ${diffHours}h`;
    }
    
    // Less than 1 day
    const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    if (diffHours >= 1) {
      return `${diffHours}h ${diffMinutes}m`;
    }
    
    // Less than 1 hour
    return `${diffMinutes}m`;
  },
  
  /**
   * Handle search input
   * @param {string} query - Search query
   */
  handleSearch: function(query) {
    this.state.searchQuery = query.trim();
    this.renderChats();
  },
  
  /**
   * Setup auto-refresh timer
   */
  setupAutoRefresh: function() {
    this.clearAutoRefresh();
    
    this.state.autoRefreshTimer = setInterval(() => {
      console.log('Auto-refreshing chats...');
      this.fetchChats();
    }, this.config.refreshInterval);
  },
  
  /**
   * Clear auto-refresh timer
   */
  clearAutoRefresh: function() {
    if (this.state.autoRefreshTimer) {
      clearInterval(this.state.autoRefreshTimer);
      this.state.autoRefreshTimer = null;
    }
  },
  
  /**
   * Connect to WebSocket for real-time updates
   */
  connectWebSocket: function() {
    try {
      // Get authentication token
      const token = AuthHelper.getToken() || 'guest';
      
      // Initialize connection
      this.state.socket = io('http://localhost:5506', {
        path: '/socket.io',
        query: { token },
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000
      });
      
      // Set up event handlers
      this.state.socket.on('connect', () => {
        console.log('WebSocket connected');
        this.state.connected = true;
        
        // Subscribe to any needed channels/topics
        
        // If there's an active invitation, register it
        if (window.InvitationManager && InvitationManager.activeInvitation) {
          this.state.socket.emit('invitation_created', {
            invitation_token: InvitationManager.activeInvitation
          });
        }
      });
      
      this.state.socket.on('disconnect', () => {
        console.log('WebSocket disconnected');
        this.state.connected = false;
      });
      
      this.state.socket.on('new_chat', (data) => {
        console.log('New chat notification received:', data);
        // Refresh chat list to show the new chat
        this.fetchChats();
      });
      
      this.state.socket.on('chat_updated', (data) => {
        console.log('Chat update notification received:', data);
        // Refresh chat list to show the updated chat
        this.fetchChats();
      });
      
      // Pass socket to invitation manager if available
      if (window.InvitationManager) {
        InvitationManager.init(this.state.socket);
      }
      
    } catch (error) {
      console.error('WebSocket connection error:', error);
    }
  },
  
  /**
   * Show new chat modal
   */
  showNewChatModal: function() {
    // Create modal instance if needed
    if (!this.elements.newChatModal._bsModal) {
      this.elements.newChatModal._bsModal = new bootstrap.Modal(this.elements.newChatModal);
    }
    
    // Reset form
    if (this.elements.newChatForm) {
      this.elements.newChatForm.reset();
    }
    
    // Clear error message
    if (this.elements.newChatError) {
      this.elements.newChatError.classList.add('d-none');
    }
    
    // Show modal
    this.elements.newChatModal._bsModal.show();
  },
  
  /**
   * Show QR invitation modal
   */
  showQrInvitationModal: function() {
    if (!this.elements.qrInvitationModal) return;
    
    // Create modal instance if needed
    if (!this.elements.qrInvitationModal._bsModal) {
      this.elements.qrInvitationModal._bsModal = new bootstrap.Modal(this.elements.qrInvitationModal);
    }
    
    // Show modal
    this.elements.qrInvitationModal._bsModal.show();
    
    // Generate QR code
    this.generateQrInvitation();
  },
  
  /**
   * Generate QR invitation
   */
  generateQrInvitation: async function() {
    // Check dependencies
    if (!window.QRCodeGenerator) {
      console.error('QRCodeGenerator not available');
      this.showQrError('QR code generation library not available. Please refresh the page and try again.');
      return;
    }
    
    if (!window.InvitationManager) {
      console.error('InvitationManager not available');
      this.showQrError('Invitation management service not available. Please refresh the page and try again.');
      return;
    }
    
    try {
      // Update UI to loading state
      const qrCodeEl = document.getElementById('qr-code');
      if (qrCodeEl) {
        qrCodeEl.innerHTML = `
          <div class="d-flex justify-content-center align-items-center h-100">
            <div class="spinner-border text-primary" role="status">
              <span class="visually-hidden">Loading...</span>
            </div>
          </div>
        `;
      }
      
      // Reset status indicators
      const statusEl = document.getElementById('invitation-status');
      if (statusEl) {
        statusEl.textContent = 'Generating...';
        statusEl.className = 'badge bg-secondary';
      }
      
      const scanStatusEl = document.getElementById('scan-status');
      if (scanStatusEl) {
        scanStatusEl.textContent = 'Generating QR code...';
        scanStatusEl.className = 'alert alert-info';
      }
      
      // Set up error listeners
      const handleInvitationError = (event) => {
        console.error('Invitation generation error event:', event.detail);
        this.showQrError(event.detail.error || 'Failed to generate invitation code');
      };
      
      document.addEventListener('invitationGenerationError', handleInvitationError);
      
      // Generate invitation
      console.log('Starting invitation generation...');
      const invitation = await InvitationManager.generateInvitation();
      console.log('Invitation generated:', invitation);
      
      // Remove error listener
      document.removeEventListener('invitationGenerationError', handleInvitationError);
      
      // Create invitation URL
      const invitationUrl = QRCodeGenerator.createInvitationURL(invitation.invitation_token);
      console.log('Generated invitation URL:', invitationUrl);
      
      // Display URL
      if (this.elements.invitationLinkInput) {
        this.elements.invitationLinkInput.value = invitationUrl;
      }
      
      // Generate QR code
      if (qrCodeEl) {
        qrCodeEl.innerHTML = ''; // Clear loading state
        const qrCode = QRCodeGenerator.generateQR('qr-code', invitationUrl, {
          width: 240,
          height: 240
        });
        
        if (!qrCode) {
          console.error('QR code generation returned null');
          // Avoid showing an error if the QRCode element already contains error message
          if (!qrCodeEl.querySelector('.alert-danger')) {
            this.showQrError('Failed to render QR code. Please try again.');
          }
          return;
        }
      }
      
      // Update status indicators
      if (statusEl) {
        statusEl.textContent = 'Active';
        statusEl.className = 'badge bg-success';
      }
      
      if (scanStatusEl) {
        scanStatusEl.textContent = 'Waiting for someone to scan the QR code...';
        scanStatusEl.className = 'alert alert-info';
      }
      
    } catch (error) {
      console.error('Error generating QR invitation:', error);
      this.showQrError(error.message || 'Unknown error generating QR code');
    }
  },
  
  /**
   * Handle invitation generation error
   */
  handleInvitationError: function(event) {
    console.error('Invitation generation error event:', event.detail);
    MyChatsList.showQrError(event.detail.error || 'Failed to generate invitation code');
  },
  
  /**
   * Show QR code generation error
   */
  showQrError: function(errorMessage) {
    // Show error in UI
    const qrCodeEl = document.getElementById('qr-code');
    if (qrCodeEl) {
      qrCodeEl.innerHTML = `
        <div class="alert alert-danger">
          <i class="fas fa-exclamation-circle me-2"></i>
          ${errorMessage || 'Unknown error'}
        </div>
      `;
    }
    
    // Update status indicator
    const statusEl = document.getElementById('invitation-status');
    if (statusEl) {
      statusEl.textContent = 'Error';
      statusEl.className = 'badge bg-danger';
    }
    
    // Update scan status
    const scanStatusEl = document.getElementById('scan-status');
    if (scanStatusEl) {
      scanStatusEl.textContent = 'Failed to generate QR code. Please try again.';
      scanStatusEl.className = 'alert alert-danger';
    }
  },
  
  /**
   * Handle invitation accepted event
   */
  handleInvitationAccepted: function(event) {
    console.log('Invitation accepted:', event.detail);
    
    // Close QR invitation modal if open
    if (this.elements.qrInvitationModal && this.elements.qrInvitationModal._bsModal) {
      this.elements.qrInvitationModal._bsModal.hide();
    }
    
    // Navigate to the new chat after a short delay
    const chatId = event.detail.chatId;
    if (chatId) {
      setTimeout(() => {
        window.location.href = `/chat/${chatId}`;
      }, 500);
    }
  },
  
  /**
   * Copy invitation link to clipboard
   */
  copyInvitationLink: function() {
    if (!this.elements.invitationLinkInput || !this.elements.invitationLinkInput.value) return;
    
    try {
      // Select the text
      this.elements.invitationLinkInput.select();
      this.elements.invitationLinkInput.setSelectionRange(0, 99999);
      
      // Copy to clipboard
      document.execCommand('copy');
      
      // Show success message
      if (this.elements.copyStatusText) {
        this.elements.copyStatusText.textContent = 'Link copied to clipboard!';
        this.elements.copyStatusText.className = 'form-text text-success';
        
        // Clear message after 2 seconds
        setTimeout(() => {
          this.elements.copyStatusText.textContent = '';
        }, 2000);
      }
      
    } catch (error) {
      console.error('Error copying link:', error);
      if (this.elements.copyStatusText) {
        this.elements.copyStatusText.textContent = 'Failed to copy link';
        this.elements.copyStatusText.className = 'form-text text-danger';
      }
    }
  },
  
  /**
   * Create a new chat
   */
  createNewChat: function() {
    // Get form data
    const recipientUsername = document.getElementById('recipient-username').value.trim();
    const chatTitle = document.getElementById('chat-title').value.trim();
    const encrypted = document.getElementById('encrypted-chat').checked;
    
    // Validate
    if (!recipientUsername) {
      this.showNewChatError('Please enter a username or email.');
      return;
    }
    
    // Show loading state
    this.elements.createChatBtn.disabled = true;
    this.elements.createChatBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Creating...';
    
    // Clear previous errors
    this.hideNewChatError();
    
    // Prepare request data
    const chatData = {
      recipient: recipientUsername,
      title: chatTitle || undefined,
      encrypted: encrypted
    };
    
    // Get auth headers
    const headers = AuthHelper.getAuthHeaders();
    headers['Content-Type'] = 'application/json';
    
    // Send request to create chat
    fetch('/api/chats', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(chatData)
    })
    .then(response => {
      if (!response.ok) {
        return response.json().then(data => {
          throw new Error(data.message || 'Failed to create chat');
        });
      }
      return response.json();
    })
    .then(data => {
      console.log('Chat created successfully:', data);
      
      // Close modal if Bootstrap is available
      if (window.bootstrap && this.elements.newChatModal) {
        const modal = bootstrap.Modal.getInstance(this.elements.newChatModal);
        if (modal) modal.hide();
      }
      
      // Redirect to the new chat
      window.location.href = `/chat/${data.id}`;
    })
    .catch(error => {
      console.error('Error creating chat:', error);
      this.showNewChatError(error.message || 'Failed to create chat. Please try again.');
    })
    .finally(() => {
      // Reset button state
      this.elements.createChatBtn.disabled = false;
      this.elements.createChatBtn.textContent = 'Create Chat';
    });
  },
  
  /**
   * Show error in new chat modal
   * @param {string} message - Error message
   */
  showNewChatError: function(message) {
    if (this.elements.newChatError) {
      this.elements.newChatError.textContent = message;
      this.elements.newChatError.classList.remove('d-none');
    }
  },
  
  /**
   * Hide error in new chat modal
   */
  hideNewChatError: function() {
    if (this.elements.newChatError) {
      this.elements.newChatError.classList.add('d-none');
    }
  },
  
  /**
   * Show loader
   */
  showLoader: function() {
    if (this.elements.chatsLoader) {
      this.elements.chatsLoader.classList.remove('d-none');
    }
  },
  
  /**
   * Hide loader
   */
  hideLoader: function() {
    if (this.elements.chatsLoader) {
      this.elements.chatsLoader.classList.add('d-none');
    }
  },
  
  /**
   * Show empty state
   */
  showEmptyState: function() {
    if (this.elements.emptyChats) {
      this.elements.emptyChats.classList.remove('d-none');
    }
  },
  
  /**
   * Hide empty state
   */
  hideEmptyState: function() {
    if (this.elements.emptyChats) {
      this.elements.emptyChats.classList.add('d-none');
    }
  },
  
  /**
   * Show error state
   */
  showError: function() {
    if (this.elements.errorState) {
      this.elements.errorState.classList.remove('d-none');
    }
    
    if (this.elements.errorMessage) {
      this.elements.errorMessage.textContent = this.state.errorMessage;
    }
  },
  
  /**
   * Hide error state
   */
  hideError: function() {
    if (this.elements.errorState) {
      this.elements.errorState.classList.add('d-none');
    }
  }
};

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  MyChatsList.init();
}); 