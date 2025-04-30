/**
 * Chat List Component for ABDRE Chat Application
 */

const ChatList = {
  /**
   * Create a new chat list item element
   * @param {Object} chat - Chat data
   * @returns {HTMLElement} - Chat list item element
   */
  createItem(chat) {
    const listItem = document.createElement('div');
    listItem.className = 'chat-list-item';
    listItem.dataset.chatId = chat.id;
    
    // Format the date/time
    const formattedTime = chat.last_message_time 
      ? DateFormatter.getRelativeTime(chat.last_message_time) 
      : 'No messages yet';
    
    // Get unread count badge if there are unread messages
    const unreadBadge = chat.unread_count > 0 
      ? `<span class="badge bg-primary">${chat.unread_count}</span>` 
      : '';
    
    // Get active status indicator
    const activeStatus = chat.is_active 
      ? '<span class="active-indicator"></span>' 
      : '';
    
    listItem.innerHTML = `
      <div class="chat-list-item-header">
        <h5 class="chat-title">${this.sanitizeHTML(chat.title || 'Unnamed Chat')}</h5>
        ${activeStatus}
      </div>
      <div class="chat-list-item-body">
        <p class="chat-preview">${this.sanitizeHTML(chat.last_message || 'No messages yet')}</p>
      </div>
      <div class="chat-list-item-footer">
        <span class="chat-time">${formattedTime}</span>
        ${unreadBadge}
      </div>
    `;
    
    // Add click handler
    listItem.addEventListener('click', () => {
      window.location.href = `/chat/${chat.id}`;
    });
    
    return listItem;
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
   * Render a list of chats in a container
   * @param {HTMLElement} container - Container element
   * @param {Array} chats - Array of chat data
   * @param {boolean} clearContainer - Whether to clear the container before rendering
   */
  renderList(container, chats, clearContainer = true) {
    if (clearContainer) {
      container.innerHTML = '';
    }
    
    if (chats.length === 0) {
      container.innerHTML = '<div class="no-chats">No chats available</div>';
      return;
    }
    
    chats.forEach(chat => {
      const chatElement = this.createItem(chat);
      container.appendChild(chatElement);
    });
  },
  
  /**
   * Update a specific chat in the list
   * @param {HTMLElement} container - Container element
   * @param {Object} updatedChat - Updated chat data
   */
  updateChat(container, updatedChat) {
    const existingChat = container.querySelector(`[data-chat-id="${updatedChat.id}"]`);
    
    if (existingChat) {
      const newChatElement = this.createItem(updatedChat);
      container.replaceChild(newChatElement, existingChat);
    } else {
      const newChatElement = this.createItem(updatedChat);
      container.appendChild(newChatElement);
    }
  },
  
  /**
   * Set active status for a chat
   * @param {HTMLElement} container - Container element
   * @param {string} chatId - Chat ID
   * @param {boolean} isActive - Whether the chat is active
   */
  setActiveStatus(container, chatId, isActive) {
    const chatElement = container.querySelector(`[data-chat-id="${chatId}"]`);
    
    if (chatElement) {
      const headerElement = chatElement.querySelector('.chat-list-item-header');
      let statusIndicator = chatElement.querySelector('.active-indicator');
      
      if (isActive) {
        if (!statusIndicator) {
          statusIndicator = document.createElement('span');
          statusIndicator.className = 'active-indicator';
          headerElement.appendChild(statusIndicator);
        }
      } else if (statusIndicator) {
        statusIndicator.remove();
      }
    }
  }
}; 