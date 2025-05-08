"""
Chat Controller for ABDRE Chat Application
Handles web requests related to chat functionality
"""

import logging
import json
import uuid
import time
from flask import request, jsonify, g, Response, abort, Blueprint

from backend.services.chat_service import chat_service
from backend.utils.message_formatter import MessageFormatter

logger = logging.getLogger(__name__)

# Create a blueprint for chat routes
chat_bp = Blueprint('chat', __name__, url_prefix='/api/chats')

class ChatController:
    """Controller to handle chat-related routes and logic"""
    
    def __init__(self, app=None):
        """Initialize chat controller with Flask app"""
        self.app = app
        if app:
            self.init_app(app)
    
    def init_app(self, app):
        """Initialize with Flask app if not provided in constructor"""
        self.app = app
        
        # Register routes
        self._register_routes()
    
    def _register_routes(self):
        """Register chat routes with the app"""
        self.app.add_url_rule('/api/chats', 'get_user_chats', self.get_user_chats, methods=['GET'])
        self.app.add_url_rule('/api/chats/<chat_id>', 'get_chat', self.get_chat, methods=['GET'])
        self.app.add_url_rule('/api/chats/<chat_id>/messages', 'get_chat_messages', self.get_chat_messages, methods=['GET'])
        self.app.add_url_rule('/api/chats/<chat_id>/messages', 'create_message', self.create_message, methods=['POST'])
        self.app.add_url_rule('/api/chats', 'create_chat', self.create_chat, methods=['POST'])
        self.app.add_url_rule('/api/chats/<chat_id>/read', 'mark_chat_read', self.mark_chat_read, methods=['POST'])
        self.app.add_url_rule('/api/chats/generate-invitation', 'generate_invitation', self.generate_invitation, methods=['POST'])
        self.app.add_url_rule('/api/chats/invitation-status/<token>', 'get_invitation_status', self.get_invitation_status, methods=['GET'])
        self.app.add_url_rule('/api/chats/accept-invitation/<token>', 'accept_invitation', self.accept_invitation, methods=['POST'])
    
    def get_user_chats(self):
        """Get all chats for current authenticated user"""
        if not g.user:
            return jsonify({'error': 'Unauthorized'}), 401
        
        try:
            user_id = g.user.get('user_id')
            chats = chat_service.get_user_chats(user_id)
            
            return jsonify({
                'status': 'success',
                'chats': chats
            })
        except Exception as e:
            logger.exception(f"Error in get_user_chats: {str(e)}")
            return jsonify({'error': 'Failed to retrieve chats'}), 500
    
    def get_chat(self, chat_id):
        """Get details for a specific chat"""
        if not g.user:
            return jsonify({'error': 'Unauthorized'}), 401
        
        try:
            user_id = g.user.get('user_id')
            chat = chat_service.get_chat(chat_id)
            
            if not chat:
                return jsonify({'error': 'Chat not found'}), 404
            
            # Check if user is participant
            if user_id not in chat.get('participants', []):
                return jsonify({'error': 'Unauthorized access to chat'}), 403
            
            return jsonify(chat)
        except Exception as e:
            logger.exception(f"Error in get_chat: {str(e)}")
            return jsonify({'error': 'Failed to retrieve chat'}), 500
    
    def get_chat_messages(self, chat_id):
        """Get messages for a specific chat"""
        if not g.user:
            return jsonify({'error': 'Unauthorized'}), 401
        
        try:
            user_id = g.user.get('user_id')
            
            # Check access permissions
            chat = chat_service.get_chat(chat_id)
            if not chat or user_id not in chat.get('participants', []):
                return jsonify({'error': 'Unauthorized access to chat'}), 403
            
            # Get pagination params
            limit = request.args.get('limit', 50, type=int)
            before_id = request.args.get('before_id')
            
            # Get messages
            messages = chat_service.get_chat_messages(chat_id, limit, before_id)
            
            # Format messages for display if needed
            formatted_messages = MessageFormatter.format_messages(messages, user_id)
            
            # Mark chat as read for this user
            chat_service.mark_chat_read(chat_id, user_id)
            
            return jsonify({
                'status': 'success',
                'messages': formatted_messages
            })
        except Exception as e:
            logger.exception(f"Error in get_chat_messages: {str(e)}")
            return jsonify({'error': 'Failed to retrieve messages'}), 500
    
    def create_message(self, chat_id):
        """Create a new message in a chat"""
        if not g.user:
            return jsonify({'error': 'Unauthorized'}), 401
        
        try:
            user_id = g.user.get('user_id')
            
            # Check access permissions
            chat = chat_service.get_chat(chat_id)
            if not chat or user_id not in chat.get('participants', []):
                return jsonify({'error': 'Unauthorized access to chat'}), 403
            
            # Get message content from request
            data = request.get_json()
            if not data or 'content' not in data:
                return jsonify({'error': 'Message content is required'}), 400
            
            content = data.get('content')
            message_id = data.get('message_id')  # Optional client-generated ID
            
            # Create message
            message = chat_service.create_message(chat_id, user_id, content, message_id)
            
            if not message:
                return jsonify({'error': 'Failed to create message'}), 500
            
            # Return formatted message
            formatted_message = MessageFormatter.format_message(message, user_id)
            
            return jsonify({
                'status': 'success',
                'message': formatted_message
            })
        except Exception as e:
            logger.exception(f"Error in create_message: {str(e)}")
            return jsonify({'error': 'Failed to create message'}), 500
    
    def create_chat(self):
        """Create a new chat"""
        if not g.user:
            return jsonify({'error': 'Unauthorized'}), 401
        
        try:
            user_id = g.user.get('user_id')
            
            # Get data from request
            data = request.get_json()
            if not data:
                return jsonify({'error': 'Invalid request data'}), 400
            
            participants = data.get('participants', [])
            if not participants:
                return jsonify({'error': 'At least one participant is required'}), 400
            
            # Ensure creator is in participants
            if user_id not in participants:
                participants.append(user_id)
            
            name = data.get('name')
            
            # Create chat
            chat = chat_service.create_chat(user_id, participants, name)
            
            if not chat:
                return jsonify({'error': 'Failed to create chat'}), 500
            
            return jsonify({
                'status': 'success',
                'chat': chat
            })
        except Exception as e:
            logger.exception(f"Error in create_chat: {str(e)}")
            return jsonify({'error': 'Failed to create chat'}), 500
    
    def mark_chat_read(self, chat_id):
        """Mark a chat as read for current user"""
        if not g.user:
            return jsonify({'error': 'Unauthorized'}), 401
        
        try:
            user_id = g.user.get('user_id')
            
            # Check access permissions
            chat = chat_service.get_chat(chat_id)
            if not chat or user_id not in chat.get('participants', []):
                return jsonify({'error': 'Unauthorized access to chat'}), 403
            
            # Mark as read
            success = chat_service.mark_chat_read(chat_id, user_id)
            
            if not success:
                return jsonify({'error': 'Failed to mark chat as read'}), 500
            
            return jsonify({
                'status': 'success'
            })
        except Exception as e:
            logger.exception(f"Error in mark_chat_read: {str(e)}")
            return jsonify({'error': 'Failed to mark chat as read'}), 500

    def generate_invitation(self):
        """Generate a chat invitation token"""
        if not g.user:
            return jsonify({'error': 'Unauthorized'}), 401
        
        try:
            user_id = g.user.get('user_id')
            
            # Generate a unique token
            token = f"inv_{uuid.uuid4()}"
            
            # Create invitation data - in a real app, this would be stored
            invitation = {
                'token': token,
                'invitation_token': token,  # Add both fields for compatibility
                'created_by': user_id,
                'created_at': time.time(),
                'expires_at': time.time() + 86400,  # 24 hours
                'status': 'active'
            }
            
            return jsonify(invitation)
        except Exception as e:
            logger.exception(f"Error in generate_invitation: {str(e)}")
            return jsonify({'error': 'Failed to generate invitation'}), 500

    def get_invitation_status(self, token):
        """Get the status of a chat invitation"""
        # For this simplified implementation, we'll always return active
        invitation = {
            'token': token,
            'invitation_token': token,  # Add for consistency
            'status': 'active',
            'seconds_remaining': 86400,  # 24 hours
            'created_at': time.time() - 3600,  # 1 hour ago
            'scanned': False
        }
        
        return jsonify(invitation)

    def accept_invitation(self, token):
        """Accept a chat invitation"""
        if not g.user:
            return jsonify({'error': 'Unauthorized'}), 401
        
        try:
            user_id = g.user.get('user_id')
            
            # In a real implementation, we would:
            # 1. Validate the token
            # 2. Check if it's expired
            # 3. Create a chat with the guest and host
            # 4. Return the chat details
            
            # For this simplified implementation, we'll create a mock chat
            chat_id = f"chat_{uuid.uuid4()}"
            chat = {
                'chat_id': chat_id,
                'type': 'direct',
                'created_at': time.time(),
                'token': token,
                'invitation_token': token,  # Add both for consistency
                'participants': [user_id, 'host_user'],  # Host user would be retrieved from stored invitation
                'messages': []
            }
            
            return jsonify(chat)
        except Exception as e:
            logger.exception(f"Error in accept_invitation: {str(e)}")
            return jsonify({'error': 'Failed to accept invitation'}), 500

# Initialize controller
chat_controller = ChatController()

# Initialize blueprint in app
def init_app(app):
    """Initialize chat controller with app"""
    # Register blueprint
    app.register_blueprint(chat_bp)
    
    # Additional initialization if needed
    pass 