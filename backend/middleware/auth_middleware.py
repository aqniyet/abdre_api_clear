"""
Auth Middleware for ABDRE Chat Application
Handles request authentication and user context
"""

import logging
import jwt
from datetime import datetime, timedelta
from functools import wraps
from flask import g, request, redirect, current_app

logger = logging.getLogger(__name__)

# JWT Secret key - should match the one in auth_controller
JWT_SECRET = 'your-secret-key-here'  # In production, use env var

def init_auth_middleware(app):
    """Initialize authentication middleware"""
    @app.before_request
    def check_auth():
        """Check authentication for all requests"""
        # Get token from cookies or Authorization header
        token = request.cookies.get('auth_token')
        
        if not token and 'Authorization' in request.headers:
            auth_header = request.headers.get('Authorization', '')
            if auth_header.startswith('Bearer '):
                token = auth_header[7:]  # Remove 'Bearer ' prefix
        
        # No token found, proceed as unauthenticated
        if not token:
            g.user = None
            return None
        
        try:
            # Decode token
            payload = jwt.decode(token, JWT_SECRET, algorithms=['HS256'])
            
            # Check token expiration
            exp = payload.get('exp', 0)
            if datetime.utcnow().timestamp() > exp:
                g.user = None
                return None
            
            # Check if it's a guest token
            if payload.get('is_guest', False):
                g.user = {
                    'visitor_id': payload.get('visitor_id'),
                    'is_guest': True,
                    'is_authenticated': True
                }
            else:
                # Regular user token
                g.user = {
                    'user_id': payload.get('user_id'),
                    'username': payload.get('username'),
                    'is_authenticated': True
                }
            
        except jwt.ExpiredSignatureError:
            # Token is expired
            g.user = None
        except jwt.InvalidTokenError:
            # Token is invalid
            g.user = None
        
        return None

def get_auth_token(user_data):
    """
    Generate a JWT token for real-time authentication
    
    Args:
        user_data (dict): User data to encode in token
        
    Returns:
        str: JWT token
    """
    if not user_data:
        return None
        
    # Create token payload
    payload = {}
    
    # Check if it's a guest
    if user_data.get('is_guest', False):
        payload = {
            'visitor_id': user_data.get('visitor_id'),
            'is_guest': True,
            'exp': datetime.utcnow() + timedelta(hours=1)  # Short expiration for real-time tokens
        }
    else:
        payload = {
            'user_id': user_data.get('user_id'),
            'username': user_data.get('username'),
            'exp': datetime.utcnow() + timedelta(hours=1)
        }
    
    # Generate token
    token = jwt.encode(payload, JWT_SECRET, algorithm='HS256')
    
    return token

def requires_auth(f):
    """Decorator to require authentication for a route"""
    @wraps(f)
    def decorated(*args, **kwargs):
        if not g.user or not g.user.get('is_authenticated', False):
            return redirect('/login')
        return f(*args, **kwargs)
    return decorated 