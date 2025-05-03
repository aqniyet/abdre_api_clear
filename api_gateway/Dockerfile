FROM python:3.9-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy base requirements first
COPY shared/requirements-base.txt ./requirements-base.txt
RUN pip install --no-cache-dir -r requirements-base.txt

# Copy service-specific requirements and install
COPY api_gateway/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy API Gateway code first
COPY api_gateway /app/api_gateway

# Copy frontend files - ensure they override any existing files
COPY frontend/templates /app/api_gateway/templates
COPY frontend/static /app/api_gateway/static

# Create required directories if they don't exist
RUN mkdir -p /app/api_gateway/static/js/utils

# Copy required auth-helper.js directly to the expected paths
COPY frontend/static/js/utils/auth-helper.js /app/api_gateway/static/js/utils/
COPY frontend/static/js/utils/auth-helper.js /app/api_gateway/static/js/utils/auth_helper.js

# Copy shared modules
COPY shared /app/shared

# Set working directory to service directory
WORKDIR /app/api_gateway

# Make startup script executable
RUN chmod +x start.sh

# Expose port
EXPOSE 5000

# Use startup script
CMD ["./start.sh"] 