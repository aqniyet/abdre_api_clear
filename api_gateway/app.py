"""
API Gateway for Abdre microservices architecture
Provides routing, authentication, rate limiting, circuit breaking,
request/response transformation, and metrics tracking.
"""
from flask import Flask, request, jsonify, render_template, redirect, g, Response
from flask_cors import CORS
import os
import requests
import json
import time
import uuid
import re
import jwt
import gzip
from functools import wraps
import threading
import logging
from datetime import datetime, timedelta
import hashlib
import prometheus_client
from prometheus_client import Counter, Histogram, Gauge
from werkzeug.middleware.dispatcher import DispatcherMiddleware
import html

# Import service discovery
from shared.service_discovery import ServiceRegistry, ServiceDiscovery, HealthCheck
from shared.service_discovery.init import initialize_registry

# Initialize logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize Flask app
app = Flask(__name__)

# Set template and static folder paths to use the frontend directories
app.template_folder = os.environ.get('TEMPLATE_FOLDER', '../frontend/templates')
app.static_folder = os.environ.get('STATIC_FOLDER', '../frontend/static')

# Configure CORS - using minimal settings here as we'll override in after_request
CORS(app, resources={r"/*": {"origins": "*"}})

# Set environment flag for development
IS_DEVELOPMENT = os.environ.get('FLASK_ENV', 'development') == 'development'

# Set SameSite policy for cookies in development
app.config['SESSION_COOKIE_SAMESITE'] = 'None' if os.environ.get('FLASK_ENV') == 'development' else 'Lax'
app.config['SESSION_COOKIE_SECURE'] = True

# Configure service URLs from environment variables
AUTH_SERVICE_URL = os.environ.get('AUTH_SERVICE_URL', 'http://auth_service:5001')
USER_SERVICE_URL = os.environ.get('USER_SERVICE_URL', 'http://user_service:5002')
OAUTH_SERVICE_URL = os.environ.get('OAUTH_SERVICE_URL', 'http://oauth_service:5003')
CHAT_SERVICE_URL = os.environ.get('CHAT_SERVICE_URL', 'http://chat_service:5004')
REALTIME_SERVICE_URL = os.environ.get('REALTIME_SERVICE_URL', 'http://realtime_service:5006')

# JWT Secret
JWT_SECRET = os.environ.get('JWT_SECRET', 'dev-secret-key')

# Initialize service discovery
services_config = os.environ.get('SERVICES_CONFIG', '../shared/service_discovery/services.json')
initialize_registry(config_file=services_config, start_health_checks=True)
discovery = ServiceDiscovery()

# Initialize health check
health_check = HealthCheck(app)

# Add a custom service dependency check
def check_service_dependencies():
    """Check if all required services are available"""
    services = ['auth_service', 'user_service', 'chat_service', 'oauth_service', 'realtime_service']
    results = {}
    
    for service in services:
        service_url = discovery.get_service_url(service)
        results[service] = service_url is not None
    
    return {
        'status': 'healthy' if all(results.values()) else 'degraded',
        'dependencies': results
    }

health_check.add_check('service_dependencies', check_service_dependencies)

# Define protected and public routes
PROTECTED_ROUTES = [
    r'^/api/users/.*$',
    r'^/api/chats/.*$'
]

PUBLIC_ROUTES = [
    r'^/api/auth/login$',
    r'^/api/auth/register$',
    r'^/api/test-json$',
    r'^/api/json-test$'
]

# Rate limiting configuration
REQUESTS_PER_MINUTE = int(os.environ.get('REQUESTS_PER_MINUTE', 600))  # Increased from 60 to 600
BURST_LIMIT = int(os.environ.get('BURST_LIMIT', 100))  # Increased from 20 to 100
rate_limit_data = {
    'ip': {},     # IP-based rate limiting
    'user': {}    # User-based rate limiting
}
rate_limit_lock = threading.Lock()

# Disable rate limiting in development mode
ENABLE_RATE_LIMITING = os.environ.get('ENABLE_RATE_LIMITING', 'false').lower() == 'true'

# Circuit breaker configuration
service_health = {
    'auth_service': {'failures': 0, 'last_failure': None, 'open': False},
    'user_service': {'failures': 0, 'last_failure': None, 'open': False},
    'chat_service': {'failures': 0, 'last_failure': None, 'open': False},
    'oauth_service': {'failures': 0, 'last_failure': None, 'open': False},
    'realtime_service': {'failures': 0, 'last_failure': None, 'open': False}
}
CIRCUIT_FAILURE_THRESHOLD = int(os.environ.get('CIRCUIT_FAILURE_THRESHOLD', 5))
CIRCUIT_RESET_TIMEOUT = int(os.environ.get('CIRCUIT_RESET_TIMEOUT', 30))  # seconds

