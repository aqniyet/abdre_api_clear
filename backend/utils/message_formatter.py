"""
Message Formatter Utility for ABDRE Chat Application
Handles server-side formatting of chat messages
"""

import html
import re
import json
from datetime import datetime
from flask import url_for

class MessageFormatter:
    """
    Formats chat messages for display
    Migrated from frontend/static/js/components/chat-message.js
    """
    
    @staticmethod
    def format_message(message, current_user_id):
        """
        Format a message for display
        
        Args:
            message (dict): The message to format
            current_user_id (str): ID of the current user
            
        Returns:
            dict: Formatted message
        """
        # Clone the message to avoid modifying the original
        formatted = message.copy()
        
        # Determine if message is from current user
        formatted['is_own'] = message.get('sender_id') == current_user_id
        
        # Format timestamp
        created_at = message.get('created_at')
        if created_at:
            if isinstance(created_at, str):
                try:
                    created_at = datetime.fromisoformat(created_at.replace('Z', '+00:00'))
                except (ValueError, TypeError):
                    try:
                        created_at = datetime.strptime(created_at, '%Y-%m-%dT%H:%M:%S.%fZ')
                    except (ValueError, TypeError):
                        created_at = datetime.utcnow()
            
            formatted['time_formatted'] = created_at.strftime('%H:%M')
            formatted['date_formatted'] = created_at.strftime('%Y-%m-%d')
            formatted['full_time_formatted'] = created_at.strftime('%Y-%m-%d %H:%M:%S')
            
            # Add relative time
            now = datetime.utcnow()
            diff = now - created_at
            seconds = diff.total_seconds()
            
            if seconds < 60:
                formatted['relative_time'] = "just now"
            elif seconds < 3600:
                minutes = int(seconds / 60)
                formatted['relative_time'] = f"{minutes}m ago"
            elif seconds < 86400:
                hours = int(seconds / 3600)
                formatted['relative_time'] = f"{hours}h ago"
            else:
                days = int(seconds / 86400)
                formatted['relative_time'] = f"{days}d ago"
        
        # Process content
        content = message.get('content', '')
        
        # Sanitize HTML
        content = html.escape(content)
        
        # Convert URLs to links
        url_pattern = r'(https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s]{2,}|www\.[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s]{2,}|https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9]+\.[^\s]{2,}|www\.[a-zA-Z0-9]+\.[^\s]{2,})'
        content = re.sub(url_pattern, r'<a href="\1" target="_blank" rel="noopener noreferrer">\1</a>', content)
        
        # Convert line breaks to <br>
        content = content.replace('\n', '<br>')
        
        formatted['content_formatted'] = content
        
        # Add CSS classes
        formatted['css_class'] = 'message-sent' if formatted['is_own'] else 'message-received'
        
        # Set message status
        if formatted['is_own']:
            status = message.get('status', 'sent')
            formatted['status'] = status
            formatted['status_class'] = f'status-{status}'
            formatted['status_icon'] = MessageFormatter._get_status_icon(status)
        
        return formatted
    
    @staticmethod
    def format_messages(messages, current_user_id):
        """
        Format multiple messages for display
        
        Args:
            messages (list): List of messages to format
            current_user_id (str): ID of the current user
            
        Returns:
            list: Formatted messages
        """
        return [MessageFormatter.format_message(message, current_user_id) 
                for message in messages]
    
    @staticmethod
    def _get_status_icon(status):
        """
        Get icon HTML for message status
        
        Args:
            status (str): Message status
            
        Returns:
            str: Icon HTML
        """
        if status == 'sending':
            return '<i class="fas fa-clock"></i>'
        elif status == 'sent':
            return '<i class="fas fa-check"></i>'
        elif status == 'delivered':
            return '<i class="fas fa-check-double"></i>'
        elif status == 'read':
            return '<i class="fas fa-check-double" style="color: #0d6efd;"></i>'
        elif status == 'failed':
            return '<i class="fas fa-exclamation-triangle"></i>'
        else:
            return ''
    
    @staticmethod
    def group_messages_by_date(messages):
        """
        Group messages by date for display
        
        Args:
            messages (list): List of formatted messages
            
        Returns:
            list: List of date groups, each containing messages
        """
        date_groups = {}
        
        for message in messages:
            date = message.get('date_formatted')
            if not date:
                date = 'Unknown Date'
            
            if date not in date_groups:
                date_groups[date] = []
            
            date_groups[date].append(message)
        
        # Convert to list of groups
        result = []
        for date, group_messages in date_groups.items():
            result.append({
                'date': date,
                'messages': group_messages
            })
        
        # Sort groups by date
        result.sort(key=lambda x: x['date'])
        
        return result
    
    @staticmethod
    def prepare_messages_for_template(messages, current_user_id):
        """
        Prepare messages for template rendering
        
        Args:
            messages (list): List of raw messages
            current_user_id (str): ID of the current user
            
        Returns:
            dict: Template context with messages
        """
        formatted_messages = MessageFormatter.format_messages(messages, current_user_id)
        date_groups = MessageFormatter.group_messages_by_date(formatted_messages)
        
        return {
            'message_groups': date_groups,
            'total_messages': len(formatted_messages),
            'messages_json': json.dumps(formatted_messages),
            'last_message_id': formatted_messages[-1]['message_id'] if formatted_messages else None,
            'oldest_message_id': formatted_messages[0]['message_id'] if formatted_messages else None
        } 