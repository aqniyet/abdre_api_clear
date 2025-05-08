"""
Auth Controller for ABDRE Chat Application
Handles authentication related requests
"""

import logging
import uuid
import json
from datetime import datetime, timedelta
import jwt
from flask import Blueprint, request, jsonify, g, make_response

logger = logging.getLogger(__name__)

# Create a blueprint for auth routes
auth_bp = Blueprint('auth', __name__, url_prefix='/api/auth')

# Secret key for JWT tokens
JWT_SECRET = 'your-secret-key-here'  # In production, use env var

@auth_bp.route('/login', methods=['POST'])
def login():
    """Handle user login"""
    data = request.get_json()
    
    if not data:
        return jsonify({'error': 'Invalid request data'}), 400
    
    username = data.get('username', '')
    password = data.get('password', '')
    remember = data.get('remember', False)
    
    # In a real app, you would validate credentials against a database
    # This is a mock implementation for demonstration
    if username and password:
        # Generate a fake user for testing
        user_id = str(uuid.uuid4())
        
        # Create token expiration
        exp_time = datetime.utcnow() + timedelta(days=30 if remember else 1)
        
        # Create token payload
        token_data = {
            'user_id': user_id,
            'username': username,
            'exp': exp_time
        }
        
        # Generate JWT token
        token = jwt.encode(token_data, JWT_SECRET, algorithm='HS256')
        
        # Create response
        response_data = {
            'success': True,
            'token': token,
            'user': {
                'user_id': user_id,
                'username': username,
                'display_name': username.capitalize(),
                'email': f"{username}@example.com" if '@' not in username else username
            }
        }
        
        # Create response object for cookie setting
        response = make_response(jsonify(response_data))
        
        # Set token cookie
        cookie_exp = exp_time if remember else None
        response.set_cookie(
            'auth_token', 
            token,
            httponly=True,
            secure=False,  # Set to True in production with HTTPS
            samesite='Lax',
            expires=cookie_exp
        )
        
        return response
    
    return jsonify({'error': 'Invalid username or password'}), 401

@auth_bp.route('/register', methods=['POST'])
def register():
    """Handle user registration"""
    data = request.get_json()
    
    if not data:
        return jsonify({'error': 'Invalid request data'}), 400
    
    username = data.get('username', '')
    email = data.get('email', '')
    password = data.get('password', '')
    
    # Validate input
    if not username or not email or not password:
        return jsonify({'error': 'Username, email and password are required'}), 400
    
    if len(password) < 8:
        return jsonify({'error': 'Password must be at least 8 characters long'}), 400
    
    # In a real app, you would save the user to a database
    # This is a mock implementation for demonstration
    user_id = str(uuid.uuid4())
    
    # Create token expiration (default 30 days for new registrations)
    exp_time = datetime.utcnow() + timedelta(days=30)
    
    # Create token payload
    token_data = {
        'user_id': user_id,
        'username': username,
        'exp': exp_time
    }
    
    # Generate JWT token
    token = jwt.encode(token_data, JWT_SECRET, algorithm='HS256')
    
    # Create response
    response_data = {
        'success': True,
        'token': token,
        'user': {
            'user_id': user_id,
            'username': username,
            'display_name': username.capitalize(),
            'email': email
        }
    }
    
    # Create response object for cookie setting
    response = make_response(jsonify(response_data))
    
    # Set token cookie
    response.set_cookie(
        'auth_token', 
        token,
        httponly=True,
        secure=False,  # Set to True in production with HTTPS
        samesite='Lax',
        expires=exp_time
    )
    
    return response

@auth_bp.route('/visitor', methods=['POST'])
def create_visitor():
    """Create a visitor ID for guest users"""
    visitor_id = str(uuid.uuid4())
    
    # In a real app, you might store visitor data in a database
    
    # Create response
    response_data = {
        'success': True,
        'visitor_id': visitor_id
    }
    
    return jsonify(response_data)

@auth_bp.route('/guest', methods=['POST'])
def guest_login():
    """Handle guest login"""
    # Create visitor ID
    visitor_id = str(uuid.uuid4())
    
    # Create token expiration (shorter for guests, 1 day)
    exp_time = datetime.utcnow() + timedelta(days=1)
    
    # Create token payload
    token_data = {
        'visitor_id': visitor_id,
        'is_guest': True,
        'exp': exp_time
    }
    
    # Generate JWT token
    token = jwt.encode(token_data, JWT_SECRET, algorithm='HS256')
    
    # Create response
    response_data = {
        'success': True,
        'token': token,
        'visitor_id': visitor_id
    }
    
    # Create response object for cookie setting
    response = make_response(jsonify(response_data))
    
    # Set token cookie
    response.set_cookie(
        'auth_token', 
        token,
        httponly=True,
        secure=False,  # Set to True in production with HTTPS
        samesite='Lax',
        expires=exp_time
    )
    
    return response

@auth_bp.route('/logout', methods=['POST'])
def logout():
    """Handle user logout"""
    # Create response
    response = make_response(jsonify({'success': True}))
    
    # Clear token cookie
    response.set_cookie('auth_token', '', expires=0)
    
    return response

@auth_bp.route('/refresh', methods=['POST'])
def refresh_token():
    """Refresh authentication token"""
    # Get current token
    auth_token = request.cookies.get('auth_token')
    
    if not auth_token:
        return jsonify({'error': 'No authentication token'}), 401
    
    try:
        # Decode token
        payload = jwt.decode(auth_token, JWT_SECRET, algorithms=['HS256'])
        
        # Check if token is close to expiration
        exp = datetime.fromtimestamp(payload.get('exp', 0))
        now = datetime.utcnow()
        
        # If expiration is less than 24 hours away, refresh
        if exp - now < timedelta(hours=24):
            # Create new expiration
            is_guest = payload.get('is_guest', False)
            exp_time = datetime.utcnow() + timedelta(days=1 if is_guest else 30)
            
            # Update payload
            payload['exp'] = exp_time
            
            # Generate new token
            new_token = jwt.encode(payload, JWT_SECRET, algorithm='HS256')
            
            # Create response
            response_data = {
                'success': True,
                'token': new_token
            }
            
            # Create response object for cookie setting
            response = make_response(jsonify(response_data))
            
            # Set token cookie
            response.set_cookie(
                'auth_token', 
                new_token,
                httponly=True,
                secure=False,  # Set to True in production with HTTPS
                samesite='Lax',
                expires=exp_time
            )
            
            return response
        
        # Token is still valid and not close to expiration
        return jsonify({'success': True, 'message': 'Token still valid'})
        
    except jwt.ExpiredSignatureError:
        return jsonify({'error': 'Token expired'}), 401
    except jwt.InvalidTokenError:
        return jsonify({'error': 'Invalid token'}), 401

# Initialize blueprint in app
def init_app(app):
    """Initialize auth controller with app"""
    app.register_blueprint(auth_bp) 