# Prometheus metrics
REQUEST_COUNT = Counter('http_requests_total', 'Total HTTP Requests', ['method', 'endpoint', 'status_code'])
REQUEST_LATENCY = Histogram('http_request_duration_seconds', 'HTTP Request Latency', ['method', 'endpoint'])
ERROR_RATE = Counter('http_request_errors_total', 'Total HTTP Request Errors', ['method', 'endpoint'])
CIRCUIT_STATE = Gauge('circuit_breaker_state', 'Circuit Breaker State (0=closed, 1=open)', ['service'])

# Set up Prometheus metrics endpoint
metrics_app = prometheus_client.make_wsgi_app()
app.wsgi_app = DispatcherMiddleware(app.wsgi_app, {'/metrics': metrics_app})

# Store app start time for uptime tracking
app.start_time = time.time()

#------------------------------------------------------------------------------
# Middleware and Decorators
#------------------------------------------------------------------------------

def authenticate_token():
    """Validate JWT token from Authorization header"""
    auth_header = request.headers.get('Authorization')
    if not auth_header:
        return None
    
    try:
        # Extract token from "Bearer <token>"
        token = auth_header.split(' ')[1]
        payload = jwt.decode(token, JWT_SECRET, algorithms=['HS256'])
        return payload
    except (jwt.InvalidTokenError, IndexError):
        return None

def check_protected_route(path):
    """Check if a route requires authentication"""
    # Special test endpoints should bypass auth
    if path == '/api/json-test' or path == '/api/test-json':
        return False
        
    for pattern in PROTECTED_ROUTES:
        if re.match(pattern, path):
            return True
    
    for pattern in PUBLIC_ROUTES:
        if re.match(pattern, path):
            return False
    
    # By default, consider non-API routes as public
    return path.startswith('/api/')

def rate_limit_check(identifier, limit_type):
    """Check if a request should be rate limited"""
    # Skip rate limiting if disabled (for development)
    if not ENABLE_RATE_LIMITING:
        return True
        
    current_time = time.time()
    
    with rate_limit_lock:
        if identifier not in rate_limit_data[limit_type]:
            rate_limit_data[limit_type][identifier] = {
                'count': 0,
                'reset_time': current_time + 60,
                'last_request': current_time
            }
        
        # Reset counter if the minute has passed
        if current_time > rate_limit_data[limit_type][identifier]['reset_time']:
            rate_limit_data[limit_type][identifier] = {
                'count': 0,
                'reset_time': current_time + 60,
                'last_request': current_time
            }
        
        # Check burst limit (requests coming too fast)
        time_since_last = current_time - rate_limit_data[limit_type][identifier]['last_request']
        # Allow bursts to be more forgiving (reduced from 0.05s to 0.01s)
        if time_since_last < 0.01 and rate_limit_data[limit_type][identifier]['count'] > BURST_LIMIT:
            return False

        # Increment counter
        rate_limit_data[limit_type][identifier]['count'] += 1
        rate_limit_data[limit_type][identifier]['last_request'] = current_time
        
        # Check if over limit
        if rate_limit_data[limit_type][identifier]['count'] > REQUESTS_PER_MINUTE:
            return False
            
    return True

def circuit_check(service):
    """Check circuit breaker status for a service"""
    service_key = service.replace('_service_url', '').lower()
    if service_key not in service_health:
        return True  # Allow unknown services
    
    if service_health[service_key]['open']:
        # Check if reset timeout has passed
        if (service_health[service_key]['last_failure'] and 
            time.time() - service_health[service_key]['last_failure'] > CIRCUIT_RESET_TIMEOUT):
            # Half-open state, allow one request to try
            service_health[service_key]['open'] = False
            return True
        return False  # Circuit is open, reject request
        
    return True  # Circuit is closed, allow request

def circuit_failure(service):
    """Record a service failure in the circuit breaker"""
    service_key = service.replace('_service_url', '').lower()
    if service_key not in service_health:
        return
        
    service_health[service_key]['failures'] += 1
    service_health[service_key]['last_failure'] = time.time()
    
    if service_health[service_key]['failures'] >= CIRCUIT_FAILURE_THRESHOLD:
        service_health[service_key]['open'] = True
        CIRCUIT_STATE.labels(service=service_key).set(1)
        logger.warning(f"Circuit opened for {service_key}")

