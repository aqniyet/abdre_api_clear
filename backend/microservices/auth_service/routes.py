"""
Auth Service - Routes
Defines API routes for authentication service
"""

import logging
import uuid
from datetime import datetime, timedelta
import os
import hashlib
from functools import wraps
import jwt
from flask import Blueprint, request, jsonify, make_response, g, abort

from .models import User, Guest, UserDatabase, TokenBlacklist, SessionManager, AuthLogger

# Setup logging
logger = logging.getLogger(__name__)

# Create a blueprint for auth routes
auth_routes = Blueprint('auth', __name__)

# JWT Secret key
JWT_SECRET = os.environ.get('JWT_SECRET', 'your-secret-key-here')

# Rate limiting configuration
RATE_LIMIT_WINDOW = 60  # 1 minute
RATE_LIMIT_MAX_REQUESTS = 10  # 10 requests per minute
rate_limit_cache = {}  # ip -> [(timestamp, endpoint), ...]

def require_json():
    """Decorator to require JSON content type"""
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            if not request.is_json:
                return jsonify({'error': 'Content-Type must be application/json'}), 415
            return f(*args, **kwargs)
        return decorated_function
    return decorator

def rate_limit():
    """Decorator to implement rate limiting on endpoints"""
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            client_ip = request.remote_addr
            current_time = datetime.utcnow().timestamp()
            endpoint = request.path
            
            # Initialize rate limit tracking for this IP if not exists
            if client_ip not in rate_limit_cache:
                rate_limit_cache[client_ip] = []
            
            # Remove entries older than the window
            rate_limit_cache[client_ip] = [
                entry for entry in rate_limit_cache[client_ip]
                if current_time - entry[0] < RATE_LIMIT_WINDOW and entry[1] == endpoint
            ]
            
            # Check if limit exceeded
            if len(rate_limit_cache[client_ip]) >= RATE_LIMIT_MAX_REQUESTS:
                return jsonify({
                    'error': 'Rate limit exceeded',
                    'retry_after': RATE_LIMIT_WINDOW
                }), 429
            
            # Add current request to cache
            rate_limit_cache[client_ip].append((current_time, endpoint))
            
            return f(*args, **kwargs)
        return decorated_function
    return decorator

def require_auth():
    """Decorator to require authentication"""
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            token = _get_token_from_request()
            
            if not token:
                return jsonify({'error': 'Authentication required'}), 401
            
            # Verify token
            payload = User.verify_auth_token(token)
            if not payload:
                return jsonify({'error': 'Invalid or expired token'}), 401
            
            # Set user context
            g.user_id = payload.get('user_id')
            g.username = payload.get('username')
            g.is_guest = payload.get('is_guest', False)
            g.visitor_id = payload.get('visitor_id') if g.is_guest else None
            g.role = payload.get('role', 'user')
            g.jti = payload.get('jti')
            
            # Update session activity
            if g.jti:
                SessionManager.update_session_activity(g.jti)
            
            return f(*args, **kwargs)
        return decorated_function
    return decorator

def hash_password(password):
    """Hash a password using SHA-256"""
    # In production, use a secure password hashing library like bcrypt
    return hashlib.sha256(password.encode()).hexdigest()

def check_password(password_hash, password):
    """Check a password against its hash"""
    return password_hash == hash_password(password)

def _get_token_from_request():
    """Get token from request (cookie or header)"""
    token = request.cookies.get('auth_token')
    
    if not token and 'Authorization' in request.headers:
        auth_header = request.headers.get('Authorization', '')
        if auth_header.startswith('Bearer '):
            token = auth_header[7:]  # Remove 'Bearer ' prefix
    
    return token

def _get_device_info():
    """Get device information from request"""
    user_agent = request.headers.get('User-Agent', 'Unknown')
    
    return {
        'user_agent': user_agent,
        'ip_address': request.remote_addr,
        'origin': request.headers.get('Origin'),
        'referer': request.headers.get('Referer')
    }

