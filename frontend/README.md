# ABDRE Chat Frontend

A modern, responsive, and modular chat application frontend built for the ABDRE Chat service.

## Architecture

The frontend is built using a modular architecture with these key components:

- **Modular JavaScript**: Organized into services, components, utils, and page-specific modules
- **Bootstrap 5**: For responsive UI components and layout
- **Socket.IO**: For real-time communication
- **CSS Custom Properties**: For consistent theming and styling
- **State Management**: Simple pub/sub pattern for local state management

## Directory Structure

```
frontend/
├── static/
│   ├── css/
│   │   └── style.css            # Main CSS styles
│   ├── js/
│   │   ├── components/          # Reusable UI components
│   │   │   ├── chat-list.js     # Chat list item rendering
│   │   │   └── chat-message.js  # Chat message rendering
│   │   ├── modules/             # Page-specific modules
│   │   │   ├── chat-page.js     # Chat room functionality
│   │   │   └── my-chats-page.js # My chats listing functionality
│   │   ├── services/            # API communication services
│   │   │   ├── api-client.js    # HTTP API client
│   │   │   └── socket-client.js # WebSocket client
│   │   ├── utils/               # Utility functions
│   │   │   ├── auth-helper.js   # Authentication utilities
│   │   │   ├── date-formatter.js # Date formatting utilities
│   │   │   └── state-manager.js # Local state management
│   │   └── main.js              # Main entry point
├── templates/
│   ├── chat.html                # Chat room page
│   ├── create.html              # Create new chat page
│   ├── error.html               # Error page
│   ├── index.html               # Home page
│   ├── login.html               # Login page
│   ├── my_chats.html            # My chats listing page
│   ├── settings.html            # Settings page
│   └── welcome.html             # Welcome page
└── README.md                    # This file
```

## Key Features

1. **Responsive Design**: Adapts to different screen sizes from mobile to desktop
2. **Real-time Communication**: WebSocket-based communication for instant messaging
3. **Optimized Socket Handling**: Efficient socket connection management and event handling
4. **Local State Management**: Simplified state management for component updates
5. **Modular Architecture**: Clean separation of concerns for maintainability
6. **Bootstrap Integration**: Modern UI with consistent styling

## Components and Services

### Services

#### API Client (`api-client.js`)
Handles HTTP communication with the backend API.

```javascript
// Example usage
await apiClient.login(credentials);
const chats = await apiClient.getChats();
```

#### Socket Client (`socket-client.js`)
Manages WebSocket connections for real-time communication.

```javascript
// Example usage
await socketClient.init();
socketClient.joinRoom({ room_id: roomId });
socketClient.on('message', handleMessage);
```

### Components

#### Chat Message (`chat-message.js`)
Renders chat messages in a conversation.

```javascript
// Example usage
ChatMessage.renderMessages(container, messages, userId);
ChatMessage.addToContainer(container, message, userId);
```

#### Chat List (`chat-list.js`)
Renders a list of chat rooms.

```javascript
// Example usage
ChatList.renderList(container, chats);
ChatList.updateChat(container, updatedChat);
```

### Utilities

#### Auth Helper (`auth-helper.js`)
Manages authentication state and tokens.

```javascript
// Example usage
if (AuthHelper.isAuthenticated()) {
  // User is logged in
}
AuthHelper.requireAuth('/chat/123');
```

#### Date Formatter (`date-formatter.js`)
Formats dates and times for display.

```javascript
// Example usage
DateFormatter.formatTime(timestamp);
DateFormatter.getRelativeTime(timestamp);
```

#### State Manager (`state-manager.js`)
Simple pub/sub pattern for local state management.

```javascript
// Example usage
stateManager.set('messages', messages);
stateManager.subscribe('messages', updateUI);
```

## Page Modules

Each page has its own module that initializes the page-specific functionality:

- `chat-page.js`: Chat room functionality
- `my-chats-page.js`: Chat list functionality
- (Other page modules as needed)

## HTML Templates

HTML templates use Jinja2 for server-side rendering and include the necessary JavaScript modules for each page. Each template follows a consistent structure:

1. HTML head with meta tags and CSS
2. Responsive navbar
3. Main content container
4. Footer scripts (Bootstrap, Socket.IO, page-specific JS)

## Usage

To use this frontend:

1. Include the necessary dependencies (Bootstrap, Socket.IO)
2. Include the required JS modules for the page
3. Initialize the page module in the main.js file

## Development

When developing new features:

1. Add new services in the `services/` directory
2. Add new components in the `components/` directory
3. Add new utility functions in the `utils/` directory
4. Add new page modules in the `modules/` directory
5. Update the CSS in `style.css` as needed

## Compatibility

- Modern browsers (Chrome, Firefox, Safari, Edge)
- Mobile-responsive design
- Progressive enhancement for older browsers 