def circuit_success(service):
    """Record a service success in the circuit breaker"""
    service_key = service.replace('_service_url', '').lower()
    if service_key not in service_health:
        return
        
    if service_health[service_key]['failures'] > 0:
        service_health[service_key]['failures'] = 0
        if service_health[service_key]['open']:
            service_health[service_key]['open'] = False
            CIRCUIT_STATE.labels(service=service_key).set(0)
            logger.info(f"Circuit closed for {service_key}")

def sanitize_input(data):
    """Sanitize request input to prevent injection attacks"""
    if isinstance(data, str):
        # Remove potentially dangerous HTML/script tags
        return html.escape(data)
    elif isinstance(data, dict):
        return {k: sanitize_input(v) for k, v in data.items()}
    elif isinstance(data, list):
        return [sanitize_input(i) for i in data]
    return data

def add_correlation_id():
    """Add a correlation ID to track requests across services"""
    if 'X-Correlation-ID' not in request.headers:
        return str(uuid.uuid4())
    return request.headers['X-Correlation-ID']

def normalize_path(path):
    """Normalize API paths for consistency"""
    # Remove trailing slashes
    path = path.rstrip('/')
    # Ensure single slashes between path segments
    while '//' in path:
        path = path.replace('//', '/')
    return path

def remove_sensitive_headers(headers):
    """Remove sensitive information from response headers"""
    sensitive_headers = ['Server', 'X-Powered-By', 'X-AspNet-Version', 'X-AspNetMvc-Version']
    return {k: v for k, v in headers.items() if k not in sensitive_headers}

def should_compress_response(response):
    """Determine if a response should be compressed"""
    content_type = response.headers.get('Content-Type', '')
    content_length = len(response.data) if hasattr(response, 'data') else 0
    return (
        content_length > 1024 and  # Only compress responses larger than 1KB
        ('text/' in content_type or 
         'application/json' in content_type or 
         'application/xml' in content_type or 
         'application/javascript' in content_type)
    )

def compress_response(response):
    """Compress response data if appropriate"""
    if should_compress_response(response):
        # Check if client accepts gzip encoding
        accept_encoding = request.headers.get('Accept-Encoding', '')
        if 'gzip' in accept_encoding:
            compressed_data = gzip.compress(response.data)
            response.data = compressed_data
            response.headers['Content-Encoding'] = 'gzip'
            response.headers['Content-Length'] = str(len(compressed_data))
    return response

#------------------------------------------------------------------------------
# Request/Response Middleware
#------------------------------------------------------------------------------

@app.before_request
def before_request():
    """Run before each request to apply middleware"""
    # Skip middleware for non-API routes and metrics
    if request.path.startswith('/metrics'):
        return None
        
    # Start timing the request
    g.start_time = time.time()
    
    # Add correlation ID
    g.correlation_id = add_correlation_id()
    
    # Normalize the request path
    if request.path.startswith('/api/'):
        request.path = normalize_path(request.path)
    
    # Authentication check
    if check_protected_route(request.path):
        auth_data = authenticate_token()
        if not auth_data:
            return jsonify({
                'error': 'Unauthorized',
                'error_code': 'AUTH_REQUIRED',
                'message': 'Authentication required for this endpoint'
            }), 401
        g.user = auth_data
    
    # Skip rate limiting for UI routes and login/register
    if not request.path.startswith('/api/') or request.path in ['/login', '/register', '/public-json-test']:
        pass # Skip rate limiting for UI routes
    else:
        # Rate limiting by IP
        client_ip = request.remote_addr
        if not rate_limit_check(client_ip, 'ip'):
            return jsonify({
                'error': 'Too Many Requests',
                'error_code': 'RATE_LIMIT_EXCEEDED',
                'message': 'Rate limit exceeded'
            }), 429
        
        # Rate limiting by user if authenticated
        if hasattr(g, 'user') and 'user_id' in g.user:
            user_id = g.user['user_id']
            if not rate_limit_check(user_id, 'user'):
                return jsonify({
                    'error': 'Too Many Requests',
                    'error_code': 'RATE_LIMIT_EXCEEDED',
                    'message': 'Rate limit exceeded'
                }), 429
    
    # Sanitize input data
    if request.is_json:
        try:
            # Be careful not to consume the request data if it's already been read
            if not request.get_data(as_text=True):
                logger.warning("Empty request body for is_json request")
                return jsonify({
                    'error': 'Bad Request',
                    'error_code': 'EMPTY_JSON',
                    'message': 'Empty JSON data'
                }), 400
            
            # Try to parse JSON safely
            try:
                json_data = request.get_json(force=True, silent=True)
                if json_data is None:
                    logger.warning("Failed to parse JSON data")
                    return jsonify({
                        'error': 'Bad Request',
                        'error_code': 'INVALID_JSON',
                        'message': 'Invalid JSON data'
                    }), 400
                g.sanitized_data = sanitize_input(json_data)
            except Exception as e:
                logger.error(f"JSON parsing error: {str(e)}")
                return jsonify({
                    'error': 'Bad Request',
                    'error_code': 'INVALID_JSON',
                    'message': f'Invalid JSON data: {str(e)}'
                }), 400
        except Exception as e:
            logger.error(f"Request data processing error: {str(e)}")
            return jsonify({
                'error': 'Bad Request',
                'error_code': 'REQUEST_ERROR',
                'message': 'Error processing request data'
            }), 400

