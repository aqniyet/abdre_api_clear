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
COPY user_service/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy service code and shared modules
COPY user_service /app/user_service
COPY shared /app/shared

# Set working directory to service directory
WORKDIR /app/user_service

# Expose port
EXPOSE 5002

# Run the app with Gunicorn
CMD ["gunicorn", "--bind", "0.0.0.0:5002", "app:app"] 