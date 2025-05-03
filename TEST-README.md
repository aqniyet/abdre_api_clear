# ABDRE Microservices Testing

This directory contains scripts and tools for testing the ABDRE microservices architecture.

## Available Scripts

### `deploy.sh`

This script automates the deployment process of the ABDRE microservices:

1. Stops any existing containers
2. Rebuilds all containers with fresh images
3. Starts all services
4. Waits for services to initialize 
5. Verifies that the API Gateway is running

Usage:
```bash
./deploy.sh
```

### `test-connections.sh`

This script tests the health and connectivity of all microservices:

1. Performs health checks on all services
2. Tests authentication with default credentials
3. Tests the WebSocket connection functionality
4. Displays detailed results for each service

Usage:
```bash
./test-connections.sh
```

## Monitoring Endpoints

The following endpoints are available for monitoring the system:

- `/health`: Basic health check endpoint (available on all services)
- `/api/system/health-detailed`: Detailed health information (API Gateway only)
- `/api/ws-test`: Test WebSocket connection (POST endpoint)

## Troubleshooting

If services are not responding correctly, you can check the logs:

```bash
# View logs for all services
docker-compose logs

# View logs for a specific service
docker-compose logs api_gateway
docker-compose logs realtime_service
```

Common issues:
1. Rate limiting: Configure `ENABLE_RATE_LIMITING=false` for development
2. CORS issues: Check that `CORS_ALLOWED_ORIGINS` includes your frontend URL
3. Connection refused: Ensure all services are running (`docker-compose ps`)
4. Database errors: Check PostgreSQL connection and migration status

## Default Credentials

For testing purposes, the following default credentials are available:

- Username: `admin`
- Password: `admin123` 