"""
Chat Service for ABDRE Chat Application
Handles chat operations, message management, and chat status updates
"""

import logging
from datetime import datetime
import uuid
import json

from backend.repositories.chat_repository import ChatRepository
from backend.services.chat_preview_service import ChatPreviewService

logger = logging.getLogger(__name__)

class ChatService:
    """
    Service to handle chat operations including messages, chat status, and management
    """
    
    def __init__(self, chat_repository=None):
        """
        Initialize chat service with repository dependency
        
        Args:
            chat_repository: Repository for chat data access
        """
        self.chat_repository = chat_repository or ChatRepository()
        self.chat_preview_service = ChatPreviewService(self.chat_repository)
    
    def get_chat(self, chat_id):
        """
        Get chat details by ID
        
        Args:
            chat_id (str): Chat ID to retrieve
            
        Returns:
            dict: Chat details or None if not found
        """
        try:
            return self.chat_repository.get_chat(chat_id)
        except Exception as e:
            logger.error(f"Error getting chat {chat_id}: {str(e)}")
            return None
            
    def get_user_chats(self, user_id):
        """
        Get all chats for a specific user
        
        Args:
            user_id (str): User ID to get chats for
            
        Returns:
            list: List of chat objects
        """
        try:
            chats = self.chat_repository.get_chats_by_user(user_id)
            
            # Add preview data for each chat
            for chat in chats:
                self.chat_preview_service.enrich_chat_preview(chat, user_id)
                
            return chats
        except Exception as e:
            logger.error(f"Error getting chats for user {user_id}: {str(e)}")
            return []
    
    def get_chat_messages(self, chat_id, limit=50, before_id=None):
        """
        Get messages for a specific chat
        
        Args:
            chat_id (str): Chat ID to get messages for
            limit (int): Maximum number of messages to retrieve
            before_id (str): Get messages before this message ID (for pagination)
            
        Returns:
            list: List of message objects
        """
        try:
            return self.chat_repository.get_messages(chat_id, limit, before_id)
        except Exception as e:
            logger.error(f"Error getting messages for chat {chat_id}: {str(e)}")
            return []
    
    def create_message(self, chat_id, user_id, content, message_id=None):
        """
        Create a new message in a chat
        
        Args:
            chat_id (str): Chat ID to add message to
            user_id (str): User ID of message sender
            content (str): Message content
            message_id (str): Optional predefined message ID
            
        Returns:
            dict: Created message object or None if failed
        """
        try:
            # Generate a message ID if not provided
            if not message_id:
                message_id = f"msg_{uuid.uuid4()}"
                
            # Create message object
            message = {
                'message_id': message_id,
                'chat_id': chat_id,
                'sender_id': user_id,
                'content': content,
                'created_at': datetime.utcnow().isoformat(),
                'status': 'sent',
                'message_type': 'text'
            }
            
            # Save to repository
            result = self.chat_repository.add_message(chat_id, message)
            
            if result:
                # Update chat with last message info
                self.chat_repository.update_chat_last_message(chat_id, message)
                
                # Mark as unread for other participants
                self.mark_chat_unread_for_others(chat_id, user_id)
                
                return message
            return None
            
        except Exception as e:
            logger.error(f"Error creating message in chat {chat_id}: {str(e)}")
            return None
    
    def create_chat(self, creator_id, participants=None, name=None):
        """
        Create a new chat
        
        Args:
            creator_id (str): User ID of chat creator
            participants (list): List of participant user IDs
            name (str): Optional chat name
            
        Returns:
            dict: Created chat object or None if failed
        """
        try:
            # Ensure creator is in participants
            if not participants:
                participants = [creator_id]
            elif creator_id not in participants:
                participants.append(creator_id)
                
            # Generate chat ID
            chat_id = f"chat_{uuid.uuid4()}"
            
            # Create chat object
            chat = {
                'chat_id': chat_id,
                'created_at': datetime.utcnow().isoformat(),
                'created_by': creator_id,
                'name': name,
                'participants': participants,
                'type': 'private' if len(participants) <= 2 else 'group'
            }
            
            # Save to repository
            result = self.chat_repository.create_chat(chat)
            
            return chat if result else None
            
        except Exception as e:
            logger.error(f"Error creating chat: {str(e)}")
            return None
    
    def mark_chat_unread_for_others(self, chat_id, current_user_id):
        """
        Mark chat as unread for all participants except the current user
        
        Args:
            chat_id (str): Chat ID to mark
            current_user_id (str): User ID who should not get unread marker
            
        Returns:
            bool: Success or failure
        """
        try:
            chat = self.chat_repository.get_chat(chat_id)
            if not chat:
                return False
                
            for participant_id in chat.get('participants', []):
                if participant_id != current_user_id:
                    self.chat_repository.mark_chat_unread(chat_id, participant_id)
                    
            return True
            
        except Exception as e:
            logger.error(f"Error marking chat {chat_id} as unread: {str(e)}")
            return False
    
    def mark_chat_read(self, chat_id, user_id):
        """
        Mark chat as read for a user
        
        Args:
            chat_id (str): Chat ID to mark
            user_id (str): User ID marking chat as read
            
        Returns:
            bool: Success or failure
        """
        try:
            return self.chat_repository.mark_chat_read(chat_id, user_id)
        except Exception as e:
            logger.error(f"Error marking chat {chat_id} as read: {str(e)}")
            return False
    
    def update_user_status(self, chat_id, user_id, status):
        """
        Update user status in a chat
        
        Args:
            chat_id (str): Chat ID to update status in
            user_id (str): User ID to update status for
            status (str): New status ('online', 'offline', 'away')
            
        Returns:
            bool: Success or failure
        """
        try:
            # Update status in repository
            return self.chat_repository.update_user_status(chat_id, user_id, status)
        except Exception as e:
            logger.error(f"Error updating status for user {user_id} in chat {chat_id}: {str(e)}")
            return False

# Singleton instance
chat_service = ChatService() 