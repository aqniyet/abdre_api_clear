"""
API Gateway - Main Application
Entry point for the API Gateway microservice
"""

import os
import logging
import uuid
from flask import Flask, request, g
from flask_cors import CORS

from .routes import gateway_routes

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Constants
SERVICE_NAME = "api-gateway"
SERVICE_PORT = int(os.environ.get("API_GATEWAY_PORT", 5000))

def create_app():
    """Create and configure the Flask application"""
    app = Flask(__name__)
    
    # Configure app
    app.config.update(
        SECRET_KEY=os.environ.get('SECRET_KEY', 'dev_key_for_development_only'),
        DEBUG=os.environ.get('DEBUG', 'False').lower() == 'true',
        ENV=os.environ.get('FLASK_ENV', 'development')
    )
    
    # Setup CORS
    CORS(app, 
         resources={r"/api/*": {"origins": "*"}},
         supports_credentials=True)
    
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
    
    # Register routes with prefix
    app.register_blueprint(gateway_routes)
    
    # Gateway service health check endpoint
    @app.route('/health')
    def health():
        """Health check endpoint"""
        return {
            'status': 'ok',
            'service': SERVICE_NAME,
            'version': '1.0.0'
        }
    
    return app

def run_gateway():
    """Run the API Gateway"""
    app = create_app()
    logger.info(f"Starting {SERVICE_NAME} on port {SERVICE_PORT}")
    app.run(host='0.0.0.0', port=SERVICE_PORT)

if __name__ == '__main__':
    run_gateway() 