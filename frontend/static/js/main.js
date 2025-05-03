/**
 * ABDRE Chat Application - Main JavaScript
 * Initializes the application and handles routing
 */

// Wait for DOM to load
document.addEventListener('DOMContentLoaded', () => {
  // Initialize the appropriate page module based on the current URL path
  initPageModule();
  
  // Setup global event listeners
  setupGlobalListeners();
});

/**
 * Initialize the appropriate page module based on the current URL path
 */
function initPageModule() {
  const path = window.location.pathname;
  
  // Determine which page module to initialize
  if (path.startsWith('/chat/')) {
    // Chat page
    if (typeof ChatPage !== 'undefined') {
      ChatPage.init();
    }
  } else if (path === '/my-chats' || path === '/my_chats') {
    // My chats page
    if (typeof MyChatsPage !== 'undefined') {
      MyChatsPage.init();
    }
  } else if (path === '/new' || path === '/create') {
    // Create chat page
    if (typeof CreateChatPage !== 'undefined') {
      CreateChatPage.init();
    }
  } else if (path === '/settings') {
    // Settings page
    if (typeof SettingsPage !== 'undefined') {
      SettingsPage.init();
    }
  } else if (path === '/login') {
    // Login page
    if (typeof LoginPage !== 'undefined') {
      LoginPage.init();
    }
  } else if (path === '/welcome') {
    // Welcome page
    if (typeof WelcomePage !== 'undefined') {
      WelcomePage.init();
    }
  } else if (path === '/' || path === '/index.html') {
    // Home page
    if (typeof HomePage !== 'undefined') {
      HomePage.init();
    }
  }
  
  // Initialize common components regardless of page
  initCommonComponents();
}

/**
 * Initialize common components used across different pages
 */
function initCommonComponents() {
  // Set up authentication status in the UI
  updateAuthUI();
  
  // Initialize error handler for all fetch requests
  initGlobalErrorHandler();
}

/**
 * Update UI elements based on authentication status
 */
function updateAuthUI() {
  const authLinks = document.querySelectorAll('[data-auth-required]');
  const nonAuthLinks = document.querySelectorAll('[data-non-auth-only]');
  const userNameElements = document.querySelectorAll('[data-user-name]');
  
  const isAuthenticated = AuthHelper.isAuthenticated();
  
  // Show/hide elements based on auth status
  if (authLinks) {
    authLinks.forEach(link => {
      link.style.display = isAuthenticated ? '' : 'none';
    });
  }
  
  if (nonAuthLinks) {
    nonAuthLinks.forEach(link => {
      link.style.display = isAuthenticated ? 'none' : '';
    });
  }
  
  // Update user name elements if user is authenticated
  if (isAuthenticated && userNameElements) {
    const userName = localStorage.getItem('user_name') || 'User';
    userNameElements.forEach(element => {
      element.textContent = userName;
    });
  }
}

/**
 * Initialize global error handler for fetch requests
 */
function initGlobalErrorHandler() {
  // Override fetch to handle common errors
  const originalFetch = window.fetch;
  
  window.fetch = async function(url, options = {}) {
    try {
      const response = await originalFetch(url, options);
      
      // Handle authentication errors
      if (response.status === 401) {
        // Try to refresh the token if available
        if (localStorage.getItem('refresh_token')) {
          try {
            await AuthHelper.refreshToken();
            
            // Retry the original request with the new token
            const newOptions = { ...options };
            if (newOptions.headers) {
              newOptions.headers = { ...newOptions.headers };
              if (newOptions.headers.Authorization) {
                newOptions.headers.Authorization = `Bearer ${AuthHelper.getToken()}`;
              }
            }
            return await originalFetch(url, newOptions);
          } catch (refreshError) {
            console.error('Token refresh failed:', refreshError);
            // Clear authentication and redirect to login
            AuthHelper.clearAuth();
            window.location.href = '/login';
            throw new Error('Authentication required');
          }
        } else {
          // No refresh token, clear auth and redirect
          AuthHelper.clearAuth();
          window.location.href = '/login';
          throw new Error('Authentication required');
        }
      }
      
      return response;
    } catch (error) {
      console.error('Fetch error:', error);
      throw error;
    }
  };
}

/**
 * Setup global event listeners
 */
function setupGlobalListeners() {
  // Listen for logout clicks
  const logoutButtons = document.querySelectorAll('[data-action="logout"]');
  if (logoutButtons) {
    logoutButtons.forEach(button => {
      button.addEventListener('click', (e) => {
        e.preventDefault();
        AuthHelper.clearAuth();
        window.location.href = '/';
      });
    });
  }
  
  // Setup Bootstrap components if Bootstrap is present
  if (typeof bootstrap !== 'undefined') {
    // Initialize tooltips
    const tooltips = document.querySelectorAll('[data-bs-toggle="tooltip"]');
    if (tooltips.length > 0) {
      Array.from(tooltips).map(tooltipNode => new bootstrap.Tooltip(tooltipNode));
    }
    
    // Initialize popovers
    const popovers = document.querySelectorAll('[data-bs-toggle="popover"]');
    if (popovers.length > 0) {
      Array.from(popovers).map(popoverNode => new bootstrap.Popover(popoverNode));
    }
  }
}

/**
 * Display a notification message
 * @param {string} message - Message to display
 * @param {string} type - Message type (success, danger, warning, info)
 * @param {number} duration - Duration in milliseconds
 */
function showNotification(message, type = 'info', duration = 5000) {
  // Check if notification container exists
  let container = document.querySelector('.notification-container');
  
  // Create container if it doesn't exist
  if (!container) {
    container = document.createElement('div');
    container.className = 'notification-container';
    document.body.appendChild(container);
  }
  
  // Create notification element
  const notification = document.createElement('div');
  notification.className = `notification alert alert-${type} alert-dismissible fade show`;
  notification.setAttribute('role', 'alert');
  
  notification.innerHTML = `
    <span>${message}</span>
    <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
  `;
  
  // Add to container
  container.appendChild(notification);
  
  // Auto-remove after duration
  if (duration > 0) {
    setTimeout(() => {
      notification.classList.remove('show');
      setTimeout(() => {
        notification.remove();
      }, 300);
    }, duration);
  }
  
  // Add click handler for close button
  const closeButton = notification.querySelector('.btn-close');
  if (closeButton) {
    closeButton.addEventListener('click', () => {
      notification.classList.remove('show');
      setTimeout(() => {
        notification.remove();
      }, 300);
    });
  }
  
  return notification;
}

// Global error handling
window.addEventListener('error', (event) => {
  console.error('Global error:', event.error);
  showNotification('An error occurred. Please try again.', 'danger');
}); 