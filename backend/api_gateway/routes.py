"""
API Gateway - Routes
Routes requests to appropriate microservices
"""

import logging
import os
import json
import requests
import jwt
from flask import Blueprint, request, Response, jsonify, g
from functools import wraps

from .service_registry import ServiceRegistry

# Setup logging
logger = logging.getLogger(__name__)

# Create blueprint for API gateway routes
gateway_routes = Blueprint('gateway', __name__)

# Initialize service registry
service_registry = ServiceRegistry()

# JWT Secret key - should match the one in Auth Service
JWT_SECRET = os.environ.get('JWT_SECRET', 'your-secret-key-here')

def proxy_request(service_name, path, preserve_host=True, auth_required=False):
    """
    Decorator for proxying requests to a specific service
    
    Args:
        service_name (str): Name of the service to proxy to
        path (str): Path to proxy to (can be None to use original path)
        preserve_host (bool): Whether to preserve the original host header
        auth_required (bool): Whether authentication is required for this route
    """
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            try:
                # Check authentication if required
                if auth_required:
                    token = _get_token_from_request()
                    if not token:
                        return jsonify({'error': 'Authentication required'}), 401
                    
                    # Verify token
                    try:
                        payload = jwt.decode(token, JWT_SECRET, algorithms=['HS256'])
                        g.user_id = payload.get('user_id')
                        g.username = payload.get('username')
                        g.is_guest = payload.get('is_guest', False)
                        g.role = payload.get('role', 'user')
                    except jwt.ExpiredSignatureError:
                        return jsonify({'error': 'Token has expired'}), 401
                    except jwt.InvalidTokenError:
                        return jsonify({'error': 'Invalid token'}), 401
                
                # Get service URL from registry
                service = service_registry.get_service(service_name)
                if not service:
                    logger.error(f"Service {service_name} not found in registry")
                    return jsonify({'error': f'Service {service_name} not available'}), 503
                
                service_url = service['url']
                
                # Determine target path
                if path:
                    # Use provided path with any path parameters
                    target_path = path
                    for key, value in kwargs.items():
                        target_path = target_path.replace(f"<{key}>", value)
                else:
                    # Use original request path
                    target_path = request.path
                
                # Build full URL
                target_url = f"{service_url}{target_path}"
                
                # Get query parameters
                query_params = request.args.to_dict()
                
                # Setup headers
                headers = {key: value for key, value in request.headers.items() 
                           if key.lower() not in ('host', 'content-length')}
                
                if preserve_host and 'Host' in request.headers:
                    headers['X-Forwarded-Host'] = request.headers['Host']
                
                # Add trace ID for request tracking
                headers['X-Request-Id'] = g.get('request_id', 'unknown')
                
                # Add user info if authenticated
                if auth_required or hasattr(g, 'user_id'):
                    headers['X-User-ID'] = g.get('user_id', '')
                    headers['X-Username'] = g.get('username', '')
                    headers['X-User-Role'] = g.get('role', 'guest')
                    headers['X-Is-Guest'] = str(g.get('is_guest', True)).lower()
                
                # Make request to service
                response = requests.request(
                    method=request.method,
                    url=target_url,
                    params=query_params,
                    headers=headers,
                    data=request.get_data(),
                    cookies=request.cookies,
                    allow_redirects=False
                )
                
                # Create Flask response from service response
                proxy_response = Response(
                    response.content,
                    status=response.status_code
                )
                
                # Copy headers from service response
                for key, value in response.headers.items():
                    if key.lower() not in ('server', 'connection', 'content-length',
                                           'transfer-encoding', 'content-encoding'):
                        proxy_response.headers[key] = value
                
                # Copy cookies from service response
                if 'Set-Cookie' in response.headers:
                    proxy_response.headers['Set-Cookie'] = response.headers['Set-Cookie']
                
                return proxy_response
                
            except requests.RequestException as e:
                logger.error(f"Error proxying request to {service_name}: {str(e)}")
                return jsonify({'error': 'Service unavailable'}), 503
                
        return decorated_function
    return decorator

