"""
Template Service for ABDRE Chat Application
Handles template rendering with context data for server-side rendering
"""

import logging
import os
from datetime import datetime
from flask import Flask, render_template, request, g

logger = logging.getLogger(__name__)

class TemplateService:
    """Service to handle template rendering with context data"""
    
    def __init__(self, app=None):
        """Initialize template service with Flask app"""
        self.app = app
        
    def init_app(self, app):
        """Initialize with Flask app if not provided in constructor"""
        self.app = app
    
    def render(self, template_name, **context):
        """
        Render a template with provided context and additional common context variables
        
        Args:
            template_name (str): Name of the template to render
            context (dict): Context variables for the template
            
        Returns:
            str: Rendered HTML
        """
        # Add common context variables
        context.update(self._get_common_context())
        
        # Add critical CSS if available
        critical_css = self._get_critical_css(template_name)
        if critical_css:
            context['critical_css'] = critical_css
        
        # Add asset versions for cache busting
        context['asset_versions'] = self._get_asset_versions()
        
        # Render the template
        return render_template(template_name, **context)

    def _get_common_context(self):
        """
        Get common context variables for all templates
        
        Returns:
            dict: Common context variables
        """
        return {
            'server_rendered': True,
            'render_time': datetime.utcnow().isoformat(),
            'path': request.path,
            'is_authenticated': self._is_authenticated(),
            'user': self._get_user_context(),
            'flash_messages': self._get_flash_messages(),
            'request_id': g.get('request_id', None),
            'csrf_token': g.get('csrf_token', None),
            'is_production': os.environ.get('FLASK_ENV') != 'development'
        }
    
    def _is_authenticated(self):
        """
        Check if current request is authenticated
        
        Returns:
            bool: True if authenticated, False otherwise
        """
        return hasattr(g, 'user') and g.user is not None
    
    def _get_user_context(self):
        """
        Get user context for templates
        
        Returns:
            dict: User context or None if not authenticated
        """
        if not self._is_authenticated():
            return None
            
        # Return only safe user fields for template context
        return {
            'user_id': g.user.get('user_id'),
            'username': g.user.get('username'),
            'display_name': g.user.get('display_name'),
            'email': g.user.get('email')
        }
    
    def _get_flash_messages(self):
        """
        Get flash messages for the template
        
        Returns:
            list: Flash messages
        """
        # If using Flask's flash system, return those
        # This is a placeholder - implement according to your system
        return getattr(g, 'flash_messages', [])
    
    def _get_critical_css(self, template_name):
        """
        Get critical CSS for a specific template
        
        Args:
            template_name (str): Name of the template
            
        Returns:
            str: Critical CSS content or None if not found
        """
        # Strip extension and convert to path
        template_base = template_name.rsplit('.', 1)[0]
        critical_css_path = os.path.join(
            self.app.static_folder,
            'css',
            'critical',
            f'{template_base}.css'
        )
        
        if os.path.exists(critical_css_path):
            try:
                with open(critical_css_path, 'r') as f:
                    return f.read()
            except Exception as e:
                logger.error(f"Error reading critical CSS for {template_name}: {str(e)}")
        
        return None
    
    def _get_asset_versions(self):
        """
        Get asset versions for cache busting
        
        Returns:
            dict: Asset versions keyed by file path
        """
        # This would ideally come from a manifest file generated during build
        # For now, we'll use the current timestamp as a version
        version = datetime.utcnow().strftime('%Y%m%d%H%M%S')
        
        return {
            'js': version,
            'css': version
        }

# Global template service instance
template_service = TemplateService() 