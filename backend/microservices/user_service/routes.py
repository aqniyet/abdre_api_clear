"""
User Service - Routes
Defines API routes for the user service
"""

import logging
import json
import requests
from flask import Blueprint, request, jsonify, current_app, send_from_directory
from functools import wraps
import os
import time
import base64

from .models import UserProfile, UserSettings

# Setup logging
logger = logging.getLogger(__name__)

# Create Blueprint
user_routes = Blueprint('user_routes', __name__)

# AUTH SERVICE URL
AUTH_SERVICE_URL = "http://localhost:5501"  # Should be configurable

def token_required(f):
    """Decorator to require valid JWT token for access"""
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        auth_header = request.headers.get('Authorization')
        
        # Get token from header
        if auth_header and auth_header.startswith('Bearer '):
            token = auth_header.split(' ')[1]
        
        # If no token, return 401
        if not token:
            return jsonify({'message': 'Authentication token is missing'}), 401
        
        try:
            # Verify token with Auth Service
            response = requests.get(
                f"{AUTH_SERVICE_URL}/api/auth/verify-token",
                headers={"Authorization": f"Bearer {token}"}
            )
            
            if response.status_code != 200:
                return jsonify({'message': 'Invalid or expired token'}), 401
            
            # Get user data from response
            auth_response = response.json()
            user_data = auth_response.get('user', {})
            
            # Create a properly formatted user object with consistent field names
            # Map 'id' to 'user_id' for compatibility
            request.user = {
                'user_id': user_data.get('id'),
                'username': user_data.get('username'),
                'role': user_data.get('role')
            }
            
            return f(*args, **kwargs)
            
        except requests.RequestException as e:
            logger.error(f"Error communicating with Auth Service: {str(e)}")
            return jsonify({'message': 'Authentication service unavailable, please try again later'}), 503
        
    return decorated

def admin_required(f):
    """Decorator to require admin role"""
    @wraps(f)
    def decorated(*args, **kwargs):
        if request.user.get('role') != 'admin':
            return jsonify({'message': 'Admin privileges required'}), 403
        return f(*args, **kwargs)
    return decorated

# Profile Routes

@user_routes.route('/profile', methods=['GET'])
@token_required
def get_own_profile():
    """Get the current user's profile"""
    user_id = request.user.get('user_id')
    
    try:
        profile = UserProfile.get_by_id(user_id)
        
        if not profile:
            # Create profile if it doesn't exist
            profile = UserProfile(
                user_id=user_id,
                username=request.user.get('username'),
                display_name=request.user.get('display_name')
            )
            profile.save()
        
        return jsonify(profile.to_dict())
    except Exception as e:
        logger.error(f"Error getting user profile: {str(e)}")
        return jsonify({'message': 'Failed to retrieve user profile'}), 500

@user_routes.route('/profile/<user_id>', methods=['GET'])
@token_required
def get_profile(user_id):
    """Get a specific user's profile"""
    try:
        profile = UserProfile.get_by_id(user_id)
        
        if not profile:
            return jsonify({'message': 'User profile not found'}), 404
        
        return jsonify(profile.to_dict())
    except Exception as e:
        logger.error(f"Error getting user profile {user_id}: {str(e)}")
        return jsonify({'message': 'Failed to retrieve user profile'}), 500

@user_routes.route('/profile/username/<username>', methods=['GET'])
@token_required
def get_profile_by_username(username):
    """Get a profile by username"""
    try:
        profile = UserProfile.get_by_username(username)
        
        if not profile:
            return jsonify({'message': 'User profile not found'}), 404
        
        return jsonify(profile.to_dict())
    except Exception as e:
        logger.error(f"Error getting user profile for username {username}: {str(e)}")
        return jsonify({'message': 'Failed to retrieve user profile'}), 500

@user_routes.route('/profile', methods=['PUT'])
@token_required
def update_profile():
    """Update the current user's profile"""
    user_id = request.user.get('user_id')
    
    try:
        profile = UserProfile.get_by_id(user_id)
        
        if not profile:
            # Create profile if it doesn't exist
            profile = UserProfile(
                user_id=user_id,
                username=request.user.get('username'),
                display_name=request.user.get('display_name')
            )
        
        data = request.json
        
        # Update profile properties
        if 'display_name' in data:
            profile.display_name = data['display_name']
        if 'bio' in data:
            profile.bio = data['bio']
        if 'avatar_url' in data:
            profile.avatar_url = data['avatar_url']
        if 'social_links' in data:
            profile.social_links = data['social_links']
        
        # Save updated profile
        profile.save()
        
        return jsonify(profile.to_dict())
    except Exception as e:
        logger.error(f"Error updating user profile: {str(e)}")
        return jsonify({'message': 'Failed to update user profile'}), 500

