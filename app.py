"""
ABDRE Chat Application Main Entry Point
Run this script to start the application
"""

import os
from backend import create_app

app = create_app()

if __name__ == '__main__':
    # Get port from environment or use default
    port = int(os.environ.get('PORT', 5000))
    
    # Get debug mode from environment
    debug = os.environ.get('DEBUG', 'False').lower() == 'true'
    
    # Run application
    app.run(host='0.0.0.0', port=port, debug=debug) 