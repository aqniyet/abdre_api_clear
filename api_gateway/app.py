"""
Simple Flask application for API Gateway
"""
from flask import Flask

app = Flask(__name__)

@app.route('/')
def index():
    return 'ABDRE Microservices API Gateway is running!'

@app.route('/health')
def health():
    return {'status': 'healthy'}

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True) 