@auth_routes.route('/login', methods=['POST'])
@require_json()
@rate_limit()
def login():
    """Handle user login"""
    data = request.get_json()
    
    if not data:
        return jsonify({'error': 'Invalid request data'}), 400
    
    username = data.get('username', '')
    password = data.get('password', '')
    remember = data.get('remember', False)
    
    # Log login attempt (without sensitive data)
    AuthLogger.log_event(
        event_type='login_attempt',
        username=username,
        success=False,  # Set to False initially
        ip_address=request.remote_addr,
        user_agent=request.headers.get('User-Agent'),
        details={'remember': remember}
    )
    
    # Find user by username or email
    user = User.get_by_username(username)
    if not user and '@' in username:
        user = User.get_by_email(username)
    
    if user and check_password(user.password_hash, password):
        # Check if user is active
        if user.status != 'active':
            AuthLogger.log_event(
                event_type='login_blocked',
                user_id=user.user_id,
                username=username,
                success=False,
                ip_address=request.remote_addr,
                user_agent=request.headers.get('User-Agent'),
                details={'reason': f'User status: {user.status}'}
            )
            return jsonify({'error': 'Account is not active'}), 403
        
        # Set token expiration based on "remember me" option
        expiration = 30 * 86400 if remember else 86400  # 30 days or 1 day
        
        # Get device info
        device_info = _get_device_info()
        
        # Generate token
        token, exp_time = user.generate_auth_token(expiration, device_info)
        
        # Create response
        response_data = {
            'success': True,
            'token': token,
            'user': user.to_dict()
        }
        
        # Create response object for cookie setting
        response = make_response(jsonify(response_data))
        
        # Set token cookie
        response.set_cookie(
            'auth_token', 
            token,
            httponly=True,
            secure=os.environ.get('FLASK_ENV') == 'production',  # True in production
            samesite='Lax',
            expires=exp_time
        )
        
        # Log successful login
        AuthLogger.log_event(
            event_type='login_success',
            user_id=user.user_id,
            username=username,
            success=True,
            ip_address=request.remote_addr,
            user_agent=request.headers.get('User-Agent'),
            details={'remember': remember}
        )
        
        logger.info(f"User '{username}' logged in successfully")
        
        return response
    
    # Log failed login attempt
    AuthLogger.log_event(
        event_type='login_failure',
        username=username,
        success=False,
        ip_address=request.remote_addr,
        user_agent=request.headers.get('User-Agent'),
        details={'reason': 'Invalid credentials'}
    )
    
    logger.warning(f"Failed login attempt for username '{username}'")
    
    return jsonify({'error': 'Invalid username or password'}), 401

@auth_routes.route('/register', methods=['POST'])
@require_json()
@rate_limit()
def register():
    """Handle user registration"""
    data = request.get_json()
    
    if not data:
        return jsonify({'error': 'Invalid request data'}), 400
    
    username = data.get('username', '')
    email = data.get('email', '')
    password = data.get('password', '')
    display_name = data.get('display_name', username.capitalize() if username else '')
    
    # Log registration attempt
    AuthLogger.log_event(
        event_type='register_attempt',
        username=username,
        success=False,  # Set to False initially
        ip_address=request.remote_addr,
        user_agent=request.headers.get('User-Agent'),
        details={'email': email}
    )
    
    # Validate input
    if not username or not email or not password:
        return jsonify({'error': 'Username, email and password are required'}), 400
    
    if len(password) < 8:
        return jsonify({'error': 'Password must be at least 8 characters long'}), 400
    
    # Check if username or email already exists
    if UserDatabase.username_exists(username):
        AuthLogger.log_event(
            event_type='register_failure',
            username=username,
            success=False,
            ip_address=request.remote_addr,
            user_agent=request.headers.get('User-Agent'),
            details={'reason': 'Username already exists'}
        )
        return jsonify({'error': 'Username already exists'}), 409
    
    if UserDatabase.email_exists(email):
        AuthLogger.log_event(
            event_type='register_failure',
            username=username,
            success=False,
            ip_address=request.remote_addr,
            user_agent=request.headers.get('User-Agent'),
            details={'reason': 'Email already exists', 'email': email}
        )
        return jsonify({'error': 'Email already exists'}), 409
    
    # Create and save new user
    password_hash = hash_password(password)
    user = User(username=username, email=email, password_hash=password_hash, display_name=display_name)
    user.save()
    
    # Get device info
    device_info = _get_device_info()
    
    # Generate token (default 30 days for new registrations)
    token, exp_time = user.generate_auth_token(30 * 86400, device_info)
    
    # Create response
    response_data = {
        'success': True,
        'token': token,
        'user': user.to_dict()
    }
    
    # Create response object for cookie setting
    response = make_response(jsonify(response_data))
    
    # Set token cookie
    response.set_cookie(
        'auth_token', 
        token,
        httponly=True,
        secure=os.environ.get('FLASK_ENV') == 'production',  # True in production
        samesite='Lax',
        expires=exp_time
    )
    
    # Log successful registration
    AuthLogger.log_event(
        event_type='register_success',
        user_id=user.user_id,
        username=username,
        success=True,
        ip_address=request.remote_addr,
        user_agent=request.headers.get('User-Agent'),
        details={'email': email}
    )
    
    logger.info(f"New user registered: '{username}'")
    
    return response

