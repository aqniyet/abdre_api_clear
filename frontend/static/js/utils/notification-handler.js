/**
 * Notification Handler
 * Manages the notification badge in the menu bar
 */

const NotificationHandler = {
    // Elements
    countElement: null,
    unreadCountContainer: null,
    
    // Initialization
    init() {
        this.countElement = document.getElementById('notification-count');
        this.unreadCountContainer = document.getElementById('unread-count');
        
        if (!this.countElement || !this.unreadCountContainer) {
            console.warn('Notification elements not found in the DOM');
            return;
        }
        
        // Try to get notifications count from socket client if available
        this.connectToSocket();
        
        // Set up click handler
        const notifyBtn = document.getElementById('notifications-btn');
        if (notifyBtn) {
            notifyBtn.addEventListener('click', this.handleNotificationClick.bind(this));
        }
        
        console.log('NotificationHandler initialized');
    },
    
    // Connect to socket for real-time notifications
    connectToSocket() {
        if (window.SocketClient) {
            // Listen for notification events
            SocketClient.on('notification', this.handleNewNotification.bind(this));
        }
    },
    
    // Update notification count
    updateCount(count) {
        if (!this.countElement || !this.unreadCountContainer) return;
        
        // Update count
        this.countElement.textContent = count;
        
        // Show/hide badge based on count
        if (count > 0) {
            this.unreadCountContainer.classList.remove('d-none');
        } else {
            this.unreadCountContainer.classList.add('d-none');
        }
    },
    
    // Handle new notification
    handleNewNotification(data) {
        // Increment count
        const currentCount = parseInt(this.countElement.textContent || '0', 10);
        this.updateCount(currentCount + 1);
        
        // Could also show desktop notification here if desired
        if (Notification.permission === 'granted') {
            const notification = new Notification('ABDRE Chat', {
                body: data.message || 'You have a new notification',
                icon: '/static/img/logo.png'
            });
            
            notification.onclick = () => {
                window.focus();
                notification.close();
            };
        }
    },
    
    // Handle notification button click
    handleNotificationClick() {
        // Reset notification count
        this.updateCount(0);
        
        // Here you would typically open a notification panel
        console.log('Notification button clicked');
    }
};

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        NotificationHandler.init();
    }, 500);
});

// Export for use in other modules
window.NotificationHandler = NotificationHandler; 