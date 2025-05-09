/**
 * ABDRE Chat - Chat Subscriber
 * 
 * Subscribes to realtime chat events and dispatches them to the appropriate UI components.
 * Handles new messages, typing indicators, read receipts, and other chat-related events.
 */

// Ensure ABDRE namespace exists
window.ABDRE = window.ABDRE || {};
window.ABDRE.Subscribers = window.ABDRE.Subscribers || {};

// Chat Subscriber Module
ABDRE.Subscribers.Chat = (function() {
    // Private variables
    let _initialized = false;
    let _subscriptions = [];
    let _currentChatId = null;
    let _activeChats = new Set();
    
    // Private methods
    function _handleNewMessage(message) {
        console.log('New chat message received:', message);
        
        // Dispatch to appropriate handlers based on current view
        if (ABDRE.ChatView && message.chat_id === _currentChatId) {
            // We're currently viewing this chat, so add message to the view
            ABDRE.ChatView.addMessage(message);
        } else {
            // We're not viewing this chat, so update unread count
            if (ABDRE.ChatListView) {
                ABDRE.ChatListView.incrementUnreadCount(message.chat_id);
            }
            
            // Show notification
            if (ABDRE.NotificationHandler) {
                ABDRE.NotificationHandler.showMessageNotification(message);
            }
        }
        
        // Update chat in the list (to show latest message and move to top)
        if (ABDRE.ChatListView) {
            ABDRE.ChatListView.updateChat(message.chat_id, {
                last_message: message.content,
                last_message_time: message.timestamp,
                last_message_sender: message.sender_id
            });
        }
        
        // Publish local event for other components
        if (ABDRE.EventBus) {
            ABDRE.EventBus.publish('chat:new_message', message);
        }
    }
    
    function _handleTypingIndicator(data) {
        console.log('Typing indicator received:', data);
        
        // Only show typing indicator if we're viewing this chat
        if (data.chat_id === _currentChatId && ABDRE.ChatView) {
            if (data.is_typing) {
                ABDRE.ChatView.showTypingIndicator(data.user_id, data.display_name);
            } else {
                ABDRE.ChatView.hideTypingIndicator(data.user_id);
            }
        }
    }
    
    function _handleReadReceipt(data) {
        console.log('Read receipt received:', data);
        
        // Update read receipts in chat view
        if (ABDRE.ChatView && data.chat_id === _currentChatId) {
            ABDRE.ChatView.updateReadReceipts(data.user_id, data.read_up_to);
        }
    }
    
    function _handleChatCreated(data) {
        console.log('New chat created:', data);
        
        // Add chat to list
        if (ABDRE.ChatListView) {
            ABDRE.ChatListView.addChat(data.chat);
        }
        
        // Update active chats
        _activeChats.add(data.chat.id);
        
        // Publish local event
        if (ABDRE.EventBus) {
            ABDRE.EventBus.publish('chat:chat_created', data.chat);
        }
    }
    
    function _handleChatUpdated(data) {
        console.log('Chat updated:', data);
        
        // Update chat in list
        if (ABDRE.ChatListView) {
            ABDRE.ChatListView.updateChat(data.chat_id, data.updates);
        }
        
        // Update current chat view if needed
        if (ABDRE.ChatView && data.chat_id === _currentChatId) {
            ABDRE.ChatView.updateChatInfo(data.updates);
        }
    }
    
    function _handleUserJoinedChat(data) {
        console.log('User joined chat:', data);
        
        // Update participants in chat view
        if (ABDRE.ChatView && data.chat_id === _currentChatId) {
            ABDRE.ChatView.addParticipant(data.user);
        }
        
        // Show system message
        const systemMessage = {
            type: 'system',
            chat_id: data.chat_id,
            content: `${data.user.display_name} joined the chat`,
            timestamp: new Date().toISOString()
        };
        
        _handleNewMessage(systemMessage);
    }
    
    function _handleUserLeftChat(data) {
        console.log('User left chat:', data);
        
        // Update participants in chat view
        if (ABDRE.ChatView && data.chat_id === _currentChatId) {
            ABDRE.ChatView.removeParticipant(data.user_id);
        }
        
        // Show system message
        const systemMessage = {
            type: 'system',
            chat_id: data.chat_id,
            content: `${data.display_name || 'A user'} left the chat`,
            timestamp: new Date().toISOString()
        };
        
        _handleNewMessage(systemMessage);
    }
    
    function _handleChatDeleted(data) {
        console.log('Chat deleted:', data);
        
        // Remove chat from list
        if (ABDRE.ChatListView) {
            ABDRE.ChatListView.removeChat(data.chat_id);
        }
        
        // Update active chats
        _activeChats.delete(data.chat_id);
        
        // If currently viewing this chat, redirect to chat list
        if (data.chat_id === _currentChatId) {
            window.location.href = '/chats';
        }
    }
    
    function _setupSubscriptions() {
        if (!ABDRE.EventBus || !ABDRE.RealtimeService) {
            console.error('EventBus or RealtimeService not available');
            return;
        }
        
        // Clean up any existing subscriptions
        _cleanupSubscriptions();
        
        // Subscribe to messages from the realtime service
        _subscriptions.push(
            ABDRE.EventBus.subscribe(ABDRE.RealtimeService.EVENTS.MESSAGE_RECEIVED, (message) => {
                // Process messages based on their type
                switch (message.type) {
                    case 'chat_message':
                        _handleNewMessage(message);
                        break;
                        
                    case 'typing_indicator':
                        _handleTypingIndicator(message);
                        break;
                        
                    case 'read_receipt':
                        _handleReadReceipt(message);
                        break;
                        
                    case 'chat_created':
                        _handleChatCreated(message);
                        break;
                        
                    case 'chat_updated':
                        _handleChatUpdated(message);
                        break;
                        
                    case 'user_joined_chat':
                        _handleUserJoinedChat(message);
                        break;
                        
                    case 'user_left_chat':
                        _handleUserLeftChat(message);
                        break;
                        
                    case 'chat_deleted':
                        _handleChatDeleted(message);
                        break;
                }
            })
        );
        
        // Subscribe to page-specific events
        _subscriptions.push(
            ABDRE.EventBus.subscribe('page:chat_opened', (data) => {
                _currentChatId = data.chatId;
                
                // Join chat room via websocket
                if (ABDRE.RealtimeService) {
                    ABDRE.RealtimeService.sendMessage({
                        type: 'join_chat',
                        chat_id: data.chatId
                    });
                }
            })
        );
        
        _subscriptions.push(
            ABDRE.EventBus.subscribe('page:chat_closed', (data) => {
                // Leave chat room via websocket
                if (_currentChatId && ABDRE.RealtimeService) {
                    ABDRE.RealtimeService.sendMessage({
                        type: 'leave_chat',
                        chat_id: _currentChatId
                    });
                }
                
                _currentChatId = null;
            })
        );
    }
    
    function _cleanupSubscriptions() {
        // Unsubscribe from all events
        _subscriptions.forEach(subscription => {
            if (subscription && typeof subscription.unsubscribe === 'function') {
                subscription.unsubscribe();
            }
        });
        
        _subscriptions = [];
    }
    
    // Public API
    return {
        init: function() {
            // Check if already initialized
            if (_initialized) {
                console.warn('Chat subscriber already initialized');
                return;
            }
            
            // Defer setup to ensure required dependencies are available
            setTimeout(() => {
                // Check for required dependencies
                if (!ABDRE.EventBus) {
                    console.error('Chat subscriber initialization failed: EventBus not available');
                    return;
                }
                
                if (!ABDRE.RealtimeService) {
                    console.error('Chat subscriber initialization failed: RealtimeService not available');
                    return;
                }
                
                // Set up event subscriptions
                _setupSubscriptions();
                
                _initialized = true;
                console.log('Chat subscriber initialized');
                
                // Publish initialization event
                ABDRE.EventBus.publish('chat:subscriber_ready');
            }, 0);
        },
        
        setCurrentChat: function(chatId) {
            if (chatId && typeof chatId === 'string') {
                _currentChatId = chatId;
                _activeChats.add(chatId);
                
                // Notify about chat being active
                if (ABDRE.RealtimeService && ABDRE.RealtimeService.getState() === ABDRE.RealtimeService.STATES.CONNECTED) {
                    ABDRE.RealtimeService.sendMessage({
                        type: 'join_chat',
                        chat_id: chatId
                    });
                }
            }
        },
        
        getCurrentChat: function() {
            return _currentChatId;
        },
        
        destroy: function() {
            _cleanupSubscriptions();
            _initialized = false;
            return null;
        }
    };
})(); 