@auth_routes.route('/guest', methods=['POST'])
def guest_login():
    """Handle guest login"""
    guest = Guest()
    
    # Get device info
    device_info = _get_device_info()
    
    # Generate token (1 day for guests)
    token, exp_time = guest.generate_auth_token(86400, device_info)
    
    # Log guest login
    AuthLogger.log_event(
        event_type='guest_login',
        user_id=f"guest:{guest.visitor_id}",
        success=True,
        ip_address=request.remote_addr,
        user_agent=request.headers.get('User-Agent'),
        details={'visitor_id': guest.visitor_id}
    )
    
    # Create response
    response_data = {
        'success': True,
        'token': token,
        'visitor_id': guest.visitor_id
    }
    
    # Create response object for cookie setting
    response = make_response(jsonify(response_data))
    
    # Set token cookie
    response.set_cookie(
        'auth_token', 
        token,
        httponly=True,
        secure=os.environ.get('FLASK_ENV') == 'production',  # True in production
        samesite='Lax',
        expires=exp_time
    )
    
    return response

@auth_routes.route('/logout', methods=['POST'])
def logout():
    """Handle user logout"""
    token = _get_token_from_request()
    
    if token:
        try:
            # Parse token without verification
            payload = jwt.decode(token, JWT_SECRET, algorithms=['HS256'], options={"verify_signature": False})
            user_id = payload.get('user_id')
            session_id = payload.get('jti')
            
            # Blacklist token
            TokenBlacklist.blacklist_token(token, reason="logout")
            
            # Remove session
            if session_id:
                SessionManager.remove_session(session_id)
            
            # Log logout
            AuthLogger.log_event(
                event_type='logout',
                user_id=user_id,
                success=True,
                ip_address=request.remote_addr,
                user_agent=request.headers.get('User-Agent')
            )
            
        except Exception as e:
            logger.error(f"Error processing logout: {str(e)}")
    
    # Create response
    response = make_response(jsonify({'success': True}))
    
    # Clear auth token cookie
    response.set_cookie('auth_token', '', expires=0)
    
    return response

@auth_routes.route('/refresh', methods=['POST'])
def refresh_token():
    """Refresh authentication token"""
    token = _get_token_from_request()
    
    if not token:
        return jsonify({'error': 'No token provided'}), 401
    
    try:
        # Verify existing token
        payload = User.verify_auth_token(token)
        if not payload:
            return jsonify({'error': 'Invalid or expired token'}), 401
        
        # Get device info
        device_info = _get_device_info()
        
        # Check if it's a guest token
        if 'is_guest' in payload and payload['is_guest']:
            guest = Guest(visitor_id=payload.get('visitor_id'))
            new_token, exp_time = guest.generate_auth_token(86400, device_info)  # 1 day for guests
            
            response_data = {
                'success': True,
                'token': new_token,
                'visitor_id': guest.visitor_id
            }
            
            # Log refresh
            AuthLogger.log_event(
                event_type='token_refresh',
                user_id=f"guest:{guest.visitor_id}",
                success=True,
                ip_address=request.remote_addr,
                user_agent=request.headers.get('User-Agent'),
                details={'is_guest': True}
            )
        else:
            # Regular user token
            user_id = payload.get('user_id')
            user = User.get_by_id(user_id)
            if not user:
                return jsonify({'error': 'User not found'}), 404
            
            new_token, exp_time = user.generate_auth_token(30 * 86400, device_info)  # 30 days
            
            response_data = {
                'success': True,
                'token': new_token,
                'user': user.to_dict()
            }
            
            # Log refresh
            AuthLogger.log_event(
                event_type='token_refresh',
                user_id=user.user_id,
                username=user.username,
                success=True,
                ip_address=request.remote_addr,
                user_agent=request.headers.get('User-Agent')
            )
        
        # Create response object
        response = make_response(jsonify(response_data))
        
        # Set new token cookie
        response.set_cookie(
            'auth_token', 
            new_token,
            httponly=True,
            secure=os.environ.get('FLASK_ENV') == 'production',  # True in production
            samesite='Lax',
            expires=exp_time
        )
        
        # Blacklist old token
        TokenBlacklist.blacklist_token(token, reason="refresh")
        
        return response
        
    except Exception as e:
        logger.error(f"Error refreshing token: {str(e)}")
        return jsonify({'error': 'Token refresh failed'}), 401

