/**
 * Socket.IO Helper
 * Provides Socket.IO compatibility for the ABDRE Chat application
 */

// Check if Socket.IO is already loaded
if (typeof io === 'undefined') {
  console.log('Loading Socket.IO client library');
  
  // Create a script element to load Socket.IO
  const script = document.createElement('script');
  script.src = 'https://cdn.socket.io/4.6.0/socket.io.min.js';
  script.integrity = 'sha384-c79GN5VsunZvi+Q/WObgk2in0CbZsHnjEqvFxC5DxHn9lTfNce2WW6h2pH6u/kF+';
  script.crossOrigin = 'anonymous';
  
  // Add onload handler
  script.onload = function() {
    console.log('Socket.IO client library loaded');
    
    // Dispatch a custom event to notify the application
    document.dispatchEvent(new CustomEvent('socketio-loaded'));
  };
  
  // Add error handler
  script.onerror = function() {
    console.error('Failed to load Socket.IO client library');
    
    // Dispatch an error event
    document.dispatchEvent(new CustomEvent('socketio-error'));
  };
  
  // Append script to the document
  document.head.appendChild(script);
}

// Socket.IO configuration helper
const SocketIOHelper = {
  // Create a Socket.IO connection with the correct configuration
  createConnection: function(url, options) {
    if (typeof io === 'undefined') {
      console.error('Socket.IO client library not loaded');
      return null;
    }
    
    // Default options
    const defaultOptions = {
      path: '/socket.io',
      transports: ['websocket'],
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000
    };
    
    // Merge with provided options
    const mergedOptions = {...defaultOptions, ...options};
    
    // Create and return the Socket.IO connection
    return io(url, mergedOptions);
  }
};

console.log('Socket.IO Helper initialized'); 