@app.after_request
def after_request(response):
    """Run after each request to apply response middleware"""
    # Skip middleware for non-API routes and metrics
    if request.path.startswith('/metrics'):
        return response
        
    # Record metrics
    if hasattr(g, 'start_time'):
        # Calculate request duration
        duration = time.time() - g.start_time
        
        # Record metrics in Prometheus
        endpoint = request.path
        REQUEST_COUNT.labels(method=request.method, endpoint=endpoint, status_code=response.status_code).inc()
        REQUEST_LATENCY.labels(method=request.method, endpoint=endpoint).observe(duration)
        
        if 400 <= response.status_code < 600:
            ERROR_RATE.labels(method=request.method, endpoint=endpoint).inc()
    
    # Add correlation ID to response
    if hasattr(g, 'correlation_id'):
        response.headers['X-Correlation-ID'] = g.correlation_id
    
    # Remove sensitive headers
    for key in list(response.headers.keys()):
        if key in ['Server', 'X-Powered-By']:
            del response.headers[key]
    
    # Compress large responses
    compress_response(response)
    
    return response

# Add comprehensive CORS headers
@app.after_request
def add_cors_headers(response):
    """Add CORS headers to all responses"""
    # Get origin from request
    origin = request.headers.get('Origin', '*')
    
    # In development mode, allow all origins
    if IS_DEVELOPMENT:
        response.headers['Access-Control-Allow-Origin'] = origin
    else:
        # In production, check against allowed origins
        allowed_origins = os.environ.get('CORS_ALLOWED_ORIGINS', '*').split(',')
        if origin in allowed_origins or '*' in allowed_origins:
            response.headers['Access-Control-Allow-Origin'] = origin
    
    # Allow credentials
    response.headers['Access-Control-Allow-Credentials'] = 'true'
    
    # Set allowed headers
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, X-Requested-With, X-Correlation-ID'
    
    # Set exposed headers
    response.headers['Access-Control-Expose-Headers'] = 'Content-Type, X-Correlation-ID'
    
    # Allow common methods
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS, PATCH'
    
    # Set max age for preflight requests
    if request.method == 'OPTIONS':
        response.headers['Access-Control-Max-Age'] = '86400'  # 24 hours
        
    # Add no-cache headers for authentication endpoints
    if request.path.startswith('/api/auth/'):
        response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
    
    return response

# Public test route that completely bypasses authentication
@app.route('/public-json-test', methods=['GET', 'POST'])
def public_json_test():
    """Public test endpoint, completely outside authentication checks"""
    if request.method == 'GET':
        return jsonify({
            'message': 'This is a public test JSON endpoint',
            'method': 'GET',
            'timestamp': datetime.utcnow().isoformat()
        })
    
    # For POST requests, try to parse JSON
    logger.info("Public JSON test endpoint received POST request")
    try:
        # Get raw data and try to parse it
        raw_data = request.get_data(as_text=True)
        logger.info(f"Raw data: {raw_data}")
        
        if not raw_data:
            return jsonify({
                'success': False,
                'error': 'Empty request body'
            }), 400
            
        try:
            parsed_data = json.loads(raw_data)
            logger.info(f"Successfully parsed JSON: {parsed_data}")
            
            # Return success with echo of the data
            return jsonify({
                'success': True,
                'message': 'JSON parsed successfully',
                'received': parsed_data,
                'timestamp': datetime.utcnow().isoformat()
            })
        except json.JSONDecodeError as e:
            logger.error(f"JSON parse error: {str(e)}")
            return jsonify({
                'success': False,
                'error': f'Invalid JSON: {str(e)}',
                'raw_data': raw_data
            }), 400
    except Exception as e:
        logger.error(f"Error in public JSON test endpoint: {str(e)}", exc_info=True)
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# Special route for auth helper JavaScript file
@app.route('/static/js/utils/auth-helper.js')
@app.route('/static/js/utils/auth_helper.js')
def serve_auth_helper():
    """Directly serve the auth helper JS file to avoid MIME type issues"""
    logger.info("Auth Helper JS file requested")
    
    # Read the file from disk
    file_path = os.path.join(app.static_folder, 'js/utils/auth-helper.js')
    
    if not os.path.exists(file_path):
        logger.error(f"Auth helper file not found at {file_path}")
        return "console.error('Auth helper file not found on server');", 404, {'Content-Type': 'application/javascript'}
    
    with open(file_path, 'r') as f:
        content = f.read()
        
    logger.info(f"Serving auth helper JS file ({len(content)} bytes)")
    return content, 200, {'Content-Type': 'application/javascript'}

