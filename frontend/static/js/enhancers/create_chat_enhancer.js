/**
 * ABDRE Chat - Create Chat Enhancer
 * 
 * Enhances the create chat page with user search functionality,
 * participant selection, and form submission handling.
 */

// Ensure ABDRE namespace exists
window.ABDRE = window.ABDRE || {};
window.ABDRE.Enhancers = window.ABDRE.Enhancers || {};

// Create Chat Enhancer
ABDRE.Enhancers.CreateChat = (function() {
    // DOM elements
    let _form = null;
    let _chatNameInput = null;
    let _chatDescriptionInput = null;
    let _chatTypeInputs = null;
    let _userSearchInput = null;
    let _userSearchButton = null;
    let _searchResultsContainer = null;
    let _selectedUsersContainer = null;
    let _cancelButton = null;
    let _createButton = null;
    
    // State
    let _selectedUsers = new Map(); // userId -> user object
    let _searchTimeout = null;
    let _isSubmitting = false;
    
    // Private methods
    function _debounceSearch(callback, delay) {
        if (_searchTimeout) {
            clearTimeout(_searchTimeout);
        }
        _searchTimeout = setTimeout(callback, delay);
    }
    
    function _renderSearchResults(results) {
        if (!_searchResultsContainer) return;
        
        // Clear previous results
        _searchResultsContainer.innerHTML = '';
        
        if (!results || results.length === 0) {
            const emptyState = document.createElement('div');
            emptyState.className = 'empty-state';
            emptyState.textContent = 'No users found';
            _searchResultsContainer.appendChild(emptyState);
            return;
        }
        
        // Create result items
        results.forEach(user => {
            // Skip already selected users
            if (_selectedUsers.has(user.id)) {
                return;
            }
            
            const userItem = document.createElement('div');
            userItem.className = 'user-item';
            userItem.dataset.userId = user.id;
            
            const avatar = document.createElement('div');
            avatar.className = 'user-avatar';
            avatar.textContent = user.display_name.substring(0, 2).toUpperCase();
            
            const info = document.createElement('div');
            info.className = 'user-info';
            
            const name = document.createElement('div');
            name.className = 'user-name';
            name.textContent = user.display_name;
            
            const addBtn = document.createElement('button');
            addBtn.className = 'btn btn-sm btn-outline';
            addBtn.type = 'button';
            addBtn.textContent = 'Add';
            addBtn.addEventListener('click', () => _addUser(user));
            
            info.appendChild(name);
            userItem.appendChild(avatar);
            userItem.appendChild(info);
            userItem.appendChild(addBtn);
            
            _searchResultsContainer.appendChild(userItem);
        });
    }
    
    function _renderSelectedUsers() {
        if (!_selectedUsersContainer) return;
        
        // Clear content
        _selectedUsersContainer.innerHTML = '';
        
        if (_selectedUsers.size === 0) {
            const emptyState = document.createElement('div');
            emptyState.className = 'empty-state';
            emptyState.textContent = 'No participants selected';
            _selectedUsersContainer.appendChild(emptyState);
            return;
        }
        
        // Create selected user chips
        _selectedUsers.forEach(user => {
            const userChip = document.createElement('div');
            userChip.className = 'user-chip';
            userChip.dataset.userId = user.id;
            
            const chipText = document.createElement('span');
            chipText.className = 'user-chip-text';
            chipText.textContent = user.display_name;
            
            const removeBtn = document.createElement('button');
            removeBtn.className = 'user-chip-remove';
            removeBtn.type = 'button';
            removeBtn.innerHTML = '&times;';
            removeBtn.addEventListener('click', () => _removeUser(user.id));
            
            userChip.appendChild(chipText);
            userChip.appendChild(removeBtn);
            
            _selectedUsersContainer.appendChild(userChip);
        });
    }
    
    function _addUser(user) {
        _selectedUsers.set(user.id, user);
        _renderSelectedUsers();
        
        // Clear search results
        _searchResultsContainer.innerHTML = '';
        _userSearchInput.value = '';
    }
    
    function _removeUser(userId) {
        _selectedUsers.delete(userId);
        _renderSelectedUsers();
    }
    
    function _performSearch() {
        const searchTerm = _userSearchInput.value.trim();
        
        if (searchTerm.length < 2) {
            _searchResultsContainer.innerHTML = '';
            return;
        }
        
        // Show loading state
        _searchResultsContainer.innerHTML = '<div class="loading-indicator">Searching...</div>';
        
        // Call API to search for users
        if (ABDRE.ApiService) {
            ABDRE.ApiService.searchUsers(searchTerm)
                .then(results => {
                    _renderSearchResults(results);
                })
                .catch(error => {
                    console.error('Error searching users:', error);
                    _searchResultsContainer.innerHTML = '<div class="error-message">Failed to search users</div>';
                });
        }
    }
    
    function _showToast(message, type = 'info') {
        const toastContainer = document.getElementById('toast-container');
        if (!toastContainer) return;
        
        const toast = document.createElement('div');
        toast.className = `toast toast--${type}`;
        toast.textContent = message;
        
        toastContainer.appendChild(toast);
        
        // Auto remove after 3 seconds
        setTimeout(() => {
            toast.classList.add('toast--fade-out');
            setTimeout(() => {
                toastContainer.removeChild(toast);
            }, 300);
        }, 3000);
    }
    
    function _handleFormSubmit(event) {
        event.preventDefault();
        
        if (_isSubmitting) return;
        
        const chatName = _chatNameInput.value.trim();
        if (!chatName) {
            _showToast('Please enter a chat name', 'error');
            _chatNameInput.focus();
            return;
        }
        
        // Get selected chat type
        let chatType = 'private';
        _chatTypeInputs.forEach(input => {
            if (input.checked) {
                chatType = input.value;
            }
        });
        
        // Prepare participant ids
        const participantIds = Array.from(_selectedUsers.keys());
        
        if (participantIds.length === 0) {
            _showToast('Please add at least one participant', 'error');
            _userSearchInput.focus();
            return;
        }
        
        // Prepare data for API call
        const chatData = {
            name: chatName,
            description: _chatDescriptionInput.value.trim(),
            type: chatType,
            participants: participantIds
        };
        
        _isSubmitting = true;
        _createButton.disabled = true;
        _createButton.textContent = 'Creating...';
        
        // Call API to create chat
        if (ABDRE.ApiService) {
            ABDRE.ApiService.createChat(chatData)
                .then(result => {
                    // Navigate to the new chat
                    window.location.href = `/chat/${result.chat_id}`;
                })
                .catch(error => {
                    console.error('Error creating chat:', error);
                    _showToast('Failed to create chat: ' + (error.message || 'Unknown error'), 'error');
                    _isSubmitting = false;
                    _createButton.disabled = false;
                    _createButton.textContent = 'Create Chat';
                });
        }
    }
    
    function _setupEventListeners() {
        if (_userSearchInput) {
            _userSearchInput.addEventListener('input', () => {
                _debounceSearch(_performSearch, 300);
            });
            
            // Clear results when input loses focus
            _userSearchInput.addEventListener('blur', () => {
                // Delay to allow clicking on search results
                setTimeout(() => {
                    _searchResultsContainer.innerHTML = '';
                }, 200);
            });
        }
        
        if (_userSearchButton) {
            _userSearchButton.addEventListener('click', _performSearch);
        }
        
        if (_form) {
            _form.addEventListener('submit', _handleFormSubmit);
        }
        
        if (_cancelButton) {
            _cancelButton.addEventListener('click', () => {
                window.location.href = '/chats';
            });
        }
    }
    
    // Public API
    return {
        init: function(options = {}) {
            // Get DOM elements
            _form = document.getElementById('create-chat-form');
            _chatNameInput = document.getElementById('chat-name');
            _chatDescriptionInput = document.getElementById('chat-description');
            _chatTypeInputs = document.querySelectorAll('input[name="chat-type"]');
            _userSearchInput = document.getElementById('user-search');
            _userSearchButton = document.getElementById('user-search-btn');
            _searchResultsContainer = document.getElementById('search-results');
            _selectedUsersContainer = document.getElementById('selected-users');
            _cancelButton = document.getElementById('cancel-btn');
            _createButton = document.getElementById('create-btn');
            
            // Setup event listeners
            _setupEventListeners();
            
            console.log('Create chat enhancer initialized');
            
            return this;
        },
        
        getSelectedUsers: function() {
            return Array.from(_selectedUsers.values());
        },
        
        addUser: function(user) {
            _addUser(user);
            return this;
        },
        
        removeUser: function(userId) {
            _removeUser(userId);
            return this;
        }
    };
})(); 