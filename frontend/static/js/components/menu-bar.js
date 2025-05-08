/**
 * ABDRE Chat - Menu Bar Component
 * Provides a standardized header/menu bar across all pages
 */

const MenuBar = {
  /**
   * Initialize the menu bar functionality
   */
  init: function() {
    this.cacheElements();
    this.updateAuthStatus();
    this.setupEventListeners();
    this.highlightCurrentPage();
    
    // Listen for auth changes
    document.addEventListener('auth:change', () => {
      this.updateAuthStatus();
    });
    
    // Listen for notification updates if socket is available
    if (window.SocketClient) {
      SocketClient.on('unread_count_update', this.updateNotificationCount.bind(this));
    }
    
    console.log('Menu bar initialized');
  },
  
  /**
   * Cache DOM elements
   */
  cacheElements: function() {
    this.authStatusElement = document.getElementById('auth-status');
    this.notificationContainer = document.getElementById('notification-container');
    this.notificationBadge = document.getElementById('notification-badge');
    this.mobileMenuToggle = document.getElementById('mobile-menu-toggle');
    this.mobileMenu = document.getElementById('mobile-menu');
  },

  /**
   * Update the auth status display in the menu bar
   */
  updateAuthStatus: function() {
    if (!this.authStatusElement) return;
    
    if (window.AuthHelper && AuthHelper.isAuthenticated && AuthHelper.isAuthenticated()) {
      const userData = AuthHelper.getUserData();
      const displayName = userData?.display_name || userData?.username || 'User';
      const initials = this.getInitials(displayName);
      
      // Create user dropdown
      this.authStatusElement.innerHTML = `
        <div class="dropdown">
          <button class="btn btn-link text-white text-decoration-none p-0 border-0 dropdown-toggle d-flex align-items-center" type="button" id="userMenuDropdown" data-bs-toggle="dropdown" aria-expanded="false">
            <div class="avatar-circle me-2 d-none d-sm-flex">
              <span class="avatar-initials">${initials}</span>
            </div>
            <span class="user-name">${displayName}</span>
          </button>
          <ul class="dropdown-menu dropdown-menu-end" aria-labelledby="userMenuDropdown">
            <li><a class="dropdown-item" href="/my-chats"><i class="fas fa-comments me-2"></i>My Chats</a></li>
            <li><a class="dropdown-item" href="/new"><i class="fas fa-plus me-2"></i>New Chat</a></li>
            <li><a class="dropdown-item" href="/settings"><i class="fas fa-cog me-2"></i>Settings</a></li>
            <li><hr class="dropdown-divider"></li>
            <li><button class="dropdown-item" id="logout-btn"><i class="fas fa-sign-out-alt me-2"></i>Logout</button></li>
          </ul>
        </div>
      `;
      
      // Show notification icon
      if (this.notificationContainer) {
        this.notificationContainer.classList.remove('d-none');
      }
      
      // Show mobile menu toggle
      if (this.mobileMenuToggle) {
        this.mobileMenuToggle.classList.remove('d-none');
      }
      
      // Add event listener to logout button
      const logoutBtn = document.getElementById('logout-btn');
      if (logoutBtn) {
        logoutBtn.addEventListener('click', this.handleLogout.bind(this));
      }
      
      // Setup mobile menu if user is authenticated
      this.setupMobileMenu(userData);
      
      // Fetch and update notification count
      this.fetchNotificationCount();
    } else {
      // Use static login button that's already in the template
      // Just ensure notification icon and mobile menu are hidden
      if (this.notificationContainer) {
        this.notificationContainer.classList.add('d-none');
      }
      
      if (this.mobileMenuToggle) {
        this.mobileMenuToggle.classList.add('d-none');
      }
    }
  },
  
  /**
   * Handle logout button click
   */
  handleLogout: function(e) {
    if (e) e.preventDefault();
    
    if (window.AuthHelper) {
      AuthHelper.logout()
        .then(() => {
          window.location.href = '/login';
        })
        .catch(error => {
          console.error('Logout failed:', error);
          // Still redirect to login page even if API call fails
          window.location.href = '/login';
        });
    } else {
      // Fallback if AuthHelper is not available
      window.location.href = '/login';
    }
  },
  
  /**
   * Setup mobile menu content
   */
  setupMobileMenu: function(userData) {
    if (!this.mobileMenu) return;
    
    const displayName = userData?.display_name || userData?.username || 'User';
    const email = userData?.email || '';
    const initials = this.getInitials(displayName);
    
    this.mobileMenu.innerHTML = `
      <div class="p-3 border-bottom">
        <div class="d-flex align-items-center">
          <div class="avatar-circle me-3">
            <span class="avatar-initials">${initials}</span>
          </div>
          <div>
            <div class="fw-bold">${displayName}</div>
            <div class="text-muted small">${email}</div>
          </div>
        </div>
      </div>
      <div class="py-2">
        <a href="/my-chats" class="mobile-menu-item">
          <i class="fas fa-comments me-2"></i>
          <span>My Chats</span>
        </a>
        <a href="/new" class="mobile-menu-item">
          <i class="fas fa-plus me-2"></i>
          <span>New Chat</span>
        </a>
        <a href="/settings" class="mobile-menu-item">
          <i class="fas fa-cog me-2"></i>
          <span>Settings</span>
        </a>
        <div class="dropdown-divider"></div>
        <a href="#" class="mobile-menu-item" id="mobile-logout-btn">
          <i class="fas fa-sign-out-alt me-2"></i>
          <span>Logout</span>
        </a>
      </div>
    `;
    
    // Add event listener to mobile logout button
    const mobileLogoutBtn = document.getElementById('mobile-logout-btn');
    if (mobileLogoutBtn) {
      mobileLogoutBtn.addEventListener('click', this.handleLogout.bind(this));
    }
  },

  /**
   * Setup event listeners for menu interactions
   */
  setupEventListeners: function() {
    // Mobile menu toggle
    if (this.mobileMenuToggle) {
      this.mobileMenuToggle.addEventListener('click', () => {
        this.toggleMobileMenu();
      });
    }
    
    // Close mobile menu when clicking outside
    document.addEventListener('click', (event) => {
      if (this.mobileMenu && 
          !this.mobileMenu.contains(event.target) && 
          this.mobileMenuToggle && 
          !this.mobileMenuToggle.contains(event.target) &&
          this.mobileMenu.classList.contains('d-block')) {
        this.toggleMobileMenu();
      }
    });
    
    // Notification button click
    const notificationButton = document.getElementById('notification-button');
    if (notificationButton) {
      notificationButton.addEventListener('click', this.handleNotificationClick.bind(this));
    }
  },
  
  /**
   * Toggle mobile menu visibility
   */
  toggleMobileMenu: function() {
    if (!this.mobileMenu) return;
    
    if (this.mobileMenu.classList.contains('d-none')) {
      this.mobileMenu.classList.remove('d-none');
      this.mobileMenu.classList.add('d-block');
      this.mobileMenuToggle.innerHTML = '<i class="fas fa-times fs-5"></i>';
      
      // Add animation class
      setTimeout(() => {
        this.mobileMenu.classList.add('menu-slide-in');
      }, 10);
    } else {
      this.mobileMenu.classList.remove('menu-slide-in');
      this.mobileMenuToggle.innerHTML = '<i class="fas fa-bars fs-5"></i>';
      
      // Wait for animation to complete before hiding
      setTimeout(() => {
        this.mobileMenu.classList.remove('d-block');
        this.mobileMenu.classList.add('d-none');
      }, 300);
    }
  },
  
  /**
   * Handle notification icon click
   */
  handleNotificationClick: function() {
    // In a full implementation, this would open a notification panel
    // For now, navigate to My Chats
    window.location.href = '/my-chats';
    
    // Reset notification count
    this.updateNotificationCount(0);
  },
  
  /**
   * Fetch notification count from API
   */
  fetchNotificationCount: function() {
    if (!window.ApiClient || !AuthHelper.isAuthenticated()) return;
    
    // Use unread message count API if available
    if (ApiClient && ApiClient.getUnreadMessageCount) {
      ApiClient.getUnreadMessageCount()
        .then(result => {
          const count = result.count || 0;
          this.updateNotificationCount(count);
        })
        .catch(err => {
          console.error('Error fetching notification count:', err);
        });
    }
  },
  
  /**
   * Update notification count display
   */
  updateNotificationCount: function(count) {
    if (!this.notificationBadge) return;
    
    if (count > 0) {
      this.notificationBadge.textContent = count > 99 ? '99+' : count;
      this.notificationBadge.classList.remove('d-none');
    } else {
      this.notificationBadge.classList.add('d-none');
    }
  },

  /**
   * Highlight the current page in the navigation
   */
  highlightCurrentPage: function() {
    const currentPath = window.location.pathname;
    
    // Highlight mobile menu items if available
    const mobileMenuItems = document.querySelectorAll('.mobile-menu-item');
    mobileMenuItems.forEach(item => {
      const href = item.getAttribute('href');
      if (href === currentPath) {
        item.classList.add('active');
      }
    });
    
    // Highlight dropdown menu items
    const dropdownItems = document.querySelectorAll('.dropdown-menu .dropdown-item');
    dropdownItems.forEach(item => {
      const href = item.getAttribute('href');
      if (href && href === currentPath) {
        item.classList.add('active');
      }
    });
  },
  
  /**
   * Get initials from name for avatar
   */
  getInitials: function(name) {
    if (!name) return '?';
    
    const names = name.split(' ');
    if (names.length === 1) {
      return names[0].charAt(0).toUpperCase();
    }
    
    return (names[0].charAt(0) + names[names.length - 1].charAt(0)).toUpperCase();
  }
};

// Export for use in other modules
window.MenuBar = MenuBar; 