@auth_routes.route('/verify', methods=['GET'])
def verify():
    """Verify authentication token"""
    token = _get_token_from_request()
    
    if not token:
        return jsonify({
            'authenticated': False,
            'token_status': 'missing'
        }), 200
    
    try:
        # Verify token
        payload = User.verify_auth_token(token)
        if not payload:
            return jsonify({
                'authenticated': False,
                'token_status': 'invalid'
            }), 200
        
        # Check if it's a guest token
        if 'is_guest' in payload and payload['is_guest']:
            return jsonify({
                'authenticated': True,
                'token_status': 'valid',
                'is_guest': True,
                'visitor_id': payload.get('visitor_id')
            }), 200
        else:
            # Regular user token
            user_id = payload.get('user_id')
            user = User.get_by_id(user_id)
            if not user:
                return jsonify({
                    'authenticated': False,
                    'token_status': 'invalid',
                    'error': 'User not found'
                }), 200
            
            return jsonify({
                'authenticated': True,
                'token_status': 'valid',
                'user': user.to_dict()
            }), 200
            
    except Exception as e:
        logger.error(f"Error verifying token: {str(e)}")
        return jsonify({
            'authenticated': False,
            'token_status': 'error',
            'error': str(e)
        }), 200

@auth_routes.route('/check-session', methods=['GET'])
def check_session():
    """Check session status"""
    token = _get_token_from_request()
    
    result = {
        'authenticated': False,
        'token_status': 'missing' if not token else 'unknown'
    }
    
    if token:
        try:
            # Verify token
            payload = User.verify_auth_token(token)
            if not payload:
                result['token_status'] = 'expired'
            else:
                result['authenticated'] = True
                result['token_status'] = 'valid'
                
                # Add user info if available
                if 'is_guest' in payload and payload['is_guest']:
                    result['is_guest'] = True
                    result['visitor_id'] = payload.get('visitor_id')
                else:
                    user_id = payload.get('user_id')
                    user = User.get_by_id(user_id)
                    if user:
                        result['user'] = user.to_dict()
                
                # Add session info
                session_id = payload.get('jti')
                if session_id:
                    session = SessionManager.get_session(session_id)
                    if session:
                        result['session'] = {
                            'created_at': session['created_at'],
                            'last_activity': session['last_activity'],
                            'device_info': {
                                'user_agent': session['device_info'].get('user_agent')
                            }
                        }
        except Exception as e:
            logger.error(f"Error checking session: {str(e)}")
            result['token_status'] = 'error'
            result['error'] = str(e)
    
    return jsonify(result), 200

