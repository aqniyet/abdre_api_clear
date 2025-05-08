"""
Chat Repository for ABDRE Chat Application
Handles data access for chat and message operations
"""

import logging
import json
from datetime import datetime
import uuid
import os

logger = logging.getLogger(__name__)

class ChatRepository:
    """
    Repository for chat data access operations
    Handles persistence and retrieval of chat and message data
    """
    
    def __init__(self, db_path=None):
        """
        Initialize chat repository with database connection
        
        Args:
            db_path (str): Optional path to database file
        """
        self.db_path = db_path or os.environ.get('CHAT_DB_PATH', 'chat_service/data/chats.json')
        self._db = None
        self._load_db()
    
    def _load_db(self):
        """Load database from file or initialize if not exists"""
        try:
            if os.path.exists(self.db_path):
                with open(self.db_path, 'r') as f:
                    self._db = json.load(f)
            else:
                # Initialize empty database
                self._db = {
                    'chats': {},
                    'messages': {},
                    'user_chats': {},
                    'read_status': {}
                }
                # Create directory if needed
                os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
                self._save_db()
                
            logger.info(f"Loaded chat database from {self.db_path}")
        except Exception as e:
            logger.error(f"Error loading chat database: {str(e)}")
            # Initialize empty database as fallback
            self._db = {
                'chats': {},
                'messages': {},
                'user_chats': {},
                'read_status': {}
            }
    
    def _save_db(self):
        """Save database to file"""
        try:
            with open(self.db_path, 'w') as f:
                json.dump(self._db, f, indent=2)
        except Exception as e:
            logger.error(f"Error saving chat database: {str(e)}")
    
    def get_chat(self, chat_id):
        """
        Get chat by ID
        
        Args:
            chat_id (str): Chat ID to retrieve
            
        Returns:
            dict: Chat object or None if not found
        """
        return self._db['chats'].get(chat_id)
    
    def get_chats_by_user(self, user_id):
        """
        Get all chats for a user
        
        Args:
            user_id (str): User ID to get chats for
            
        Returns:
            list: List of chat objects
        """
        # Get chat IDs for user
        chat_ids = self._db['user_chats'].get(user_id, [])
        
        # Get chat objects
        chats = []
        for chat_id in chat_ids:
            chat = self.get_chat(chat_id)
            if chat:
                # Add read status
                read_key = f"{chat_id}:{user_id}"
                chat['unread'] = not self._db['read_status'].get(read_key, True)
                chats.append(chat)
                
        return chats
    
    def create_chat(self, chat):
        """
        Create a new chat
        
        Args:
            chat (dict): Chat object to create
            
        Returns:
            bool: Success or failure
        """
        try:
            chat_id = chat['chat_id']
            
            # Add to chats
            self._db['chats'][chat_id] = chat
            
            # Update user_chats for each participant
            for user_id in chat.get('participants', []):
                if user_id not in self._db['user_chats']:
                    self._db['user_chats'][user_id] = []
                    
                if chat_id not in self._db['user_chats'][user_id]:
                    self._db['user_chats'][user_id].append(chat_id)
                    
                # Initialize messages collection
                if chat_id not in self._db['messages']:
                    self._db['messages'][chat_id] = []
                    
                # Mark as read for creator, unread for others
                read_key = f"{chat_id}:{user_id}"
                self._db['read_status'][read_key] = (user_id == chat.get('created_by'))
            
            # Save changes
            self._save_db()
            return True
            
        except Exception as e:
            logger.error(f"Error creating chat: {str(e)}")
            return False
    
    def add_message(self, chat_id, message):
        """
        Add a message to a chat
        
        Args:
            chat_id (str): Chat ID to add message to
            message (dict): Message object to add
            
        Returns:
            bool: Success or failure
        """
        try:
            # Create messages list for chat if needed
            if chat_id not in self._db['messages']:
                self._db['messages'][chat_id] = []
            
            # Add message
            self._db['messages'][chat_id].append(message)
            
            # Save changes
            self._save_db()
            return True
            
        except Exception as e:
            logger.error(f"Error adding message to chat {chat_id}: {str(e)}")
            return False
    
    def get_messages(self, chat_id, limit=50, before_id=None):
        """
        Get messages for a chat
        
        Args:
            chat_id (str): Chat ID to get messages for
            limit (int): Maximum number of messages to retrieve
            before_id (str): Get messages before this message ID (for pagination)
            
        Returns:
            list: List of message objects
        """
        try:
            # Get all messages for chat
            all_messages = self._db['messages'].get(chat_id, [])
            
            # Sort by created_at
            all_messages.sort(key=lambda m: m.get('created_at', ''), reverse=True)
            
            # Filter by before_id if specified
            if before_id:
                # Find index of message with before_id
                before_index = next((i for i, m in enumerate(all_messages) if m.get('message_id') == before_id), None)
                
                if before_index is not None:
                    # Get messages after this index
                    all_messages = all_messages[before_index + 1:]
            
            # Limit number of messages
            limited_messages = all_messages[:limit]
            
            # Return in chronological order
            return list(reversed(limited_messages))
            
        except Exception as e:
            logger.error(f"Error getting messages for chat {chat_id}: {str(e)}")
            return []
    
    def update_chat_last_message(self, chat_id, message):
        """
        Update a chat with information about the last message
        
        Args:
            chat_id (str): Chat ID to update
            message (dict): Last message object
            
        Returns:
            bool: Success or failure
        """
        try:
            chat = self.get_chat(chat_id)
            if not chat:
                return False
                
            # Update last message info
            chat['last_message'] = {
                'content': message.get('content', ''),
                'sender_id': message.get('sender_id', ''),
                'created_at': message.get('created_at', datetime.utcnow().isoformat())
            }
            
            # Update chat in DB
            self._db['chats'][chat_id] = chat
            
            # Save changes
            self._save_db()
            return True
            
        except Exception as e:
            logger.error(f"Error updating last message for chat {chat_id}: {str(e)}")
            return False
    
    def mark_chat_read(self, chat_id, user_id):
        """
        Mark a chat as read for a user
        
        Args:
            chat_id (str): Chat ID to mark
            user_id (str): User ID to mark chat as read for
            
        Returns:
            bool: Success or failure
        """
        try:
            read_key = f"{chat_id}:{user_id}"
            self._db['read_status'][read_key] = True
            
            # Save changes
            self._save_db()
            return True
            
        except Exception as e:
            logger.error(f"Error marking chat {chat_id} as read for user {user_id}: {str(e)}")
            return False
    
    def mark_chat_unread(self, chat_id, user_id):
        """
        Mark a chat as unread for a user
        
        Args:
            chat_id (str): Chat ID to mark
            user_id (str): User ID to mark chat as unread for
            
        Returns:
            bool: Success or failure
        """
        try:
            read_key = f"{chat_id}:{user_id}"
            self._db['read_status'][read_key] = False
            
            # Save changes
            self._save_db()
            return True
            
        except Exception as e:
            logger.error(f"Error marking chat {chat_id} as unread for user {user_id}: {str(e)}")
            return False
    
    def update_user_status(self, chat_id, user_id, status):
        """
        Update user status in a chat
        
        Args:
            chat_id (str): Chat ID to update
            user_id (str): User ID to update status for
            status (str): New status
            
        Returns:
            bool: Success or failure
        """
        try:
            chat = self.get_chat(chat_id)
            if not chat:
                return False
                
            # Update status if it exists already
            if 'user_statuses' not in chat:
                chat['user_statuses'] = {}
                
            chat['user_statuses'][user_id] = {
                'status': status,
                'updated_at': datetime.utcnow().isoformat()
            }
            
            # Update chat in DB
            self._db['chats'][chat_id] = chat
            
            # Save changes
            self._save_db()
            return True
            
        except Exception as e:
            logger.error(f"Error updating status for user {user_id} in chat {chat_id}: {str(e)}")
            return False 