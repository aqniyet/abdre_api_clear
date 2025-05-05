# ABDRE API Fixes

This document summarizes the fixes that were made to make the ABDRE API work correctly in a local development environment.

## Issues Fixed

1. **JWT Import Issue**: Changed `import PyJWT` to `import jwt as PyJWT` across all services.
   - All services were using `PyJWT` but it should be imported as `jwt`.

2. **Mock Database for Chat Service**: Added a proper MockConnection class with needed methods (commit, rollback) to allow the Chat Service to run without an actual database.

3. **Service Port Configuration**: Updated all services to use consistent ports and set environment variables correctly:
   - Auth Service: Port 5501
   - User Service: Port 5502
   - OAuth Service: Port 5503
   - Chat Service: Port 5504
   - API Gateway: Port 5505
   - Realtime Service: Port 5506

4. **Service Discovery**: Updated the service discovery configuration to use localhost instead of container names.

5. **API Gateway Endpoint Routing**: Added special handling for the `/api/chats/generate-invitation` endpoint to route it to the Chat Service's `/generate-invitation` endpoint.

6. **Environment Variables**: Configured environment variables in the start script to ensure all services can communicate with each other.

## Scripts Added

1. **start-all-services.sh**: Script to start all the services with correct configuration
2. **stop-all-services.sh**: Script to stop all the services

## How to Run

1. Activate the virtual environment: `source venv/bin/activate`
2. Start all services: `./start-all-services.sh`
3. Access the application at: http://localhost:5505
4. Stop all services when done: `./stop-all-services.sh` 