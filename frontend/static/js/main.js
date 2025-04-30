/**
 * ABDRE Microservices - Main JavaScript
 * Core functionality and initializations for the frontend
 */

// Global variables
let isAuthenticated = false;
let currentUser = null;

// DOM elements cached after page load
const domElements = {};

/**
 * Initialize the application
 */
async function initializeApp() {
  // Cache frequently used DOM elements
  cacheElements();
  
  // Check authentication status
  isAuthenticated = await checkAuth();
  
  // Initialize page-specific functionality
  initializePage();
  
  // Attach global event listeners
  attachEventListeners();
}

/**
 * Check authentication status and refresh token if needed
 */
async function checkAuth() {
  // Use the API client's authentication check
  if (!window.api) {
    console.error('API client not initialized');
    return false;
  }
  
  if (!window.api.isAuthenticated()) {
    handleUnauthenticated();
    return false;
  }
  
  // Initialize user data if authenticated
  try {
    await window.api.refreshAuthState();
    currentUser = window.api.user;
    
    // Initialize socket for real-time communications if authenticated
    if (window.socketClient && currentUser) {
      window.socketClient.initialize();
    }
    
    // Update UI with user info
    updateUserUI();
    return true;
  } catch (error) {
    console.error('Authentication error:', error);
    handleUnauthenticated();
    return false;
  }
}

/**
 * Handle unauthenticated state
 */
function handleUnauthenticated() {
  // Redirect to login if on a protected page
  const protectedPaths = ['/chat/', '/new', '/profile'];
  const currentPath = window.location.pathname;
  
  const isProtected = protectedPaths.some(path => currentPath.startsWith(path));
  
  if (isProtected) {
    window.location.href = '/login?redirect=' + encodeURIComponent(currentPath);
  }
}

/**
 * Initialize page-specific functionality
 */
function initializePage() {
  const path = window.location.pathname;
  
  // Handle different pages
  if (path === '/') {
    initializeHomePage();
  } else if (path === '/login') {
    initializeLoginPage();
  } else if (path.startsWith('/chat/')) {
    initializeChatPage();
  } else if (path === '/new') {
    initializeCreateChatPage();
  }
}

/**
 * Initialize home page
 */
function initializeHomePage() {
  // If authenticated, fetch user's chats
  if (isAuthenticated && window.api) {
    loadUserChats();
  }
}

/**
 * Initialize login page
 */
function initializeLoginPage() {
  // If already authenticated, redirect to home
  if (isAuthenticated) {
    const redirectUrl = new URLSearchParams(window.location.search).get('redirect') || '/';
    window.location.href = redirectUrl;
    return;
  }
  
  // Set up login form submission
  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', handleLogin);
  }
  
  // Set up registration form submission
  const registerForm = document.getElementById('register-form');
  if (registerForm) {
    registerForm.addEventListener('submit', handleRegister);
  }
  
  // Set up OAuth buttons
  const oauthButtons = document.querySelectorAll('.oauth-button');
  oauthButtons.forEach(button => {
    const provider = button.getAttribute('data-provider');
    if (provider) {
      button.addEventListener('click', () => initiateOAuth(provider));
    }
  });
}

/**
 * Initialize chat page
 */
function initializeChatPage() {
  if (!isAuthenticated) return;
  
  // Get chat ID from URL
  const chatId = window.location.pathname.split('/chat/')[1];
  if (!chatId) return;
  
  // Connect to socket for this chat
  if (window.socketClient) {
    window.socketClient.joinRoom(chatId);
    
    // Listen for new messages
    window.socketClient.on('chat_message', handleIncomingMessage);
    window.socketClient.on('typing', updateTypingIndicator);
  }
  
  // Load chat messages
  loadChatMessages(chatId);
  
  // Set up message form
  const messageForm = document.getElementById('message-form');
  if (messageForm) {
    messageForm.addEventListener('submit', handleSendMessage);
    
    // Set up typing indicator
    const messageInput = document.getElementById('message-input');
    if (messageInput) {
      let typingTimeout;
      messageInput.addEventListener('input', () => {
        // Clear previous timeout
        clearTimeout(typingTimeout);
        
        // Send typing indicator
        window.socketClient.sendTypingIndicator(true);
        
        // Stop typing indicator after 2 seconds of inactivity
        typingTimeout = setTimeout(() => {
          window.socketClient.sendTypingIndicator(false);
        }, 2000);
      });
    }
  }
}

