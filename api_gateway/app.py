"""
API Gateway for Abdre microservices architecture
Provides routing, authentication, rate limiting, circuit breaking,
request/response transformation, and metrics tracking.
"""

import gzip
import hashlib
import html
import json
import logging
import os
import re
import threading
import time
import uuid
from datetime import datetime, timedelta
from functools import wraps

# Fix: Import PyJWT correctly without aliasing
import jwt as PyJWT
import prometheus_client
import requests
from flask import (
    Flask,
    Response,
    g,
    jsonify,
    redirect,
    render_template,
    request,
    send_from_directory,
    make_response,
)
from flask_cors import CORS
from prometheus_client import Counter, Gauge, Histogram
from werkzeug.middleware.dispatcher import DispatcherMiddleware

# Import service discovery
from shared.service_discovery import HealthCheck, ServiceDiscovery, ServiceRegistry, initialize_registry

# Initialize logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize Flask app
app = Flask(__name__)

# Set template and static folder paths to use the frontend directories
app.template_folder = os.environ.get("TEMPLATE_FOLDER", "../frontend/templates")
app.static_folder = os.environ.get("STATIC_FOLDER", "../frontend/static")

# Configure CORS - using minimal settings here as we'll override in after_request
CORS(app, resources={r"/*": {"origins": "*"}})

# Set environment flag for development
IS_DEVELOPMENT = os.environ.get("FLASK_ENV", "development") == "development"

# Set SameSite policy for cookies in development
app.config["SESSION_COOKIE_SAMESITE"] = (
    "None" if os.environ.get("FLASK_ENV") == "development" else "Lax"
)
app.config["SESSION_COOKIE_SECURE"] = True

# Configure service URLs from environment variables
AUTH_SERVICE_URL = os.environ.get("AUTH_SERVICE_URL", "http://localhost:5501")
USER_SERVICE_URL = os.environ.get("USER_SERVICE_URL", "http://localhost:5502")
OAUTH_SERVICE_URL = os.environ.get("OAUTH_SERVICE_URL", "http://localhost:5503")
CHAT_SERVICE_URL = os.environ.get("CHAT_SERVICE_URL", "http://localhost:5504")
REALTIME_SERVICE_URL = os.environ.get(
    "REALTIME_SERVICE_URL", "http://localhost:5506"
)

# JWT Secret
JWT_SECRET = os.environ.get("JWT_SECRET", "dev-secret-key")

# Initialize service discovery
services_config = os.environ.get(
    "SERVICES_CONFIG", "../shared/service_discovery/services.json"
)
initialize_registry(config_file=services_config, start_health_checks=True)
discovery = ServiceDiscovery()

# Initialize health check
health_check = HealthCheck(app)

# Add a custom service dependency check
def check_service_dependencies():
    """Check if all required services are available"""
    services = [
        "auth_service",
        "user_service",
        "chat_service",
        "oauth_service",
        "realtime_service",
    ]
    results = {}

    for service in services:
        service_url = discovery.get_service_url(service)
        results[service] = service_url is not None

    return {
        "status": "healthy" if all(results.values()) else "degraded",
        "dependencies": results,
    }

health_check.add_check("service_dependencies", check_service_dependencies)

# Define protected and public routes
PROTECTED_ROUTES = [
    r"^/api/users/.*$",
    r"^/api/chats/[^/]+$",  # Match /api/chats/{id} but not /api/chats/{id}/messages
    r"^/api/chats/[^/]+/(?!messages).*$",  # Match other chat endpoints but exclude messages
]

PUBLIC_ROUTES = [
    r"^/api/auth/login$",
    r"^/api/auth/register$",
    r"^/api/auth/refresh$",
    r"^/api/auth/get-or-create-visitor-id$",
    r"^/api/auth/verify$",
    r"^/api/test-json$",
    r"^/api/json-test$",
    r"^/api/chats$",  # Root chats endpoint as public
    r"^/api/chats/[^/]+/messages$",  # Make the messages endpoint public
    r"^/api/chats/invitation-status/.*$",  # Make invitation status endpoint public
    r"^/api/chats/accept-invitation/.*$",  # Make invitation acceptance endpoint public
    r"^/api/chats/generate-invitation$",  # Make invitation generation endpoint public
    r"^/api/chats/cleanup-expired-invitations$",  # Add cleanup endpoint as public
    r"^/api/my-chats$",  # Allow access to my-chats without auth for demo
    r"^/api/realtime/check-connection$",  # Allow connection check without auth
    r"^/api/realtime/socket\.io.*$"  # Allow all socket.io endpoints without auth
]

# Rate limiting configuration
REQUESTS_PER_MINUTE = int(
    os.environ.get("REQUESTS_PER_MINUTE", 600)
)  # Increased from 60 to 600
BURST_LIMIT = int(os.environ.get("BURST_LIMIT", 100))  # Increased from 20 to 100
rate_limit_data = {
    "ip": {},  # IP-based rate limiting
    "user": {},  # User-based rate limiting
}
rate_limit_lock = threading.Lock()

# Disable rate limiting in development mode
ENABLE_RATE_LIMITING = os.environ.get("ENABLE_RATE_LIMITING", "false").lower() == "true"

# Circuit breaker configuration
service_health = {
    "auth_service": {"failures": 0, "last_failure": None, "open": False},
    "user_service": {"failures": 0, "last_failure": None, "open": False},
    "chat_service": {"failures": 0, "last_failure": None, "open": False},
    "oauth_service": {"failures": 0, "last_failure": None, "open": False},
    "realtime_service": {"failures": 0, "last_failure": None, "open": False},
}
CIRCUIT_FAILURE_THRESHOLD = int(os.environ.get("CIRCUIT_FAILURE_THRESHOLD", 5))
CIRCUIT_RESET_TIMEOUT = int(os.environ.get("CIRCUIT_RESET_TIMEOUT", 30))  # seconds

# Prometheus metrics
REQUEST_COUNT = Counter(
    "http_requests_total", "Total HTTP Requests", ["method", "endpoint", "status_code"]
)
REQUEST_LATENCY = Histogram(
    "http_request_duration_seconds", "HTTP Request Latency", ["method", "endpoint"]
)
ERROR_RATE = Counter(
    "http_request_errors_total", "Total HTTP Request Errors", ["method", "endpoint"]
)
CIRCUIT_STATE = Gauge(
    "circuit_breaker_state", "Circuit Breaker State (0=closed, 1=open)", ["service"]
)

# Set up Prometheus metrics endpoint
metrics_app = prometheus_client.make_wsgi_app()
app.wsgi_app = DispatcherMiddleware(app.wsgi_app, {"/metrics": metrics_app})

# Store app start time for uptime tracking
app.start_time = time.time()

# Add template existence check helper
def template_exists(template_name):
    """Check if a template file exists in the configured template folder"""
    template_path = os.path.join(app.template_folder, template_name)
    exists = os.path.isfile(template_path)
    if not exists:
        logger.warning(f"Template not found: {template_name} at path {template_path}")
    return exists

# ------------------------------------------------------------------------------
# Middleware and Decorators
# ------------------------------------------------------------------------------


def authenticate_token():
    """Validate JWT token from Authorization header"""
    auth_header = request.headers.get("Authorization")
    if not auth_header:
        return None

    try:
        # Extract token from "Bearer <token>"
        token = auth_header.split(" ")[1]
        payload = PyJWT.decode(token, JWT_SECRET, algorithms=["HS256"])
        return payload
    except (PyJWT.exceptions.InvalidTokenError, PyJWT.exceptions.DecodeError, IndexError, AttributeError):
        return None


def check_protected_route(path):
    """Check if a route requires authentication"""
    # Special test endpoints should bypass auth
    if path == "/api/json-test" or path == "/api/test-json" or path == "/api/ws-test":
        return False

    # Temporary fix: always allow access to chat message endpoints
    if "/api/chats/" in path and "/messages" in path:
        logger.info(f"TEMPORARY FIX: Bypassing auth for chat messages endpoint: {path}")
        return False
        
    # Explicitly handle invitation endpoints
    if (
        path == "/api/chats/generate-invitation" or
        path.startswith("/api/chats/invitation-status/") or
        path.startswith("/api/chats/accept-invitation/") or
        path == "/api/chats/cleanup-expired-invitations"
    ):
        logger.info(f"Bypassing auth for invitation endpoint: {path}")
        return False

    for pattern in PROTECTED_ROUTES:
        if re.match(pattern, path):
            return True

    for pattern in PUBLIC_ROUTES:
        if re.match(pattern, path):
            return False

    # By default, consider non-API routes as public
    return path.startswith("/api/")


def rate_limit_check(identifier, limit_type):
    """Check if a request should be rate limited"""
    # Skip rate limiting if disabled (for development)
    if not ENABLE_RATE_LIMITING:
        return True

    current_time = time.time()

    with rate_limit_lock:
        if identifier not in rate_limit_data[limit_type]:
            rate_limit_data[limit_type][identifier] = {
                "count": 0,
                "reset_time": current_time + 60,
                "last_request": current_time,
            }

        # Reset counter if the minute has passed
        if current_time > rate_limit_data[limit_type][identifier]["reset_time"]:
            rate_limit_data[limit_type][identifier] = {
                "count": 0,
                "reset_time": current_time + 60,
                "last_request": current_time,
            }

        # Check burst limit (requests coming too fast)
        time_since_last = (
            current_time - rate_limit_data[limit_type][identifier]["last_request"]
        )
        # Allow bursts to be more forgiving (reduced from 0.05s to 0.01s)
        if (
            time_since_last < 0.01
            and rate_limit_data[limit_type][identifier]["count"] > BURST_LIMIT
        ):
            return False

        # Increment counter
        rate_limit_data[limit_type][identifier]["count"] += 1
        rate_limit_data[limit_type][identifier]["last_request"] = current_time

        # Check if over limit
        if rate_limit_data[limit_type][identifier]["count"] > REQUESTS_PER_MINUTE:
            return False

    return True


def circuit_check(service):
    """Check circuit breaker status for a service"""
    service_key = service.replace("_service_url", "").lower()
    if service_key not in service_health:
        return True  # Allow unknown services

    if service_health[service_key]["open"]:
        # Check if reset timeout has passed
        if (
            service_health[service_key]["last_failure"]
            and time.time() - service_health[service_key]["last_failure"]
            > CIRCUIT_RESET_TIMEOUT
        ):
            # Half-open state, allow one request to try
            service_health[service_key]["open"] = False
            return True
        return False  # Circuit is open, reject request

    return True  # Circuit is closed, allow request


def circuit_failure(service):
    """Record a service failure in the circuit breaker"""
    service_key = service.replace("_service_url", "").lower()
    if service_key not in service_health:
        return

    service_health[service_key]["failures"] += 1
    service_health[service_key]["last_failure"] = time.time()

    if service_health[service_key]["failures"] >= CIRCUIT_FAILURE_THRESHOLD:
        service_health[service_key]["open"] = True
        CIRCUIT_STATE.labels(service=service_key).set(1)
        logger.warning(f"Circuit opened for {service_key}")


