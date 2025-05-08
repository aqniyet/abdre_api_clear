/**
 * ABDRE Chat - API Client Module
 * 
 * Provides standardized methods for making API requests to the backend.
 * Handles common tasks like authentication, error handling, and response parsing.
 */

// Ensure ABDRE namespace exists
window.ABDRE = window.ABDRE || {};

// API Client Module
ABDRE.ApiClient = (function() {
    // Private variables
    let _baseUrl = '';
    let _debug = false;
    let _defaultHeaders = {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    };
    
    // Request queue for rate limiting
    const _requestQueue = [];
    let _processingQueue = false;
    
    // Private methods
    function _logRequest(method, url, data, headers) {
        if (!_debug) return;
        
        console.groupCollapsed(`[API] ${method} ${url}`);
        console.log('Request Data:', data || 'none');
        console.log('Headers:', headers);
        console.groupEnd();
    }
    
    function _logResponse(method, url, response, isError) {
        if (!_debug) return;
        
        const logMethod = isError ? console.error : console.log;
        
        console.groupCollapsed(`[API] ${method} ${url} - ${isError ? 'ERROR' : 'SUCCESS'}`);
        logMethod('Response:', response);
        console.groupEnd();
    }
    
    function _processQueue() {
        if (_processingQueue || _requestQueue.length === 0) return;
        
        _processingQueue = true;
        const { method, url, data, headers, resolve, reject } = _requestQueue.shift();
        
        _executeRequest(method, url, data, headers)
            .then(response => {
                resolve(response);
            })
            .catch(error => {
                reject(error);
            })
            .finally(() => {
                _processingQueue = false;
                // Process next request in queue
                setTimeout(_processQueue, 50);
            });
    }
    
    function _executeRequest(method, url, data, headers) {
        return new Promise((resolve, reject) => {
            const options = {
                method: method,
                headers: { ..._defaultHeaders, ...headers },
                credentials: 'include', // Include cookies in request
            };
            
            // Add body for non-GET requests
            if (method !== 'GET' && data) {
                options.body = JSON.stringify(data);
            }
            
            // Log request
            _logRequest(method, url, data, options.headers);
            
            // Execute fetch request
            fetch(url, options)
                .then(response => {
                    // Check if response is JSON
                    const contentType = response.headers.get('content-type');
                    const isJson = contentType && contentType.includes('application/json');
                    
                    // Parse response based on content type
                    if (isJson) {
                        return response.json().then(data => {
                            return {
                                status: response.status,
                                ok: response.ok,
                                data: data,
                                headers: Object.fromEntries(response.headers.entries())
                            };
                        });
                    } else {
                        return response.text().then(text => {
                            return {
                                status: response.status,
                                ok: response.ok,
                                data: text,
                                headers: Object.fromEntries(response.headers.entries())
                            };
                        });
                    }
                })
                .then(response => {
                    // Handle HTTP errors
                    if (!response.ok) {
                        const error = new Error(response.data.error || 'API request failed');
                        error.status = response.status;
                        error.response = response.data;
                        
                        _logResponse(method, url, error, true);
                        
                        // Publish error event
                        if (ABDRE.EventBus) {
                            ABDRE.EventBus.publish('api:error', {
                                method,
                                url,
                                status: response.status,
                                error: error.response
                            });
                        }
                        
                        throw error;
                    }
                    
                    // Log successful response
                    _logResponse(method, url, response.data);
                    
                    // Return only the data part for convenience
                    return response.data;
                })
                .then(resolve)
                .catch(error => {
                    _logResponse(method, url, error, true);
                    
                    // Handle network errors
                    if (!error.status) {
                        // Publish network error event
                        if (ABDRE.EventBus) {
                            ABDRE.EventBus.publish('api:networkError', {
                                method,
                                url,
                                error: error.message
                            });
                        }
                    }
                    
                    reject(error);
                });
        });
    }
    
    function _queueRequest(method, url, data, headers) {
        return new Promise((resolve, reject) => {
            _requestQueue.push({ method, url, data, headers, resolve, reject });
            _processQueue();
        });
    }
    
    function _buildUrl(endpoint) {
        // Handle absolute URLs
        if (endpoint.startsWith('http')) {
            return endpoint;
        }
        
        // Handle endpoint with or without leading slash
        const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
        return `${_baseUrl}${normalizedEndpoint}`;
    }
    
    // Public API
    return {
        init: function(baseUrl = '', options = {}) {
            _baseUrl = baseUrl;
            _debug = options.debug || false;
            
            // Add custom default headers
            if (options.headers) {
                Object.assign(_defaultHeaders, options.headers);
            }
            
            console.info(`API Client initialized with base URL: ${_baseUrl}`);
        },
        
        /**
         * Make a GET request
         * 
         * @param {string} endpoint - API endpoint
         * @param {Object} headers - Additional headers
         * @returns {Promise} - Promise with response data
         */
        get: function(endpoint, headers = {}) {
            const url = _buildUrl(endpoint);
            return _queueRequest('GET', url, null, headers);
        },
        
        /**
         * Make a POST request
         * 
         * @param {string} endpoint - API endpoint
         * @param {Object} data - Data to send
         * @param {Object} headers - Additional headers
         * @returns {Promise} - Promise with response data
         */
        post: function(endpoint, data = {}, headers = {}) {
            const url = _buildUrl(endpoint);
            return _queueRequest('POST', url, data, headers);
        },
        
        /**
         * Make a PUT request
         * 
         * @param {string} endpoint - API endpoint
         * @param {Object} data - Data to send
         * @param {Object} headers - Additional headers
         * @returns {Promise} - Promise with response data
         */
        put: function(endpoint, data = {}, headers = {}) {
            const url = _buildUrl(endpoint);
            return _queueRequest('PUT', url, data, headers);
        },
        
        /**
         * Make a DELETE request
         * 
         * @param {string} endpoint - API endpoint
         * @param {Object} headers - Additional headers
         * @returns {Promise} - Promise with response data
         */
        delete: function(endpoint, headers = {}) {
            const url = _buildUrl(endpoint);
            return _queueRequest('DELETE', url, null, headers);
        },
        
        /**
         * Make a PATCH request
         * 
         * @param {string} endpoint - API endpoint
         * @param {Object} data - Data to send
         * @param {Object} headers - Additional headers
         * @returns {Promise} - Promise with response data
         */
        patch: function(endpoint, data = {}, headers = {}) {
            const url = _buildUrl(endpoint);
            return _queueRequest('PATCH', url, data, headers);
        },
        
        /**
         * Upload a file
         * 
         * @param {string} endpoint - API endpoint
         * @param {FormData} formData - Form data with file
         * @param {Object} headers - Additional headers
         * @returns {Promise} - Promise with response data
         */
        upload: function(endpoint, formData, headers = {}) {
            const url = _buildUrl(endpoint);
            // Remove Content-Type header to let browser set it with boundary
            const uploadHeaders = { ...headers };
            delete uploadHeaders['Content-Type'];
            
            return _queueRequest('POST', url, formData, uploadHeaders);
        }
    };
})(); 