/**
 * Initialize create chat page
 */
function initializeCreateChatPage() {
  if (!isAuthenticated) return;
  
  // Set up create chat form
  const createChatForm = document.getElementById('create-chat-form');
  if (createChatForm) {
    createChatForm.addEventListener('submit', handleCreateChat);
  }
}

/**
 * Load user's chat list
 */
async function loadUserChats() {
  try {
    const chats = await window.api.chat.getChats();
    const chatList = document.getElementById('chat-list');
    
    if (chatList && chats.length > 0) {
      chatList.innerHTML = '';
      
      chats.forEach(chat => {
        const chatItem = document.createElement('div');
        chatItem.className = 'chat-item';
        chatItem.innerHTML = `
          <h3>${escapeHTML(chat.name)}</h3>
          <p>${escapeHTML(chat.last_message || 'No messages yet')}</p>
          <small>${formatDate(chat.updated_at)}</small>
          <a href="/chat/${chat.id}" class="btn btn-primary">Open</a>
        `;
        chatList.appendChild(chatItem);
      });
    } else if (chatList) {
      chatList.innerHTML = '<p>No chats found. Create a new chat to get started!</p>';
    }
  } catch (error) {
    console.error('Error loading chats:', error);
    showNotification('Failed to load chats', 'error');
  }
}

/**
 * Load chat messages
 */
async function loadChatMessages(chatId) {
  try {
    const chat = await window.api.chat.getChatById(chatId);
    const messages = await window.api.chat.getMessages(chatId);
    
    // Update chat title
    const chatTitle = document.getElementById('chat-title');
    if (chatTitle) {
      chatTitle.textContent = chat.name;
    }
    
    // Display messages
    const messagesContainer = document.getElementById('messages-container');
    if (messagesContainer && messages.length > 0) {
      messagesContainer.innerHTML = '';
      
      messages.forEach(message => {
        displayMessage(message);
      });
      
      // Scroll to bottom
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    } else if (messagesContainer) {
      messagesContainer.innerHTML = '<p class="empty-state">No messages yet. Start the conversation!</p>';
    }
  } catch (error) {
    console.error('Error loading chat:', error);
    showNotification('Failed to load chat messages', 'error');
  }
}

/**
 * Display a message in the UI
 */