def _get_token_from_request():
    """Get token from request (cookie or header)"""
    token = request.cookies.get('auth_token')
    
    if not token and 'Authorization' in request.headers:
        auth_header = request.headers.get('Authorization', '')
        if auth_header.startswith('Bearer '):
            token = auth_header[7:]  # Remove 'Bearer ' prefix
    
    return token

# Auth Service Routes
@gateway_routes.route('/api/auth/login', methods=['POST'])
@proxy_request('auth-service', '/api/auth/login')
def auth_login():
    """Proxy login request to Auth Service"""
    pass

@gateway_routes.route('/api/auth/register', methods=['POST'])
@proxy_request('auth-service', '/api/auth/register')
def auth_register():
    """Proxy register request to Auth Service"""
    pass

@gateway_routes.route('/api/auth/logout', methods=['POST'])
@proxy_request('auth-service', '/api/auth/logout')
def auth_logout():
    """Proxy logout request to Auth Service"""
    pass

@gateway_routes.route('/api/auth/refresh', methods=['POST'])
@proxy_request('auth-service', '/api/auth/refresh')
def auth_refresh():
    """Proxy token refresh request to Auth Service"""
    pass

@gateway_routes.route('/api/auth/verify', methods=['GET'])
@proxy_request('auth-service', '/api/auth/verify')
def auth_verify():
    """Proxy token verification request to Auth Service"""
    pass

@gateway_routes.route('/api/auth/check-session', methods=['GET'])
@proxy_request('auth-service', '/api/auth/check-session')
def auth_check_session():
    """Proxy session check request to Auth Service"""
    pass

@gateway_routes.route('/api/auth/guest', methods=['POST'])
@proxy_request('auth-service', '/api/auth/guest')
def auth_guest():
    """Proxy guest login request to Auth Service"""
    pass

@gateway_routes.route('/api/auth/set-user-name', methods=['POST'])
@proxy_request('auth-service', '/api/auth/set-user-name', auth_required=True)
def auth_set_user_name():
    """Proxy user name update request to Auth Service"""
    pass

# User Session Management Routes
@gateway_routes.route('/api/auth/sessions', methods=['GET'])
@proxy_request('auth-service', '/api/auth/sessions', auth_required=True)
def auth_sessions():
    """Proxy session management request to Auth Service"""
    pass

@gateway_routes.route('/api/auth/sessions/<session_id>', methods=['DELETE'])
@proxy_request('auth-service', '/api/auth/sessions/<session_id>', auth_required=True)
def auth_delete_session(session_id):
    """Proxy session deletion request to Auth Service"""
    pass

@gateway_routes.route('/api/auth/sessions/all', methods=['DELETE'])
@proxy_request('auth-service', '/api/auth/sessions/all', auth_required=True)
def auth_delete_all_sessions():
    """Proxy delete all sessions request to Auth Service"""
    pass

# Maintenance Routes (admin only)
@gateway_routes.route('/api/auth/maintenance/cleanup', methods=['POST'])
@proxy_request('auth-service', '/api/auth/maintenance/cleanup')
def auth_maintenance():
    """Proxy maintenance request to Auth Service"""
    pass

# Service Health Check Routes
@gateway_routes.route('/api/services/health', methods=['GET'])
def services_health():
    """Get health status of all services"""
    services = service_registry.get_all_services()
    health_status = {}
    
    for service_name, service_info in services.items():
        try:
            service_url = service_info['url']
            response = requests.get(f"{service_url}/health", timeout=3)
            if response.status_code == 200:
                health_status[service_name] = {
                    'status': 'healthy',
                    'info': response.json()
                }
            else:
                health_status[service_name] = {
                    'status': 'unhealthy',
                    'code': response.status_code
                }
        except requests.RequestException:
            health_status[service_name] = {
                'status': 'unreachable'
            }
    
    return jsonify({
        'gateway': {
            'status': 'healthy',
            'version': '1.0.0'
        },
        'services': health_status
    }) 