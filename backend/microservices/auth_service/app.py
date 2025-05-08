"""
Auth Service - Main Application
Provides authentication endpoints for ABDRE Chat
"""

import os
import logging
import threading
import time
from flask import Flask
from flask_cors import CORS
from pathlib import Path

from .routes import auth_routes
from .models import SessionManager, TokenBlacklist

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Constants
SERVICE_NAME = "auth-service"
SERVICE_PORT = int(os.environ.get("AUTH_SERVICE_PORT", 5501))

def create_app():
    """Create and configure the Flask application"""
    app = Flask(__name__)
    
    # Configure app
    app.config.update(
        SECRET_KEY=os.environ.get('SECRET_KEY', 'dev_key_for_development_only'),
        DEBUG=os.environ.get('DEBUG', 'False').lower() == 'true',
        ENV=os.environ.get('FLASK_ENV', 'development'),
        JWT_SECRET=os.environ.get('JWT_SECRET', 'your-secret-key-here'),
        ADMIN_SECRET=os.environ.get('ADMIN_SECRET', 'admin-secret-token'),
        SESSION_CLEANUP_INTERVAL=int(os.environ.get('SESSION_CLEANUP_INTERVAL', 3600))  # 1 hour
    )
    
    # Setup CORS
    CORS(app, 
         resources={r"/api/*": {"origins": "*"}},
         supports_credentials=True)
    
    # Register routes with prefix
    app.register_blueprint(auth_routes, url_prefix='/api/auth')
    
    # Service health check endpoint
    @app.route('/health')
    def health_check():
        return {
            'status': 'ok',
            'service': SERVICE_NAME,
            'version': '1.0.0'
        }
    
    # Create data directory
    data_dir = Path(__file__).parent / "data"
    data_dir.mkdir(exist_ok=True)
    
    # Start maintenance thread for cleaning up expired sessions and tokens
    _start_maintenance_thread(app)
    
    return app

def _start_maintenance_thread(app):
    """Start maintenance thread for periodic cleanup"""
    cleanup_interval = app.config.get('SESSION_CLEANUP_INTERVAL', 3600)  # Default 1 hour
    
    def maintenance_task():
        """Periodic maintenance task"""
        while True:
            try:
                # Wait for interval
                time.sleep(cleanup_interval)
                
                # Clean up expired sessions
                with app.app_context():
                    logger.info("Running maintenance task: Cleaning up expired sessions and tokens")
                    sessions_removed = SessionManager.cleanup_expired_sessions()
                    blacklist_removed = TokenBlacklist.cleanup_expired_entries()
                    logger.info(f"Maintenance complete: Removed {sessions_removed} expired sessions and {blacklist_removed} expired blacklist entries")
            
            except Exception as e:
                logger.error(f"Error in maintenance thread: {str(e)}")
    
    # Start thread as daemon so it will exit when the main process exits
    maintenance_thread = threading.Thread(target=maintenance_task, daemon=True)
    maintenance_thread.start()
    logger.info(f"Started maintenance thread with {cleanup_interval}s interval")

def run_service():
    """Run the Auth Service"""
    app = create_app()
    logger.info(f"Starting {SERVICE_NAME} on port {SERVICE_PORT}")
    app.run(host='0.0.0.0', port=SERVICE_PORT)

if __name__ == '__main__':
    run_service() 