function displayMessage(message) {
  const messagesContainer = document.getElementById('messages-container');
  if (!messagesContainer) return;
  
  const isCurrentUser = message.sender_id === currentUser.id;
  const messageElement = document.createElement('div');
  messageElement.className = `message ${isCurrentUser ? 'message-outgoing' : 'message-incoming'}`;
  
  messageElement.innerHTML = `
    <div class="message-content">
      <p>${escapeHTML(message.content)}</p>
      <small>${formatDate(message.created_at)}</small>
    </div>
  `;
  
  messagesContainer.appendChild(messageElement);
  
  // Scroll to new message
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

/**
 * Handle sending a message
 */
async function handleSendMessage(event) {
  event.preventDefault();
  
  const messageInput = document.getElementById('message-input');
  const chatId = window.location.pathname.split('/chat/')[1];
  
  if (!messageInput || !chatId) return;
  
  const content = messageInput.value.trim();
  if (!content) return;
  
  // Clear input right away for better UX
  messageInput.value = '';
  
  try {
    // Send via API
    const sentMessage = await window.api.chat.sendMessage(chatId, content);
    
    // Also send via WebSocket for real-time delivery
    if (window.socketClient) {
      window.socketClient.sendChatMessage(content, chatId);
    }
    
    // Clear typing indicator
    window.socketClient.sendTypingIndicator(false);
  } catch (error) {
    console.error('Error sending message:', error);
    showNotification('Failed to send message', 'error');
    // Restore message to input
    messageInput.value = content;
  }
}

/**
 * Handle incoming message via WebSocket
 */
function handleIncomingMessage(messageData) {
  // Skip messages from the current user (already displayed)
  if (messageData.sender_id === currentUser.id) return;
  
  // Display the message
  displayMessage(messageData);
  
  // Play notification sound if not visible
  if (document.hidden) {
    playNotificationSound();
  }
}

/**
 * Handle login form submission
 */
async function handleLogin(event) {
  event.preventDefault();
  
  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  
  if (!usernameInput || !passwordInput) return;
  
  const username = usernameInput.value.trim();
  const password = passwordInput.value;
  
  if (!username || !password) {
    showNotification('Please enter both username and password', 'error');
    return;
  }
  
  try {
    const loginButton = document.querySelector('#login-form button[type="submit"]');
    if (loginButton) {
      loginButton.disabled = true;
      loginButton.textContent = 'Logging in...';
    }
    
    const response = await window.api.auth.login(username, password);
    
    // Handle successful login
    if (response.token) {
      // Get redirect URL from query string
      const redirectUrl = new URLSearchParams(window.location.search).get('redirect') || '/';
      window.location.href = redirectUrl;
    } else {
      showNotification('Login failed. Please try again.', 'error');
    }
  } catch (error) {
    console.error('Login error:', error);
    showNotification(error.message || 'Login failed. Please try again.', 'error');
  } finally {
    const loginButton = document.querySelector('#login-form button[type="submit"]');
    if (loginButton) {
      loginButton.disabled = false;
      loginButton.textContent = 'Log In';
    }
  }
}

/**
 * Handle register form submission
 */
async function handleRegister(event) {
  event.preventDefault();
  
  const usernameInput = document.getElementById('register-username');
  const passwordInput = document.getElementById('register-password');
  const emailInput = document.getElementById('register-email');
  
  if (!usernameInput || !passwordInput || !emailInput) return;
  
  const username = usernameInput.value.trim();
  const password = passwordInput.value;
  const email = emailInput.value.trim();
  
  if (!username || !password || !email) {
    showNotification('Please fill out all fields', 'error');
    return;
  }
  
  try {
    const registerButton = document.querySelector('#register-form button[type="submit"]');
    if (registerButton) {
      registerButton.disabled = true;
      registerButton.textContent = 'Creating Account...';
    }
    
    const response = await window.api.auth.register({
      username,
      password,
      email
    });
    
    // Handle successful registration
    if (response.token) {
      showNotification('Account created successfully!', 'success');
      
      // Redirect to home page
      window.location.href = '/';
    } else {
      showNotification('Registration failed. Please try again.', 'error');
    }
  } catch (error) {
    console.error('Registration error:', error);
    showNotification(error.message || 'Registration failed. Please try again.', 'error');
  } finally {
    const registerButton = document.querySelector('#register-form button[type="submit"]');
    if (registerButton) {
      registerButton.disabled = false;
      registerButton.textContent = 'Register';
    }
  }
}

/**
 * Handle creating a new chat
 */
async function handleCreateChat(event) {
  event.preventDefault();
  
  const nameInput = document.getElementById('chat-name');
  const descriptionInput = document.getElementById('chat-description');
  
  if (!nameInput) return;
  
  const name = nameInput.value.trim();
  const description = descriptionInput ? descriptionInput.value.trim() : '';
  
  if (!name) {
    showNotification('Please enter a chat name', 'error');
    return;
  }
  
  try {
    const createButton = document.querySelector('#create-chat-form button[type="submit"]');
    if (createButton) {
      createButton.disabled = true;
      createButton.textContent = 'Creating...';
    }
    
    const response = await window.api.chat.createChat({
      name,
      description
    });
    
    // Handle successful chat creation
    if (response.id) {
      // Redirect to the new chat
      window.location.href = `/chat/${response.id}`;
    } else {
      showNotification('Failed to create chat. Please try again.', 'error');
    }
  } catch (error) {
    console.error('Error creating chat:', error);
    showNotification(error.message || 'Failed to create chat. Please try again.', 'error');
  } finally {
    const createButton = document.querySelector('#create-chat-form button[type="submit"]');
    if (createButton) {
      createButton.disabled = false;
      createButton.textContent = 'Create Chat';
    }
  }
}

/**
 * Update typing indicator
 */
function updateTypingIndicator(data) {
  const typingIndicator = document.getElementById('typing-indicator');
  if (!typingIndicator) return;
  
  if (data.is_typing && data.user_id !== currentUser.id) {
    typingIndicator.textContent = `${data.username || 'Someone'} is typing...`;
    typingIndicator.style.display = 'block';
  } else {
    typingIndicator.style.display = 'none';
  }
}

/**
 * Cache frequently used DOM elements for better performance
 */
function cacheElements() {
  // Always present elements
  domElements.notifications = document.getElementById('notifications');
  domElements.logoutButton = document.getElementById('logout-button');
  domElements.userInfo = document.getElementById('user-info');
}

/**
 * Update UI with user information
 */
function updateUserUI() {
  if (!currentUser) return;
  
  // Update user info in header if exists
  if (domElements.userInfo) {
    domElements.userInfo.innerHTML = `
      <span class="username">${escapeHTML(currentUser.username)}</span>
    `;
  }
}

/**
 * Initiate OAuth login flow
 */
function initiateOAuth(provider) {
  if (window.api && window.api.oauth) {
    window.api.oauth.initiateOAuth(provider);
  }
}

/**
 * Attach global event listeners
 */
function attachEventListeners() {
  // Logout button
  if (domElements.logoutButton) {
    domElements.logoutButton.addEventListener('click', () => {
      if (window.api && window.api.auth) {
        window.api.auth.logout();
      }
    });
  }
  
  // Copy buttons
  const copyButtons = document.querySelectorAll('.copy-button');
  copyButtons.forEach(button => {
    button.addEventListener('click', () => {
      const textToCopy = button.getAttribute('data-copy');
      if (textToCopy) {
        copyToClipboard(textToCopy);
      }
    });
  });
}

/**
 * Play notification sound
 */
function playNotificationSound() {
  // Create an audio element and play it
  const audio = new Audio('/static/sounds/notification.mp3');
  audio.play().catch(e => {
    // Ignore errors - browser might block autoplay
    console.log('Could not play notification sound');
  });
}

/**
 * Show notification
 */
function showNotification(message, type = 'info', duration = 3000) {
  // Create notification element if not cached or not in DOM
  const notificationElement = document.createElement('div');
  notificationElement.className = `notification notification-${type}`;
  notificationElement.textContent = message;
  
  // Add to notifications container or body
  const container = domElements.notifications || document.body;
  container.appendChild(notificationElement);
  
  // Animate in
  setTimeout(() => {
    notificationElement.classList.add('visible');
  }, 10);
  
  // Remove after duration
  setTimeout(() => {
    notificationElement.classList.remove('visible');
    
    // Remove from DOM after animation
    setTimeout(() => {
      notificationElement.remove();
    }, 300);
  }, duration);
}

/**
 * Format date for display
 */
function formatDate(dateString) {
  if (!dateString) return '';
  
  const date = new Date(dateString);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  
  // Check if today
  if (date.toDateString() === now.toDateString()) {
    return `Today at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
  
  // Check if yesterday
  if (date.toDateString() === yesterday.toDateString()) {
    return `Yesterday at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
  
  // Otherwise show full date
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * Copy text to clipboard
 */
function copyToClipboard(text) {
  navigator.clipboard.writeText(text)
    .then(() => {
      showNotification('Copied to clipboard!', 'success', 2000);
    })
    .catch(err => {
      console.error('Could not copy text: ', err);
      showNotification('Failed to copy to clipboard', 'error');
    });
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHTML(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', initializeApp); 