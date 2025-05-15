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

## Setup and Installation

1. Clone the repository:
   ```
   git clone https://github.com/aqniyet/abdre_api_clear.git
   cd abdre_api_clear
   ```

2. Create and activate a virtual environment:
   ```
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. Install dependencies:
   ```
   pip install -r requirements.txt
   ```

4. Start the services:
   ```
   python service_launcher.py
   ```

5. Open your browser and navigate to http://localhost:8000

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

## Architecture

### Backend

The backend is organized into the following components:

- **Controllers**: Handle HTTP requests and render responses
  - `render_controller.py`: Handles rendering of HTML templates
  - `chat_controller.py`: Handles chat-specific API requests

- **Services**: Business logic layer
  - `template_service.py`: Manages template rendering functionality
  - `chat_service.py`: Core chat functionality
  - `chat_preview_service.py`: Generates preview data for chat listings

- **Repositories**: Data access layer
  - `chat_repository.py`: Handles chat data persistence and retrieval

- **Utils**: Helper utilities
  - `template_context.py`: Prepares context data for templates
  - `message_formatter.py`: Formats chat messages for display
  - `chat_list_formatter.py`: Formats chat lists for display
  - `asset_versioner.py`: Manages asset versioning for cache busting

- **Routes**: URL routing
  - `web_routes.py`: Defines the web application routes

### Frontend

The frontend is organized as follows:

- **Templates**: Server-rendered HTML templates
  - Page templates: `chat.html`, `my_chats.html`
  - Components: `message_list.html`, `chat_list.html`

- **Static**: Static assets
  - JavaScript
    - Enhancers: `chat_enhancer.js`, `chat_list_enhancer.js`
  - CSS
    - `style.css`: Main stylesheet

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