@auth_routes.route('/set-user-name', methods=['POST'])
@require_json()
@require_auth()
def set_user_name():
    """Update user display name"""
    if g.is_guest:
        return jsonify({'error': 'Guest users cannot update display name'}), 403
    
    data = request.get_json()
    if not data or 'display_name' not in data:
        return jsonify({'error': 'Display name is required'}), 400
    
    display_name = data.get('display_name')
    if not display_name or len(display_name) < 1:
        return jsonify({'error': 'Display name cannot be empty'}), 400
    
    # Update user
    user = User.get_by_id(g.user_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404
    
    user.display_name = display_name
    user.save()
    
    # Log the update
    AuthLogger.log_event(
        event_type='profile_update',
        user_id=user.user_id,
        username=user.username,
        success=True,
        ip_address=request.remote_addr,
        user_agent=request.headers.get('User-Agent'),
        details={'field': 'display_name'}
    )
    
    return jsonify({
        'success': True,
        'user': user.to_dict()
    }), 200

@auth_routes.route('/sessions', methods=['GET'])
@require_auth()
def get_user_sessions():
    """Get active sessions for the authenticated user"""
    if g.is_guest:
        return jsonify({'error': 'Guest users cannot view sessions'}), 403
    
    sessions = SessionManager.load_sessions()
    
    # Filter sessions for this user
    user_sessions = {
        session_id: {
            'session_id': session_id,
            'created_at': session['created_at'],
            'expires_at': session['expires_at'],
            'last_activity': session['last_activity'],
            'device_info': {
                'user_agent': session['device_info'].get('user_agent'),
                'ip_address': session['device_info'].get('ip_address')
            },
            'current': session_id == g.jti
        }
        for session_id, session in sessions.items()
        if session['user_id'] == g.user_id
    }
    
    return jsonify({
        'success': True,
        'sessions': list(user_sessions.values())
    }), 200

@auth_routes.route('/sessions/<session_id>', methods=['DELETE'])
@require_auth()
def terminate_session(session_id):
    """Terminate a specific session"""
    if g.is_guest:
        return jsonify({'error': 'Guest users cannot terminate sessions'}), 403
    
    # Check if session exists and belongs to user
    session = SessionManager.get_session(session_id)
    if not session:
        return jsonify({'error': 'Session not found'}), 404
    
    if session['user_id'] != g.user_id:
        return jsonify({'error': 'Unauthorized'}), 403
    
    # Cannot terminate current session through this endpoint
    if session_id == g.jti:
        return jsonify({'error': 'Cannot terminate current session, use logout instead'}), 400
    
    # Remove session
    success = SessionManager.remove_session(session_id)
    
    if success:
        # Log session termination
        AuthLogger.log_event(
            event_type='session_terminated',
            user_id=g.user_id,
            username=g.username,
            success=True,
            ip_address=request.remote_addr,
            user_agent=request.headers.get('User-Agent'),
            details={'session_id': session_id}
        )
    
    return jsonify({
        'success': success
    }), 200 if success else 500

@auth_routes.route('/sessions/all', methods=['DELETE'])
@require_auth()
def terminate_all_sessions():
    """Terminate all sessions except the current one"""
    if g.is_guest:
        return jsonify({'error': 'Guest users cannot terminate sessions'}), 403
    
    # Get all sessions
    sessions = SessionManager.load_sessions()
    
    # Filter sessions for this user
    user_sessions = {
        session_id: session
        for session_id, session in sessions.items()
        if session['user_id'] == g.user_id and session_id != g.jti
    }
    
    # Remove each session
    for session_id in user_sessions:
        SessionManager.remove_session(session_id)
    
    # Log termination
    AuthLogger.log_event(
        event_type='all_sessions_terminated',
        user_id=g.user_id,
        username=g.username,
        success=True,
        ip_address=request.remote_addr,
        user_agent=request.headers.get('User-Agent'),
        details={'count': len(user_sessions)}
    )
    
    return jsonify({
        'success': True,
        'count': len(user_sessions)
    }), 200

@auth_routes.route('/maintenance/cleanup', methods=['POST'])
def cleanup_expired_data():
    """Cleanup expired sessions and blacklisted tokens (admin only)"""
    # In a real app, this would be protected by admin authentication
    # For simplicity, we're using a secret token in the request
    secret = request.headers.get('X-Admin-Secret')
    
    if not secret or secret != os.environ.get('ADMIN_SECRET', 'admin-secret-token'):
        abort(404)  # Return 404 to avoid disclosing the endpoint exists
    
    # Cleanup expired sessions
    sessions_removed = SessionManager.cleanup_expired_sessions()
    
    # Cleanup expired blacklist entries
    blacklist_removed = TokenBlacklist.cleanup_expired_entries()
    
    return jsonify({
        'success': True,
        'sessions_removed': sessions_removed,
        'blacklist_removed': blacklist_removed
    }), 200

# Health check endpoint
@auth_routes.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'service': 'auth-service',
        'version': '1.0.0',
        'time': datetime.utcnow().isoformat()
    }), 200 