"""
Template Context Processors for ABDRE Chat Application
Provides context processors for Jinja2 templates
"""

import hashlib
import os
import random
import time
from datetime import datetime
from functools import wraps

from flask import g, request


def template_context_processor():
    """
    Context processor for Jinja2 templates
    
    Returns:
        dict: Context variables accessible in all templates
    """
    return {
        # Environment information
        'environment': os.environ.get('FLASK_ENV', 'development'),
        'is_production': os.environ.get('FLASK_ENV') == 'production',
        'debug': os.environ.get('FLASK_ENV') == 'development',
        
        # Request information
        'url': request.url,
        'path': request.path,
        'endpoint': request.endpoint,
        
        # Helper functions
        'format_timestamp': format_timestamp,
        'format_relative_time': format_relative_time,
        'asset_url': asset_url,
        'generate_nonce': generate_nonce,
        'sanitize_html': sanitize_html,
        'current_time': datetime.utcnow(),
    }


def user_context_processor():
    """
    Context processor for user information
    
    Returns:
        dict: User context variables
    """
    user = getattr(g, 'user', None)
    
    if user:
        # Filter only safe attributes for templates
        safe_user = {
            'user_id': user.get('user_id'),
            'username': user.get('username'),
            'display_name': user.get('display_name'),
            'email': user.get('email'),
            'is_authenticated': True
        }
    else:
        safe_user = {
            'is_authenticated': False
        }
    
    return {'user': safe_user}


def format_timestamp(timestamp, format_str='%Y-%m-%d %H:%M:%S'):
    """
    Format a timestamp for display
    
    Args:
        timestamp: Timestamp to format (datetime or string)
        format_str: Format string
        
    Returns:
        str: Formatted timestamp
    """
    if isinstance(timestamp, str):
        try:
            timestamp = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
        except (ValueError, TypeError):
            try:
                timestamp = datetime.strptime(timestamp, '%Y-%m-%dT%H:%M:%S.%fZ')
            except (ValueError, TypeError):
                return timestamp
    
    if isinstance(timestamp, datetime):
        return timestamp.strftime(format_str)
    
    return timestamp


def format_relative_time(timestamp):
    """
    Format a timestamp as a relative time (e.g., "2 hours ago")
    
    Args:
        timestamp: Timestamp to format
        
    Returns:
        str: Relative time string
    """
    if isinstance(timestamp, str):
        try:
            timestamp = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
        except (ValueError, TypeError):
            try:
                timestamp = datetime.strptime(timestamp, '%Y-%m-%dT%H:%M:%S.%fZ')
            except (ValueError, TypeError):
                return timestamp
    
    if not isinstance(timestamp, datetime):
        return str(timestamp)
    
    now = datetime.utcnow()
    diff = now - timestamp
    
    seconds = diff.total_seconds()
    
    if seconds < 60:
        return "just now"
    elif seconds < 3600:
        minutes = int(seconds / 60)
        return f"{minutes} minute{'s' if minutes != 1 else ''} ago"
    elif seconds < 86400:
        hours = int(seconds / 3600)
        return f"{hours} hour{'s' if hours != 1 else ''} ago"
    elif seconds < 604800:
        days = int(seconds / 86400)
        return f"{days} day{'s' if days != 1 else ''} ago"
    else:
        return timestamp.strftime('%Y-%m-%d')


def asset_url(path, version=None):
    """
    Generate a versioned URL for an asset
    
    Args:
        path: Asset path relative to static folder
        version: Version string for cache busting
        
    Returns:
        str: Versioned asset URL
    """
    if version is None:
        # Use modification time as version
        static_folder = os.environ.get('STATIC_FOLDER', '../frontend/static')
        full_path = os.path.join(static_folder, path)
        
        if os.path.exists(full_path):
            version = int(os.path.getmtime(full_path))
        else:
            # Fallback to current timestamp
            version = int(time.time())
    
    return f"/static/{path}?v={version}"


def generate_nonce():
    """
    Generate a nonce for Content Security Policy
    
    Returns:
        str: Random nonce
    """
    return hashlib.sha256(str(random.getrandbits(256)).encode()).hexdigest()[:16]


def sanitize_html(html_str):
    """
    Sanitize HTML to prevent XSS attacks
    
    Args:
        html_str: HTML string to sanitize
        
    Returns:
        str: Sanitized HTML
    """
    import html
    
    # Basic HTML escaping - in production, use a proper HTML sanitizer
    return html.escape(html_str)


def cache_for(seconds):
    """
    Decorator to cache a function result for a specified time
    
    Args:
        seconds: Cache lifetime in seconds
        
    Returns:
        function: Decorated function
    """
    def decorator(f):
        cache = {}
        
        @wraps(f)
        def decorated_function(*args, **kwargs):
            # Create a cache key from args and kwargs
            key = str(args) + str(sorted(kwargs.items()))
            
            # Check if result is cached and not expired
            if key in cache:
                timestamp, result = cache[key]
                if time.time() - timestamp < seconds:
                    return result
            
            # Execute function and cache result
            result = f(*args, **kwargs)
            cache[key] = (time.time(), result)
            return result
        
        return decorated_function
    
    return decorator 