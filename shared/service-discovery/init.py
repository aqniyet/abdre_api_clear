"""
Service initialization script for registering services with the registry
"""
import os
import sys
import argparse
import json
import logging
from typing import Dict, Any, Optional

from .registry import registry, ServiceInfo

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler()]
)
logger = logging.getLogger(__name__)


def register_services_from_env() -> None:
    """
    Register services from environment variables
    
    Environment variables should be in the format:
    SERVICE_NAME_HOST, SERVICE_NAME_PORT
    
    For example:
    AUTH_SERVICE_HOST=auth_service
    AUTH_SERVICE_PORT=5001
    """
    registered = 0
    
    # Look for service host/port pairs in environment variables
    for env_var in os.environ:
        if env_var.endswith('_HOST'):
            service_prefix = env_var[:-5]  # Remove _HOST suffix
            port_var = f"{service_prefix}_PORT"
            
            if port_var in os.environ:
                service_name = service_prefix.lower()
                host = os.environ[env_var]
                try:
                    port = int(os.environ[port_var])
                    
                    # Check for optional health endpoint
                    health_endpoint = os.environ.get(f"{service_prefix}_HEALTH_ENDPOINT", '/health')
                    
                    # Additional metadata from environment
                    metadata = {}
                    metadata_var = f"{service_prefix}_METADATA"
                    if metadata_var in os.environ:
                        try:
                            metadata = json.loads(os.environ[metadata_var])
                        except json.JSONDecodeError:
                            logger.warning(f"Invalid JSON in {metadata_var}")
                    
                    registry.register_service(
                        name=service_name,
                        host=host,
                        port=port,
                        health_endpoint=health_endpoint,
                        metadata=metadata
                    )
                    
                    registered += 1
                    logger.info(f"Registered service {service_name} at {host}:{port}")
                except ValueError:
                    logger.error(f"Invalid port for {service_name}: {os.environ[port_var]}")
    
    logger.info(f"Registered {registered} services from environment variables")


def register_services_from_file(config_file: str) -> None:
    """
    Register services from a configuration file
    
    Args:
        config_file: Path to the configuration file (JSON format)
    """
    if not os.path.exists(config_file):
        logger.error(f"Configuration file not found: {config_file}")
        return
        
    try:
        with open(config_file, 'r') as f:
            config = json.load(f)
            
        if not isinstance(config, dict) or 'services' not in config:
            logger.error("Invalid configuration format: missing 'services' key")
            return
            
        services_config = config['services']
        registered = 0
        
        for service_name, service_config in services_config.items():
            if not isinstance(service_config, dict):
                logger.warning(f"Invalid service configuration for {service_name}")
                continue
                
            host = service_config.get('host')
            port = service_config.get('port')
            
            if not host or not port:
                logger.warning(f"Missing host or port for {service_name}")
                continue
                
            try:
                port = int(port)
                health_endpoint = service_config.get('health_endpoint', '/health')
                metadata = service_config.get('metadata', {})
                
                registry.register_service(
                    name=service_name,
                    host=host,
                    port=port,
                    health_endpoint=health_endpoint,
                    metadata=metadata
                )
                
                registered += 1
                logger.info(f"Registered service {service_name} at {host}:{port}")
            except ValueError:
                logger.error(f"Invalid port for {service_name}: {port}")
        
        logger.info(f"Registered {registered} services from configuration file")
    except Exception as e:
        logger.error(f"Error loading configuration file: {str(e)}")


def initialize_registry(config_file: Optional[str] = None, start_health_checks: bool = True) -> None:
    """
    Initialize the service registry from environment variables and/or a config file
    
    Args:
        config_file: Path to configuration file (optional)
        start_health_checks: Whether to start the health check thread
    """
    # Register services from environment variables
    register_services_from_env()
    
    # Register services from configuration file if provided
    if config_file:
        register_services_from_file(config_file)
    
    # Start health check thread
    if start_health_checks:
        registry.start_health_checks()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Initialize service registry')
    parser.add_argument('--config', help='Path to configuration file')
    parser.add_argument('--no-health-checks', action='store_true', help='Disable health checks')
    
    args = parser.parse_args()
    
    initialize_registry(
        config_file=args.config,
        start_health_checks=not args.no_health_checks
    ) 