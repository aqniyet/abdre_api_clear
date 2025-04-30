FROM python:3.9-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    python3-dev \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy base requirements first
COPY shared/requirements-base.txt ./requirements-base.txt
RUN pip install --no-cache-dir -r requirements-base.txt

# Copy service-specific requirements and install
COPY realtime_service/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy service code and shared modules
COPY realtime_service /app/realtime_service
COPY shared /app/shared

# Set working directory to service directory
WORKDIR /app/realtime_service

ENV PYTHONPATH=/app

# Expose port
EXPOSE 5006

# Create a startup script
RUN echo '#!/usr/bin/env python3\n\
import os\n\
import sys\n\
sys.path.append("/app")\n\
from realtime_service.app import app\n\
\n\
if __name__ == "__main__":\n\
    app.run(host="0.0.0.0", port=5006)\n\
' > /app/realtime_service/run.py \
    && chmod +x /app/realtime_service/run.py

# Run the startup script
CMD ["python", "run.py"] 