/**
 * State Manager for ABDRE Chat Application
 * Simple pub/sub pattern implementation for local state management
 */

class StateManager {
  constructor() {
    this.state = {};
    this.subscribers = {};
  }

  /**
   * Get state value
   * @param {string} key - State key
   * @returns {*} - State value
   */
  get(key) {
    return this.state[key];
  }

  /**
   * Set state value and notify subscribers
   * @param {string} key - State key
   * @param {*} value - State value
   */
  set(key, value) {
    this.state[key] = value;
    this._notify(key, value);
  }

  /**
   * Subscribe to state changes
   * @param {string} key - State key
   * @param {Function} callback - Subscriber callback
   * @returns {Function} - Unsubscribe function
   */
  subscribe(key, callback) {
    if (!this.subscribers[key]) {
      this.subscribers[key] = [];
    }
    
    this.subscribers[key].push(callback);
    
    // Return unsubscribe function
    return () => {
      this.subscribers[key] = this.subscribers[key].filter(cb => cb !== callback);
    };
  }

  /**
   * Notify subscribers of state change
   * @param {string} key - State key
   * @param {*} value - State value
   * @private
   */
  _notify(key, value) {
    if (this.subscribers[key]) {
      this.subscribers[key].forEach(callback => callback(value));
    }
  }

  /**
   * Get multiple state values
   * @param {string[]} keys - Array of state keys
   * @returns {Object} - Object with state values
   */
  getMultiple(keys) {
    const result = {};
    keys.forEach(key => {
      result[key] = this.state[key];
    });
    return result;
  }

  /**
   * Set multiple state values
   * @param {Object} values - Key-value pairs to set
   */
  setMultiple(values) {
    Object.entries(values).forEach(([key, value]) => {
      this.set(key, value);
    });
  }

  /**
   * Subscribe to multiple state changes
   * @param {string[]} keys - Array of state keys
   * @param {Function} callback - Subscriber callback that receives an object with the state values
   * @returns {Function} - Unsubscribe function
   */
  subscribeMultiple(keys, callback) {
    const unsubscribers = keys.map(key => 
      this.subscribe(key, () => {
        callback(this.getMultiple(keys));
      })
    );
    
    // Return unsubscribe function for all subscriptions
    return () => {
      unsubscribers.forEach(unsubscribe => unsubscribe());
    };
  }
}

// Create and export a singleton instance
const stateManager = new StateManager(); 