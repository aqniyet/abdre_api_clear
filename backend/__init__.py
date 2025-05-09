"""
ABDRE Chat Application Backend
Server-side rendering and REST API for chat application
"""

import logging
import os
from flask import Flask

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

def create_app(config=None):
    """
    Create and configure the Flask application
    
    Args:
        config (dict): Optional configuration dictionary
        
    Returns:
        Flask: Configured Flask application
    """
    app = Flask(__name__, 
                template_folder='../frontend/templates',
                static_folder='../frontend/static')
    
    # Load default configuration
    app.config.from_mapping(
        SECRET_KEY=os.environ.get('SECRET_KEY', 'dev_key_for_development_only'),
        DEBUG=os.environ.get('DEBUG', 'False').lower() == 'true',
        TEMPLATES_AUTO_RELOAD=True
    )
    
    # Apply any custom configuration
    if config:
        app.config.update(config)
    
    # Register routes and components
    with app.app_context():
        # Initialize middleware
        from backend.middleware.auth_middleware import init_auth_middleware
        init_auth_middleware(app)
        
        # Initialize services first
        from backend.services.template_service import template_service
        template_service.init_app(app)
        
        # Initialize repositories
        from backend.repositories.chat_repository import ChatRepository
        
        # Initialize controllers
        from backend.controllers.render_controller import render_controller
        render_controller.init_app(app)
        
        from backend.controllers.chat_controller import chat_controller
        chat_controller.init_app(app)
        
        from backend.controllers.auth_controller import init_app as init_auth_controller
        init_auth_controller(app)
        
        from backend.controllers.user_controller import user_bp
        app.register_blueprint(user_bp)
        
        from backend.controllers.logs_controller import logs_bp, root_logs_bp
        app.register_blueprint(logs_bp)
        app.register_blueprint(root_logs_bp)
        
        from backend.controllers.api_controller import init_app as init_api_controller
        init_api_controller(app)
        
        # Register web routes
        from backend.routes.web_routes import init_app as init_web_routes
        init_web_routes(app)
        
        # Register API routes
        from backend.routes.api_routes import init_app as init_api_routes
        init_api_routes(app)
        
    return app 