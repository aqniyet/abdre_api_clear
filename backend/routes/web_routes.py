"""
Web Routes for ABDRE Chat Application
Defines URL routes for server-rendered web pages
"""

from flask import Blueprint, redirect, url_for

from backend.controllers.render_controller import render_controller

# Create blueprint for web routes
web_routes = Blueprint('web_routes', __name__)

# Register the render controller's routes
@web_routes.route('/')
def index():
    """
    Landing page route
    
    Returns:
        Response: Redirect to home or chat list page
    """
    return redirect(url_for('web_routes.my_chats'))

@web_routes.route('/home')
def home():
    """
    Home page route
    
    Returns:
        Response: Home page template
    """
    return render_controller.render_home()

@web_routes.route('/my-chats')
def my_chats():
    """
    My chats page route
    
    Returns:
        Response: My chats page template
    """
    return render_controller.render_my_chats()

@web_routes.route('/chat/<chat_id>')
def chat(chat_id):
    """
    Chat page route
    
    Args:
        chat_id (str): ID of the chat to display
        
    Returns:
        Response: Chat page template
    """
    return render_controller.render_chat(chat_id)

@web_routes.route('/create')
def create_chat():
    """
    Create chat page route
    
    Returns:
        Response: Create chat page template
    """
    return render_controller.render_create_chat()

@web_routes.route('/login')
def login():
    """
    Login page route
    
    Returns:
        Response: Login page template
    """
    return render_controller.render_login()

@web_routes.route('/welcome')
def welcome():
    """
    Welcome page route
    
    Returns:
        Response: Welcome page template
    """
    return render_controller.render_welcome()

@web_routes.route('/invite/<invitation_code>')
def invitation(invitation_code):
    """
    Invitation accept page route
    
    Args:
        invitation_code (str): Invitation code to process
        
    Returns:
        Response: Invitation accept page template
    """
    return render_controller.render_invitation(invitation_code)

# Error routes
@web_routes.errorhandler(404)
def page_not_found(e):
    """
    404 error page route
    
    Args:
        e: Error object
        
    Returns:
        Response: Error page template
    """
    return render_controller.render_error(404, "Page Not Found")

@web_routes.errorhandler(500)
def server_error(e):
    """
    500 error page route
    
    Args:
        e: Error object
        
    Returns:
        Response: Error page template
    """
    return render_controller.render_error(500, "Server Error")

# Register the blueprint with the app
def init_app(app):
    """
    Initialize web routes with Flask app
    
    Args:
        app: Flask application instance
    """
    app.register_blueprint(web_routes) 