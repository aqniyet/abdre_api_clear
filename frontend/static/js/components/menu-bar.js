/**
 * ABDRE Chat - Menu Bar Component
 * Provides a standardized header/menu bar across all pages
 */

const MenuBar = {
  /**
   * Initialize the menu bar functionality
   */
  init: function() {
    this.updateAuthStatus();
    this.setupEventListeners();
    this.highlightCurrentPage();
    
    // Listen for auth changes
    document.addEventListener('auth:change', () => {
      this.updateAuthStatus();
    });
  },

  /**
   * Update the auth status display in the menu bar
   */
  updateAuthStatus: function() {
    const authStatusElement = document.getElementById('auth-status');
    if (!authStatusElement) return;
    
    if (window.AuthHelper && AuthHelper.isAuthenticated()) {
      const userData = AuthHelper.getUserData();
      const displayName = userData?.display_name || userData?.username || 'User';
      
      authStatusElement.innerHTML = `
        <div class="dropdown">
          <button class="btn btn-link dropdown-toggle text-white text-decoration-none" type="button" id="userMenuDropdown" data-bs-toggle="dropdown" aria-expanded="false">
            <i class="fas fa-user-circle me-1"></i> ${displayName}
          </button>
          <ul class="dropdown-menu dropdown-menu-end" aria-labelledby="userMenuDropdown">
            <li><a class="dropdown-item" href="/my-chats"><i class="fas fa-comments me-2"></i>My Chats</a></li>
            <li><a class="dropdown-item" href="/settings"><i class="fas fa-cog me-2"></i>Settings</a></li>
            <li><hr class="dropdown-divider"></li>
            <li><button class="dropdown-item" id="logout-btn"><i class="fas fa-sign-out-alt me-2"></i>Logout</button></li>
          </ul>
        </div>
      `;
      
      // Add event listener to logout button
      const logoutBtn = document.getElementById('logout-btn');
      if (logoutBtn) {
        logoutBtn.addEventListener('click', function() {
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
        });
      }
    } else {
      // Show login link for guest users
      authStatusElement.innerHTML = `
        <a href="/login" class="btn btn-sm btn-outline-light">
          <i class="fas fa-sign-in-alt me-1"></i> Login
        </a>
      `;
    }
  },

  /**
   * Setup event listeners for menu interactions
   */
  setupEventListeners: function() {
    // Mobile menu toggle if it exists
    const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
    if (mobileMenuToggle) {
      mobileMenuToggle.addEventListener('click', function() {
        const mobileMenu = document.getElementById('mobile-menu');
        if (mobileMenu) {
          mobileMenu.classList.toggle('show');
        }
      });
    }
  },

  /**
   * Highlight the current page in the navigation
   */
  highlightCurrentPage: function() {
    const currentPath = window.location.pathname;
    const navLinks = document.querySelectorAll('.navbar-nav .nav-link');
    
    navLinks.forEach(link => {
      const href = link.getAttribute('href');
      if (href === currentPath) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });
  }
};

// Auto-initialize when document is ready
document.addEventListener('DOMContentLoaded', function() {
  MenuBar.init();
}); 