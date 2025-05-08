"""
API Controller for ABDRE Chat Application
Handles API requests for frontend clients
"""

import logging
import os
from flask import Blueprint, jsonify, request, g

logger = logging.getLogger(__name__)

# Create a blueprint for API routes
api_bp = Blueprint('api', __name__, url_prefix='/api')

@api_bp.route('/realtime/socket.io/', methods=['GET'])
def realtime_socket_info():
    """
    Provide realtime socket.io connection information to clients
    
    Returns:
        Response: Connection information for Socket.IO client
    """
    # Get realtime service details
    realtime_host = os.environ.get('REALTIME_HOST', request.host.split(':')[0])
    realtime_port = os.environ.get('REALTIME_PORT', '5506')
    realtime_secure = request.scheme == 'https'
    
    # Build connection details
    protocol = 'https' if realtime_secure else 'http'
    connection_url = f"{protocol}://{realtime_host}:{realtime_port}"
    
    # Get token for authentication
    token = "guest"
    if hasattr(g, 'user') and g.user:
        # Use JWT token for authenticated users
        from backend.middleware.auth_middleware import get_auth_token
        token = get_auth_token(g.user) or "guest"
    
    # Return connection details
    return jsonify({
        'connection_url': connection_url,
        'socket_io_path': '/socket.io',
        'service': 'realtime',
        'token_param': token,
        'transport': 'websocket'
    })

@api_bp.route('/chats/generate-invitation', methods=['POST'])
def generate_invitation():
    """
    Generate a chat invitation token
    
    Returns:
        Response: Invitation details
    """
    # This is a stub implementation - in a real app, this would create
    # and store an invitation token and return it
    
    # Get user ID from request
    if not hasattr(g, 'user') or not g.user:
        return jsonify({'error': 'Authentication required'}), 401
    
    user_id = g.user.get('user_id')
    
    # Generate a fake invitation token
    import uuid
    import time
    token = f"inv_{uuid.uuid4()}"
    
    # Return invitation details
    return jsonify({
        'token': token,
        'created_by': user_id,
        'expires_at': int(time.time()) + 86400,  # 24 hours
        'status': 'active'
    })

# Initialize blueprint in app
def init_app(app):
    """Initialize API controller with app"""
    app.register_blueprint(api_bp)
    
    # Add CORS headers for API routes
    @app.after_request
    def add_cors_headers(response):
        if request.path.startswith('/api/'):
            response.headers['Access-Control-Allow-Origin'] = '*'
            response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS'
            response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
        return response 