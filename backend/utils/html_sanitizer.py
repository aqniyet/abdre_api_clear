"""
HTML Sanitizer for ABDRE Chat Application
Provides utilities for sanitizing HTML content to prevent XSS attacks
"""

import bleach
import logging

logger = logging.getLogger(__name__)

# Allowed HTML tags
ALLOWED_TAGS = [
    'a', 'abbr', 'acronym', 'b', 'blockquote', 'br', 'code',
    'div', 'em', 'i', 'li', 'ol', 'p', 'pre', 'span',
    'strong', 'ul'
]

# Allowed HTML attributes
ALLOWED_ATTRIBUTES = {
    'a': ['href', 'title', 'target', 'rel'],
    'abbr': ['title'],
    'acronym': ['title'],
    'div': ['class'],
    'span': ['class'],
    'p': ['class'],
    'pre': ['class'],
    'code': ['class']
}

# Allowed URL schemes
ALLOWED_PROTOCOLS = ['http', 'https', 'mailto', 'tel']

def sanitize_html(html_content, tags=None, attributes=None, protocols=None):
    """
    Sanitize HTML content to prevent XSS attacks
    
    Args:
        html_content (str): HTML content to sanitize
        tags (list): Optional list of allowed tags to override defaults
        attributes (dict): Optional dict of allowed attributes to override defaults
        protocols (list): Optional list of allowed protocols to override defaults
        
    Returns:
        str: Sanitized HTML content
    """
    if not html_content:
        return ""
        
    try:
        # Use provided parameters or defaults
        allowed_tags = tags or ALLOWED_TAGS
        allowed_attributes = attributes or ALLOWED_ATTRIBUTES
        allowed_protocols = protocols or ALLOWED_PROTOCOLS
        
        # Sanitize the HTML
        clean_html = bleach.clean(
            html_content,
            tags=allowed_tags,
            attributes=allowed_attributes,
            protocols=allowed_protocols,
            strip=True,
            strip_comments=True
        )
        
        return clean_html
    except Exception as e:
        logger.error(f"Error sanitizing HTML: {str(e)}")
        # In case of error, strip all HTML as a fallback
        return bleach.clean(
            html_content,
            tags=[],
            attributes={},
            protocols=[],
            strip=True
        ) 