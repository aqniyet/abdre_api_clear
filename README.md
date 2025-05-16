# ABDRE Chat API

A modern, real-time chat application with QR code connectivity and typing status indicators.

## Features

- **Real-time messaging**: Instant message delivery using WebSockets
- **Typing indicators**: Shows when a user is typing in real-time
- **Online status**: Displays when users are online
- **QR code connections**: Connect to other users by scanning a QR code
- **Microservice architecture**: Modular backend design for scalability

## Recent Changes

### Typing Status Indicator Feature

The latest update implements a typing status indicator feature that:

- Shows "Online" status when another user is connected
- Displays "[Username] is typing..." when the other user is typing
- Properly handles different message formats for backward compatibility
- Excludes sending typing status back to the user who is typing

### Code Cleanup and Consolidation

The codebase has been streamlined to improve maintainability:

- Removed redundant files and unused assets
- Consolidated authentication logic to use microservices
- Standardized WebSocket handling in a dedicated service
- Improved JavaScript organization with modular patterns
- Better organized template structure

For details on the cleanup process, see:
- `consolidate_recommendations.md`
- `codebase_cleanup_checklist.md`

## Architecture

### Microservices

ABDRE Chat uses a microservice architecture for better scalability and separation of concerns:

- **API Gateway**: Routes requests to appropriate services
- **Auth Service**: Handles user authentication and session management
- **User Service**: Manages user profiles and settings
- **Chat Service**: Handles chat rooms, messages, and QR connections
- **Realtime Service**: WebSocket service for real-time messaging and status updates

### Frontend

The frontend is built with a clean HTML/CSS/JavaScript stack:

- Pure JavaScript with modular organization
- ABDRE namespace pattern for encapsulation
- Flask templating for server-side rendering
- Modern CSS with responsive design

## Setup and Installation

See the [Setup Guide](docs/setup.md) for detailed instructions.

## Development

To start the development environment:

```bash
# Activate virtual environment
source venv/bin/activate

# Start all services
python service_launcher.py
```

The application will be available at http://localhost:8000

## Contributing

Please see [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.

## Project Structure

```
abdre_api/
├── backend/                 # Backend services
│   ├── api_gateway/         # API Gateway
│   ├── chat_service/        # Chat service
│   └── microservices/       # Microservices
│       ├── auth_service/    # Authentication service
│       ├── user_service/    # User management service
│       └── qr_service/      # QR code connection service
├── frontend/                # Frontend application
│   └── templates/           # HTML templates
└── realtime_service/        # WebSocket service for real-time features
```

## Technology Stack

- **Backend**: Python, Flask, FastAPI
- **Frontend**: HTML, CSS, JavaScript
- **Real-time**: WebSockets
- **Authentication**: JWT tokens
- **Data Storage**: JSON files (for demo purposes)

## Development

For development purposes, you can run the application with hot-reloading enabled:

```
python service_launcher.py --dev
```

## Server-Side Rendering

The application utilizes server-side rendering (SSR) to improve:

1. **Initial Load Performance**: Pages load faster because HTML is pre-rendered on the server
2. **SEO**: Search engines can better index the content
3. **Progressive Enhancement**: Core functionality works even without JavaScript

JavaScript enhancers are used to add real-time functionality after the initial page load, following a "progressive enhancement" approach.

## Getting Started

### Prerequisites

- Python 3.8+
- Virtual environment (recommended)

### Installation

1. Clone the repository
   ```
   git clone https://github.com/yourusername/abdre_api.git
   cd abdre_api
   ```

2. Create and activate a virtual environment
   ```
   python -m venv venv
   source venv/bin/activate  # On Windows, use: venv\Scripts\activate
   ```

3. Install dependencies
   ```
   pip install -r requirements.txt
   ```

### Running the Application

1. Start the backend server
   ```
   python backend/app.py
   ```

2. Open a web browser and navigate to http://localhost:5000

## Development

### Adding a New Feature

1. Create necessary services/repositories in the backend
2. Add appropriate controllers for API endpoints
3. Update templates for server-side rendering
4. Enhance with client-side JavaScript as needed

### Testing

Run the tests using:
```
pytest
```

## License

This project is licensed under the MIT License - see the LICENSE file for details.
