"""
Logs Controller for ABDRE Chat Application
Handles client-side error logging and log file management
"""

import logging
import os
import json
from datetime import datetime
from flask import Blueprint, request, jsonify, g

# Create logger
logger = logging.getLogger(__name__)

# Create blueprint
logs_bp = Blueprint('logs', __name__, url_prefix='/api/logs')

# Create a second blueprint for root-level logs (for client compatibility)
root_logs_bp = Blueprint('root_logs', __name__, url_prefix='/logs')

# Constants
LOG_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'logs')

# Ensure logs directory exists
if not os.path.exists(LOG_DIR):
    os.makedirs(LOG_DIR)

class LogsController:
    """Controller to handle logs management"""
    
    def log_client_error(self):
        """Log client-side errors to server logs"""
        try:
            data = request.get_json()
            if not data:
                return jsonify({'error': 'No data provided'}), 400
            
            # Log the error with client details
            client_ip = request.remote_addr
            logger.error(f"CLIENT ERROR [{client_ip}]: {json.dumps(data)}")
            
            return jsonify({'status': 'success'}), 200
        except Exception as e:
            logger.exception(f"Error in log_client_error: {str(e)}")
            return jsonify({'error': 'Failed to log error'}), 500
    
    def log_to_file(self):
        """Write log entry to a specified log file"""
        try:
            data = request.get_json()
            if not data:
                return jsonify({'error': 'No data provided'}), 400
            
            # Extract log details
            file_name = data.get('file', 'error_tracking.log')
            message = data.get('message', 'No message provided')
            level = data.get('level', 'INFO').upper()
            
            # Validate file name (basic security check)
            if '..' in file_name or not file_name.endswith('.log'):
                return jsonify({'error': 'Invalid log file name'}), 400
                
            # Write to log file
            log_path = os.path.join(LOG_DIR, file_name)
            with open(log_path, 'a') as log_file:
                # Add timestamp if not in message
                if not message.startswith(('20', '19')):  # Simple check for ISO date format
                    timestamp = datetime.now().isoformat()
                    message = f"{timestamp} - {message}"
                
                log_file.write(f"{message}\n")
            
            return jsonify({'status': 'success'}), 200
        except Exception as e:
            logger.exception(f"Error in log_to_file: {str(e)}")
            return jsonify({'error': 'Failed to write to log file'}), 500
            
    def get_latest_logs(self):
        """Get the latest entries from a log file"""
        try:
            file_name = request.args.get('file', 'error_tracking.log')
            lines = int(request.args.get('lines', 100))
            
            # Validate file name
            if '..' in file_name or not file_name.endswith('.log'):
                return jsonify({'error': 'Invalid log file name'}), 400
                
            # Cap lines for security
            if lines > 1000:
                lines = 1000
                
            # Read from log file
            log_path = os.path.join(LOG_DIR, file_name)
            if not os.path.exists(log_path):
                return jsonify({'logs': [], 'file': file_name}), 200
                
            # Read the last N lines
            with open(log_path, 'r') as log_file:
                # Simple last N lines implementation
                all_lines = log_file.readlines()
                last_lines = all_lines[-lines:] if lines < len(all_lines) else all_lines
                
            return jsonify({
                'logs': last_lines,
                'file': file_name,
                'total_lines': len(all_lines),
                'returned_lines': len(last_lines)
            }), 200
        except Exception as e:
            logger.exception(f"Error in get_latest_logs: {str(e)}")
            return jsonify({'error': 'Failed to read log file'}), 500

# Initialize controller
logs_controller = LogsController()

# Register routes
@logs_bp.route('/client-error', methods=['POST'])
def client_error():
    return logs_controller.log_client_error()

@logs_bp.route('/file-log', methods=['POST'])
def file_log():
    return logs_controller.log_to_file()

@logs_bp.route('/latest', methods=['GET'])
def latest_logs():
    return logs_controller.get_latest_logs()

# Register the same routes at root level for direct client access
@root_logs_bp.route('/client-error', methods=['POST'])
def root_client_error():
    return logs_controller.log_client_error()

@root_logs_bp.route('/file-log', methods=['POST'])
def root_file_log():
    return logs_controller.log_to_file()

@root_logs_bp.route('/latest', methods=['GET'])
def root_latest_logs():
    return logs_controller.get_latest_logs() 