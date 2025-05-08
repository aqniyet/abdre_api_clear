"""
User Controller for ABDRE Chat Application
Handles user-related API requests
"""

import logging
import uuid
import time
from flask import Blueprint, request, jsonify, g

logger = logging.getLogger(__name__)

# Create a blueprint for user routes
user_bp = Blueprint('users', __name__, url_prefix='/api/users')

class UserController:
    """Controller to handle user-related routes and logic"""
    
    def get_profile(self):
        """Get current user profile"""
        if not g.user:
            return jsonify({'error': 'Unauthorized'}), 401
        
        try:
            # In a real app, you would get the user from a database
            user_data = {
                'user_id': g.user.get('user_id'),
                'username': g.user.get('username'),
                'display_name': g.user.get('display_name'),
                'email': g.user.get('email'),
                'created_at': g.user.get('created_at', time.time()),
                'preferences': g.user.get('preferences', {})
            }
            
            return jsonify(user_data)
        except Exception as e:
            logger.exception(f"Error in get_profile: {str(e)}")
            return jsonify({'error': 'Failed to retrieve profile'}), 500
    
    def update_profile(self):
        """Update current user profile"""
        if not g.user:
            return jsonify({'error': 'Unauthorized'}), 401
        
        try:
            data = request.get_json()
            if not data:
                return jsonify({'error': 'Invalid request data'}), 400
            
            # In a real app, you would update the user in a database
            # For now, we'll just return the merged data
            
            # Only allow certain fields to be updated
            allowed_fields = ['display_name', 'email', 'preferences']
            update_data = {k: v for k, v in data.items() if k in allowed_fields}
            
            # Merge with existing user data
            user_data = {
                'user_id': g.user.get('user_id'),
                'username': g.user.get('username'),
                'display_name': g.user.get('display_name'),
                'email': g.user.get('email'),
                'created_at': g.user.get('created_at', time.time()),
                'preferences': g.user.get('preferences', {})
            }
            
            updated_user = {**user_data, **update_data}
            
            return jsonify(updated_user)
        except Exception as e:
            logger.exception(f"Error in update_profile: {str(e)}")
            return jsonify({'error': 'Failed to update profile'}), 500
    
    def search_users(self):
        """Search for users"""
        if not g.user:
            return jsonify({'error': 'Unauthorized'}), 401
        
        try:
            # Get query from request
            query = request.args.get('q', '')
            
            if not query or len(query) < 3:
                return jsonify({'error': 'Search query must be at least 3 characters'}), 400
            
            # In a real app, you would search a database
            # Mock implementation for demonstration
            mock_users = [
                {'user_id': str(uuid.uuid4()), 'username': f'user_{i}', 'display_name': f'User {i}'}
                for i in range(1, 6)
            ]
            
            return jsonify({'users': mock_users})
        except Exception as e:
            logger.exception(f"Error in search_users: {str(e)}")
            return jsonify({'error': 'Failed to search users'}), 500
    
    def get_unread_count(self):
        """Get unread message count for current user"""
        if not g.user:
            return jsonify({'error': 'Unauthorized'}), 401
        
        try:
            user_id = g.user.get('user_id')
            
            # In a real app, you would query the database
            # Mock implementation for demonstration
            
            # Generate random data for demonstration
            # In a real app, this would be actual unread counts from a database
            mock_chats = {
                f"chat_{i}": {
                    "count": i,
                    "last_message_time": time.time() - (i * 3600)
                } for i in range(1, 4)
            }
            
            total_count = sum(chat["count"] for chat in mock_chats.values())
            
            return jsonify({
                'count': total_count,
                'chats': mock_chats,
                'updated_at': time.time()
            })
        except Exception as e:
            logger.exception(f"Error in get_unread_count: {str(e)}")
            return jsonify({'error': 'Failed to get unread counts'}), 500

# Initialize controller
user_controller = UserController()

# Register routes
@user_bp.route('/profile', methods=['GET'])
def profile():
    return user_controller.get_profile()

@user_bp.route('/update', methods=['PUT'])
def update():
    return user_controller.update_profile()

@user_bp.route('/search', methods=['GET'])
def search():
    return user_controller.search_users()

@user_bp.route('/unread-count', methods=['GET'])
def unread_count():
    return user_controller.get_unread_count() 