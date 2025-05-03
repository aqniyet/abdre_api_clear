# Abdre API - Microservices Architecture

A modern microservices-based API system built with Flask and Docker.

## Architecture

The system consists of the following microservices:

1. **API Gateway** (Port 5000) - Entry point for all client requests with routing and load balancing
2. **Auth Service** (Port 5001) - Handles authentication, user registration, and token management
3. **User Service** (Port 5002) - Manages user profiles and user-related operations
4. **OAuth Service** (Port 5003) - Provides OAuth integration with third-party identity providers
5. **Chat Service** (Port 5004) - Implements chat functionality between users
6. **Realtime Service** (Port 5006) - Provides real-time updates and notifications

## Technology Stack

- **Backend**: Python with Flask framework
- **Containerization**: Docker and Docker Compose
- **Database**: PostgreSQL
- **Caching**: Redis
- **Service Discovery**: Custom implementation in shared/service_discovery

## Getting Started

### Prerequisites

- Docker and Docker Compose
- Git

### Installation

1. Clone the repository:
   ```
   git clone https://github.com/aqniyet/abdre_api.git
   cd abdre_api
   ```

2. Start the system using the management script:
   ```
   ./abdre-manage.sh start
   ```

3. Verify health status:
   ```
   ./abdre-manage.sh status
   ```

### Management Script

The `abdre-manage.sh` script provides a convenient way to manage the application:

```
Usage: ./abdre-manage.sh COMMAND

Commands:
  start           Start all services
  stop            Stop all services
  restart         Restart all services
  status          Check status of all services
  logs [service]  View logs (optional: specify service name)
  test            Run connection tests
  backup          Backup the database
  install         Install as systemd service (requires sudo)
  help            Show this help message
```

### Testing

Use the test-connections script to verify all services are working properly:

```
./test-connections.sh
```

For detailed information about testing, see [TEST-README.md](TEST-README.md).

## Development

### Project Structure

```
.
├── api_gateway/             # API Gateway service
├── auth_service/            # Authentication service
├── chat_service/            # Chat functionality service
├── docker-compose.yml       # Docker Compose configuration
├── frontend/                # Frontend templates and static files
│   ├── static/
│   └── templates/
├── oauth_service/           # OAuth integration service
├── realtime_service/        # Real-time updates service
├── shared/                  # Shared code and utilities
│   ├── requirements-base.txt
│   └── service_discovery/
└── user_service/            # User management service
```

### Adding New Features

1. Identify the appropriate service for your feature
2. Implement the feature in the service's app.py
3. Update tests and documentation
4. Test the feature with the entire system running

## API Endpoints

Check each service's health endpoint for basic verification:

- API Gateway: `GET http://localhost:5000/health`
- Auth Service: `GET http://localhost:5001/health`
- User Service: `GET http://localhost:5002/health`
- OAuth Service: `GET http://localhost:5003/health`
- Chat Service: `GET http://localhost:5004/health`
- Realtime Service: `GET http://localhost:5006/health`

## Troubleshooting

If you encounter issues, try the following:

1. Check service status: `./abdre-manage.sh status`
2. View logs: `./abdre-manage.sh logs`
3. Restart services: `./abdre-manage.sh restart`
4. Run tests: `./abdre-manage.sh test`

For more troubleshooting information, see [TEST-README.md](TEST-README.md).

## Installing as a Service

To install ABDRE as a systemd service (auto-start on boot):

```
sudo ./install-service.sh
```

After installation, you can manage the service with standard systemd commands:

```
sudo systemctl start abdre
sudo systemctl stop abdre
sudo systemctl status abdre
sudo systemctl enable abdre  # Enable auto-start on boot
```

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Commit your changes: `git commit -m 'Add some feature'`
4. Push to the branch: `git push origin feature-name`
5. Open a pull request

## License

This project is licensed under the MIT License.
