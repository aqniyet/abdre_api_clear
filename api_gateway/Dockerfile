FROM python:3.9-slim

WORKDIR /app

# Copy requirements and install dependencies
COPY api_gateway/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy service code and shared modules
COPY api_gateway /app/api_gateway
COPY frontend/templates /app/api_gateway/templates
COPY frontend/static /app/api_gateway/static
COPY shared /app/shared

# Set working directory to service directory
WORKDIR /app/api_gateway

# Expose port
EXPOSE 5000

# Run the app with Gunicorn instead of Python's built-in server
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "app:app"] 