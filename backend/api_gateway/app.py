"""
API Gateway - Main Application
Entry point for the API Gateway microservice
"""

import os
import logging
import uuid
import json
import requests
from pathlib import Path
from flask import Flask, request, g, jsonify, Response, send_from_directory
from flask_cors import CORS

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Constants
SERVICE_NAME = "api-gateway"
SERVICE_PORT = int(os.environ.get("API_GATEWAY_PORT", 5000))

# Service registry file path
DEFAULT_REGISTRY_FILE = str(Path(__file__).parent.parent.parent / "services.json")
SERVICE_REGISTRY_FILE = os.environ.get("SERVICE_REGISTRY_FILE", DEFAULT_REGISTRY_FILE)

def load_services():
    """Load services from registry file"""
    if not os.path.exists(SERVICE_REGISTRY_FILE):
        logger.warning(f"Service registry file not found: {SERVICE_REGISTRY_FILE}")
        return {}
    
    try:
        with open(SERVICE_REGISTRY_FILE, 'r') as f:
            services = json.load(f)
            logger.info(f"Loaded {len(services)} services from registry")
            return services
    except Exception as e:
        logger.error(f"Error loading service registry: {str(e)}")
        return {}

def create_app():
    """Create and configure the Flask application"""
    app = Flask(__name__, 
                template_folder='../../frontend/templates',
                static_folder='../../frontend/static')
    
    # Configure app
    app.config.update(
        SECRET_KEY=os.environ.get('SECRET_KEY', 'dev_key_for_development_only'),
        DEBUG=os.environ.get('DEBUG', 'False').lower() == 'true',
        ENV=os.environ.get('FLASK_ENV', 'development')
    )
    
    # Setup CORS
    CORS(app, 
         resources={r"/api/*": {"origins": ["http://localhost:8080", "http://127.0.0.1:8080", "http://192.168.0.149:8080"]}},
         supports_credentials=True,
         allow_headers=["Content-Type", "content-type", "Authorization", "X-Requested-With", "X-Session-ID"],
         methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"])
    
    # Add request ID middleware
    @app.before_request
    def add_request_id():
        """Add request ID to each request for tracing"""
        # Use existing request ID if provided in header
        g.request_id = request.headers.get('X-Request-Id', str(uuid.uuid4()))
        
    # Add response headers middleware
    @app.after_request
    def add_response_headers(response):
        """Add security and tracing headers to responses"""
        # Security headers
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'DENY'
        response.headers['X-XSS-Protection'] = '1; mode=block'
        
        # CORS headers - use specific origins when credentials are supported
        origin = request.headers.get('Origin')
        if origin in ["http://localhost:8080", "http://127.0.0.1:8080", "http://192.168.0.149:8080"]:
            response.headers['Access-Control-Allow-Origin'] = origin
            response.headers['Access-Control-Allow-Credentials'] = 'true'
            response.headers['Access-Control-Allow-Headers'] = 'Content-Type, content-type, Authorization, X-Requested-With, X-Session-ID'
            response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS'
            
            # For preflight requests, ensure they succeed
            if request.method == 'OPTIONS':
                response.status_code = 200
        
        # Add content security policy in production
        if os.environ.get('FLASK_ENV') == 'production':
            response.headers['Content-Security-Policy'] = (
                "default-src 'self'; "
                "script-src 'self' 'unsafe-inline'; "
                "style-src 'self' 'unsafe-inline'; "
                "img-src 'self' data:; "
                "font-src 'self'; "
                "connect-src 'self'"
            )
        
        # Tracing header
        response.headers['X-Request-Id'] = g.get('request_id', 'unknown')
        
        return response
    
    # Socket.IO specific routes to handle websocket connections
    @app.route('/socket.io/', defaults={'path': ''})
    @app.route('/socket.io/<path:path>')
    def proxy_socketio(path=''):
        """Proxy Socket.IO connections to Realtime Service"""
        # Use the special handling for socket.io
        return proxy_request_to_service('realtime-service', f'/socket.io/{path}', 
                                        preserve_query_string=True, websocket=True)
    
    # Socket.IO test endpoint
    @app.route('/socket.io-test')
    def proxy_socketio_test():
        """Proxy Socket.IO test endpoint to Realtime Service"""
        return proxy_request_to_service('realtime-service', '/socket.io-test')
    
    # API proxy routes
    @app.route('/api/auth/<path:subpath>', methods=['GET', 'POST', 'PUT', 'DELETE'])
    def proxy_auth(subpath):
        """Proxy requests to Auth Service"""
        return proxy_request_to_service('auth-service', f'/api/auth/{subpath}')
    
    @app.route('/api/users/profile', methods=['GET', 'PUT'])
    def proxy_user_own_profile():
        """Proxy user's own profile requests to User Service"""
        return proxy_request_to_service('user-service', '/api/users/profile')
    
    @app.route('/api/users/profile/<path:user_id>', methods=['GET', 'PUT', 'DELETE'])
    def proxy_user_profile(user_id):
        """Proxy user profile requests to User Service"""
        return proxy_request_to_service('user-service', f'/api/users/profile/{user_id}')
    
    @app.route('/api/users/profile/username/<path:username>', methods=['GET'])
    def proxy_user_profile_by_username(username):
        """Proxy user profile by username requests to User Service"""
        return proxy_request_to_service('user-service', f'/api/users/profile/username/{username}')
    
    @app.route('/api/users/settings', methods=['GET', 'PUT'])
    def proxy_user_own_settings():
        """Proxy user's own settings requests to User Service"""
        return proxy_request_to_service('user-service', '/api/users/settings')
    
    @app.route('/api/users/settings/<path:user_id>', methods=['GET', 'PUT'])
    def proxy_user_settings(user_id):
        """Proxy user settings requests to User Service"""
        return proxy_request_to_service('user-service', f'/api/users/settings/{user_id}')
    
    @app.route('/api/users/avatar', methods=['POST'])
    def proxy_user_avatar():
        """Proxy user avatar upload requests to User Service"""
        return proxy_request_to_service('user-service', '/api/users/avatar')
    
    @app.route('/api/users/search', methods=['GET'])
    def proxy_user_search():
        """Proxy user search requests to User Service"""
        return proxy_request_to_service('user-service', '/api/users/search', preserve_query_string=True)
    
    @app.route('/api/users/<path:subpath>', methods=['GET', 'POST', 'PUT', 'DELETE'])
    def proxy_users(subpath):
        """Proxy requests to User Service for user endpoints"""
        # This is a fallback for any other user service endpoints not specifically defined
        return proxy_request_to_service('user-service', f'/api/users/{subpath}')
    
    @app.route('/api/realtime/<path:subpath>', methods=['GET', 'POST', 'PUT', 'DELETE'])
    def proxy_realtime(subpath):
        """Proxy requests to Realtime Service"""
        return proxy_request_to_service('realtime-service', f'/api/realtime/{subpath}')
    
    @app.route('/api/qr-chat/<path:subpath>', methods=['GET', 'POST', 'PUT', 'DELETE'])
    def proxy_qr_chat(subpath):
        """Proxy requests to QR Chat Service"""
        return proxy_request_to_service('qr-service', f'/api/qr-chat/{subpath}')
    
    @app.route('/api/chat/<path:subpath>', methods=['GET', 'POST', 'PUT', 'DELETE'])
    def proxy_chat(subpath):
        """Proxy requests to Chat Service"""
        return proxy_request_to_service('chat-service', f'/api/chat/{subpath}')
    
    # Web routes - handled by main application
    @app.route('/', defaults={'path': ''})
    @app.route('/<path:path>')
    def catch_all(path):
        """Import and use the actual handler from the monolithic app for web routes"""
        # Comment out the problematic import that's causing the error
        # from backend import create_app as create_main_app
        
        try:
            # Return a basic HTML response for now since the main app integration isn't working
            if path.endswith(('.js', '.css', '.png', '.jpg', '.svg', '.ico')):
                # Try to serve static files if requested
                try:
                    return send_from_directory(app.static_folder, path)
                except:
                    return "", 404
            
            return f"""
            <html>
                <head>
                    <title>ABDRE Chat</title>
                    <style>
                        body {{ font-family: Arial, sans-serif; padding: 20px; }}
                        h1 {{ color: #333; }}
                    </style>
                </head>
                <body>
                    <h1>Welcome to ABDRE Chat</h1>
                    <p>The frontend is being served through the API Gateway. Visit one of the following URLs:</p>
                    <ul>
                        <li><a href="/api/services/status">Services Status</a></li>
                        <li><a href="/health">API Gateway Health</a></li>
                    </ul>
                </body>
            </html>
            """
            
            # Original code is commented out since it depends on the missing import
            # main_app = create_main_app()
            # Create a modified copy of headers (to avoid immutability issues)
            # headers_dict = dict(request.headers)
            
            # Fix static file paths - check if this is a static file request from a sub-route
            # if '/static/' in path and path.startswith(('my-chats/', 'profile/', 'chat/')):
            #     # Extract the actual static file path
            #     parts = path.split('/static/', 1)
            #     if len(parts) > 1:
            #         # Rewrite to use the main static path
            #         return send_from_directory(
            #             app.static_folder, 
            #             parts[1],
            #             as_attachment=False
            #         )
            
            # Create a test request context with copied headers
            # with main_app.test_request_context(
            #     path=request.path,
            #     base_url=request.base_url,
            #     query_string=request.query_string,
            #     method=request.method,
            #     headers=headers_dict,
            #     data=request.get_data()
            # ):
            #     # Dispatch the request to the main app
            #     response = main_app.full_dispatch_request()
            #     return response
        except Exception as e:
            logger.error(f"Error in catch_all handler: {str(e)}")
            # Fallback to direct proxy to the main application
            return jsonify({
                "error": "Failed to proxy request to main application",
                "message": str(e)
            }), 500
    
    # Gateway service health check endpoint
    @app.route('/health')
    def health():
        """Health check endpoint"""
        return jsonify({
            'status': 'healthy',
            'service': SERVICE_NAME,
            'version': '1.0.0'
        })
    
    # Services status endpoint
    @app.route('/api/services/status')
    def services_status():
        """Get status of all services"""
        services = load_services()
        status = {}
        
        for name, service in services.items():
            try:
                url = service['url']
                response = requests.get(f"{url}/health", timeout=2)
                if response.status_code == 200:
                    status[name] = {
                        'status': 'healthy',
                        'data': response.json()
                    }
                else:
                    status[name] = {
                        'status': 'unhealthy',
                        'code': response.status_code
                    }
            except Exception as e:
                status[name] = {
                    'status': 'unavailable',
                    'error': str(e)
                }
        
        # Add API Gateway status
        status['api-gateway'] = {
            'status': 'healthy',
            'data': {
                'service': SERVICE_NAME,
                'version': '1.0.0'
            }
        }
        
        return jsonify({
            'services': status,
            'timestamp': import_time()
        })
    
    return app

def proxy_request_to_service(service_name, path, preserve_query_string=False, websocket=False):
    """Proxy a request to the specified service"""
    services = load_services()
    
    if service_name not in services:
        logger.error(f"Service {service_name} not found in registry")
        return jsonify({
            "error": f"Service {service_name} not available"
        }), 503
    
    service = services[service_name]
    url = service['url']
    
    target_url = f"{url}{path}"
    if preserve_query_string and request.query_string:
        target_url = f"{target_url}?{request.query_string.decode('utf-8')}"
    
    logger.debug(f"Proxying request to: {target_url}")
    
    headers = {}
    # Copy request headers
    for header, value in request.headers:
        # Skip host header to allow the request to reach the target service
        if header.lower() not in ['host', 'content-length']:
            headers[header] = value
    
    # Add forwarding headers to identify the original request
    headers['X-Forwarded-For'] = request.remote_addr
    headers['X-Forwarded-Proto'] = request.scheme
    
    # Add original host header as X-Forwarded-Host
    original_host = request.headers.get('Host')
    if original_host:
        headers['X-Forwarded-Host'] = original_host
    
    # Add request ID
    request_id = g.get('request_id', 'unknown')
    headers['X-Request-Id'] = request_id
    
    # Special handling for websockets
    if websocket:
        from werkzeug.datastructures import Headers
        headers_obj = Headers(headers)
        return Response(
            requests.request(
                method=request.method,
                url=target_url,
                headers=headers_obj,
                data=request.get_data(),
                cookies=request.cookies,
                stream=True
            ).iter_content(),
            content_type=request.headers.get('Content-Type'),
            direct_passthrough=True
        )
    
    # Standard request
    try:
        response = requests.request(
            method=request.method,
            url=target_url,
            headers=headers,
            data=request.get_data(),
            cookies=request.cookies,
            timeout=10
        )
        
        logger.debug(f"Proxy response from {service_name}: {response.status_code}")
        
        # Convert response from service to Flask response
        resp = Response(
            response.content,
            status=response.status_code
        )
        
        # Copy headers from service response
        for header, value in response.headers.items():
            if header.lower() not in ['content-length', 'connection', 'transfer-encoding']:
                resp.headers[header] = value
                
        return resp
    except requests.exceptions.RequestException as e:
        logger.error(f"Error proxying request to {service_name}: {str(e)}")
        return jsonify({
            "error": f"Error communicating with service: {str(e)}"
        }), 503

def import_time():
    """Get current time"""
    import datetime
    return datetime.datetime.now().isoformat()

def run_gateway():
    """Run the API Gateway"""
    app = create_app()
    logger.info(f"Starting {SERVICE_NAME} on port {SERVICE_PORT}")
    app.run(host='0.0.0.0', port=SERVICE_PORT, debug=app.config['DEBUG'])

if __name__ == '__main__':
    run_gateway() 