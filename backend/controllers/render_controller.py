"""
Render Controller for ABDRE Chat Application
Handles template rendering for server-side rendered pages
"""

import json
import logging
import os
import re
import requests
from datetime import datetime
from flask import g, request, redirect, url_for, jsonify, abort

from backend.services.template_service import template_service
from backend.utils.message_formatter import MessageFormatter
from backend.utils.chat_list_formatter import ChatListFormatter
from backend.utils.html_sanitizer import sanitize_html

logger = logging.getLogger(__name__)

class RenderController:
    """Controller for server-side rendering"""
    
    def __init__(self, app=None):
        """Initialize with Flask app"""
        self.app = app
        if app:
            self.init_app(app)
    
    def init_app(self, app):
        """Initialize with Flask app"""
        self.app = app
        
        # Register routes
        self._register_routes()
    
    def _register_routes(self):
        """Register rendering routes with the app"""
        self.app.add_url_rule('/', 'render_index', self.render_index)
        self.app.add_url_rule('/login', 'render_login', self.render_login)
        self.app.add_url_rule('/my-chats', 'render_my_chats', self.render_my_chats)
        self.app.add_url_rule('/chat/<chat_id>', 'render_chat', self.render_chat)
        self.app.add_url_rule('/create', 'render_create_chat', self.render_create_chat)
        
    def render_index(self):
        """Render the index page"""
        return template_service.render('index.html')
    
    def render_login(self):
        """Render the login page"""
        # If user is already authenticated, redirect to my-chats page
        if hasattr(g, 'user') and g.user:
            return redirect('/my-chats')
            
        # Get optional redirect parameter
        redirect_to = request.args.get('redirect', '/my-chats')
        
        # Check if a specific error message needs to be displayed
        error = request.args.get('error')
        
        return template_service.render('login.html', 
            redirect_to=redirect_to,
            error=error,
            server_rendered=True
        )
    
    def render_my_chats(self):
        """Render the my-chats page with server-side rendered chat list"""
        # Check if user is authenticated, redirect to login if not
        if not hasattr(g, 'user') or not g.user:
            return redirect('/login?redirect=/my-chats')
        
        # Get chat list for the user from API
        try:
            user_id = g.user.get('user_id')
            token = request.cookies.get('auth_token')
            
            response = self._make_api_request(
                'GET',
                '/api/my-chats',
                headers={'Authorization': f'Bearer {token}'}
            )
            
            if response.status_code == 200:
                chats_data = response.json()
                
                # Format chats for template
                context = ChatListFormatter.prepare_chats_for_template(
                    chats_data.get('chats', []),
                    user_id
                )
                
                # Add additional context
                context.update({
                    'user': g.user,
                    'server_rendered': True,
                    'current_time': datetime.utcnow().isoformat()
                })
                
                return template_service.render('my_chats.html', **context)
            else:
                logger.error(f"Error fetching chats: {response.status_code}")
                # Return empty chat list
                return template_service.render('my_chats.html', 
                    chats=[],
                    total_chats=0,
                    unread_count=0,
                    chats_json=json.dumps([]),
                    error=f"Could not load chats. Status: {response.status_code}"
                )
        
        except Exception as e:
            logger.exception(f"Error rendering my-chats page: {str(e)}")
            return template_service.render('my_chats.html', 
                chats=[],
                total_chats=0,
                unread_count=0,
                chats_json=json.dumps([]),
                error=f"An error occurred: {str(e)}"
            )
    
    def render_chat(self, chat_id):
        """Render the chat page with server-side rendered messages"""
        # Check if user is authenticated, redirect to login if not
        if not hasattr(g, 'user') or not g.user:
            return redirect(f'/login?redirect=/chat/{chat_id}')
        
        # Validate chat_id format
        if not re.match(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', chat_id):
            return abort(404)
        
        try:
            user_id = g.user.get('user_id')
            token = request.cookies.get('auth_token')
            
            # Get chat details from API
            chat_response = self._make_api_request(
                'GET',
                f'/api/chats/{chat_id}',
                headers={'Authorization': f'Bearer {token}'}
            )
            
            if chat_response.status_code != 200:
                logger.error(f"Error fetching chat: {chat_response.status_code}")
                return abort(404)
            
            chat_data = chat_response.json()
            
            # Get chat messages from API
            messages_response = self._make_api_request(
                'GET',
                f'/api/chats/{chat_id}/messages',
                headers={'Authorization': f'Bearer {token}'}
            )
            
            if messages_response.status_code != 200:
                logger.error(f"Error fetching messages: {messages_response.status_code}")
                messages = []
            else:
                messages = messages_response.json().get('messages', [])
            
            # Format messages for template
            messages_context = MessageFormatter.prepare_messages_for_template(
                messages,
                user_id
            )
            
            # Get chat participants and find the other participant
            participants = chat_data.get('participants', [])
            other_participants = [p for p in participants if p.get('user_id') != user_id]
            
            if other_participants:
                participant = other_participants[0]
                chat_name = participant.get('display_name') or participant.get('username') or 'Chat Participant'
            else:
                chat_name = 'Chat'
            
            # Combine all context
            context = {
                'chat': chat_data,
                'chat_id': chat_id,
                'chat_name': chat_name,
                'user': g.user,
                'server_rendered': True,
                'initial_connection_status': 'connecting',
                'current_time': datetime.utcnow().isoformat(),
                'is_empty': len(messages) == 0
            }
            context.update(messages_context)
            
            return template_service.render('chat.html', **context)
            
        except Exception as e:
            logger.exception(f"Error rendering chat page: {str(e)}")
            return template_service.render('error.html',
                error=f"Could not load chat: {str(e)}",
                back_url='/my-chats'
            )
    
    def render_create_chat(self):
        """Render the create chat page"""
        # Check if user is authenticated, redirect to login if not
        if not hasattr(g, 'user') or not g.user:
            return redirect('/login?redirect=/create')
        
        return template_service.render('create.html',
            user=g.user,
            server_rendered=True
        )
    
    def _make_api_request(self, method, url, **kwargs):
        """
        Make a request to internal API endpoint
        
        Args:
            method: HTTP method
            url: API URL
            **kwargs: Additional arguments for requests
            
        Returns:
            Response object
        """
        # Determine full URL based on whether it's an absolute or relative URL
        if url.startswith('http'):
            full_url = url
        else:
            # Replace /api with appropriate service URL based on the endpoint
            if url.startswith('/api/chats'):
                service_url = os.environ.get('CHAT_SERVICE_URL', 'http://localhost:5504')
                full_url = service_url + url.replace('/api/chats', '')
            elif url.startswith('/api/users'):
                service_url = os.environ.get('USER_SERVICE_URL', 'http://localhost:5502')
                full_url = service_url + url.replace('/api/users', '')
            elif url.startswith('/api/auth'):
                service_url = os.environ.get('AUTH_SERVICE_URL', 'http://localhost:5501')
                full_url = service_url + url.replace('/api/auth', '')
            elif url.startswith('/api/my-chats'):
                # Add specific handling for my-chats API endpoint
                service_url = os.environ.get('CHAT_SERVICE_URL', 'http://localhost:5504')
                full_url = service_url + '/my-chats'
            else:
                # Default case - use API base URL with the provided path
                api_base_url = os.environ.get('API_BASE_URL', 'http://localhost:5000')
                full_url = api_base_url + url
        
        # Add request ID for tracing
        headers = kwargs.get('headers', {})
        headers['X-Request-ID'] = g.get('request_id', 'unknown')
        kwargs['headers'] = headers
        
        # Make the request
        return requests.request(method, full_url, **kwargs) 

# Initialize controller
render_controller = RenderController() 