"""
Chat Preview Service for ABDRE Chat Application
Handles generating preview data for chat listings
"""

import logging
from datetime import datetime
import re

logger = logging.getLogger(__name__)

class ChatPreviewService:
    """
    Service to provide preview data for chat listings
    Generates preview snippets, timestamps, and other display data
    """
    
    def __init__(self, chat_repository=None):
        """
        Initialize chat preview service
        
        Args:
            chat_repository: Repository for chat data access
        """
        self.chat_repository = chat_repository
    
    def enrich_chat_preview(self, chat, current_user_id):
        """
        Enrich a chat object with preview data for display in a list
        
        Args:
            chat (dict): Chat object to enrich
            current_user_id (str): ID of the current user
            
        Returns:
            dict: Enriched chat object
        """
        try:
            # Add preview data if not already present
            if not chat.get('preview'):
                chat['preview'] = self._generate_preview(chat)
                
            # Add participant info (other than current user)
            if not chat.get('other_participant') and chat.get('type') == 'private':
                chat['other_participant'] = self._get_other_participant(chat, current_user_id)
                
            # Add formatted time
            if chat.get('last_message') and chat.get('last_message').get('created_at'):
                chat['last_message']['time_formatted'] = self._format_time(chat['last_message']['created_at'])
                chat['last_message']['date_formatted'] = self._format_date(chat['last_message']['created_at'])
            
            return chat
        except Exception as e:
            logger.error(f"Error enriching chat preview: {str(e)}")
            return chat
    
    def _generate_preview(self, chat):
        """
        Generate preview data for a chat
        
        Args:
            chat (dict): Chat object to generate preview for
            
        Returns:
            dict: Preview data
        """
        last_message = chat.get('last_message', {})
        content = last_message.get('content', '')
        
        # Strip HTML if present
        content = re.sub(r'<[^>]+>', '', content)
        
        # Truncate message for preview
        preview_text = content[:60] + ('...' if len(content) > 60 else '')
        
        return {
            'text': preview_text or 'No messages yet',
            'timestamp': last_message.get('created_at', chat.get('created_at', '')),
            'sender_id': last_message.get('sender_id', '')
        }
    
    def _get_other_participant(self, chat, current_user_id):
        """
        Get information about the other participant in a private chat
        
        Args:
            chat (dict): Chat object
            current_user_id (str): ID of the current user
            
        Returns:
            dict: Other participant data
        """
        participants = chat.get('participants', [])
        
        # Find participant who is not the current user
        other_ids = [p for p in participants if p != current_user_id]
        if not other_ids:
            return None
            
        other_id = other_ids[0]
        
        # Get status if available
        status = 'offline'
        status_timestamp = None
        
        if chat.get('user_statuses') and chat['user_statuses'].get(other_id):
            status = chat['user_statuses'][other_id].get('status', 'offline')
            status_timestamp = chat['user_statuses'][other_id].get('updated_at')
        
        # Get user details (would normally come from a user service)
        # This is a simplified version that works with existing data
        user_data = {
            'user_id': other_id,
            'username': chat.get('participant_names', {}).get(other_id, 'User'),
            'display_name': chat.get('participant_display_names', {}).get(other_id),
            'status': status,
            'status_updated_at': status_timestamp
        }
        
        return user_data
    
    def _format_time(self, timestamp):
        """
        Format timestamp for display in chat list
        
        Args:
            timestamp (str): ISO timestamp
            
        Returns:
            str: Formatted time
        """
        try:
            dt = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
            now = datetime.now()
            
            # If today, show time only
            if dt.date() == now.date():
                return dt.strftime('%H:%M')
                
            # If this year, show month and day
            if dt.year == now.year:
                return dt.strftime('%b %d')
                
            # Otherwise show date with year
            return dt.strftime('%b %d, %Y')
            
        except Exception as e:
            logger.error(f"Error formatting time: {str(e)}")
            return ''
    
    def _format_date(self, timestamp):
        """
        Format date for display in chat list
        
        Args:
            timestamp (str): ISO timestamp
            
        Returns:
            str: Formatted date
        """
        try:
            dt = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
            now = datetime.now()
            
            # Calculate days difference
            days_diff = (now.date() - dt.date()).days
            
            if days_diff == 0:
                return 'Today'
            elif days_diff == 1:
                return 'Yesterday'
            elif days_diff < 7:
                return dt.strftime('%A')  # Day name
            elif dt.year == now.year:
                return dt.strftime('%b %d')  # Month day
            else:
                return dt.strftime('%b %d, %Y')  # Month day, year
                
        except Exception as e:
            logger.error(f"Error formatting date: {str(e)}")
            return ''

# Singleton instance
chat_preview_service = ChatPreviewService() 