#------------------------------------------------------------------------------
# Error Handlers
#------------------------------------------------------------------------------

@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors"""
    if request.path.startswith('/api/'):
        return jsonify({
            'error': 'Not Found',
            'error_code': 'RESOURCE_NOT_FOUND',
            'message': 'The requested resource was not found'
        }), 404
    return """
    <!DOCTYPE html>
    <html>
    <head>
        <title>Page Not Found</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 40px; text-align: center; }
            h1 { color: #333; }
            a { color: #0066cc; text-decoration: none; }
        </style>
    </head>
    <body>
        <h1>Page Not Found</h1>
        <p>The page you requested could not be found.</p>
        <p><a href="/">Go back to home</a></p>
    </body>
    </html>
    """, 404

@app.errorhandler(500)
def server_error(error):
    """Handle 500 errors"""
    logger.error(f"Internal server error: {error}")
    if request.path.startswith('/api/'):
        return jsonify({
            'error': 'Internal Server Error',
            'error_code': 'SERVER_ERROR',
            'message': 'An unexpected error occurred'
        }), 500
    return """
    <!DOCTYPE html>
    <html>
    <head>
        <title>Internal Server Error</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 40px; text-align: center; }
            h1 { color: #333; }
            a { color: #0066cc; text-decoration: none; }
        </style>
    </head>
    <body>
        <h1>Internal Server Error</h1>
        <p>Sorry, something went wrong on our end.</p>
        <p><a href="/">Go back to home</a></p>
    </body>
    </html>
    """, 500

@app.errorhandler(429)
def too_many_requests(error):
    """Handle rate limiting errors"""
    return jsonify({
        'error': 'Too Many Requests',
        'error_code': 'RATE_LIMIT_EXCEEDED',
        'message': 'Rate limit exceeded, please try again later'
    }), 429

@app.errorhandler(401)
def unauthorized(error):
    """Handle authentication errors"""
    return jsonify({
        'error': 'Unauthorized',
        'error_code': 'AUTH_REQUIRED',
        'message': 'Authentication required for this endpoint'
    }), 401

@app.errorhandler(403)
def forbidden(error):
    """Handle authorization errors"""
    return jsonify({
        'error': 'Forbidden',
        'error_code': 'PERMISSION_DENIED',
        'message': 'You do not have permission to access this resource'
    }), 403

#------------------------------------------------------------------------------
# UI Routes
#------------------------------------------------------------------------------

@app.route('/')
def index():
    """Render the main index page"""
    return render_template('index.html')

@app.route('/login')
def login():
    """Render the login page"""
    return render_template('login.html')

@app.route('/new')
def create_chat():
    """Render the create chat page"""
    return render_template('create.html')

@app.route('/chat/<room_id>')
def chat_room(room_id):
    """Render the chat room page"""
    return render_template('chat.html')

@app.route('/join/<token>')
def join_chat(token):
    """Join a chat with a token and redirect to chat page"""
    # This would verify the token with auth service and redirect to proper chat
    return redirect(f'/chat/{token}')

@app.route('/ws-test')
def websocket_test():
    """Render the WebSocket testing page"""
    return render_template('ws-test.html')

#------------------------------------------------------------------------------
# API Gateway Routes
#------------------------------------------------------------------------------

@app.route('/api/auth/login', methods=['POST', 'OPTIONS'])
def direct_login():
    """Direct login handler to bypass proxy issues"""
    # Handle OPTIONS preflight request
    if request.method == 'OPTIONS':
        response = Response('')
        response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
        response.headers.add('Access-Control-Allow-Methods', 'POST, OPTIONS')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        response.headers.add('Access-Control-Max-Age', '86400')
        return response

    logger.info(f"Direct login request received, headers: {dict(request.headers)}")
    logger.info(f"Request data: {request.get_data(as_text=True)}")
    
    try:
        # Force parse JSON regardless of Content-Type
        raw_data = request.get_data(as_text=True)
        logger.info(f"Raw data: {raw_data}")
        
        if not raw_data:
            return jsonify({
                'error': 'Bad Request',
                'error_code': 'EMPTY_REQUEST',
                'message': 'Empty request body'
            }), 400
        
        try:
            data = json.loads(raw_data)
        except json.JSONDecodeError as e:
            logger.error(f"JSON decode error: {str(e)}")
            return jsonify({
                'error': 'Bad Request', 
                'error_code': 'INVALID_JSON',
                'message': f'Invalid JSON: {str(e)}'
            }), 400
        
        if not data or 'username' not in data or 'password' not in data:
            return jsonify({
                'error': 'Missing username or password',
                'error_code': 'MISSING_FIELDS'
            }), 400
            
        # Forward request to auth service
        logger.info(f"Forwarding login request to {AUTH_SERVICE_URL}/login")
        response = requests.post(
            f"{AUTH_SERVICE_URL}/login",
            json=data,
            headers={'Content-Type': 'application/json'},
            timeout=5
        )
        
        logger.info(f"Auth service response: status={response.status_code}, text={response.text}")
        
        if response.status_code != 200:
            return jsonify({
                'error': 'Authentication failed',
                'error_code': 'AUTH_FAILED',
                'message': response.text
            }), response.status_code
            
        result = response.json()
        logger.info(f"Successful login for user: {data['username']}")
        return jsonify(result)
    except Exception as e:
        logger.error(f"Login error: {str(e)}", exc_info=True)
        return jsonify({
            'error': 'Server error',
            'error_code': 'SERVER_ERROR',
            'message': str(e)
        }), 500

@app.route('/api/auth/register', methods=['POST', 'OPTIONS'])
def direct_register():
    """Direct register handler to bypass proxy issues"""
    # Handle OPTIONS preflight request
    if request.method == 'OPTIONS':
        response = app.make_default_options_response()
        return response

    logger.info(f"Direct register request received, headers: {dict(request.headers)}")
    logger.info(f"Request data: {request.get_data(as_text=True)}")
    
    try:
        # Force parse JSON regardless of Content-Type
        raw_data = request.get_data(as_text=True)
        logger.info(f"Raw data: {raw_data}")
        
        if not raw_data:
            return jsonify({
                'error': 'Bad Request',
                'error_code': 'EMPTY_REQUEST',
                'message': 'Empty request body'
            }), 400
        
        try:
            data = json.loads(raw_data)
        except json.JSONDecodeError as e:
            logger.error(f"JSON decode error: {str(e)}")
            return jsonify({
                'error': 'Bad Request', 
                'error_code': 'INVALID_JSON',
                'message': f'Invalid JSON: {str(e)}'
            }), 400
        
        if not data or 'username' not in data or 'password' not in data or 'email' not in data:
            return jsonify({
                'error': 'Missing required fields',
                'error_code': 'MISSING_FIELDS'
            }), 400
            
        # Forward request to auth service
        logger.info(f"Forwarding register request to {AUTH_SERVICE_URL}/register")
        response = requests.post(
            f"{AUTH_SERVICE_URL}/register",
            json=data,
            headers={'Content-Type': 'application/json'},
            timeout=5
        )
        
        logger.info(f"Auth service response: status={response.status_code}, text={response.text}")
        
        if response.status_code != 201:
            return jsonify({
                'error': 'Registration failed',
                'error_code': 'REGISTRATION_FAILED',
                'message': response.text
            }), response.status_code
            
        result = response.json()
        logger.info(f"Successful registration for user: {data['username']}")
        return jsonify(result), 201
    except Exception as e:
        logger.error(f"Registration error: {str(e)}", exc_info=True)
        return jsonify({
            'error': 'Server error',
            'error_code': 'SERVER_ERROR',
            'message': str(e)
        }), 500

@app.route('/api/auth/<path:path>', methods=['GET', 'POST', 'PUT', 'DELETE'])
def auth_service_proxy(path):
    """Proxy requests to auth service"""
    if path == 'login':
        # Login is handled by direct_login
        return jsonify({'error': 'Method not allowed'}), 405
    elif path == 'register':
        # Register is handled by direct_register
        return jsonify({'error': 'Method not allowed'}), 405
    return proxy_request(f"{AUTH_SERVICE_URL}/{path}", 'AUTH_SERVICE_URL')

@app.route('/api/users/<path:path>', methods=['GET', 'POST', 'PUT', 'DELETE'])
def user_service_proxy(path):
    """Proxy requests to user service"""
    return proxy_request(f"{USER_SERVICE_URL}/{path}", 'USER_SERVICE_URL')

@app.route('/api/oauth/<path:path>', methods=['GET', 'POST', 'PUT', 'DELETE'])
def oauth_service_proxy(path):
    """Proxy requests to oauth service"""
    return proxy_request(f"{OAUTH_SERVICE_URL}/{path}", 'OAUTH_SERVICE_URL')

@app.route('/api/chats/<path:path>', methods=['GET', 'POST', 'PUT', 'DELETE'])
def chat_service_proxy(path):
    """Proxy requests to chat service"""
    return proxy_request(f"{CHAT_SERVICE_URL}/{path}", 'CHAT_SERVICE_URL')

@app.route('/api/chats', methods=['GET', 'POST', 'PUT', 'DELETE'])
def chat_service_root_proxy():
    """Proxy requests to chat service root"""
    return proxy_request(f"{CHAT_SERVICE_URL}/", 'CHAT_SERVICE_URL')

@app.route('/api/realtime/<path:path>', methods=['GET', 'POST', 'PUT', 'DELETE'])
def realtime_service_proxy(path):
    """Proxy requests to realtime service"""
    return proxy_request(f"{REALTIME_SERVICE_URL}/{path}", 'REALTIME_SERVICE_URL')

@app.route('/api/realtime/socket.io', methods=['GET', 'POST', 'OPTIONS'])
@app.route('/api/realtime/socket.io/', methods=['GET', 'POST', 'OPTIONS'])
def socketio_proxy():
    """Proxy WebSocket connections to realtime service"""
    return proxy_request(f"{REALTIME_SERVICE_URL}/socket.io/", 'REALTIME_SERVICE_URL')

@app.route('/api/ws-test', methods=['POST'])
def test_websocket():
    """Test the WebSocket connection by sending a message"""
    data = request.get_json()
    message = data.get('message', 'Test message from API Gateway')
    room = data.get('room')
    
    # Forward to realtime service
    headers = {'Content-Type': 'application/json'}
    if hasattr(g, 'correlation_id'):
        headers['X-Correlation-ID'] = g.correlation_id
    
    test_data = {
        'message': message
    }
    
    if room:
        test_data['room'] = room
    
    try:
        response = requests.post(
            f"{REALTIME_SERVICE_URL}/test-broadcast",
            headers=headers,
            json=test_data,
            timeout=5
        )
        
        return jsonify({
            'success': response.status_code == 200,
            'message': 'WebSocket test message sent'
        })
    except requests.RequestException as e:
        logger.error(f"WebSocket test error: {str(e)}")
        return jsonify({
            'success': False,
            'error': 'Failed to send test message',
            'message': str(e)
        }), 500

@app.route('/api/test-json', methods=['POST'])
def test_json():
    """Test endpoint to debug JSON handling"""
    try:
        data = request.get_data(as_text=True)
        logger.info(f"Raw data: '{data}'")
        
        try:
            if data:
                json_data = json.loads(data)
                return jsonify({
                    'success': True,
                    'received': json_data
                })
            else:
                return jsonify({
                    'success': False,
                    'error': 'Empty data'
                }), 400
        except Exception as e:
            logger.error(f"JSON parse error: {str(e)}")
            return jsonify({
                'success': False,
                'error': str(e)
            }), 400
    except Exception as e:
        logger.error(f"Test error: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# Special JSON test endpoint
@app.route('/api/json-test', methods=['GET', 'POST'])
def json_test():
    """Test endpoint to check JSON parsing"""
    if request.method == 'GET':
        return jsonify({
            'message': 'This is a test JSON endpoint',
            'method': 'GET',
            'timestamp': datetime.utcnow().isoformat()
        })
    
    # For POST requests, try to parse JSON
    logger.info(f"JSON test endpoint received POST request: headers={dict(request.headers)}")
    try:
        # Get raw data and try to parse it
        raw_data = request.get_data(as_text=True)
        logger.info(f"Raw data: {raw_data}")
        
        if not raw_data:
            return jsonify({
                'success': False,
                'error': 'Empty request body'
            }), 400
            
        try:
            parsed_data = json.loads(raw_data)
            logger.info(f"Successfully parsed JSON: {parsed_data}")
            
            # Return success with echo of the data
            return jsonify({
                'success': True,
                'message': 'JSON parsed successfully',
                'received': parsed_data,
                'timestamp': datetime.utcnow().isoformat()
            })
        except json.JSONDecodeError as e:
            logger.error(f"JSON parse error: {str(e)}")
            return jsonify({
                'success': False,
                'error': f'Invalid JSON: {str(e)}',
                'raw_data': raw_data
            }), 400
    except Exception as e:
        logger.error(f"Error in JSON test endpoint: {str(e)}", exc_info=True)
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

def proxy_request(url, service_name):
    """
    Proxy a request to the specified service URL with circuit breaker
    """
    # Check circuit breaker
    if not circuit_check(service_name):
        return jsonify({
            'error': 'Service Unavailable',
            'error_code': 'CIRCUIT_OPEN',
            'message': 'The service is currently unavailable. Please try again later.'
        }), 503
    
    # Prepare headers
    headers = {key: value for key, value in request.headers if key.lower() != 'host'}
    if hasattr(g, 'correlation_id'):
        headers['X-Correlation-ID'] = g.correlation_id
    
    # Use sanitized data if available
    if hasattr(g, 'sanitized_data'):
        # We have sanitized JSON data
        data = json.dumps(g.sanitized_data)
        if 'Content-Type' not in headers:
            headers['Content-Type'] = 'application/json'
    else:
        # Use raw data
        data = request.get_data()
    
    try:
        resp = requests.request(
            method=request.method,
            url=url,
            headers=headers,
            data=data,
            cookies=request.cookies,
            allow_redirects=False,
            timeout=5  # Set timeout to prevent long-running requests
        )
    
        # Record circuit breaker success
        circuit_success(service_name)
        
        # Handle response
        try:
            if resp.content:
                # Try to parse as JSON
                content_type = resp.headers.get('Content-Type', '')
                if 'application/json' in content_type:
                    response_data = resp.json()
                    response = jsonify(response_data)
                else:
                    # Not JSON or content type is not JSON
                    response = Response(resp.content)
            else:
                # Empty response
                response = Response('')
                
        except ValueError as e:
            # JSON parsing failed, return raw content
            logger.warning(f"Failed to parse JSON response: {str(e)}")
            response = Response(resp.content)
            
        response.status_code = resp.status_code
    
        # Add headers, but remove sensitive ones
        safe_headers = remove_sensitive_headers(resp.headers)
        for key, value in safe_headers.items():
            if key.lower() not in ('content-length', 'connection', 'content-encoding'):
                response.headers[key] = value
            
        return response
    except requests.RequestException as e:
        # Record circuit breaker failure
        circuit_failure(service_name)
        
        logger.error(f"Service request error: {str(e)} - URL: {url}")
        
        # Mask internal details in production
        if os.environ.get('FLASK_ENV') == 'production':
            error_message = "The service is currently unavailable."
        else:
            error_message = f"Service request failed: {str(e)}"
            
        return jsonify({
            'error': 'Service Unavailable',
            'error_code': 'SERVICE_ERROR',
            'message': error_message
        }), 503

#------------------------------------------------------------------------------
# Health and Monitoring
#------------------------------------------------------------------------------

@app.route('/health')
def health():
    """Health check endpoint"""
    service_statuses = {name: 'healthy' if not info['open'] else 'unhealthy' 
                       for name, info in service_health.items()}
    return jsonify({
        'status': 'healthy',
        'services': service_statuses,
        'timestamp': datetime.utcnow().isoformat()
    })

@app.route('/api/circuit-status')
def circuit_status():
    """Circuit breaker status endpoint"""
    if not hasattr(g, 'user') or 'role' not in g.user or g.user['role'] != 'admin':
        return jsonify({
            'error': 'Forbidden',
            'error_code': 'PERMISSION_DENIED',
            'message': 'Admin access required'
        }), 403
        
    return jsonify({
        'circuit_status': {name: {
            'state': 'open' if info['open'] else 'closed',
            'failures': info['failures'],
            'last_failure': datetime.fromtimestamp(info['last_failure']).isoformat() if info['last_failure'] else None
        } for name, info in service_health.items()}
    })

if __name__ == '__main__':
    # Initialize circuit breaker states in Prometheus
    for service in service_health:
        CIRCUIT_STATE.labels(service=service).set(0)
        
    app.run(host='0.0.0.0', port=5000, debug=True) 