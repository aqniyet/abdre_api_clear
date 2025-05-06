"""
Service Discovery for client-side service discovery
"""

import logging
import os
import random
from typing import Any, Callable, Dict, List, Optional, Union
from urllib.parse import urljoin

from .registry import ServiceInfo, registry

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class ServiceDiscovery:
    """
    Service Discovery client for microservices
    Provides service lookup and routing functionality
    """

    def __init__(self, default_timeout: int = 5):
        """
        Initialize the service discovery client

        Args:
            default_timeout: Default timeout for requests in seconds
        """
        self.registry = registry
        self.default_timeout = default_timeout
        self.selection_strategies = {
            "random": self._select_random,
            "first": self._select_first,
            "round_robin": self._select_round_robin,
        }
        self.round_robin_counters: Dict[str, int] = {}

    def get_service_url(
        self, service_name: str, strategy: str = "random", only_healthy: bool = True
    ) -> Optional[str]:
        """
        Get a service URL using the specified selection strategy

        Args:
            service_name: Name of the service to find
            strategy: Selection strategy (random, first, round_robin)
            only_healthy: Only consider healthy services

        Returns:
            Service URL or None if not found
        """
        services = self.get_services(service_name, only_healthy)
        if not services:
            return None

        if strategy not in self.selection_strategies:
            strategy = "random"

        selected = self.selection_strategies[strategy](services, service_name)
        return selected.url if selected else None

    def get_services(
        self, service_name: str, only_healthy: bool = True
    ) -> List[ServiceInfo]:
        """
        Get all instances of a service

        Args:
            service_name: Name of the service to find
            only_healthy: Only return healthy services

        Returns:
            List of ServiceInfo objects
        """
        # Check for direct match
        service = self.registry.get_service(service_name)
        if service:
            if only_healthy and service.status != "online":
                return []
            return [service]

        # Get all matching services (for future support of multiple instances)
        services = []
        for service in self.registry.get_all_services():
            if service.name == service_name:
                if not only_healthy or service.status == "online":
                    services.append(service)

        return services

    def get_endpoint_url(
        self,
        service_name: str,
        endpoint: str,
        strategy: str = "random",
        only_healthy: bool = True,
    ) -> Optional[str]:
        """
        Get a full URL for a service endpoint

        Args:
            service_name: Name of the service
            endpoint: Endpoint path (e.g., /api/users)
            strategy: Selection strategy
            only_healthy: Only consider healthy services

        Returns:
            Full URL or None if service not found
        """
        service_url = self.get_service_url(service_name, strategy, only_healthy)
        if not service_url:
            return None

        # Ensure endpoint starts with a slash
        if not endpoint.startswith("/"):
            endpoint = f"/{endpoint}"

        return urljoin(service_url, endpoint)

    def _select_random(
        self, services: List[ServiceInfo], _: str
    ) -> Optional[ServiceInfo]:
        """Select a random service from the list"""
        return random.choice(services) if services else None

    def _select_first(
        self, services: List[ServiceInfo], _: str
    ) -> Optional[ServiceInfo]:
        """Select the first service from the list"""
        return services[0] if services else None

    def _select_round_robin(
        self, services: List[ServiceInfo], service_name: str
    ) -> Optional[ServiceInfo]:
        """Select services in round-robin fashion"""
        if not services:
            return None

        # Initialize counter if not exists
        if service_name not in self.round_robin_counters:
            self.round_robin_counters[service_name] = 0

        # Get the next service
        index = self.round_robin_counters[service_name] % len(services)
        self.round_robin_counters[service_name] = (index + 1) % len(services)

        return services[index]


# Create a singleton instance
discovery = ServiceDiscovery()