def circuit_success(service):
    """Record a service success in the circuit breaker"""
    service_key = service.replace("_service_url", "").lower()
    if service_key not in service_health:
        return

    if service_health[service_key]["failures"] > 0:
        service_health[service_key]["failures"] = 0
        if service_health[service_key]["open"]:
            service_health[service_key]["open"] = False
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
    if "X-Correlation-ID" not in request.headers:
        return str(uuid.uuid4())
    return request.headers["X-Correlation-ID"]


def normalize_path(path):
    """Normalize API paths for consistency"""
    # Remove trailing slashes
    path = path.rstrip("/")
    # Ensure single slashes between path segments
    while "//" in path:
        path = path.replace("//", "/")
    return path


def remove_sensitive_headers(headers):
    """Remove sensitive information from response headers"""
    sensitive_headers = [
        "Server",
        "X-Powered-By",
        "X-AspNet-Version",
        "X-AspNetMvc-Version",
    ]
    return {k: v for k, v in headers.items() if k not in sensitive_headers}


def should_compress_response(response):
    """Determine if a response should be compressed"""
    # Skip compression for file responses or special response types
    if not hasattr(response, "data") or getattr(response, "direct_passthrough", False):
        return False

    content_type = response.headers.get("Content-Type", "")
    content_length = len(response.data) if hasattr(response, "data") else 0

    # Skip compression for images, icons, and binary files
    if (
        "image/" in content_type
        or "icon" in content_type
        or "application/octet-stream" in content_type
    ):
        return False

    return content_length > 1024 and (  # Only compress responses larger than 1KB
        "text/" in content_type
        or "application/json" in content_type
        or "application/xml" in content_type
        or "application/javascript" in content_type
    )


def compress_response(response):
    """Compress response data if appropriate"""
    # Skip compression for static files or direct passthrough responses
    if (
        getattr(response, "direct_passthrough", False)
        or not hasattr(response, "data")
        or response.mimetype.startswith("image/")
        or response.mimetype.startswith("font/")
        or request.path.startswith("/static/")
        or request.path == "/favicon.ico"
        or response.mimetype == "application/octet-stream"
    ):
        return response

    # Safely get content type and check if it should be compressed
    content_type = response.headers.get("Content-Type", "")
    should_compress = (
        hasattr(response, "data")
        and len(response.data) > 1024
        and (
            "text/" in content_type
            or "application/json" in content_type
            or "application/xml" in content_type
            or "application/javascript" in content_type
        )
    )

    if should_compress:
        # Check if client accepts gzip encoding
        accept_encoding = request.headers.get("Accept-Encoding", "")
        if "gzip" in accept_encoding:
            try:
                compressed_data = gzip.compress(response.data)
                response.data = compressed_data
                response.headers["Content-Encoding"] = "gzip"
                response.headers["Content-Length"] = str(len(compressed_data))
            except Exception as e:
                # Log error but don't fail if compression fails
                print(f"Compression error: {e}")

    return response


# ------------------------------------------------------------------------------
# Request/Response Middleware
# ------------------------------------------------------------------------------


@app.before_request
def before_request():
    """Run before each request to apply middleware"""
    # Skip middleware for non-API routes and metrics
    if request.path.startswith("/metrics"):
        return None

    # Start timing the request
    g.start_time = time.time()

    # Add correlation ID
    g.correlation_id = add_correlation_id()

    # Normalize the request path
    if request.path.startswith("/api/"):
        request.path = normalize_path(request.path)

    # Authentication check
    if check_protected_route(request.path):
        auth_data = authenticate_token()
        if not auth_data:
            return (
                jsonify(
                    {
                        "error": "Unauthorized",
                        "error_code": "AUTH_REQUIRED",
                        "message": "Authentication required for this endpoint",
                    }
                ),
                401,
            )
        g.user = auth_data

    # Skip rate limiting for UI routes and login/register
    if not request.path.startswith("/api/") or request.path in [
        "/login",
        "/register",
        "/public-json-test",
    ]:
        pass  # Skip rate limiting for UI routes
    else:
        # Rate limiting by IP
        client_ip = request.remote_addr
        if not rate_limit_check(client_ip, "ip"):
            return (
                jsonify(
                    {
                        "error": "Too Many Requests",
                        "error_code": "RATE_LIMIT_EXCEEDED",
                        "message": "Rate limit exceeded",
                    }
                ),
                429,
            )

        # Rate limiting by user if authenticated
        if hasattr(g, "user") and "user_id" in g.user:
            user_id = g.user["user_id"]
            if not rate_limit_check(user_id, "user"):
                return (
                    jsonify(
                        {
                            "error": "Too Many Requests",
                            "error_code": "RATE_LIMIT_EXCEEDED",
                            "message": "Rate limit exceeded",
                        }
                    ),
                    429,
                )

    # Special handling for GET requests to /api/chats/*/messages endpoint
    # Skip JSON validation for these requests even if Content-Type is application/json
    if (
        request.method == "GET"
        and "/api/chats/" in request.path
        and "/messages" in request.path
    ):
        return None

    # Sanitize input data - skip for GET requests since they shouldn't have a body
    if request.is_json and request.method != "GET":
        try:
            # Skip validation for GET requests to message endpoints even if they have Content-Type: application/json
            if (
                request.method == "GET"
                and "/api/chats/" in request.path
                and "/messages" in request.path
            ):
                return None

            # Be careful not to consume the request data if it's already been read
            if not request.get_data(as_text=True):
                logger.warning("Empty request body for is_json request")
                return (
                    jsonify(
                        {
                            "error": "Bad Request",
                            "error_code": "EMPTY_JSON",
                            "message": "Empty JSON data",
                        }
                    ),
                    400,
                )

            # Try to parse JSON safely
            try:
                json_data = request.get_json(force=True, silent=True)
                if json_data is None:
                    logger.warning("Failed to parse JSON data")
                    return (
                        jsonify(
                            {
                                "error": "Bad Request",
                                "error_code": "INVALID_JSON",
                                "message": "Invalid JSON data",
                            }
                        ),
                        400,
                    )
                g.sanitized_data = sanitize_input(json_data)
            except Exception as e:
                logger.error(f"JSON parsing error: {str(e)}")
                return (
                    jsonify(
                        {
                            "error": "Bad Request",
                            "error_code": "INVALID_JSON",
                            "message": f"Invalid JSON data: {str(e)}",
                        }
                    ),
                    400,
                )
        except Exception as e:
            logger.error(f"Request data processing error: {str(e)}")
            return (
                jsonify(
                    {
                        "error": "Bad Request",
                        "error_code": "REQUEST_ERROR",
                        "message": "Error processing request data",
                    }
                ),
                400,
            )


@app.after_request
def after_request(response):
    """Run after each request to apply response middleware"""
    # Skip middleware for metrics endpoint
    if request.path.startswith("/metrics"):
        return response

    # Skip middleware for static resources
    if request.path.startswith("/static/") or request.path == "/favicon.ico":
        # Only add security headers for static content
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "SAMEORIGIN"
        return response

    # Record metrics
    if hasattr(g, "start_time"):
        # Calculate request duration
        duration = time.time() - g.start_time

        # Record metrics in Prometheus
        endpoint = request.path
        REQUEST_COUNT.labels(
            method=request.method, endpoint=endpoint, status_code=response.status_code
        ).inc()
        REQUEST_LATENCY.labels(method=request.method, endpoint=endpoint).observe(
            duration
        )

        if 400 <= response.status_code < 600:
            ERROR_RATE.labels(method=request.method, endpoint=endpoint).inc()

    # Add correlation ID to response
    if hasattr(g, "correlation_id"):
        response.headers["X-Correlation-ID"] = g.correlation_id

    # Remove sensitive headers
    for key in list(response.headers.keys()):
        if key in ["Server", "X-Powered-By"]:
            del response.headers[key]

    # Compress large responses (safely)
    try:
        return compress_response(response)
    except Exception as e:
        print(f"Error in compression middleware: {e}")
        return response


# Add comprehensive CORS headers
@app.after_request
def add_cors_headers(response):
    """Add CORS headers to all responses"""
    # Get origin from request
    origin = request.headers.get("Origin", "*")

    # In development mode, allow all origins
    if IS_DEVELOPMENT:
        response.headers["Access-Control-Allow-Origin"] = origin
    else:
        # In production, check against allowed origins
        allowed_origins = os.environ.get("CORS_ALLOWED_ORIGINS", "*").split(",")
        if origin in allowed_origins or "*" in allowed_origins:
            response.headers["Access-Control-Allow-Origin"] = origin

    # Allow credentials
    response.headers["Access-Control-Allow-Credentials"] = "true"

    # Set allowed headers
    response.headers["Access-Control-Allow-Headers"] = (
        "Content-Type, Authorization, X-Requested-With, X-Correlation-ID"
    )

    # Set exposed headers
    response.headers["Access-Control-Expose-Headers"] = "Content-Type, X-Correlation-ID"

    # Allow common methods
    response.headers["Access-Control-Allow-Methods"] = (
        "GET, POST, PUT, DELETE, OPTIONS, PATCH"
    )

    # Set max age for preflight requests
    if request.method == "OPTIONS":
        response.headers["Access-Control-Max-Age"] = "86400"  # 24 hours

    # Add no-cache headers for authentication endpoints
    if request.path.startswith("/api/auth/"):
        response.headers["Cache-Control"] = (
            "no-store, no-cache, must-revalidate, max-age=0"
        )
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"

    return response


