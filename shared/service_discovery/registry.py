"""
Service Registry for managing service availability and discovery
"""

import json
import logging
import os
import threading
import time
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional, Union

import requests

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@dataclass
class ServiceInfo:
    """Information about a registered service"""

    name: str
    host: str
    port: int
    url: str
    health_endpoint: str = "/health"
    status: str = "online"  # online, offline, degraded
    last_check: float = field(default_factory=time.time)
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization"""
        return asdict(self)

    @property
    def health_url(self) -> str:
        """Get the full health check URL"""
        return f"{self.url.rstrip('/')}{self.health_endpoint}"

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ServiceInfo":
        """Create ServiceInfo from dictionary"""
        return cls(**data)


class ServiceRegistry:
    """
    Registry for microservices with health checking capabilities
    """

    def __init__(self, storage_path: Optional[str] = None, check_interval: int = 30):
        """
        Initialize the service registry

        Args:
            storage_path: Path to store registry data (optional)
            check_interval: Interval in seconds for health checks (default: 30)
        """
        self.services: Dict[str, ServiceInfo] = {}
        self.storage_path = storage_path or os.path.join(
            os.path.dirname(__file__), "registry.json"
        )
        self.check_interval = check_interval
        self.lock = threading.RLock()
        self._stop_event = threading.Event()
        self._health_check_thread = None

        # Load existing registry if available
        self._load_registry()

    def register_service(
        self,
        name: str,
        host: str,
        port: int,
        health_endpoint: str = "/health",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> ServiceInfo:
        """
        Register a new service with the registry

        Args:
            name: Service name
            host: Service host
            port: Service port
            health_endpoint: Health check endpoint (default: /health)
            metadata: Additional service metadata (optional)

        Returns:
            ServiceInfo object for the registered service
        """
        url = f"http://{host}:{port}"
        metadata = metadata or {}

        with self.lock:
            service = ServiceInfo(
                name=name,
                host=host,
                port=port,
                url=url,
                health_endpoint=health_endpoint,
                metadata=metadata,
            )

            self.services[name] = service
            self._save_registry()

            logger.info(f"Registered service: {name} at {url}")
            return service

    def unregister_service(self, name: str) -> bool:
        """
        Remove a service from the registry

        Args:
            name: Service name to remove

        Returns:
            True if service was removed, False if not found
        """
        with self.lock:
            if name in self.services:
                del self.services[name]
                self._save_registry()
                logger.info(f"Unregistered service: {name}")
                return True
            return False

    def get_service(self, name: str) -> Optional[ServiceInfo]:
        """
        Get information about a registered service

        Args:
            name: Service name to find

        Returns:
            ServiceInfo if found, None otherwise
        """
        return self.services.get(name)

    def get_all_services(self) -> List[ServiceInfo]:
        """
        Get all registered services

        Returns:
            List of ServiceInfo objects
        """
        return list(self.services.values())

    def update_service_status(self, name: str, status: str) -> bool:
        """
        Update a service's status

        Args:
            name: Service name
            status: New status (online, offline, degraded)

        Returns:
            True if updated, False if service not found
        """
        with self.lock:
            if name in self.services:
                self.services[name].status = status
                self.services[name].last_check = time.time()
                self._save_registry()
                return True
            return False

    def start_health_checks(self) -> None:
        """Start periodic health checks in a separate thread"""
        if (
            self._health_check_thread is not None
            and self._health_check_thread.is_alive()
        ):
            return

        self._stop_event.clear()
        self._health_check_thread = threading.Thread(
            target=self._health_check_loop, daemon=True
        )
        self._health_check_thread.start()
        logger.info(f"Started health check thread (interval: {self.check_interval}s)")

    def stop_health_checks(self) -> None:
        """Stop the health check thread"""
        if self._health_check_thread is not None:
            self._stop_event.set()
            self._health_check_thread.join(timeout=5)
            self._health_check_thread = None
            logger.info("Stopped health check thread")

    def _health_check_loop(self) -> None:
        """Perform periodic health checks on all services"""
        while not self._stop_event.is_set():
            self.check_all_services()

            # Sleep for check_interval, but check for stop event every second
            for _ in range(self.check_interval):
                if self._stop_event.is_set():
                    break
                time.sleep(1)

    def check_all_services(self) -> Dict[str, str]:
        """
        Check the health of all registered services

        Returns:
            Dictionary of service names to status
        """
        results = {}

        for name, service in list(self.services.items()):
            try:
                status = self.check_service_health(name)
                results[name] = status
            except Exception as e:
                logger.error(f"Error checking service {name}: {str(e)}")
                results[name] = "offline"

        return results

    def check_service_health(self, name: str) -> str:
        """
        Check the health of a specific service

        Args:
            name: Service name to check

        Returns:
            Status string: 'online', 'offline', or 'degraded'

        Raises:
            ValueError: If service not found
        """
        service = self.get_service(name)
        if not service:
            raise ValueError(f"Service not found: {name}")

        try:
            response = requests.get(service.health_url, timeout=5)

            if response.status_code == 200:
                try:
                    data = response.json()
                    status = data.get("status", "").lower()

                    # Accept 'healthy' or 'ok' as valid online statuses
                    if status in ("healthy", "ok"):
                        status = "online"

                    # Update status
                    self.update_service_status(name, status)
                    return status
                except (ValueError, AttributeError):
                    # Not JSON or missing status field
                    self.update_service_status(name, "online")
                    return "online"
            else:
                self.update_service_status(name, "degraded")
                return "degraded"
        except requests.RequestException:
            self.update_service_status(name, "offline")
            return "offline"

    def _save_registry(self) -> None:
        """Save the registry to disk"""
        if not self.storage_path:
            return

        try:
            data = {name: service.to_dict() for name, service in self.services.items()}
            with open(self.storage_path, "w") as f:
                json.dump(data, f, indent=2)
        except Exception as e:
            logger.error(f"Failed to save registry: {str(e)}")

    def _load_registry(self) -> None:
        """Load the registry from disk"""
        if not self.storage_path or not os.path.exists(self.storage_path):
            return

        try:
            with open(self.storage_path, "r") as f:
                data = json.load(f)

            with self.lock:
                self.services = {
                    name: ServiceInfo.from_dict(service_data)
                    for name, service_data in data.items()
                }
        except Exception as e:
            logger.error(f"Failed to load registry: {str(e)}")


# Create a singleton instance
registry = ServiceRegistry()
