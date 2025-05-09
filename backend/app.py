"""
ABDRE Chat Application Main Entry Point
Run this script to start the application
"""

import os
import sys
import logging

# Add parent directory to Python path to make backend importable
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from backend import create_app

app = create_app()

if __name__ == '__main__':
    # Load configuration from environment variables
    host = os.environ.get('HOST', '0.0.0.0')
    port = int(os.environ.get('PORT', 5001))  # Use port 5001 to not conflict with realtime service
    debug = os.environ.get('DEBUG', 'False').lower() == 'true'
    
    # Start the application
    logging.info(f"Starting ABDRE Chat Application on port {port}, debug={debug}")
    app.run(host=host, port=port, debug=debug) 