@user_routes.route('/profile/<user_id>', methods=['PUT'])
@token_required
@admin_required
def admin_update_profile(user_id):
    """Admin update a user's profile"""
    try:
        profile = UserProfile.get_by_id(user_id)
        
        if not profile:
            return jsonify({'message': 'User profile not found'}), 404
        
        data = request.json
        
        # Update profile properties
        if 'display_name' in data:
            profile.display_name = data['display_name']
        if 'bio' in data:
            profile.bio = data['bio']
        if 'avatar_url' in data:
            profile.avatar_url = data['avatar_url']
        if 'social_links' in data:
            profile.social_links = data['social_links']
        if 'status' in data:
            profile.status = data['status']
        
        # Save updated profile
        profile.save()
        
        return jsonify(profile.to_dict())
    except Exception as e:
        logger.error(f"Error updating user profile {user_id}: {str(e)}")
        return jsonify({'message': 'Failed to update user profile'}), 500

@user_routes.route('/profile/<user_id>', methods=['DELETE'])
@token_required
@admin_required
def delete_profile(user_id):
    """Delete a user's profile"""
    try:
        profile = UserProfile.get_by_id(user_id)
        
        if not profile:
            return jsonify({'message': 'User profile not found'}), 404
        
        # Delete the profile
        profile.delete()
        
        return jsonify({'message': 'User profile deleted successfully'})
    except Exception as e:
        logger.error(f"Error deleting user profile {user_id}: {str(e)}")
        return jsonify({'message': 'Failed to delete user profile'}), 500

# Settings Routes

@user_routes.route('/settings', methods=['GET'])
@token_required
def get_settings():
    """Get the current user's settings"""
    user_id = request.user.get('user_id')
    
    try:
        settings = UserSettings.get_by_user_id(user_id)
        
        return jsonify(settings.to_dict())
    except Exception as e:
        logger.error(f"Error getting user settings: {str(e)}")
        return jsonify({'message': 'Failed to retrieve user settings'}), 500

@user_routes.route('/settings', methods=['PUT'])
@token_required
def update_settings():
    """Update the current user's settings"""
    user_id = request.user.get('user_id')
    
    try:
        settings = UserSettings.get_by_user_id(user_id)
        
        data = request.json
        
        # Update settings properties
        if 'theme' in data:
            settings.theme = data['theme']
        if 'notifications' in data:
            settings.notifications = data['notifications']
        if 'privacy' in data:
            settings.privacy = data['privacy']
        if 'language' in data:
            settings.language = data['language']
        
        # Save updated settings
        settings.save()
        
        return jsonify(settings.to_dict())
    except Exception as e:
        logger.error(f"Error updating user settings: {str(e)}")
        return jsonify({'message': 'Failed to update user settings'}), 500

@user_routes.route('/settings/<user_id>', methods=['GET'])
@token_required
@admin_required
def admin_get_settings(user_id):
    """Admin get a user's settings"""
    try:
        settings = UserSettings.get_by_user_id(user_id)
        
        return jsonify(settings.to_dict())
    except Exception as e:
        logger.error(f"Error getting user settings for {user_id}: {str(e)}")
        return jsonify({'message': 'Failed to retrieve user settings'}), 500

@user_routes.route('/settings/<user_id>', methods=['PUT'])
@token_required
@admin_required
def admin_update_settings(user_id):
    """Admin update a user's settings"""
    try:
        settings = UserSettings.get_by_user_id(user_id)
        
        data = request.json
        
        # Update settings properties
        if 'theme' in data:
            settings.theme = data['theme']
        if 'notifications' in data:
            settings.notifications = data['notifications']
        if 'privacy' in data:
            settings.privacy = data['privacy']
        if 'language' in data:
            settings.language = data['language']
        
        # Save updated settings
        settings.save()
        
        return jsonify(settings.to_dict())
    except Exception as e:
        logger.error(f"Error updating user settings for {user_id}: {str(e)}")
        return jsonify({'message': 'Failed to update user settings'}), 500

