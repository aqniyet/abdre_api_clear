/**
 * Date formatting utilities for ABDRE Chat Application
 */

const DateFormatter = {
  /**
   * Format a timestamp to a readable time (HH:MM)
   * @param {string|number|Date} timestamp - Timestamp to format
   * @returns {string} - Formatted time string
   */
  formatTime(timestamp) {
    const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  },
  
  /**
   * Format a timestamp to a readable date (YYYY-MM-DD)
   * @param {string|number|Date} timestamp - Timestamp to format
   * @returns {string} - Formatted date string
   */
  formatDate(timestamp) {
    const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
    return date.toLocaleDateString();
  },
  
  /**
   * Format a timestamp to a readable date and time (YYYY-MM-DD HH:MM)
   * @param {string|number|Date} timestamp - Timestamp to format
   * @returns {string} - Formatted date and time string
   */
  formatDateTime(timestamp) {
    const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
    return `${this.formatDate(date)} ${this.formatTime(date)}`;
  },
  
  /**
   * Get a relative time string (e.g., "2 minutes ago", "yesterday")
   * @param {string|number|Date} timestamp - Timestamp to format
   * @returns {string} - Relative time string
   */
  getRelativeTime(timestamp) {
    const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
    const now = new Date();
    const diffInSeconds = Math.floor((now - date) / 1000);
    
    if (diffInSeconds < 60) {
      return 'just now';
    }
    
    const diffInMinutes = Math.floor(diffInSeconds / 60);
    if (diffInMinutes < 60) {
      return `${diffInMinutes} minute${diffInMinutes > 1 ? 's' : ''} ago`;
    }
    
    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) {
      return `${diffInHours} hour${diffInHours > 1 ? 's' : ''} ago`;
    }
    
    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays === 1) {
      return 'yesterday';
    }
    
    if (diffInDays < 7) {
      return `${diffInDays} days ago`;
    }
    
    return this.formatDate(date);
  }
}; 