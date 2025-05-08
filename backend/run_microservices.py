#!/usr/bin/env python3
"""
ABDRE Chat Microservices Runner
Script to run all microservices for development
"""

import os
import sys
import time
import signal
import logging
import subprocess
from pathlib import Path

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("microservices_runner")

# Paths
BASE_DIR = Path(__file__).parent
API_GATEWAY_PATH = BASE_DIR / "api_gateway" / "app.py"
AUTH_SERVICE_PATH = BASE_DIR / "microservices" / "auth_service" / "app.py"

# Service configurations
SERVICES = [
    {
        "name": "auth-service",
        "path": AUTH_SERVICE_PATH,
        "env": {
            "AUTH_SERVICE_PORT": "5501",
            "FLASK_ENV": "development",
            "DEBUG": "true",
            "JWT_SECRET": "development-secret-key-change-in-production"
        }
    },
    {
        "name": "api-gateway",
        "path": API_GATEWAY_PATH,
        "env": {
            "API_GATEWAY_PORT": "5000",
            "FLASK_ENV": "development",
            "DEBUG": "true",
            "AUTH_SERVICE_URL": "http://localhost:5501"
        }
    }
]

# Global variables
processes = {}

def start_service(service_config):
    """Start a service with the given configuration"""
    name = service_config["name"]
    path = service_config["path"]
    env = os.environ.copy()
    
    # Add service-specific environment variables
    for key, value in service_config["env"].items():
        env[key] = value
    
    logger.info(f"Starting {name} from {path}")
    
    try:
        process = subprocess.Popen(
            [sys.executable, str(path)],
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            universal_newlines=True,
            bufsize=1
        )
        
        processes[name] = {
            "process": process,
            "config": service_config
        }
        
        logger.info(f"{name} started with PID {process.pid}")
        
        # Start a thread to read and log output
        def log_output(process, name):
            for line in iter(process.stdout.readline, ""):
                if line:
                    logger.info(f"[{name}] {line.rstrip()}")
        
        import threading
        threading.Thread(target=log_output, args=(process, name), daemon=True).start()
        
        return True
    except Exception as e:
        logger.error(f"Failed to start {name}: {str(e)}")
        return False

def stop_service(name):
    """Stop a running service"""
    if name in processes:
        logger.info(f"Stopping {name}")
        try:
            processes[name]["process"].terminate()
            processes[name]["process"].wait(timeout=5)
            logger.info(f"{name} stopped")
        except subprocess.TimeoutExpired:
            logger.warning(f"{name} did not terminate gracefully, killing")
            processes[name]["process"].kill()
        except Exception as e:
            logger.error(f"Error stopping {name}: {str(e)}")
        
        del processes[name]

def stop_all_services():
    """Stop all running services"""
    for name in list(processes.keys()):
        stop_service(name)

def signal_handler(sig, frame):
    """Handle termination signals"""
    logger.info("Received termination signal, shutting down services")
    stop_all_services()
    sys.exit(0)

def check_service_health():
    """Check the health of running services"""
    for name, process_info in list(processes.items()):
        process = process_info["process"]
        if process.poll() is not None:
            logger.warning(f"{name} has stopped unexpectedly with code {process.returncode}")
            
            # Restart the service
            logger.info(f"Restarting {name}")
            stop_service(name)
            start_service(process_info["config"])

def main():
    """Main function to run all microservices"""
    logger.info("Starting ABDRE Chat microservices")
    
    # Register signal handlers
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    # Start services
    for service_config in SERVICES:
        start_service(service_config)
    
    # Monitor and keep services running
    try:
        while True:
            check_service_health()
            time.sleep(5)
    except KeyboardInterrupt:
        logger.info("Interrupted by user")
        stop_all_services()
    except Exception as e:
        logger.error(f"Error in main loop: {str(e)}")
        stop_all_services()
        sys.exit(1)

if __name__ == "__main__":
    main() 