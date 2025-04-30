"""
Health check utilities for microservices
"""
import os
import sys
import time
import json
import logging
import platform
from typing import Dict, List, Optional, Any, Union, Callable
import psutil
from flask import Blueprint, jsonify, current_app, g, request

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class HealthCheck:
    """
    Health check utility for Flask microservices
    """
    def __init__(self, app=None, endpoint: str = '/health', 
                 db_engines: Optional[List[Any]] = None,
                 redis_client: Optional[Any] = None):
        """
        Initialize the health check utility
        
        Args:
            app: Flask application (optional)
            endpoint: Health check endpoint (default: /health)
            db_engines: List of SQLAlchemy engines to check
            redis_client: Redis client to check
        """
        self.endpoint = endpoint
        self.db_engines = db_engines or []
        self.redis_client = redis_client
        self.blueprint = Blueprint('health', __name__)
        self.custom_checks: Dict[str, Callable[[], Dict[str, Any]]] = {}
        
        # Set up the health check endpoint
        self.blueprint.route(endpoint)(self.health_check)
        
        if app:
            self.init_app(app)
            
    def init_app(self, app) -> None:
        """
        Register the health check blueprint with a Flask app
        
        Args:
            app: Flask application
        """
        app.register_blueprint(self.blueprint)
        app.extensions['health_check'] = self
        
    def add_check(self, name: str, check_func: Callable[[], Dict[str, Any]]) -> None:
        """
        Add a custom health check
        
        Args:
            name: Check name
            check_func: Function that returns health check data
        """
        self.custom_checks[name] = check_func
        
    def check_db_connection(self) -> Dict[str, bool]:
        """
        Check database connections
        
        Returns:
            Dictionary of database connection statuses
        """
        results = {}
        
        for i, engine in enumerate(self.db_engines):
            db_name = f"db_{i+1}"
            try:
                # Test connection by executing a simple query
                with engine.connect() as conn:
                    conn.execute("SELECT 1")
                results[db_name] = True
            except Exception as e:
                logger.error(f"Database connection error: {str(e)}")
                results[db_name] = False
                
        return results
    
    def check_redis_connection(self) -> bool:
        """
        Check Redis connection
        
        Returns:
            True if connected, False otherwise
        """
        if not self.redis_client:
            return True  # Skip if not configured
            
        try:
            self.redis_client.ping()
            return True
        except Exception as e:
            logger.error(f"Redis connection error: {str(e)}")
            return False
            
    def system_health(self) -> Dict[str, Any]:
        """
        Get system health metrics
        
        Returns:
            Dictionary of system health data
        """
        try:
            return {
                'cpu': {
                    'usage_percent': psutil.cpu_percent(interval=0.1),
                    'count': psutil.cpu_count()
                },
                'memory': {
                    'total': psutil.virtual_memory().total,
                    'available': psutil.virtual_memory().available,
                    'percent': psutil.virtual_memory().percent
                },
                'disk': {
                    'total': psutil.disk_usage('/').total,
                    'free': psutil.disk_usage('/').free,
                    'percent': psutil.disk_usage('/').percent
                },
                'python': {
                    'version': sys.version,
                    'implementation': platform.python_implementation()
                },
                'platform': {
                    'system': platform.system(),
                    'release': platform.release(),
                    'version': platform.version()
                }
            }
        except Exception as e:
            logger.error(f"Error getting system health: {str(e)}")
            return {'error': str(e)}
            
    def health_check(self):
        """Flask route handler for health check endpoint"""
        start_time = time.time()
        
        # Build health check data
        health_data = {
            'status': 'healthy',
            'timestamp': time.time(),
            'uptime': self._get_uptime(),
            'request': {
                'id': g.get('correlation_id', 'unknown'),
                'method': request.method,
                'path': request.path,
                'remote_addr': request.remote_addr
            }
        }
        
        # Check database connections if configured
        if self.db_engines:
            db_status = self.check_db_connection()
            health_data['database'] = db_status
            
            # Set overall status to degraded if any database is down
            if not all(db_status.values()):
                health_data['status'] = 'degraded'
        
        # Check Redis connection if configured
        if self.redis_client:
            redis_status = self.check_redis_connection()
            health_data['redis'] = redis_status
            
            # Set overall status to degraded if Redis is down
            if not redis_status:
                health_data['status'] = 'degraded'
        
        # Add custom health checks
        for name, check_func in self.custom_checks.items():
            try:
                result = check_func()
                health_data[name] = result
                
                # If the check returns a 'status' field and it's not 'healthy', mark overall as degraded
                if isinstance(result, dict) and result.get('status') not in ('healthy', 'ok', True):
                    health_data['status'] = 'degraded'
            except Exception as e:
                logger.error(f"Error in health check {name}: {str(e)}")
                health_data[name] = {'error': str(e)}
                health_data['status'] = 'degraded'
        
        # Include simplified system health information
        system_info = self.system_health()
        health_data['system'] = {
            'cpu_percent': system_info.get('cpu', {}).get('usage_percent', 0),
            'memory_percent': system_info.get('memory', {}).get('percent', 0),
            'disk_percent': system_info.get('disk', {}).get('percent', 0)
        }
        
        # Include response time
        health_data['response_time'] = time.time() - start_time
        
        # Return as JSON (always 200 status to indicate the service is running)
        # The 'status' field in the response indicates the health status
        return jsonify(health_data)
        
    def _get_uptime(self) -> float:
        """
        Get application uptime
        
        Returns:
            Uptime in seconds
        """
        # Try to get start time from Flask app
        if hasattr(current_app, 'start_time'):
            return time.time() - current_app.start_time
            
        # Fallback to process start time
        try:
            process = psutil.Process(os.getpid())
            return time.time() - process.create_time()
        except Exception:
            return 0.0 