# Public test route that completely bypasses authentication
@app.route("/public-json-test", methods=["GET", "POST"])
def public_json_test():
    """Public test endpoint, completely outside authentication checks"""
    if request.method == "GET":
        return jsonify(
            {
                "message": "This is a public test JSON endpoint",
                "method": "GET",
                "timestamp": datetime.utcnow().isoformat(),
            }
        )

    # For POST requests, try to parse JSON
    logger.info("Public JSON test endpoint received POST request")
    try:
        # Get raw data and try to parse it
        raw_data = request.get_data(as_text=True)
        logger.info(f"Raw data: {raw_data}")

        if not raw_data:
            return jsonify({"success": False, "error": "Empty request body"}), 400

        try:
            parsed_data = json.loads(raw_data)
            logger.info(f"Successfully parsed JSON: {parsed_data}")

            # Return success with echo of the data
            return jsonify(
                {
                    "success": True,
                    "message": "JSON parsed successfully",
                    "received": parsed_data,
                    "timestamp": datetime.utcnow().isoformat(),
                }
            )
        except json.JSONDecodeError as e:
            logger.error(f"JSON parse error: {str(e)}")
            return (
                jsonify(
                    {
                        "success": False,
                        "error": f"Invalid JSON: {str(e)}",
                        "raw_data": raw_data,
                    }
                ),
                400,
            )
    except Exception as e:
        logger.error(f"Error in public JSON test endpoint: {str(e)}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


# Special route for auth helper JavaScript file
@app.route("/static/js/utils/auth-helper.js")
@app.route("/static/js/utils/auth_helper.js")
def serve_auth_helper():
    """Directly serve the auth helper JS file to avoid MIME type issues"""
    logger.info("Auth Helper JS file requested")

    # Read the file from disk
    file_path = os.path.join(app.static_folder, "js/utils/auth-helper.js")
    
    # Try alternate path if first one doesn't exist
    if not os.path.exists(file_path):
        file_path = os.path.join(app.static_folder, "js/utils/auth_helper.js")

    if not os.path.exists(file_path):
        logger.error(f"Auth helper file not found at {file_path}")
        return (
            "console.error('Auth helper file not found on server');",
            404,
            {"Content-Type": "application/javascript"},
        )

    try:
        with open(file_path, "r") as f:
            content = f.read()
        
        logger.info(f"Serving auth helper JS file ({len(content)} bytes)")
        return content, 200, {"Content-Type": "application/javascript"}
    except Exception as e:
        logger.error(f"Error reading auth helper file: {str(e)}")
        return (
            f"console.error('Error loading auth helper: {str(e)}');",
            500,
            {"Content-Type": "application/javascript"},
        )


# ------------------------------------------------------------------------------
# Error Handlers
# ------------------------------------------------------------------------------


@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors"""
    if request.path.startswith("/api/"):
        return (
            jsonify(
                {
                    "error": "Not Found",
                    "error_code": "RESOURCE_NOT_FOUND",
                    "message": "The requested resource was not found",
                }
            ),
            404,
        )
    
    # For UI routes, use the error template if available
    if template_exists("error.html"):
        return render_template("error.html", error="Page not found"), 404
    
    # Fallback if error template doesn't exist
    return (
        """
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
    """,
        404,
    )


@app.errorhandler(500)
def server_error(error):
    """Handle 500 errors"""
    logger.error(f"Internal server error: {error}")
    if request.path.startswith("/api/"):
        return (
            jsonify(
                {
                    "error": "Internal Server Error",
                    "error_code": "SERVER_ERROR",
                    "message": "An unexpected error occurred",
                }
            ),
            500,
        )
    
    # For UI routes, use the error template if available
    if template_exists("error.html"):
        return render_template("error.html", error="Internal server error"), 500
    
    # Fallback if error template doesn't exist
    return (
        """
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
    """,
        500,
    )


@app.errorhandler(429)
def too_many_requests(error):
    """Handle rate limiting errors"""
    return (
        jsonify(
            {
                "error": "Too Many Requests",
                "error_code": "RATE_LIMIT_EXCEEDED",
                "message": "Rate limit exceeded, please try again later",
            }
        ),
        429,
    )


@app.errorhandler(401)
def unauthorized(error):
    """Handle authentication errors"""
    return (
        jsonify(
            {
                "error": "Unauthorized",
                "error_code": "AUTH_REQUIRED",
                "message": "Authentication required for this endpoint",
            }
        ),
        401,
    )


@app.errorhandler(403)
def forbidden(error):
    """Handle authorization errors"""
    return (
        jsonify(
            {
                "error": "Forbidden",
                "error_code": "PERMISSION_DENIED",
                "message": "You do not have permission to access this resource",
            }
        ),
        403,
    )


# ------------------------------------------------------------------------------
# UI Routes
# ------------------------------------------------------------------------------


@app.route("/")
def index():
    """Redirect the main index page to my-chats"""
    logger.info("Redirecting from index to my-chats")
    return redirect("/my-chats")

@app.route("/my-chats")
def my_chats():
    """Render the my chats page"""
    if not template_exists("my_chats.html"):
        logger.error("Failed to render my_chats.html - template file missing")
        return render_template("error.html", error="Template file missing"), 500
    return render_template("my_chats.html")

@app.route("/login")
def login():
    """Render the login page"""
    if not template_exists("login.html"):
        logger.error("Failed to render login.html - template file missing")
        return render_template("error.html", error="Template file missing"), 500
    return render_template("login.html")

@app.route("/register")
def register():
    """Render the register page"""
    if not template_exists("register.html"):
        logger.error("Failed to render register.html - template file missing")
        return render_template("error.html", error="Template file missing"), 500
    return render_template("register.html")

@app.route("/create")
def create_chat():
    """Render the create chat page with QR code invitation flow"""
    # If create.html exists, render it
    if template_exists("create.html"):
        return render_template("create.html")
    
    # Otherwise, fall back to the combined chat.html template with mode=create
    if not template_exists("chat.html"):
        logger.error("Failed to render create chat template - no templates available")
        return redirect("/my-chats")
    
    return render_template("chat.html", mode="create")

@app.route("/chat/<room_id>")
def chat_room(room_id):
    """Render the chat room page"""
    if not template_exists("chat.html"):
        logger.error(f"Failed to render chat.html for room {room_id} - template file missing")
        return render_template("error.html", error="Chat template missing"), 500
    return render_template("chat.html", room_id=room_id)

@app.route("/join/<token>")
def join_chat(token):
    """Join a chat with a token and redirect to chat page"""
    logger.info(f"Join request received for token: {token}")
    
    try:
        # Get user info from session
        user_data = None
        user_id = None
        
        # Try to get authenticated user first
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token_value = auth_header[7:]
            try:
                user_data = PyJWT.decode(token_value, JWT_SECRET, algorithms=["HS256"])
                user_id = user_data.get("user_id")
                logger.info(f"Authenticated user {user_id} is joining with token {token}")
            except Exception as e:
                logger.warning(f"Invalid auth token in join request: {str(e)}")
        
        # If no authenticated user, use visitor ID or generate guest ID
        if not user_id:
            user_id = request.cookies.get("visitor_id")
            if not user_id:
                user_id = f"guest-{uuid.uuid4()}"
            logger.info(f"Guest user {user_id} is joining with token {token}")
        
        # First check if the invitation exists
        status_url = f"{CHAT_SERVICE_URL}/invitation-status/{token}"
        logger.info(f"Checking invitation status at: {status_url}")
        
        try:
            status_response = requests.get(status_url, timeout=5)
            
            if status_response.status_code != 200:
                error_message = "Invitation not found"
                try:
                    error_data = status_response.json()
                    error_message = error_data.get("error", error_message)
                except:
                    pass
                    
                logger.error(f"Invitation status check failed: {error_message}")
                return redirect(f"/test-join/{token}?error={error_message}")
                
            # If we get here, the invitation exists - get the status
            status_data = status_response.json()
            invitation_status = status_data.get("status")
            
            if invitation_status == "expired":
                return redirect(f"/test-join/{token}?error=Invitation has expired")
                
            if invitation_status == "used":
                return redirect(f"/test-join/{token}?error=Invitation has already been used")
                
        except Exception as e:
            logger.error(f"Error checking invitation status: {str(e)}")
            return redirect(f"/test-join/{token}?error=Error checking invitation: {str(e)}")
        
        # Call chat service to accept the invitation
        accept_url = f"{CHAT_SERVICE_URL}/accept-invitation/{token}"
        logger.info(f"Calling chat service at {accept_url} with user_id {user_id}")
        
        # Log full request details
        headers = {"Content-Type": "application/json"}
        request_body = {"guest_id": user_id}
        logger.info(f"Request to chat service: URL={accept_url}, headers={headers}, body={request_body}")
        
        try:
            response = requests.post(
                accept_url,
                json=request_body,
                headers=headers,
                timeout=5
            )
            
            # Log the full response
            logger.info(f"Chat service response status: {response.status_code}")
            logger.info(f"Chat service response headers: {dict(response.headers)}")
            logger.info(f"Chat service response body: {response.text[:500]}")
            
            if response.status_code != 200:
                try:
                    error_data = response.json()
                    error_message = error_data.get("error", "Unknown error")
                    logger.error(f"Failed to accept invitation: {error_message}")
                    # Try to get more diagnostic info
                    logger.error(f"Full error response: {error_data}")
                    return redirect(f"/test-join/{token}?error={error_message}")
                except Exception as json_error:
                    logger.error(f"Error parsing error response: {str(json_error)}")
                    return redirect(f"/test-join/{token}?error=Status code {response.status_code}")
            
            # Get the chat ID from the response
            result = response.json()
            chat_id = result.get("chat_id")
            
            if not chat_id:
                logger.error("No chat ID returned from accept invitation endpoint")
                logger.error(f"Full response data: {result}")
                return redirect(f"/test-join/{token}?error=No chat ID returned")
            
            # Notify the host through realtime service
            try:
                host_id = result.get("host_id")
                if host_id:
                    notify_url = f"{REALTIME_SERVICE_URL}/api/notify"
                    notification_data = {
                        "event": "invitation_accepted",
                        "recipient_id": host_id,
                        "data": {
                            "chat_id": chat_id,
                            "guest_id": user_id,
                            "invitation_token": token
                        }
                    }
                    
                    requests.post(
                        notify_url,
                        json=notification_data,
                        headers={"Content-Type": "application/json"},
                        timeout=2  # Short timeout as this is non-critical
                    )
                
                # Public notification for room creation
                room_notification = {
                    "event": "room_created",
                    "room_id": chat_id,
                    "data": {
                        "room_id": chat_id,
                        "created_at": datetime.utcnow().isoformat(),
                        "participants": [host_id, user_id]
                    }
                }
                
                requests.post(
                    f"{REALTIME_SERVICE_URL}/api/broadcast",
                    json=room_notification,
                    headers={"Content-Type": "application/json"},
                    timeout=2
                )
            except Exception as e:
                # Don't fail the request if notification fails
                logger.warning(f"Failed to send notification: {str(e)}")
            
            # Redirect to the chat room
            return redirect(f"/chat/{chat_id}")
        except requests.RequestException as req_err:
            logger.error(f"Request error when calling chat service: {str(req_err)}")
            return redirect(f"/test-join/{token}?error=Error connecting to chat service")
        
    except Exception as e:
        logger.error(f"Error in join_chat: {str(e)}", exc_info=True)
        return redirect(f"/test-join/{token}?error={str(e)}")

@app.route("/test-join/<token>")
def test_join_chat(token):
    """Test endpoint to diagnose join chat issues"""
    logger.info(f"Test join request received for token: {token}")
    
    try:
        # Check invitation status first
        status_url = f"{CHAT_SERVICE_URL}/invitation-status/{token}"
        logger.info(f"Checking invitation status at {status_url}")
        
        error_from_query = request.args.get("error", None)
        
        # Add additional diagnostics
        diagnostic = {
            "token": token,
            "error_from_query": error_from_query,
            "timestamp": datetime.utcnow().isoformat(),
            "chat_service_url": CHAT_SERVICE_URL,
            "api_endpoints": {
                "direct_status_url": status_url,
                "api_gateway_status_url": f"/api/chats/invitation-status/{token}",
                "direct_accept_url": f"{CHAT_SERVICE_URL}/accept-invitation/{token}",
                "api_gateway_accept_url": f"/api/chats/accept-invitation/{token}",
                "invitation_form": f"{request.url_root.rstrip('/')}/join/{token}"
            }
        }
        
        try:
            # Try to get the actual status
            status_response = requests.get(
                status_url,
                timeout=5
            )
            
            # Add response info to diagnostics
            diagnostic["status_code"] = status_response.status_code
            
            # Add invitation status if available
            if status_response.status_code == 200:
                diagnostic["invitation_status"] = status_response.json()
            else:
                # Get error message
                try:
                    error_data = status_response.json()
                    diagnostic["error"] = error_data.get("error", "Unknown error")
                except:
                    diagnostic["error"] = f"Status check failed with code {status_response.status_code}"
        except Exception as status_error:
            diagnostic["status_check_error"] = str(status_error)
        
        # Also try to query through the API gateway endpoint to validate routing
        try:
            api_gateway_url = f"{request.url_root.rstrip('/')}/api/chats/invitation-status/{token}"
            logger.info(f"Checking through API gateway at: {api_gateway_url}")
            
            api_gateway_response = requests.get(
                api_gateway_url,
                timeout=5
            )
            
            diagnostic["api_gateway_status_code"] = api_gateway_response.status_code
            
            if api_gateway_response.status_code == 200:
                diagnostic["api_gateway_status"] = api_gateway_response.json()
            else:
                try:
                    api_error_data = api_gateway_response.json()
                    diagnostic["api_gateway_error"] = api_error_data.get("error", "Unknown error")
                except:
                    diagnostic["api_gateway_error"] = f"API gateway check failed with code {api_gateway_response.status_code}"
        except Exception as api_error:
            diagnostic["api_gateway_check_error"] = str(api_error)
        
        # Return diagnostic information
        return render_template(
            "error.html", 
            error="QR Code Invitation Diagnostic", 
            details=json.dumps(diagnostic, indent=2)
        )
    
    except Exception as e:
        logger.error(f"Error in test_join_chat: {str(e)}", exc_info=True)
        return render_template(
            "error.html",
            error="Error testing invitation",
            details=str(e)
        )

@app.route("/error")
def error_page():
    """Render the error page"""
    error_message = request.args.get("message", "Unknown error")
    if not template_exists("error.html"):
        logger.error("Failed to render error.html - template file missing")
        return "Error: " + error_message, 500
    return render_template("error.html", error=error_message)

@app.route("/ws-test")
def websocket_test():
    """WebSocket test page"""
    return render_template("websocket-test.html")

@app.route("/websocket-test")
def websocket_test_page():
    """Advanced WebSocket test page with more features"""
    try:
        # Get connection details
        conn_resp = requests.get(
            f"{request.url_root.rstrip('/')}/api/realtime/check-connection", 
            timeout=3
        )
        
        if conn_resp.status_code != 200:
            return render_template(
                "error.html", 
                error_message="Could not get realtime service connection details", 
                details=conn_resp.text if conn_resp.text else f"Status code: {conn_resp.status_code}"
            )
            
        conn_data = conn_resp.json()
        
        return render_template(
            "websocket-test.html",
            connection_data=conn_data,
            socket_url=conn_data.get("websocket_url", "/api/realtime"),
            socket_path=conn_data.get("socket_io_path", "/socket.io"),
            user_id=conn_data.get("user_id", "anonymous"),
            is_authenticated=conn_data.get("authenticated", False)
        )
    except Exception as e:
        return render_template(
            "error.html", 
            error_message="Error preparing WebSocket test page", 
            details=str(e)
        )

@app.route("/favicon.ico")
def favicon():
    """Serve the favicon directly"""
    return send_from_directory(os.path.join(app.static_folder, "img"), "favicon.ico")


# ------------------------------------------------------------------------------
# API Gateway Routes
# ------------------------------------------------------------------------------


@app.route("/api/auth/login", methods=["POST", "OPTIONS"])
def direct_login():
    """Direct login endpoint that proxies to auth service"""
    if request.method == "OPTIONS":
        return handle_preflight_request()

    try:
        data = request.get_json()
        if not data or not data.get("username") or not data.get("password"):
            return jsonify({"error": "Missing username or password"}), 400

        # Sanitize input
        sanitized_data = sanitize_input(data)

        # Debug the service discovery
        service_url = discovery.get_service_url('auth_service')
        print(f"Auth service URL from discovery: {service_url}")
        
        # Override the service URL to use localhost directly
        auth_url = "http://localhost:5501/login"
        print(f"Using direct auth URL: {auth_url}")
        
        headers = {"Content-Type": "application/json"}
        
        # Add correlation ID for tracing
        correlation_id = request.headers.get("X-Correlation-ID", str(uuid.uuid4()))
        headers["X-Correlation-ID"] = correlation_id

        print(f"Sending request to auth service with headers: {headers}")
        print(f"Request data: {sanitized_data}")
        
        response = requests.post(
            auth_url, json=sanitized_data, headers=headers, timeout=5
        )

        print(f"Auth service response status: {response.status_code}")
        print(f"Auth service response: {response.text}")

        # Check for circuit breaker
        if circuit_check("auth_service"):
            if response.status_code >= 500:
                circuit_failure("auth_service")
                return (
                    jsonify(
                        {"error": "Authentication service unavailable, please try again later"}
                    ),
                    503,
                )
            else:
                circuit_success("auth_service")

        # Format response
        result = response.json()
        status_code = response.status_code

        # Set CORS headers
        resp = make_response(jsonify(result), status_code)
        add_cors_headers(resp)

        return resp

    except requests.RequestException as e:
        # Handle connection error
        circuit_failure("auth_service")
        print(f"Auth service connection error: {e}")
        logger.error(f"Auth service connection error: {e}")
        return (
            jsonify({"error": "Authentication service unavailable, please try again later"}),
            503,
        )
    except Exception as e:
        print(f"Login error: {str(e)}")
        logger.error(f"Login error: {e}")
        return jsonify({"error": "An unexpected error occurred"}), 500


@app.route("/api/auth/register", methods=["POST", "OPTIONS"])
def direct_register():
    """Direct register endpoint that proxies to auth service"""
    if request.method == "OPTIONS":
        return handle_preflight_request()

    try:
        data = request.get_json()
        if not data or not data.get("username") or not data.get("password") or not data.get("email"):
            return jsonify({"error": "Missing required fields"}), 400

        # Sanitize input
        sanitized_data = sanitize_input(data)

        # Forward to auth service
        auth_url = "http://localhost:5501/register"
        headers = {"Content-Type": "application/json"}
        
        # Add correlation ID for tracing
        correlation_id = request.headers.get("X-Correlation-ID", str(uuid.uuid4()))
        headers["X-Correlation-ID"] = correlation_id

        response = requests.post(
            auth_url, json=sanitized_data, headers=headers, timeout=5
        )

        # Check for circuit breaker
        if circuit_check("auth_service"):
            if response.status_code >= 500:
                circuit_failure("auth_service")
                return (
                    jsonify(
                        {"error": "Authentication service unavailable, please try again later"}
                    ),
                    503,
                )
            else:
                circuit_success("auth_service")

        # Format response
        result = response.json()
        status_code = response.status_code

        # Set CORS headers
        resp = make_response(jsonify(result), status_code)
        add_cors_headers(resp)

        return resp

    except requests.RequestException as e:
        # Handle connection error
        circuit_failure("auth_service")
        logger.error(f"Auth service connection error: {e}")
        return (
            jsonify({"error": "Authentication service unavailable, please try again later"}),
            503,
        )
    except Exception as e:
        logger.error(f"Registration error: {e}")
        return jsonify({"error": "An unexpected error occurred"}), 500


@app.route("/api/auth/refresh", methods=["POST", "OPTIONS"])
def direct_refresh():
    """Direct token refresh endpoint that proxies to auth service"""
    if request.method == "OPTIONS":
        return handle_preflight_request()

    try:
        # Get the refresh token from Authorization header or request body
        auth_header = request.headers.get("Authorization")
        data = request.get_json() or {}
        
        headers = {
            "Content-Type": "application/json",
        }
        
        # Add authorization header if present
        if auth_header:
            headers["Authorization"] = auth_header
        
        # Add correlation ID for tracing
        correlation_id = request.headers.get("X-Correlation-ID", str(uuid.uuid4()))
        headers["X-Correlation-ID"] = correlation_id

        # Forward to auth service
        auth_url = "http://localhost:5501/refresh"
        
        response = requests.post(
            auth_url, json=data, headers=headers, timeout=5
        )

        # Check for circuit breaker
        if circuit_check("auth_service"):
            if response.status_code >= 500:
                circuit_failure("auth_service")
                return (
                    jsonify(
                        {"error": "Authentication service unavailable, please try again later"}
                    ),
                    503,
                )
            else:
                circuit_success("auth_service")

        # Format response
        result = response.json()
        status_code = response.status_code

        # Set CORS headers
        resp = make_response(jsonify(result), status_code)
        add_cors_headers(resp)

        return resp

    except requests.RequestException as e:
        # Handle connection error
        circuit_failure("auth_service")
        logger.error(f"Auth service connection error: {e}")
        return (
            jsonify({"error": "Authentication service unavailable, please try again later"}),
            503,
        )
    except Exception as e:
        logger.error(f"Token refresh error: {e}")
        return jsonify({"error": "An unexpected error occurred"}), 500


@app.route("/api/auth/verify", methods=["GET", "OPTIONS"])
def direct_verify():
    """Direct token verification endpoint that proxies to auth service"""
    if request.method == "OPTIONS":
        return handle_preflight_request()

    try:
        # Get the token from Authorization header
        auth_header = request.headers.get("Authorization")
        
        if not auth_header:
            return jsonify({"valid": False, "error": "Missing token"}), 401
        
        headers = {
            "Content-Type": "application/json",
            "Authorization": auth_header
        }
        
        # Add correlation ID for tracing
        correlation_id = request.headers.get("X-Correlation-ID", str(uuid.uuid4()))
        headers["X-Correlation-ID"] = correlation_id

        # Forward to auth service
        auth_url = "http://localhost:5501/verify"
        
        response = requests.get(
            auth_url, headers=headers, timeout=5
        )

        # Check for circuit breaker
        if circuit_check("auth_service"):
            if response.status_code >= 500:
                circuit_failure("auth_service")
                return (
                    jsonify(
                        {"error": "Authentication service unavailable, please try again later"}
                    ),
                    503,
                )
            else:
                circuit_success("auth_service")

        # Format response
        result = response.json()
        status_code = response.status_code

        # Set CORS headers
        resp = make_response(jsonify(result), status_code)
        add_cors_headers(resp)

        return resp

    except requests.RequestException as e:
        # Handle connection error
        circuit_failure("auth_service")
        logger.error(f"Auth service connection error: {e}")
        return (
            jsonify({"error": "Authentication service unavailable, please try again later"}),
            503,
        )
    except Exception as e:
        logger.error(f"Token verification error: {e}")
        return jsonify({"error": "An unexpected error occurred"}), 500


@app.route("/api/auth/get-or-create-visitor-id", methods=["POST", "GET", "OPTIONS"])
def direct_visitor_id():
    """Direct visitor ID endpoint that proxies to auth service"""
    if request.method == "OPTIONS":
        return handle_preflight_request()

    try:
        # Get data if available
        data = {}
        if request.is_json:
            data = request.get_json() or {}
        
        headers = {"Content-Type": "application/json"}
        
        # Add correlation ID for tracing
        correlation_id = request.headers.get("X-Correlation-ID", str(uuid.uuid4()))
        headers["X-Correlation-ID"] = correlation_id

        # Forward to auth service
        auth_url = "http://localhost:5501/get-or-create-visitor-id"
        
        if request.method == "GET":
            response = requests.get(
                auth_url, headers=headers, timeout=5
            )
        else:
            response = requests.post(
                auth_url, json=data, headers=headers, timeout=5
            )

        # Check for circuit breaker
        if circuit_check("auth_service"):
            if response.status_code >= 500:
                circuit_failure("auth_service")
                return (
                    jsonify(
                        {"error": "Authentication service unavailable, please try again later"}
                    ),
                    503,
                )
            else:
                circuit_success("auth_service")

        # Format response
        result = response.json()
        status_code = response.status_code

        # Set CORS headers
        resp = make_response(jsonify(result), status_code)
        add_cors_headers(resp)

        return resp

    except requests.RequestException as e:
        # Handle connection error
        circuit_failure("auth_service")
        logger.error(f"Auth service connection error: {e}")
        return (
            jsonify({"error": "Authentication service unavailable, please try again later"}),
            503,
        )
    except Exception as e:
        logger.error(f"Visitor ID error: {e}")
        return jsonify({"error": "An unexpected error occurred"}), 500


@app.route("/api/auth/set-user-name", methods=["POST", "OPTIONS"])
def direct_set_user_name():
    """Direct set user name endpoint that proxies to auth service"""
    if request.method == "OPTIONS":
        return handle_preflight_request()

    try:
        data = request.get_json() or {}
        if not data or not data.get("display_name"):
            return jsonify({"error": "Display name is required"}), 400
            
        # Get the token from Authorization header
        auth_header = request.headers.get("Authorization")
        
        if not auth_header:
            return jsonify({"error": "Authentication required"}), 401
        
        headers = {
            "Content-Type": "application/json",
            "Authorization": auth_header
        }
        
        # Add correlation ID for tracing
        correlation_id = request.headers.get("X-Correlation-ID", str(uuid.uuid4()))
        headers["X-Correlation-ID"] = correlation_id

        # Forward to auth service
        auth_url = "http://localhost:5501/set-user-name"
        
        response = requests.post(
            auth_url, json=data, headers=headers, timeout=5
        )

        # Check for circuit breaker
        if circuit_check("auth_service"):
            if response.status_code >= 500:
                circuit_failure("auth_service")
                return (
                    jsonify(
                        {"error": "Authentication service unavailable, please try again later"}
                    ),
                    503,
                )
            else:
                circuit_success("auth_service")

        # Format response
        result = response.json()
        status_code = response.status_code

        # Set CORS headers
        resp = make_response(jsonify(result), status_code)
        add_cors_headers(resp)

        return resp

    except requests.RequestException as e:
        # Handle connection error
        circuit_failure("auth_service")
        logger.error(f"Auth service connection error: {e}")
        return (
            jsonify({"error": "Authentication service unavailable, please try again later"}),
            503,
        )
    except Exception as e:
        logger.error(f"Set user name error: {e}")
        return jsonify({"error": "An unexpected error occurred"}), 500


@app.route("/api/auth/logout", methods=["POST", "OPTIONS"])
def direct_logout():
    """Direct logout endpoint that proxies to auth service"""
    if request.method == "OPTIONS":
        return handle_preflight_request()

    try:
        # Get the token from Authorization header
        auth_header = request.headers.get("Authorization")
        
        headers = {
            "Content-Type": "application/json",
        }
        
        # Add authorization header if present
        if auth_header:
            headers["Authorization"] = auth_header
            
        # Add correlation ID for tracing
        correlation_id = request.headers.get("X-Correlation-ID", str(uuid.uuid4()))
        headers["X-Correlation-ID"] = correlation_id

        # Forward to auth service
        auth_url = "http://localhost:5501/logout"
        
        response = requests.post(
            auth_url, headers=headers, timeout=5
        )

        # We don't need to check for circuit breaker on logout
        # Even if it fails, we'll clear the client-side tokens anyway

        # Format response - always return success to client
        resp = make_response(jsonify({"success": True}), 200)
        add_cors_headers(resp)

        return resp

    except Exception as e:
        # For logout, we always want to return success to the client
        # Even if the server-side fails, we want client to clear tokens
        logger.error(f"Logout error (non-critical): {e}")
        resp = make_response(jsonify({"success": True}), 200)
        add_cors_headers(resp)
        return resp


def handle_preflight_request():
    """Handle CORS preflight requests"""
    response = make_response()
    add_cors_headers(response)
    return response


@app.route("/api/auth/<path:path>", methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"])
def auth_service_proxy(path):
    """Proxy requests to the auth service"""
    if request.method == "OPTIONS":
        return handle_preflight_request()
        
    try:
        service_url = discovery.get_service_url("auth_service")
        if not service_url:
            return jsonify({"error": "Auth service unavailable"}), 503
            
        return proxy_request(f"{service_url}/{path}", "auth_service")
    except Exception as e:
        logger.error(f"Error proxying to auth service: {e}")
        return jsonify({"error": "Auth service error"}), 500


@app.route("/api/users/<path:path>", methods=["GET", "POST", "PUT", "DELETE"])
def user_service_proxy(path):
    """Proxy requests to user service"""
    return proxy_request(f"{USER_SERVICE_URL}/{path}", "USER_SERVICE_URL")


@app.route("/api/oauth/<path:path>", methods=["GET", "POST", "PUT", "DELETE"])
def oauth_service_proxy(path):
    """Proxy requests to oauth service"""
    return proxy_request(f"{OAUTH_SERVICE_URL}/{path}", "OAUTH_SERVICE_URL")


@app.route(
    "/api/chats/<path:path>", methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"]
)
def chat_service_proxy(path):
    """Proxy requests to chat service"""
    # Handle OPTIONS request explicitly
    if request.method == "OPTIONS":
        response = app.make_default_options_response()
        return response

    logger.info(f"Chat service proxy for path: {path}")
    logger.info(f"Request method: {request.method}")

    # Special handling for generate-invitation endpoint
    if path == "generate-invitation":
        target_url = f"{CHAT_SERVICE_URL}/generate-invitation"
        logger.info(f"Proxying to target URL: {target_url}")
        return proxy_request(target_url, "CHAT_SERVICE_URL")
        
    # Special handling for cleanup-expired-invitations endpoint
    if path == "cleanup-expired-invitations":
        target_url = f"{CHAT_SERVICE_URL}/cleanup-expired-invitations"
        logger.info(f"Proxying to target URL: {target_url}")
        return proxy_request(target_url, "CHAT_SERVICE_URL")
        
    # Special handling for invitation-status endpoint
    if path.startswith("invitation-status/"):
        token = path.split("/")[1]
        target_url = f"{CHAT_SERVICE_URL}/invitation-status/{token}"
        logger.info(f"Proxying invitation status to target URL: {target_url}")
        return proxy_request(target_url, "CHAT_SERVICE_URL")
        
    # Special handling for accept-invitation endpoint
    if path.startswith("accept-invitation/"):
        token = path.split("/")[1]
        target_url = f"{CHAT_SERVICE_URL}/accept-invitation/{token}"
        logger.info(f"Proxying invitation acceptance to target URL: {target_url}")
        return proxy_request(target_url, "CHAT_SERVICE_URL")

    # Special handling for GET requests to messages endpoint
    if request.method == "GET" and "/messages" in path:
        logger.info(f"Special handling for GET messages request: {path}")

        # Don't forward Content-Type: application/json for GET requests with no body
        headers = {
            key: value
            for key, value in request.headers
            if key.lower() != "host"
            and (key.lower() != "content-type" or request.get_data())
        }

        if hasattr(g, "correlation_id"):
            headers["X-Correlation-ID"] = g.correlation_id

        logger.info(f"Modified headers for GET messages request: {headers}")

        target_url = f"{CHAT_SERVICE_URL}/chats/{path}"
        logger.info(f"Proxying to target URL: {target_url}")

        try:
            resp = requests.get(
                url=target_url, headers=headers, cookies=request.cookies, timeout=5
            )

            # Log response
            logger.info(
                f"Service response from CHAT_SERVICE_URL: status={resp.status_code}"
            )
            logger.info(f"Response headers: {dict(resp.headers)}")
            logger.info(
                f"Response body preview: {resp.text[:200] if resp.text else 'Empty'}"
            )

            # Record circuit breaker success
            circuit_success("CHAT_SERVICE_URL")

            # Handle response
            try:
                if resp.content:
                    # Try to parse as JSON
                    content_type = resp.headers.get("Content-Type", "")
                    if "application/json" in content_type:
                        response_data = resp.json()
                        response = jsonify(response_data)
                    else:
                        # Not JSON or content type is not JSON
                        response = Response(resp.content)
                else:
                    # Empty response
                    response = Response("")

            except ValueError as e:
                # JSON parsing failed, return raw content
                logger.warning(f"Failed to parse JSON response: {str(e)}")
                response = Response(resp.content)

            response.status_code = resp.status_code

            # Add headers, but remove sensitive ones
            safe_headers = remove_sensitive_headers(resp.headers)
            for key, value in safe_headers.items():
                if key.lower() not in (
                    "content-length",
                    "connection",
                    "content-encoding",
                ):
                    response.headers[key] = value

            return response
        except requests.RequestException as e:
            # Record circuit breaker failure
            circuit_failure("CHAT_SERVICE_URL")

            logger.error(f"Service request error: {str(e)} - URL: {target_url}")

            # Mask internal details in production
            if os.environ.get("FLASK_ENV") == "production":
                error_message = "The service is currently unavailable."
            else:
                error_message = f"Service request failed: {str(e)}"

            return (
                jsonify(
                    {
                        "error": "Service Unavailable",
                        "error_code": "SERVICE_ERROR",
                        "message": error_message,
                    }
                ),
                503,
            )

    # Standard proxy for other requests
    target_url = f"{CHAT_SERVICE_URL}/chats/{path}"
    logger.info(f"Proxying to target URL: {target_url}")
    return proxy_request(target_url, "CHAT_SERVICE_URL")


@app.route("/api/chats", methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"])
def chat_service_root_proxy():
    """Proxy requests to chat service root"""
    # Handle OPTIONS request explicitly
    if request.method == "OPTIONS":
        response = app.make_default_options_response()
        return response

    logger.info("Chat service root proxy")
    return proxy_request(f"{CHAT_SERVICE_URL}/chats", "CHAT_SERVICE_URL")


@app.route("/api/realtime/<path:path>", methods=["GET", "POST", "PUT", "DELETE"])
def realtime_service_proxy(path):
    """Proxy requests to realtime service"""
    return proxy_request(f"{REALTIME_SERVICE_URL}/{path}", "REALTIME_SERVICE_URL")


@app.route("/api/realtime/socket.io", methods=["GET", "POST", "OPTIONS"])
@app.route("/api/realtime/socket.io/", methods=["GET", "POST", "OPTIONS"])
def socketio_proxy():
    """Proxy WebSocket connections to realtime service"""
    # Forward the request to the realtime service
    target_url = f"{REALTIME_SERVICE_URL}/socket.io/"

    # For WebSocket upgrade requests, add a special header for client information
    if request.headers.get("Upgrade", "").lower() == "websocket":
        logger.info("WebSocket upgrade request detected, preparing to proxy")

        # Check if user is authenticated (but allow guest users)
        auth_data = authenticate_token()

        # Set user data in g if authenticated
        if auth_data:
            g.user = auth_data
            logger.info(f"User {auth_data.get('user_id')} authenticated for WebSocket connection")
        else:
            logger.info("Anonymous WebSocket connection (guest user)")
            # Set guest user information
            g.user = {"user_id": "guest", "is_guest": True}

        # Create a direct connection URL for WebSockets
        # In development, this might be localhost with the right port
        # In production, it should be the proper WebSocket endpoint
        try:
            # Extract any query parameters to pass along
            query_params = {}
            if hasattr(request, "args"):
                for key, value in request.args.items():
                    query_params[key] = value
            
            # Add the auth token to query params if authenticated
            if hasattr(g, "user") and not query_params.get("token"):
                if g.user.get("is_guest"):
                    # For guest users, set token to 'guest'
                    query_params["token"] = "guest"
                    logger.info("Added guest token to WebSocket connection params")
                else:
                    # Get the original token from the Authorization header
                    auth_header = request.headers.get("Authorization", "")
                    if auth_header.startswith("Bearer "):
                        token = auth_header[7:]
                        query_params["token"] = token
                        logger.info("Added authentication token to WebSocket connection params")
                    else:
                        # If no token is present, use 'guest'
                        query_params["token"] = "guest"
                        logger.info("No auth header found, using guest token")
            elif not query_params.get("token"):
                # Default to guest if no token is present
                query_params["token"] = "guest"
                logger.info("No token found in query, using guest token")

            # For WebSocket upgrade handling, we'll return JSON info for the client
            # to use to connect directly to the realtime service
            ws_protocol = "wss" if request.is_secure else "ws"
            http_protocol = "https" if request.is_secure else "http"
            
            # Parse the realtime service URL to extract host and port
            realtime_url = REALTIME_SERVICE_URL
            if realtime_url.startswith("http"):
                # Replace http with ws protocol
                realtime_url = realtime_url.replace("http://", f"{ws_protocol}://")
                realtime_url = realtime_url.replace("https://", f"{ws_protocol}://")
            else:
                # If no protocol specified, add the ws protocol
                realtime_url = f"{ws_protocol}://{realtime_url}"
            
            return (
                jsonify(
                    {
                        "status": "redirect",
                        "message": "WebSocket connections should be made directly to the realtime service",
                        "connection_url": realtime_url,
                        "socket_path": "/socket.io/",
                        "connection_type": "direct",
                        "token_valid": True if hasattr(g, "user") else False,
                        "query_params": query_params,
                    }
                ),
                200,
            )
        except Exception as e:
            logger.error(f"Error handling WebSocket proxy: {e}")
            return jsonify({"error": "WebSocket proxy error", "message": str(e)}), 500

    # For regular HTTP requests to Socket.IO (polling), use the standard proxy
    logger.info(f"Socket.IO HTTP request (polling) proxied to: {target_url}")

    # Special handling for OPTIONS requests
    if request.method == "OPTIONS":
        response = app.make_default_options_response()
        return response

    return proxy_request(target_url, "REALTIME_SERVICE_URL")


@app.route("/api/ws-test", methods=["POST", "OPTIONS"])
def test_websocket():
    """Test the WebSocket connection by sending a message
    This is a public test endpoint that does not require authentication
    """
    # Handle OPTIONS preflight request
    if request.method == "OPTIONS":
        response = Response("")
        response.headers.add(
            "Access-Control-Allow-Origin", request.headers.get("Origin", "*")
        )
        response.headers.add("Access-Control-Allow-Methods", "POST, OPTIONS")
        response.headers.add(
            "Access-Control-Allow-Headers", "Content-Type, Authorization"
        )
        response.headers.add("Access-Control-Allow-Credentials", "true")
        response.headers.add("Access-Control-Max-Age", "86400")
        return response

    data = request.get_json()
    message = data.get("message", "Test message from API Gateway")
    room = data.get("room")

    logger.info(f"WebSocket test with message: {message}")

    # Forward to realtime service
    headers = {"Content-Type": "application/json"}
    if hasattr(g, "correlation_id"):
        headers["X-Correlation-ID"] = g.correlation_id

    test_data = {"message": message}

    if room:
        test_data["room"] = room

    try:
        response = requests.post(
            f"{REALTIME_SERVICE_URL}/test-broadcast",
            headers=headers,
            json=test_data,
            timeout=5,
        )

        logger.info(
            f"Realtime service response: {response.status_code} - {response.text[:100]}"
        )

        return jsonify(
            {
                "success": response.status_code == 200,
                "message": "WebSocket test message sent",
            }
        )
    except requests.RequestException as e:
        logger.error(f"WebSocket test error: {str(e)}")
        return (
            jsonify(
                {
                    "success": False,
                    "error": "Failed to send test message",
                    "message": str(e),
                }
            ),
            500,
        )


@app.route("/api/test-json", methods=["POST"])
def test_json():
    """Test endpoint to debug JSON handling"""
    try:
        data = request.get_data(as_text=True)
        logger.info(f"Raw data: '{data}'")

        try:
            if data:
                json_data = json.loads(data)
                return jsonify({"success": True, "received": json_data})
            else:
                return jsonify({"success": False, "error": "Empty data"}), 400
        except Exception as e:
            logger.error(f"JSON parse error: {str(e)}")
            return jsonify({"success": False, "error": str(e)}), 400
    except Exception as e:
        logger.error(f"Test error: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500


# Special JSON test endpoint
@app.route("/api/json-test", methods=["GET", "POST"])
def json_test():
    """Test endpoint to check JSON parsing"""
    if request.method == "GET":
        return jsonify(
            {
                "message": "This is a test JSON endpoint",
                "method": "GET",
                "timestamp": datetime.utcnow().isoformat(),
            }
        )

    # For POST requests, try to parse JSON
    logger.info(
        f"JSON test endpoint received POST request: headers={dict(request.headers)}"
    )
    try:
        # Get raw data and try to parse it
        raw_data = request.get_data(as_text=True)
        logger.info(f"Raw data: {raw_data}")

        if not raw_data:
            return jsonify({"success": False, "error": "Empty request body"}), 400

        try:
            parsed_data = json.loads(raw_data)
            logger.info(f"Successfully parsed JSON: {parsed_data}")

            # Return success with echo of the data
            return jsonify(
                {
                    "success": True,
                    "message": "JSON parsed successfully",
                    "received": parsed_data,
                    "timestamp": datetime.utcnow().isoformat(),
                }
            )
        except json.JSONDecodeError as e:
            logger.error(f"JSON parse error: {str(e)}")
            return (
                jsonify(
                    {
                        "success": False,
                        "error": f"Invalid JSON: {str(e)}",
                        "raw_data": raw_data,
                    }
                ),
                400,
            )
    except Exception as e:
        logger.error(f"Error in JSON test endpoint: {str(e)}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


def proxy_request(url, service_name, skip_auth=False):
    """
    Proxy a request to the specified service URL with circuit breaker
    """
    # Check if this is an invitation endpoint that should bypass authentication
    path = request.path
    if (
        "invitation-status" in path or 
        "accept-invitation" in path or 
        "generate-invitation" in path or
        "cleanup-expired-invitations" in path
    ):
        skip_auth = True
        logger.info(f"Skipping authentication for invitation endpoint: {path}")

    # Check circuit breaker
    if not circuit_check(service_name):
        return (
            jsonify(
                {
                    "error": "Service Unavailable",
                    "error_code": "CIRCUIT_OPEN",
                    "message": "The service is currently unavailable. Please try again later.",
                }
            ),
            503,
        )

    # Prepare headers
    headers = {key: value for key, value in request.headers if key.lower() != "host"}
    if hasattr(g, "correlation_id"):
        headers["X-Correlation-ID"] = g.correlation_id

    # Add user ID header for invitation endpoints
    if skip_auth and "invitation" in path:
        # Try to extract user ID from token if available
        user_id = None
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            try:
                token = auth_header.split(" ")[1]
                payload = PyJWT.decode(token, JWT_SECRET, algorithms=["HS256"])
                user_id = payload.get("user_id")
            except:
                pass
        
        # If no user ID from token, try visitor ID from cookies
        if not user_id:
            user_id = request.cookies.get("visitor_id")
        
        # If still no ID, generate a guest ID
        if not user_id:
            user_id = f"guest-{uuid.uuid4()}"
        
        # Add the user ID to headers
        headers["X-User-ID"] = user_id
        logger.info(f"Added user ID for invitation endpoint: {user_id}")

    logger.info(f"Proxy request to: {url}")
    logger.info(f"Proxy headers: {headers}")

    # Use sanitized data if available
    if hasattr(g, "sanitized_data"):
        # We have sanitized JSON data
        data = json.dumps(g.sanitized_data)
        if "Content-Type" not in headers:
            headers["Content-Type"] = "application/json"
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
            timeout=5,  # Set timeout to prevent long-running requests
        )

        # Log response
        logger.info(f"Service response from {service_name}: status={resp.status_code}")
        logger.info(f"Response headers: {dict(resp.headers)}")
        logger.info(
            f"Response body preview: {resp.text[:200] if resp.text else 'Empty'}"
        )

        # Record circuit breaker success
        circuit_success(service_name)

        # Handle response
        try:
            if resp.content:
                # Try to parse as JSON
                content_type = resp.headers.get("Content-Type", "")
                if "application/json" in content_type:
                    try:
                        response_data = resp.json()
                        response = jsonify(response_data)
                    except ValueError as json_error:
                        logger.error(f"JSON parse error for content: {resp.text[:200]}")
                        logger.error(f"JSON error: {str(json_error)}")
                        response = Response(resp.content)
                else:
                    # Not JSON or content type is not JSON
                    response = Response(resp.content)
            else:
                # Empty response
                response = Response("")

        except ValueError as e:
            # JSON parsing failed, return raw content
            logger.warning(f"Failed to parse JSON response: {str(e)}")
            response = Response(resp.content)

        response.status_code = resp.status_code

        # Add headers, but remove sensitive ones
        safe_headers = remove_sensitive_headers(resp.headers)
        for key, value in safe_headers.items():
            if key.lower() not in ("content-length", "connection", "content-encoding"):
                response.headers[key] = value

        return response
    except requests.RequestException as e:
        # Record circuit breaker failure
        circuit_failure(service_name)

        logger.error(f"Service request error: {str(e)} - URL: {url}")

        # Mask internal details in production
        if os.environ.get("FLASK_ENV") == "production":
            error_message = "The service is currently unavailable."
        else:
            error_message = f"Service request failed: {str(e)}"

        return (
            jsonify(
                {
                    "error": "Service Unavailable",
                    "error_code": "SERVICE_ERROR",
                    "message": error_message,
                }
            ),
            503,
        )


# ------------------------------------------------------------------------------
# Health and Monitoring
# ------------------------------------------------------------------------------


@app.route("/health")
def health():
    """Health check endpoint"""
    # Check status of all services
    services = {
        "auth_service": AUTH_SERVICE_URL,
        "user_service": USER_SERVICE_URL,
        "chat_service": CHAT_SERVICE_URL,
        "oauth_service": OAUTH_SERVICE_URL,
        "realtime_service": REALTIME_SERVICE_URL,
    }

    service_statuses = {}
    overall_status = "healthy"

    # Check each service
    for name, url in services.items():
        service_status = "unknown"
        try:
            resp = requests.get(f"{url}/health", timeout=2)
            if resp.status_code == 200:
                service_status = "healthy"
                # Check for healthy in response
                try:
                    resp_data = resp.json()
                    if "status" in resp_data and resp_data["status"] != "healthy":
                        service_status = resp_data["status"]
                        overall_status = "degraded"
                except Exception:
                    pass
            else:
                service_status = "unhealthy"
                overall_status = "degraded"
        except requests.RequestException:
            service_status = "unreachable"
            overall_status = "degraded"

        # Consider circuit breaker state
        if name in service_health and service_health[name]["open"]:
            service_status = "circuit_open"
            overall_status = "degraded"

        service_statuses[name] = service_status

    # Get system information
    uptime = int(time.time() - app.start_time)

    # Check WebSocket special handling
    ws_status = "unknown"
    if service_statuses.get("realtime_service") in ["healthy", "degraded"]:
        try:
            # Test WebSocket connection via the test endpoint
            ws_resp = requests.post(
                f"{REALTIME_SERVICE_URL}/test-broadcast",
                json={"message": "Health check test"},
                timeout=2,
            )
            if ws_resp.status_code == 200:
                ws_status = "healthy"
            else:
                ws_status = "unhealthy"
                overall_status = "degraded"
        except requests.RequestException:
            ws_status = "unreachable"
            overall_status = "degraded"
    else:
        ws_status = "skipped"

    return jsonify(
        {
            "status": overall_status,
            "uptime_seconds": uptime,
            "rate_limiting_enabled": ENABLE_RATE_LIMITING,
            "environment": os.environ.get("FLASK_ENV", "development"),
            "version": os.environ.get("APP_VERSION", "1.0.0"),
            "services": service_statuses,
            "websocket": ws_status,
            "timestamp": datetime.utcnow().isoformat(),
        }
    )


@app.route("/api/system/health-detailed")
def health_detailed():
    """Detailed system health check for admin/monitoring"""
    # Only allow in development mode or for admin users
    if not IS_DEVELOPMENT and (
        not hasattr(g, "user") or "role" not in g.user or g.user["role"] != "admin"
    ):
        return (
            jsonify(
                {
                    "error": "Forbidden",
                    "error_code": "PERMISSION_DENIED",
                    "message": "Admin access required",
                }
            ),
            403,
        )

    # Gather detailed service status
    service_details = {}
    for name, url in {
        "auth_service": AUTH_SERVICE_URL,
        "user_service": USER_SERVICE_URL,
        "chat_service": CHAT_SERVICE_URL,
        "oauth_service": OAUTH_SERVICE_URL,
        "realtime_service": REALTIME_SERVICE_URL,
    }.items():
        try:
            start_time = time.time()
            resp = requests.get(f"{url}/health", timeout=3)
            response_time = time.time() - start_time

            service_details[name] = {
                "status": "healthy" if resp.status_code == 200 else "unhealthy",
                "response_time_ms": round(response_time * 1000, 2),
                "status_code": resp.status_code,
                "circuit_state": "open" if service_health[name]["open"] else "closed",
                "circuit_failures": service_health[name]["failures"],
                "last_failure": (
                    datetime.fromtimestamp(
                        service_health[name]["last_failure"]
                    ).isoformat()
                    if service_health[name]["last_failure"]
                    else None
                ),
            }

            # Include response body if available
            try:
                service_details[name]["response"] = resp.json()
            except Exception:
                service_details[name]["response"] = "Non-JSON response"

        except requests.RequestException as e:
            service_details[name] = {
                "status": "unreachable",
                "error": str(e),
                "circuit_state": "open" if service_health[name]["open"] else "closed",
                "circuit_failures": service_health[name]["failures"],
                "last_failure": (
                    datetime.fromtimestamp(
                        service_health[name]["last_failure"]
                    ).isoformat()
                    if service_health[name]["last_failure"]
                    else None
                ),
            }

    # Get runtime statistics
    memory_usage = {}
    try:
        import psutil

        process = psutil.Process()
        memory_info = process.memory_info()
        memory_usage = {
            "rss_mb": round(memory_info.rss / (1024 * 1024), 2),
            "vms_mb": round(memory_info.vms / (1024 * 1024), 2),
            "percent": round(process.memory_percent(), 2),
        }
    except ImportError:
        memory_usage = {"error": "psutil not available"}

    return jsonify(
        {
            "timestamp": datetime.utcnow().isoformat(),
            "uptime_seconds": int(time.time() - app.start_time),
            "environment": os.environ.get("FLASK_ENV", "development"),
            "services": service_details,
            "rate_limiting": {
                "enabled": ENABLE_RATE_LIMITING,
                "requests_per_minute": REQUESTS_PER_MINUTE,
                "burst_limit": BURST_LIMIT,
            },
            "circuit_breaker": {
                "failure_threshold": CIRCUIT_FAILURE_THRESHOLD,
                "reset_timeout": CIRCUIT_RESET_TIMEOUT,
            },
            "memory": memory_usage,
        }
    )


@app.route("/api/circuit-status")
def circuit_status():
    """Circuit breaker status endpoint"""
    if not hasattr(g, "user") or "role" not in g.user or g.user["role"] != "admin":
        return (
            jsonify(
                {
                    "error": "Forbidden",
                    "error_code": "PERMISSION_DENIED",
                    "message": "Admin access required",
                }
            ),
            403,
        )

    return jsonify(
        {
            "circuit_status": {
                name: {
                    "state": "open" if info["open"] else "closed",
                    "failures": info["failures"],
                    "last_failure": (
                        datetime.fromtimestamp(info["last_failure"]).isoformat()
                        if info["last_failure"]
                        else None
                    ),
                }
                for name, info in service_health.items()
            }
        }
    )


@app.route("/static/js/libs/qrcode.min.js")
def serve_qrcode_js():
    """Serve the QRCode.js library"""
    return send_from_directory(os.path.join(app.static_folder, "js", "libs"), "qrcode.min.js", mimetype="application/javascript")


@app.route("/static/js/utils/qrcode-generator.js")
def serve_qrcode_generator():
    """Serve the QR code generator utility"""
    return send_from_directory(os.path.join(app.static_folder, "js", "utils"), "qrcode-generator.js", mimetype="application/javascript")

@app.route("/static/js/utils/invitation-manager.js")
def serve_invitation_manager():
    """Serve the invitation manager utility"""
    return send_from_directory(os.path.join(app.static_folder, "js", "utils"), "invitation-manager.js", mimetype="application/javascript")

@app.route("/static/js/modules/create-chat-page.js")
def serve_create_chat_page():
    """Serve the create chat page script"""
    return send_from_directory(os.path.join(app.static_folder, "js", "modules"), "create-chat-page.js", mimetype="application/javascript")

@app.route("/static/js/modules/my-chats-page.js")
def serve_my_chats_page():
    """Serve the my chats page script"""
    return send_from_directory(os.path.join(app.static_folder, "js", "modules"), "my-chats-page.js", mimetype="application/javascript")

@app.route("/static/js/services/api-client.js")
def serve_api_client():
    """Serve the API client utility"""
    return send_from_directory(os.path.join(app.static_folder, "js", "services"), "api-client.js", mimetype="application/javascript")

@app.route("/static/js/services/socket-client.js")
def serve_socket_client():
    """Serve the Socket client utility"""
    return send_from_directory(os.path.join(app.static_folder, "js", "services"), "socket-client.js", mimetype="application/javascript")

@app.route("/static/js/services/chat-service.js")
def serve_chat_service():
    """Serve the Chat service utility"""
    return send_from_directory(os.path.join(app.static_folder, "js", "services"), "chat-service.js", mimetype="application/javascript")

@app.route("/api/realtime/check-connection", methods=["GET"])
def check_realtime_connection():
    """Check if the realtime service is available and properly configured"""
    try:
        # Verify that the realtime service is up
        health_url = f"{REALTIME_SERVICE_URL}/health"
        health_resp = requests.get(health_url, timeout=3)
        
        if health_resp.status_code != 200:
            return (
                jsonify({
                    "status": "error",
                    "message": f"Realtime service returned status code {health_resp.status_code}",
                    "service_url": REALTIME_SERVICE_URL
                }),
                503
            )
        
        # Try to get connection info from the realtime service
        connections_url = f"{REALTIME_SERVICE_URL}/connections"
        connections_resp = requests.get(connections_url, timeout=3)
        
        # Get auth status
        auth_data = authenticate_token()
        user_id = auth_data.get("user_id", "anonymous") if auth_data else "anonymous"
        
        # Get WebSocket connection URL (same logic as socketio_proxy)
        ws_protocol = "wss" if request.is_secure else "ws"
        realtime_url = REALTIME_SERVICE_URL
        if realtime_url.startswith("http"):
            realtime_url = realtime_url.replace("http://", f"{ws_protocol}://")
            realtime_url = realtime_url.replace("https://", f"{ws_protocol}://")
        else:
            realtime_url = f"{ws_protocol}://{realtime_url}"
            
        # Check for public URL override
        public_realtime_url = os.environ.get("PUBLIC_REALTIME_URL")
        if public_realtime_url:
            if public_realtime_url.startswith("http"):
                public_realtime_url = public_realtime_url.replace("http://", f"{ws_protocol}://")
                public_realtime_url = public_realtime_url.replace("https://", f"{ws_protocol}://")
            else:
                public_realtime_url = f"{ws_protocol}://{public_realtime_url}"
                
            realtime_url = public_realtime_url
        
        # Return connection status and configuration
        return jsonify({
            "status": "available",
            "realtime_service": REALTIME_SERVICE_URL,
            "socket_io_path": "/socket.io",
            "websocket_url": realtime_url,
            "authenticated": auth_data is not None,
            "user_id": user_id,
            "connections": connections_resp.json() if connections_resp.status_code == 200 else None,
            "websocket_test_route": "/api/ws-test",
            "socket_endpoint": "/api/realtime/socket.io",
            "transport_options": ["websocket", "polling"],
            "connection_health": health_resp.json() if health_resp.status_code == 200 else None
        })
    except requests.RequestException as e:
        logger.error(f"Error connecting to realtime service: {str(e)}")
        return (
            jsonify({
                "status": "unavailable",
                "message": f"Could not connect to realtime service: {str(e)}",
                "realtime_service_url": REALTIME_SERVICE_URL
            }),
            503
        )

@app.route("/api/my-chats", methods=["GET"])
def get_my_chats():
    """Endpoint to retrieve chats for the currently authenticated user"""
    # Get authentication data if available
    auth_data = authenticate_token()
    
    # Use a default guest user ID if no authentication
    user_id = auth_data.get("user_id", "guest") if auth_data else "guest"
    logger.info(f"Getting chats for user: {user_id}")
    
    try:
        # For development, return an empty array if chat service is not available
        if IS_DEVELOPMENT:
            # Try to connect to chat service
            try:
                # Create headers with the user_id
                headers = {"X-User-ID": user_id}
                if hasattr(g, "correlation_id"):
                    headers["X-Correlation-ID"] = g.correlation_id
                
                # Add Authorization header to pass through the token
                auth_header = request.headers.get("Authorization")
                if auth_header:
                    headers["Authorization"] = auth_header
                
                response = requests.get(
                    f"{CHAT_SERVICE_URL}/my-chats",
                    headers=headers,
                    timeout=3
                )
                
                if response.status_code == 200:
                    chats_data = response.json()
                    logger.info(f"Got response from chat service: {chats_data[:100]}")
                    # Ensure we return the expected format for the frontend
                    return jsonify({"chats": chats_data}), 200
                
                logger.error(f"Chat service error: {response.status_code}, {response.text}")
                # Fall back to returning empty array
                return jsonify({"chats": []}), 200
            except requests.RequestException as e:
                logger.error(f"Failed to connect to chat service: {str(e)}")
                # Return empty array in development
                return jsonify({"chats": []}), 200
        
        # In production, properly proxy to chat service
        # Create headers with the user_id
        headers = {"X-User-ID": user_id}
        if hasattr(g, "correlation_id"):
            headers["X-Correlation-ID"] = g.correlation_id
        
        # Add Authorization header
        auth_header = request.headers.get("Authorization")
        if auth_header:
            headers["Authorization"] = auth_header
        
        response = requests.get(
            f"{CHAT_SERVICE_URL}/my-chats",
            headers=headers,
            timeout=5
        )
        
        if response.status_code == 200:
            chats_data = response.json()
            logger.info(f"Got response from chat service (production): {chats_data[:100]}")
            # Ensure we return the expected format for the frontend
            return jsonify({"chats": chats_data}), 200
        else:
            logger.error(f"Chat service error in production: {response.status_code}, {response.text}")
            return jsonify({"chats": []}), 200
        
    except Exception as e:
        logger.error(f"Error in my-chats endpoint: {str(e)}")
        # Return empty array instead of error for better user experience
        return jsonify({"chats": []}), 200

@app.route("/api/auth/check-session", methods=["GET", "OPTIONS"])
def check_session():
    """
    Check current session status and return user state
    This endpoint validates JWT tokens and determines if the user is:
    - Authenticated (standard user)
    - Guest user
    - Not authenticated
    """
    if request.method == "OPTIONS":
        return handle_preflight_request()
        
    auth_header = request.headers.get("Authorization")
    session_status = {
        "authenticated": False,
        "guest": False,
        "auth_type": None,
        "user": None,
        "token_status": "invalid"
    }
    
    # Log the request
    logger.info(f"Session check request received with Authorization header: {bool(auth_header)}")
    
    if not auth_header:
        return jsonify(session_status), 200
    
    try:
        # Extract token from "Bearer <token>"
        token = auth_header.split(" ")[1]
        
        # Decode token
        payload = PyJWT.decode(token, JWT_SECRET, algorithms=["HS256"])
        
        # Determine authentication type
        auth_type = payload.get("auth_type", "standard")
        is_guest = auth_type == "guest"
        
        # Check if token is expired
        exp = payload.get("exp", 0)
        token_expired = exp and datetime.fromtimestamp(exp) < datetime.utcnow()
        
        if token_expired:
            session_status["token_status"] = "expired"
            return jsonify(session_status), 200
            
        # Get user data
        user_data = {
            "user_id": payload.get("user_id", ""),
            "username": payload.get("username", ""),
            "display_name": payload.get("display_name", ""),
            "email": payload.get("email", "")
        }
        
        # Update session status
        session_status["authenticated"] = not is_guest
        session_status["guest"] = is_guest
        session_status["auth_type"] = auth_type
        session_status["user"] = user_data
        session_status["token_status"] = "valid"
        
        # Add expiration info
        if exp:
            session_status["expires_at"] = datetime.fromtimestamp(exp).isoformat()
            session_status["expires_in_seconds"] = max(0, exp - int(datetime.utcnow().timestamp()))
        
        logger.info(f"Session check successful. Auth type: {auth_type}, Guest: {is_guest}")
        return jsonify(session_status), 200
        
    except Exception as e:
        # Token is invalid
        logger.error(f"Session check failed: {str(e)}")
        return jsonify(session_status), 200

@app.route("/api/chats/invitation-status/<token>", methods=["GET", "OPTIONS"])
def invitation_status_proxy(token):
    """Special proxy route for invitation status endpoints"""
    # Handle OPTIONS request
    if request.method == "OPTIONS":
        response = app.make_default_options_response()
        return response
        
    # Create the target URL
    target_url = f"{CHAT_SERVICE_URL}/invitation-status/{token}"
    logger.info(f"Proxying invitation status check to: {target_url}")
    
    # Use proxy_request with skip_auth=True
    return proxy_request(target_url, "CHAT_SERVICE_URL", skip_auth=True)
    
@app.route("/api/chats/accept-invitation/<token>", methods=["POST", "OPTIONS"])
def accept_invitation_proxy(token):
    """Special proxy route for accepting invitation endpoints"""
    # Handle OPTIONS request
    if request.method == "OPTIONS":
        response = app.make_default_options_response()
        return response
        
    # Create the target URL
    target_url = f"{CHAT_SERVICE_URL}/accept-invitation/{token}"
    logger.info(f"Proxying invitation acceptance to: {target_url}")
    
    # Use proxy_request with skip_auth=True
    return proxy_request(target_url, "CHAT_SERVICE_URL", skip_auth=True)

@app.route("/api/chats/generate-invitation", methods=["POST", "OPTIONS"])
def generate_invitation_proxy():
    """Special proxy route for generating invitations"""
    # Handle OPTIONS request
    if request.method == "OPTIONS":
        response = app.make_default_options_response()
        return response
        
    # Create the target URL
    target_url = f"{CHAT_SERVICE_URL}/generate-invitation"
    logger.info(f"Proxying invitation generation to: {target_url}")
    
    # Use proxy_request with skip_auth=True
    return proxy_request(target_url, "CHAT_SERVICE_URL", skip_auth=True)

@app.route("/ws/chat/<chat_id>", methods=["GET", "OPTIONS"])
def websocket_chat_proxy(chat_id):
    """Proxy WebSocket connections for chat to the realtime service"""
    # Handle OPTIONS request
    if request.method == "OPTIONS":
        response = app.make_default_options_response()
        return response
        
    # Extract token from query parameters
    token = request.args.get("token")
    if not token:
        return jsonify({"error": "Authentication required"}), 401
    
    # Set WebSocket protocol
    ws_protocol = "wss" if request.is_secure else "ws"
    
    # Parse the realtime service URL to extract host and port
    realtime_url = REALTIME_SERVICE_URL
    
    # Check if external host is configured
    external_host = os.environ.get("EXTERNAL_HOST")
    client_ip = request.remote_addr
    
    # Get client request headers to check if it's coming from an external IP
    logger.info(f"WebSocket connection request from IP: {client_ip}")
    
    if external_host and not (client_ip == '127.0.0.1' or client_ip == 'localhost'):
        # Use external host for connections from non-localhost clients
        host_parts = realtime_url.split('://')
        protocol = host_parts[0] if len(host_parts) > 1 else "http"
        
        # Extract port from original URL (default to 5506)
        port_match = re.search(r':(\d+)', realtime_url)
        port = port_match.group(1) if port_match else "5506"
        
        realtime_url = f"{protocol}://{external_host}:{port}"
        logger.info(f"Using external host for WebSocket: {realtime_url}")
    
    if realtime_url.startswith("http"):
        # Replace http with ws protocol
        realtime_url = realtime_url.replace("http://", f"{ws_protocol}://")
        realtime_url = realtime_url.replace("https://", f"{ws_protocol}://")
    else:
        # If no protocol specified, add the ws protocol
        realtime_url = f"{ws_protocol}://{realtime_url}"
    
    # Format socket.io connection URL properly for compatibility with Socket.IO
    socket_io_url = f"{realtime_url}/socket.io/?EIO=4&transport=websocket&token={token}&chat_id={chat_id}"
    
    logger.info(f"Redirecting WebSocket to: {socket_io_url}")
    
    # Create redirect response to the actual WebSocket endpoint
    return (
        jsonify({
            "status": "redirect",
            "message": "WebSocket connections should be made directly to the realtime service",
            "connection_url": socket_io_url,
            "socket_path": "/socket.io/",
            "connection_type": "socketio",
            "token_valid": True,
            "chat_id": chat_id,
            "transport": "websocket",
            "socket_io_version": "4",
            "additional_params": {
                "EIO": "4",
                "transport": "websocket",
                "token": token,
                "chat_id": chat_id
            }
        }),
        200
    )

@app.route("/test-websocket")
def test_websocket_page():
    """Render the WebSocket test page"""
    return render_template("websocket-test.html")

@app.route("/static/js/libs/socket-io-helper.js")
def serve_socketio_helper():
    """Serve the Socket.IO helper JS file"""
    return send_from_directory(os.path.join(app.static_folder, "js", "libs"), "socket-io-helper.js", mimetype="application/javascript")


if __name__ == "__main__":
    # Initialize circuit breaker states in Prometheus
    for service in service_health:
        CIRCUIT_STATE.labels(service=service).set(0)

    # Use command line arguments to get port if specified
    import argparse
    parser = argparse.ArgumentParser(description='API Gateway')
    parser.add_argument('--port', type=int, default=5000, help='Port to run the server on')
    args = parser.parse_args()

    app.run(host="0.0.0.0", port=args.port, debug=False)
