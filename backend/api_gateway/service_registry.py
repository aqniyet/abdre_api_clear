"""
API Gateway - Service Registry
Handles service discovery and management
"""

import os
import json
import logging
import threading
import time
from pathlib import Path

# Setup logging
logger = logging.getLogger(__name__)

class ServiceRegistry:
    """
    Service Registry for managing microservices
    Implements a simple registry for service discovery
    """
    
    def __init__(self, registry_file=None):
        """Initialize the service registry"""
        self.registry_file = registry_file or os.environ.get(
            'SERVICE_REGISTRY_FILE', 
            str(Path(__file__).parent / 'services.json')
        )
        self.services = {}
        self.lock = threading.RLock()
        
        # Load initial services from environment or file
        self._load_services()
        
        # Start background refresh thread
        self._start_refresh_thread()
    
    def _load_services(self):
        """Load services from registry file or environment"""
        with self.lock:
            try:
                # First try to load from file
                if os.path.exists(self.registry_file):
                    with open(self.registry_file, 'r') as f:
                        self.services = json.load(f)
                        logger.info(f"Loaded {len(self.services)} services from {self.registry_file}")
                        return
                
                # If file doesn't exist, initialize with defaults from environment
                self._initialize_default_services()
                
                # Save to file
                self._save_services()
                
            except Exception as e:
                logger.error(f"Error loading service registry: {str(e)}")
                # Initialize with defaults
                self._initialize_default_services()
    
    def _initialize_default_services(self):
        """Initialize default services from environment variables"""
        self.services = {
            'auth-service': {
                'name': 'auth-service',
                'url': os.environ.get('AUTH_SERVICE_URL', 'http://localhost:5501'),
                'status': 'unknown'
            }
            # Add more default services here as needed
        }
        logger.info("Initialized default services from environment")
    
    def _save_services(self):
        """Save services to registry file"""
        try:
            with open(self.registry_file, 'w') as f:
                json.dump(self.services, f, indent=2)
            logger.info(f"Saved {len(self.services)} services to {self.registry_file}")
        except Exception as e:
            logger.error(f"Error saving service registry: {str(e)}")
    
    def _start_refresh_thread(self):
        """Start background thread to periodically refresh service status"""
        def refresh_thread():
            while True:
                try:
                    self._check_services_health()
                    time.sleep(60)  # Check every minute
                except Exception as e:
                    logger.error(f"Error in refresh thread: {str(e)}")
                    time.sleep(60)  # Sleep and retry
        
        thread = threading.Thread(target=refresh_thread, daemon=True)
        thread.start()
        logger.info("Started service registry refresh thread")
    
    def _check_services_health(self):
        """Check health of all registered services"""
        import requests
        
        with self.lock:
            for service_name, service_info in self.services.items():
                try:
                    service_url = service_info['url']
                    response = requests.get(f"{service_url}/health", timeout=3)
                    
                    if response.status_code == 200:
                        self.services[service_name]['status'] = 'healthy'
                    else:
                        self.services[service_name]['status'] = 'unhealthy'
                        
                except requests.RequestException:
                    self.services[service_name]['status'] = 'unreachable'
            
            # Save updated status
            self._save_services()
    
    def register_service(self, name, url):
        """
        Register a new service
        
        Args:
            name (str): Service name
            url (str): Service URL
            
        Returns:
            bool: True if successful, False otherwise
        """
        with self.lock:
            self.services[name] = {
                'name': name,
                'url': url,
                'status': 'unknown'
            }
            self._save_services()
            return True
    
    def deregister_service(self, name):
        """
        Deregister a service
        
        Args:
            name (str): Service name
            
        Returns:
            bool: True if successful, False otherwise
        """
        with self.lock:
            if name in self.services:
                del self.services[name]
                self._save_services()
                return True
            return False
    
    def get_service(self, name):
        """
        Get service by name
        
        Args:
            name (str): Service name
            
        Returns:
            dict: Service information, or None if not found
        """
        with self.lock:
            return self.services.get(name)
    
    def get_all_services(self):
        """
        Get all registered services
        
        Returns:
            dict: Dictionary of all services
        """
        with self.lock:
            return self.services.copy()
    
    def update_service(self, name, url=None, status=None):
        """
        Update service information
        
        Args:
            name (str): Service name
            url (str, optional): New service URL
            status (str, optional): New service status
            
        Returns:
            bool: True if successful, False otherwise
        """
        with self.lock:
            if name not in self.services:
                return False
            
            if url:
                self.services[name]['url'] = url
            
            if status:
                self.services[name]['status'] = status
            
            self._save_services()
            return True 