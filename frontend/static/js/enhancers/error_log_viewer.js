/**
 * ABDRE Chat - Error Log Viewer Enhancer
 * 
 * Provides a UI component to view error logs in the application.
 * Can be activated by pressing Ctrl+Shift+L in development mode.
 */

// Ensure ABDRE namespace exists
window.ABDRE = window.ABDRE || {};
window.ABDRE.Enhancers = window.ABDRE.Enhancers || {};

// Error Log Viewer Enhancer Module
ABDRE.Enhancers.ErrorLogViewer = (function() {
    // Private variables
    let _initialized = false;
    let _isVisible = false;
    let _container = null;
    let _logEntries = [];
    let _isDevMode = false;
    
    // Private methods
    function _createViewer() {
        // Create container
        _container = document.createElement('div');
        _container.className = 'error-log-viewer';
        _container.style.display = 'none';
        _container.innerHTML = `
            <div class="error-log-header">
                <h3>Error Log Viewer</h3>
                <div class="error-log-actions">
                    <button id="refresh-logs-btn" class="btn btn-sm">Refresh</button>
                    <button id="clear-logs-btn" class="btn btn-sm">Clear</button>
                    <button id="close-logs-btn" class="btn btn-sm">Close</button>
                </div>
            </div>
            <div class="error-log-content">
                <div id="error-log-entries" class="error-log-entries"></div>
            </div>
        `;
        
        // Add to body
        document.body.appendChild(_container);
        
        // Add event listeners
        document.getElementById('refresh-logs-btn').addEventListener('click', _refreshLogs);
        document.getElementById('clear-logs-btn').addEventListener('click', _clearLogs);
        document.getElementById('close-logs-btn').addEventListener('click', _hideViewer);
        
        // Add keyboard shortcut
        document.addEventListener('keydown', function(event) {
            // Ctrl+Shift+L to toggle log viewer in dev mode
            if (event.ctrlKey && event.shiftKey && event.key === 'L' && _isDevMode) {
                event.preventDefault();
                _toggleViewer();
            }
        });
        
        // Add styles
        _addStyles();
    }
    
    function _addStyles() {
        // Add viewer styles if not already present
        if (!document.getElementById('error-log-viewer-styles')) {
            const style = document.createElement('style');
            style.id = 'error-log-viewer-styles';
            style.textContent = `
                .error-log-viewer {
                    position: fixed;
                    top: 10%;
                    left: 10%;
                    width: 80%;
                    height: 80%;
                    background-color: #fff;
                    border-radius: 8px;
                    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
                    z-index: 10000;
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                }
                
                .error-log-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 12px 16px;
                    border-bottom: 1px solid #e0e0e0;
                    background-color: #f5f5f5;
                }
                
                .error-log-header h3 {
                    margin: 0;
                    font-size: 16px;
                    color: #333;
                }
                
                .error-log-actions {
                    display: flex;
                    gap: 8px;
                }
                
                .error-log-content {
                    flex: 1;
                    overflow: auto;
                    padding: 16px;
                }
                
                .error-log-entries {
                    font-family: monospace;
                    font-size: 13px;
                    white-space: pre-wrap;
                    line-height: 1.5;
                }
                
                .error-log-entry {
                    margin-bottom: 8px;
                    padding: 8px;
                    border-radius: 4px;
                    border-left: 3px solid #ccc;
                }
                
                .error-log-entry.error {
                    background-color: #ffeaea;
                    border-left-color: #ea4335;
                }
                
                .error-log-entry.warning {
                    background-color: #fff8e1;
                    border-left-color: #fbbc05;
                }
                
                .error-log-entry.info {
                    background-color: #e8f0fe;
                    border-left-color: #4285f4;
                }
                
                .error-log-timestamp {
                    color: #666;
                    font-size: 12px;
                }
                
                .error-log-type {
                    font-weight: bold;
                    margin-right: 8px;
                }
                
                .error-log-message {
                    display: block;
                    margin-top: 4px;
                }
                
                .error-log-details {
                    display: block;
                    margin-top: 4px;
                    color: #666;
                    font-size: 12px;
                }
                
                .btn-sm {
                    padding: 4px 8px;
                    font-size: 12px;
                }
            `;
            document.head.appendChild(style);
        }
    }
    
    function _toggleViewer() {
        if (_isVisible) {
            _hideViewer();
        } else {
            _showViewer();
        }
    }
    
    function _showViewer() {
        if (!_container) return;
        _container.style.display = 'flex';
        _isVisible = true;
        _refreshLogs();
    }
    
    function _hideViewer() {
        if (!_container) return;
        _container.style.display = 'none';
        _isVisible = false;
    }
    
    function _refreshLogs() {
        // Get logs from ErrorHandler
        if (ABDRE.ErrorHandler && typeof ABDRE.ErrorHandler.getErrorLog === 'function') {
            _logEntries = ABDRE.ErrorHandler.getErrorLog();
            _renderLogs();
        } else {
            // Try to fetch logs from API
            if (ABDRE.ApiClient) {
                ABDRE.ApiClient.get('/logs/latest?file=error_tracking.log')
                    .then(response => {
                        if (response && response.logs) {
                            _renderLogsFromApi(response.logs);
                        }
                    })
                    .catch(error => {
                        console.error('Failed to fetch logs:', error);
                    });
            }
        }
    }
    
    function _renderLogs() {
        const entriesContainer = document.getElementById('error-log-entries');
        if (!entriesContainer) return;
        
        // Clear existing entries
        entriesContainer.innerHTML = '';
        
        if (_logEntries.length === 0) {
            entriesContainer.innerHTML = '<div class="error-log-empty">No errors have been logged.</div>';
            return;
        }
        
        // Render entries
        _logEntries.forEach(entry => {
            const entryElement = document.createElement('div');
            entryElement.className = `error-log-entry ${entry.type === 'error' ? 'error' : (entry.type === 'warning' ? 'warning' : 'info')}`;
            
            let detailsHtml = '';
            if (entry.details) {
                detailsHtml = `<div class="error-log-details">${JSON.stringify(entry.details, null, 2)}</div>`;
            }
            
            entryElement.innerHTML = `
                <div class="error-log-timestamp">${entry.timestamp}</div>
                <div>
                    <span class="error-log-type">${entry.type}</span>
                    <span class="error-log-message">${entry.message || 'No message'}</span>
                    ${detailsHtml}
                </div>
            `;
            
            entriesContainer.appendChild(entryElement);
        });
    }
    
    function _renderLogsFromApi(logs) {
        const entriesContainer = document.getElementById('error-log-entries');
        if (!entriesContainer) return;
        
        // Clear existing entries
        entriesContainer.innerHTML = '';
        
        if (logs.length === 0) {
            entriesContainer.innerHTML = '<div class="error-log-empty">No errors have been logged.</div>';
            return;
        }
        
        // Render entries
        logs.forEach(logLine => {
            const entryElement = document.createElement('div');
            entryElement.className = 'error-log-entry';
            
            // Determine type based on content
            if (logLine.includes('ERROR')) {
                entryElement.classList.add('error');
            } else if (logLine.includes('WARNING')) {
                entryElement.classList.add('warning');
            } else {
                entryElement.classList.add('info');
            }
            
            entryElement.innerHTML = `<pre>${logLine}</pre>`;
            entriesContainer.appendChild(entryElement);
        });
    }
    
    function _clearLogs() {
        if (ABDRE.ErrorHandler && typeof ABDRE.ErrorHandler.clearErrorLog === 'function') {
            ABDRE.ErrorHandler.clearErrorLog();
            _logEntries = [];
            _renderLogs();
        }
        
        // Also clear file log if API is available
        if (ABDRE.ApiClient) {
            ABDRE.ApiClient.post('/logs/file-log', {
                file: 'error_tracking.log',
                message: `${new Date().toISOString()} - Log cleared by user`,
                level: 'INFO'
            }).then(() => {
                console.log('Log file cleared');
            }).catch(error => {
                console.error('Failed to clear log file:', error);
            });
        }
    }
    
    // Public API
    return {
        init: function(options = {}) {
            if (_initialized) {
                console.warn('Error log viewer already initialized');
                return;
            }
            
            _isDevMode = options.devMode || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
            
            // Create viewer UI
            _createViewer();
            
            // Set initialized flag
            _initialized = true;
            
            // Log initialization
            console.log('Error log viewer initialized', _isDevMode ? '(dev mode)' : '');
            
            // If dev mode and requested, show automatically
            if (_isDevMode && options.showOnInit) {
                _showViewer();
            }
        },
        
        show: function() {
            _showViewer();
        },
        
        hide: function() {
            _hideViewer();
        },
        
        refresh: function() {
            _refreshLogs();
        }
    };
})(); 