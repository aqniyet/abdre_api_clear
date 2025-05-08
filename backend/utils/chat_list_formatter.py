"""
Chat List Formatter Utility for ABDRE Chat Application
Handles server-side formatting of chat lists
"""

import html
import json
from datetime import datetime
from flask import url_for

class ChatListFormatter:
    """
    Formats chat lists for display
    Migrated from frontend/static/js/modules/my-chats-page.js
    """
    
    @staticmethod
    def format_chat(chat, current_user_id):
        """
        Format a chat for display in the chat list
        
        Args:
            chat (dict): The chat to format
            current_user_id (str): ID of the current user
            
        Returns:
            dict: Formatted chat
        """
        # Clone the chat to avoid modifying the original
        formatted = chat.copy()
        
        # Determine the other participant(s)
        participants = chat.get('participants', [])
        other_participants = [p for p in participants if p.get('user_id') != current_user_id]
        
        # Set display name based on other participants
        if other_participants:
            if len(other_participants) == 1:
                participant = other_participants[0]
                display_name = participant.get('display_name') or participant.get('username') or 'Unknown User'
                formatted['display_name'] = display_name
                formatted['participant'] = participant
            else:
                # Group chat
                names = [p.get('display_name') or p.get('username') or 'Unknown' for p in other_participants]
                formatted['display_name'] = f"Group: {', '.join(names[:2])}" + (", ..." if len(names) > 2 else "")
                formatted['participants_count'] = len(participants)
        else:
            formatted['display_name'] = 'Private Chat'
        
        # Format the last message time
        last_message = chat.get('last_message', {})
        if last_message:
            created_at = last_message.get('created_at')
            if created_at:
                if isinstance(created_at, str):
                    try:
                        created_at = datetime.fromisoformat(created_at.replace('Z', '+00:00'))
                    except (ValueError, TypeError):
                        try:
                            created_at = datetime.strptime(created_at, '%Y-%m-%dT%H:%M:%S.%fZ')
                        except (ValueError, TypeError):
                            created_at = None
                
                if created_at:
                    # Format for display
                    now = datetime.utcnow()
                    diff = now - created_at
                    seconds = diff.total_seconds()
                    
                    if seconds < 60:
                        formatted['last_message_time'] = "just now"
                    elif seconds < 3600:
                        minutes = int(seconds / 60)
                        formatted['last_message_time'] = f"{minutes}m ago"
                    elif seconds < 86400:
                        hours = int(seconds / 3600)
                        formatted['last_message_time'] = f"{hours}h ago"
                    elif seconds < 604800:  # Less than a week
                        days = int(seconds / 86400)
                        formatted['last_message_time'] = f"{days}d ago"
                    else:
                        formatted['last_message_time'] = created_at.strftime('%Y-%m-%d')
                        
                    formatted['last_message_full_time'] = created_at.strftime('%Y-%m-%d %H:%M:%S')
                    formatted['last_message_sort_time'] = created_at.timestamp()
        
        # Format last message preview
        if last_message:
            content = last_message.get('content', '')
            sender_id = last_message.get('sender_id')
            
            # Sanitize content
            content = html.escape(content)
            
            # Truncate if needed
            if len(content) > 50:
                content = content[:47] + "..."
                
            # Add sender prefix for group chats
            if len(other_participants) > 1 and sender_id:
                sender_name = "You" if sender_id == current_user_id else "Unknown"
                
                # Find sender in participants
                for p in participants:
                    if p.get('user_id') == sender_id:
                        sender_name = p.get('display_name') or p.get('username') or 'Unknown'
                        break
                
                content = f"{sender_name}: {content}"
                
            formatted['last_message_preview'] = content
            formatted['has_unread'] = last_message.get('is_unread', False)
        else:
            formatted['last_message_preview'] = 'No messages yet'
            formatted['has_unread'] = False
        
        # Generate URL to chat
        formatted['chat_url'] = f"/chat/{chat.get('chat_id')}"
        
        return formatted
    
    @staticmethod
    def format_chats(chats, current_user_id):
        """
        Format multiple chats for display
        
        Args:
            chats (list): List of chats to format
            current_user_id (str): ID of the current user
            
        Returns:
            list: Formatted chats
        """
        formatted = [ChatListFormatter.format_chat(chat, current_user_id) for chat in chats]
        
        # Sort by last message time, newest first
        formatted.sort(
            key=lambda x: x.get('last_message_sort_time', 0), 
            reverse=True
        )
        
        return formatted
    
    @staticmethod
    def prepare_chats_for_template(chats, current_user_id):
        """
        Prepare chats for template rendering
        
        Args:
            chats (list): List of raw chats
            current_user_id (str): ID of the current user
            
        Returns:
            dict: Template context with chats
        """
        formatted_chats = ChatListFormatter.format_chats(chats, current_user_id)
        
        # Group chats by unread status for rendering
        unread_chats = [chat for chat in formatted_chats if chat.get('has_unread')]
        read_chats = [chat for chat in formatted_chats if not chat.get('has_unread')]
        
        return {
            'chats': formatted_chats,
            'unread_chats': unread_chats,
            'read_chats': read_chats,
            'total_chats': len(formatted_chats),
            'unread_count': len(unread_chats),
            'chats_json': json.dumps(formatted_chats)
        } 