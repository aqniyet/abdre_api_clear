#!/bin/bash
# Restart the Docker services with the new changes

echo "Stopping services..."
docker-compose down

echo "Rebuilding services..."
docker-compose build chat_service realtime_service

echo "Starting services..."
docker-compose up -d

echo "Services restarted. To view logs, run: docker-compose logs -f" 