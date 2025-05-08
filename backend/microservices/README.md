# ABDRE Chat Microservices Architecture

This directory contains the microservices implementation for the ABDRE Chat application.

## Architecture Overview

The ABDRE Chat application is being refactored from a monolithic architecture to a microservices architecture to support future mobile client development and improve scalability and maintainability.

### Key Components

1. **API Gateway**: Central entry point for all client requests
2. **Auth Service**: Handles authentication and user management
3. **Chat Service**: Manages chat rooms and messages (to be implemented)
4. **User Service**: Manages user profiles and preferences (to be implemented)
5. **Notification Service**: Handles real-time notifications (to be implemented)

## Service Communication

Services communicate with each other using HTTP/REST. The API Gateway routes requests to the appropriate microservice based on the URL path.

## Service Discovery

A simple service registry is implemented to enable service discovery. Each service registers itself with the API Gateway on startup, and the API Gateway maintains a list of available services.

## Authentication

JWT (JSON Web Tokens) are used for authentication. The Auth Service issues and validates tokens, and other services verify tokens by communicating with the Auth Service.

## Running the Microservices

### Prerequisites

- Python 3.8+
- pip

### Environment Variables

Each service can be configured using environment variables:

- `API_GATEWAY_PORT`: Port for the API Gateway (default: 5000)
- `AUTH_SERVICE_PORT`: Port for the Auth Service (default: 5501)
- `JWT_SECRET`: Secret key for JWT tokens (default: a development key)
- `FLASK_ENV`: Environment (development/production)
- `DEBUG`: Enable debug mode (true/false)

### Starting the Services

1. Create and activate a virtual environment:
   ```
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

2. Install dependencies for each service:
   ```
   pip install -r backend/api_gateway/requirements.txt
   pip install -r backend/microservices/auth_service/requirements.txt
   ```

3. Start the API Gateway:
   ```
   python -m backend.api_gateway.app
   ```

4. Start the Auth Service:
   ```
   python -m backend.microservices.auth_service.app
   ```

## Testing the Microservices

You can test the microservices using the `/api/services/health` endpoint of the API Gateway:

```
curl http://localhost:5000/api/services/health
```

## Adding New Microservices

To add a new microservice:

1. Create a new directory for the service in the `backend/microservices` directory
2. Implement the service using the same pattern as the Auth Service
3. Register routes for the service in the API Gateway
4. Add the service to the service registry

## Security Considerations

- JWT secrets are managed through environment variables
- CORS protection is implemented in the API Gateway
- Rate limiting is applied to sensitive endpoints
- All services implement proper error handling and logging
- Authentication failures are logged for security monitoring 