# Avatar Upload Route
@user_routes.route('/avatar', methods=['POST'])
@token_required
def upload_avatar():
    """Upload user avatar"""
    user_id = request.user.get('user_id')
    
    try:
        profile = UserProfile.get_by_id(user_id)
        
        if not profile:
            return jsonify({'message': 'User profile not found'}), 404
        
        # Check if request contains a file upload
        if 'avatar' in request.files:
            avatar_file = request.files['avatar']
            
            # Validate file
            if not avatar_file.filename:
                return jsonify({'message': 'No file selected'}), 400
            
            # Check file type
            allowed_extensions = {'png', 'jpg', 'jpeg', 'gif'}
            if '.' not in avatar_file.filename or \
               avatar_file.filename.rsplit('.', 1)[1].lower() not in allowed_extensions:
                return jsonify({'message': 'File type not allowed. Supported formats: PNG, JPG, JPEG, GIF'}), 400
            
            # Save file to uploads directory
            filename = f"{user_id}_{int(time.time())}.{avatar_file.filename.rsplit('.', 1)[1].lower()}"
            uploads_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'avatars')
            
            # Create directory if it doesn't exist
            if not os.path.exists(uploads_dir):
                os.makedirs(uploads_dir)
            
            # Save the file
            avatar_path = os.path.join(uploads_dir, filename)
            avatar_file.save(avatar_path)
            
            # Update avatar URL in profile
            avatar_url = f"/api/users/avatars/{filename}"
            profile.avatar_url = avatar_url
            profile.save()
            
            return jsonify({'message': 'Avatar uploaded successfully', 'avatar_url': avatar_url})
        
        # Check if request contains base64 image data
        elif request.json and 'avatar_data' in request.json:
            avatar_data = request.json['avatar_data']
            
            # Ensure data is base64 encoded
            if not avatar_data.startswith('data:image'):
                return jsonify({'message': 'Invalid image data format'}), 400
            
            try:
                # Extract image format and data
                format_data = avatar_data.split(';base64,')
                if len(format_data) != 2:
                    return jsonify({'message': 'Invalid image data format'}), 400
                
                image_format = format_data[0].split('/')[-1]
                image_data = format_data[1]
                
                # Validate image format
                if image_format not in ['png', 'jpeg', 'jpg', 'gif']:
                    return jsonify({'message': 'Unsupported image format. Use PNG, JPEG, or GIF'}), 400
                
                # Decode base64 data
                image_bytes = base64.b64decode(image_data)
                
                # Save to file
                filename = f"{user_id}_{int(time.time())}.{image_format}"
                uploads_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'avatars')
                
                # Create directory if it doesn't exist
                if not os.path.exists(uploads_dir):
                    os.makedirs(uploads_dir)
                
                # Save the file
                avatar_path = os.path.join(uploads_dir, filename)
                with open(avatar_path, 'wb') as f:
                    f.write(image_bytes)
                
                # Update avatar URL in profile
                avatar_url = f"/api/users/avatars/{filename}"
                profile.avatar_url = avatar_url
                profile.save()
                
                return jsonify({'message': 'Avatar uploaded successfully', 'avatar_url': avatar_url})
            
            except Exception as e:
                logger.error(f"Error processing base64 image: {str(e)}")
                return jsonify({'message': 'Failed to process image data'}), 400
        
        else:
            return jsonify({'message': 'No avatar data provided. Send a file with field "avatar" or base64 data with field "avatar_data"'}), 400
    
    except Exception as e:
        logger.error(f"Error uploading avatar: {str(e)}")
        return jsonify({'message': 'Failed to upload avatar'}), 500

# Serve avatar files
@user_routes.route('/avatars/<filename>', methods=['GET'])
def get_avatar(filename):
    """Serve avatar file"""
    uploads_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'avatars')
    return send_from_directory(uploads_dir, filename)

# User Search Route
@user_routes.route('/search', methods=['GET'])
@token_required
def search_users():
    """Search for users by username or display name"""
    # Get search query
    query = request.args.get('q', '')
    
    # Get pagination parameters
    try:
        limit = int(request.args.get('limit', 20))
        offset = int(request.args.get('offset', 0))
    except ValueError:
        return jsonify({'message': 'Invalid pagination parameters'}), 400
    
    # Validate limit and offset
    if limit < 1 or limit > 100:
        limit = 20
    
    if offset < 0:
        offset = 0
    
    # Validate query
    if not query or len(query) < 1:
        return jsonify({'message': 'Search query is required'}), 400
    
    try:
        # Get all profiles
        profiles = UserProfile.get_all_profiles()
        
        # Filter profiles by query
        query = query.lower()
        
        # Check for matches in display name, username, or bio
        filtered_profiles = []
        
        for profile in profiles:
            # Check if user is the current user - don't include self in results
            if profile.user_id == request.user.get('user_id'):
                continue
                
            # Check for matches
            if (profile.display_name and query in profile.display_name.lower()) or \
               (profile.username and query in profile.username.lower()) or \
               (profile.bio and query in profile.bio.lower()):
                filtered_profiles.append(profile)
        
        # Apply pagination
        paginated_profiles = filtered_profiles[offset:offset + limit] if filtered_profiles else []
        
        # Convert profiles to dictionary
        results = [profile.to_dict() for profile in paginated_profiles]
        
        # Return search results
        return jsonify({
            'query': query,
            'total': len(filtered_profiles),
            'limit': limit,
            'offset': offset,
            'users': results
        })
    
    except Exception as e:
        logger.error(f"Error searching users: {str(e)}")
        return jsonify({'message': 'Failed to search users'}), 500 