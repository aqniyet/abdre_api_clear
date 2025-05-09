"""
API Routes for ABDRE Chat Application
Defines URL routes for the REST API
"""

from flask import Blueprint, request, jsonify

from backend.controllers.chat_controller import chat_controller
from backend.controllers.user_controller import user_controller
from backend.controllers.auth_controller import auth_bp

# Create blueprint for API routes
api_routes = Blueprint('api_routes', __name__, url_prefix='/api')

# Auth routes
@api_routes.route('/auth/login', methods=['POST'])
def login():
    """
    Login route
    
    Returns:
        Response: Authentication status and tokens
    """
    return auth_bp.login()

@api_routes.route('/auth/logout', methods=['POST'])
def logout():
    """
    Logout route
    
    Returns:
        Response: Logout confirmation
    """
    return auth_bp.logout()

@api_routes.route('/auth/refresh', methods=['POST'])
def refresh_token():
    """
    Refresh token route
    
    Returns:
        Response: New access token
    """
    return auth_bp.refresh_token()

# User routes
@api_routes.route('/users/search', methods=['GET'])
def search_users():
    """
    Search users route
    
    Returns:
        Response: List of matching users
    """
    return user_controller.search_users()

@api_routes.route('/users/me', methods=['GET'])
def get_current_user():
    """
    Get current user route
    
    Returns:
        Response: Current user data
    """
    return user_controller.get_current_user()

# Chat routes
@api_routes.route('/chats', methods=['GET'])
def get_user_chats():
    """
    Get user chats route
    
    Returns:
        Response: List of user's chats
    """
    return chat_controller.get_user_chats()

@api_routes.route('/chats/<chat_id>', methods=['GET'])
def get_chat(chat_id):
    """
    Get chat route
    
    Args:
        chat_id (str): ID of the chat to retrieve
        
    Returns:
        Response: Chat data
    """
    return chat_controller.get_chat(chat_id)

@api_routes.route('/chats/<chat_id>/messages', methods=['GET'])
def get_chat_messages(chat_id):
    """
    Get chat messages route
    
    Args:
        chat_id (str): ID of the chat to get messages from
        
    Returns:
        Response: List of chat messages
    """
    return chat_controller.get_chat_messages(chat_id)

@api_routes.route('/chats/<chat_id>/messages', methods=['POST'])
def create_message(chat_id):
    """
    Create message route
    
    Args:
        chat_id (str): ID of the chat to create message in
        
    Returns:
        Response: Created message data
    """
    return chat_controller.create_message(chat_id)

@api_routes.route('/chats', methods=['POST'])
def create_chat():
    """
    Create chat route
    
    Returns:
        Response: Created chat data
    """
    return chat_controller.create_chat()

@api_routes.route('/chats/<chat_id>/read', methods=['POST'])
def mark_chat_read(chat_id):
    """
    Mark chat as read route
    
    Args:
        chat_id (str): ID of the chat to mark as read
        
    Returns:
        Response: Success confirmation
    """
    return chat_controller.mark_chat_read(chat_id)

# Chat invitations - New routes
@api_routes.route('/invitations', methods=['POST'])
def generate_invitation():
    """
    Generate a new chat invitation
    
    Returns:
        Response: Invitation details as JSON
    """
    return chat_controller.generate_invitation()

@api_routes.route('/invitations/<invitation_code>', methods=['GET'])
def get_invitation_info(invitation_code):
    """
    Get information about an invitation
    
    Args:
        invitation_code (str): The invitation code
        
    Returns:
        Response: Invitation details as JSON
    """
    return chat_controller.get_invitation_status(invitation_code)

@api_routes.route('/invitations/<invitation_code>/accept', methods=['POST'])
def accept_invitation(invitation_code):
    """
    Accept an invitation to join a chat
    
    Args:
        invitation_code (str): The invitation code
        
    Returns:
        Response: Success response or error
    """
    return chat_controller.accept_invitation(invitation_code)

# Register the blueprint with the app
def init_app(app):
    """
    Initialize API routes with Flask app
    
    Args:
        app: Flask application instance
    """
    app.register_blueprint(api_routes) 