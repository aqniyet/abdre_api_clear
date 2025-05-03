"""
Authentication Service for Abdre microservices platform
"""
from flask import Flask, jsonify, request
import os
import logging
import jwt
from datetime import datetime, timedelta
from flask_cors import CORS

# Initialize logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize Flask app
app = Flask(__name__)

# Configure CORS
cors_allowed_origins = os.environ.get('CORS_ALLOWED_ORIGINS', '*').split(',')
CORS(app, origins=cors_allowed_origins)

# Configuration
JWT_SECRET = os.environ.get('JWT_SECRET', 'dev-secret-key')
TOKEN_EXPIRY = int(os.environ.get('TOKEN_EXPIRY', 3600))  # 1 hour
REFRESH_TOKEN_EXPIRY = int(os.environ.get('REFRESH_TOKEN_EXPIRY', 2592000))  # 30 days

# In-memory user storage (replace with database in production)
users = {
    'admin': {
        'username': 'admin',
        'password': 'admin123',  # In production, use hashed passwords
        'email': 'admin@example.com',
        'role': 'admin',
    },
    'user': {
        'username': 'user',
        'password': 'user123',
        'email': 'user@example.com',
        'role': 'user',
    }
}

@app.route('/health')
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'service': 'auth_service',
        'timestamp': datetime.utcnow().isoformat()
    })

@app.route('/login', methods=['POST'])
def login():
    """Login endpoint"""
    data = request.get_json()
    
    username = data.get('username')
    password = data.get('password')
    
    if not username or not password:
        return jsonify({
            'error': 'Missing username or password'
        }), 400
    
    user = users.get(username)
    
    if not user or user['password'] != password:
        return jsonify({
            'error': 'Invalid username or password'
        }), 401
    
    # Generate tokens
    access_token = generate_token(user, TOKEN_EXPIRY)
    refresh_token = generate_token(user, REFRESH_TOKEN_EXPIRY, is_refresh=True)
    
    return jsonify({
        'access_token': access_token,
        'refresh_token': refresh_token,
        'user': {
            'username': user['username'],
            'email': user['email'],
            'role': user['role'],
            'user_id': user['username']  # Include user_id for compatibility
        }
    })

@app.route('/register', methods=['POST'])
def register():
    """Register endpoint"""
    data = request.get_json()
    
    username = data.get('username')
    password = data.get('password')
    email = data.get('email')
    
    if not username or not password or not email:
        return jsonify({
            'error': 'Missing required fields'
        }), 400
    
    if username in users:
        return jsonify({
            'error': 'Username already exists'
        }), 409
    
    # Create new user
    users[username] = {
        'username': username,
        'password': password,  # In production, hash this
        'email': email,
        'role': 'user'
    }
    
    # Generate tokens
    access_token = generate_token(users[username], TOKEN_EXPIRY)
    refresh_token = generate_token(users[username], REFRESH_TOKEN_EXPIRY, is_refresh=True)
    
    return jsonify({
        'access_token': access_token,
        'refresh_token': refresh_token,
        'user': {
            'username': username,
            'email': email,
            'role': 'user',
            'user_id': username  # Include user_id for compatibility
        }
    }), 201

@app.route('/refresh', methods=['POST'])
def refresh():
    """Refresh token endpoint"""
    auth_header = request.headers.get('Authorization')
    
    if not auth_header or not auth_header.startswith('Bearer '):
        return jsonify({
            'error': 'Invalid or missing refresh token'
        }), 401
    
    refresh_token = auth_header.split(' ')[1]
    
    try:
        # Decode token
        payload = jwt.decode(refresh_token, JWT_SECRET, algorithms=['HS256'])
        
        # Check if it's a refresh token
        if payload.get('type') != 'refresh':
            raise jwt.InvalidTokenError('Not a refresh token')
        
        # Get user data
        username = payload.get('username')
        user = users.get(username)
        
        if not user:
            raise jwt.InvalidTokenError('User not found')
            
        # Generate new tokens
        access_token = generate_token(user, TOKEN_EXPIRY)
        new_refresh_token = generate_token(user, REFRESH_TOKEN_EXPIRY, is_refresh=True)
        
        return jsonify({
            'access_token': access_token,
            'refresh_token': new_refresh_token,
            'user_id': username
        })
        
    except jwt.InvalidTokenError as e:
        return jsonify({
            'error': f'Invalid token: {str(e)}'
        }), 401

@app.route('/verify', methods=['GET'])
def verify():
    """Verify token endpoint"""
    auth_header = request.headers.get('Authorization')
    
    if not auth_header or not auth_header.startswith('Bearer '):
        return jsonify({
            'valid': False,
            'error': 'Invalid or missing token'
        }), 401
    
    token = auth_header.split(' ')[1]
    
    try:
        # Decode token
        payload = jwt.decode(token, JWT_SECRET, algorithms=['HS256'])
        
        # Check token type
        if payload.get('type') == 'refresh':
            return jsonify({
                'valid': True,
                'token_type': 'refresh'
            })
        
        return jsonify({
            'valid': True,
            'token_type': 'access',
            'user': {
                'username': payload.get('username'),
                'email': payload.get('email'),
                'role': payload.get('role')
            }
        })
        
    except jwt.ExpiredSignatureError:
        return jsonify({
            'valid': False,
            'error': 'Token expired'
        }), 401
    except jwt.InvalidTokenError as e:
        return jsonify({
            'valid': False,
            'error': f'Invalid token: {str(e)}'
        }), 401

def generate_token(user, expiry, is_refresh=False):
    """Generate a JWT token"""
    now = datetime.utcnow()
    
    payload = {
        'user_id': user['username'],  # Use a proper ID in production
        'username': user['username'],
        'email': user['email'],
        'role': user['role'],
        'type': 'refresh' if is_refresh else 'access',
        'iat': now,
        'exp': now + timedelta(seconds=expiry)
    }
    
    return jwt.encode(payload, JWT_SECRET, algorithm='HS256')

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5001))
    app.run(host='0.0.0.0', port=port) 