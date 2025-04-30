/**
 * Chat Message Component for ABDRE Chat Application
 */

const ChatMessage = {
  /**
   * Create a new chat message element
   * @param {Object} message - Message data
   * @param {string} currentUserId - Current user ID
   * @returns {HTMLElement} - Message element
   */
  create(message, currentUserId) {
    const messageDiv = document.createElement('div');
    const isSentByUser = message.sender_id === currentUserId;
    
    messageDiv.className = `message ${isSentByUser ? 'message-sent' : 'message-received'}`;
    
    // Format the date/time
    const formattedTime = DateFormatter.formatTime(message.created_at || new Date());
    
    messageDiv.innerHTML = `
      <div class="message-content">${this.sanitizeHTML(message.content)}</div>
      <div class="message-time">${formattedTime}</div>
    `;
    
    return messageDiv;
  },
  
  /**
   * Sanitize HTML to prevent XSS attacks
   * @param {string} html - HTML to sanitize
   * @returns {string} - Sanitized HTML
   */
  sanitizeHTML(html) {
    const temp = document.createElement('div');
    temp.textContent = html;
    return temp.innerHTML;
  },
  
  /**
   * Add a message to a container
   * @param {HTMLElement} container - Container element
   * @param {Object} message - Message data
   * @param {string} currentUserId - Current user ID
   * @param {boolean} prepend - Whether to prepend the message
   * @returns {HTMLElement} - Added message element
   */
  addToContainer(container, message, currentUserId, prepend = false) {
    const messageElement = this.create(message, currentUserId);
    
    if (prepend && container.firstChild) {
      container.insertBefore(messageElement, container.firstChild);
    } else {
      container.appendChild(messageElement);
    }
    
    // Scroll to bottom if the message is appended and from the current user
    if (!prepend && message.sender_id === currentUserId) {
      this.scrollToBottom(container);
    }
    
    return messageElement;
  },
  
  /**
   * Scroll a container to the bottom
   * @param {HTMLElement} container - Container element
   */
  scrollToBottom(container) {
    container.scrollTop = container.scrollHeight;
  },
  
  /**
   * Render messages in a container
   * @param {HTMLElement} container - Container element
   * @param {Array} messages - Array of message data
   * @param {string} currentUserId - Current user ID
   * @param {boolean} clearContainer - Whether to clear the container before rendering
   */
  renderMessages(container, messages, currentUserId, clearContainer = true) {
    if (clearContainer) {
      container.innerHTML = '';
    }
    
    messages.forEach(message => {
      this.addToContainer(container, message, currentUserId);
    });
    
    this.scrollToBottom(container);
  }
}; 