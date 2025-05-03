/**
 * WebSocket Tester Utility for ABDRE Chat Application
 * Provides helper functions to test WebSocket connectivity
 */

class WebSocketTester {
  constructor() {
    this.testResults = [];
  }

  /**
   * Run a full connectivity test
   * @returns {Promise} Promise that resolves with test results
   */
  async runTest() {
    this.testResults = [];
    this.addResult('Starting WebSocket connectivity test');
    
    // Check if socket client is available
    if (typeof socketClient === 'undefined') {
      this.addResult('FAIL: Socket client not available', 'error');
      return this.testResults;
    }
    
    // Check if access token exists
    const accessToken = localStorage.getItem('access_token');
    if (!accessToken) {
      this.addResult('FAIL: No access token available. Please log in first.', 'error');
      return this.testResults;
    }
    
    this.addResult('Access token available');
    
    // Initialize socket connection
    try {
      if (!socketClient.connected) {
        this.addResult('Initializing socket connection...');
        await socketClient.init();
        this.addResult('Socket connection initialized successfully');
      } else {
        this.addResult('Socket already connected');
      }
      
      // Test connection is active
      if (socketClient.connected) {
        this.addResult(`SUCCESS: Socket connected with ID: ${socketClient.socket.id}`, 'success');
        
        // Send ping to test bidirectional communication
        this.addResult('Sending ping to test bidirectional communication...');
        socketClient.socket.once('pong', (data) => {
          const roundTripTime = new Date() - new Date(data.received_ping);
          this.addResult(`Pong received! Round-trip time: ${roundTripTime}ms`, 'success');
          this.displayResults();
        });
        
        socketClient.testConnection();
        
        // Also try sending a test message
        this.sendTestMessage();
      } else {
        this.addResult('FAIL: Socket not connected after initialization', 'error');
      }
    } catch (error) {
      this.addResult(`FAIL: Socket connection error: ${error.message}`, 'error');
    }
    
    return this.testResults;
  }
  
  /**
   * Send a test message through the API
   */
  async sendTestMessage() {
    try {
      this.addResult('Sending test message through API Gateway...');
      
      const response = await fetch('/api/ws-test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('access_token')}`
        },
        body: JSON.stringify({
          message: 'Test message from WebSocket tester'
        })
      });
      
      const data = await response.json();
      
      if (data.success) {
        this.addResult('Test message sent successfully through API', 'success');
      } else {
        this.addResult(`FAIL: Error sending test message: ${data.message}`, 'error');
      }
    } catch (error) {
      this.addResult(`FAIL: Error sending test message: ${error.message}`, 'error');
    }
  }
  
  /**
   * Add a result to the test results array
   * @param {string} message - The message to add
   * @param {string} type - The type of message (info, success, error)
   */
  addResult(message, type = 'info') {
    const result = {
      message,
      type,
      timestamp: new Date().toISOString()
    };
    
    this.testResults.push(result);
    console.log(`[WebSocketTester] ${message}`);
  }
  
  /**
   * Display test results in the UI if available
   */
  displayResults() {
    // Check if there's a results container
    const container = document.getElementById('websocket-test-results');
    if (!container) return;
    
    // Clear container
    container.innerHTML = '';
    
    // Add results
    this.testResults.forEach(result => {
      const div = document.createElement('div');
      div.className = `ws-test-result ${result.type}`;
      div.textContent = result.message;
      container.appendChild(div);
    });
  }
}

// Create a global instance
const wsTestUtil = new WebSocketTester();

// Export for testing
if (typeof module !== 'undefined') {
  module.exports = { WebSocketTester };
} 