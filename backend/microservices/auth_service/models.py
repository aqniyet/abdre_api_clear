"""
Auth Service - Models
Defines data models for the authentication service
"""

import uuid
from datetime import datetime, timedelta
import jwt
import os
import json
import logging
import hashlib
from pathlib import Path

# Setup logging
logger = logging.getLogger(__name__)

# JWT Secret key - should be stored in environment variable in production
JWT_SECRET = os.environ.get('JWT_SECRET', 'your-secret-key-here')

# Path to database files
DATA_DIR = Path(__file__).parent / "data"
USER_DB_FILE = DATA_DIR / "users.json"
SESSION_DB_FILE = DATA_DIR / "sessions.json"
BLACKLIST_DB_FILE = DATA_DIR / "token_blacklist.json"
AUTH_LOG_FILE = DATA_DIR / "auth_logs.json"

# Ensure data directory exists
DATA_DIR.mkdir(exist_ok=True)

class User:
    """User model with authentication methods"""
    
    def __init__(self, username, email, password_hash=None, user_id=None, display_name=None, 
                 created_at=None, status="active", role="user", preferences=None):
        """Initialize a user"""
        self.user_id = user_id or str(uuid.uuid4())
        self.username = username
        self.email = email
        self.password_hash = password_hash  # In production, use proper password hashing
        self.display_name = display_name or username.capitalize()
        self.created_at = created_at or datetime.utcnow().isoformat()
        self.status = status
        self.role = role
        self.preferences = preferences or {}
    
    def to_dict(self):
        """Convert user to dictionary for API responses"""
        return {
            'user_id': self.user_id,
            'username': self.username,
            'email': self.email,
            'display_name': self.display_name,
            'created_at': self.created_at,
            'status': self.status,
            'role': self.role,
            'preferences': self.preferences
        }
    
    def to_json(self):
        """Convert user to JSON for storage"""
        return {
            'user_id': self.user_id,
            'username': self.username,
            'email': self.email,
            'password_hash': self.password_hash,
            'display_name': self.display_name,
            'created_at': self.created_at,
            'status': self.status,
            'role': self.role,
            'preferences': self.preferences
        }
    
    @classmethod
    def from_json(cls, data):
        """Create user from JSON data"""
        return cls(
            username=data['username'],
            email=data['email'],
            password_hash=data['password_hash'],
            user_id=data['user_id'],
            display_name=data.get('display_name'),
            created_at=data.get('created_at'),
            status=data.get('status', 'active'),
            role=data.get('role', 'user'),
            preferences=data.get('preferences', {})
        )
    
    @classmethod
    def get_by_username(cls, username):
        """Get user by username"""
        users = UserDatabase.load_users()
        for user_data in users:
            if user_data['username'] == username:
                return cls.from_json(user_data)
        return None
    
    @classmethod
    def get_by_email(cls, email):
        """Get user by email"""
        users = UserDatabase.load_users()
        for user_data in users:
            if user_data['email'] == email:
                return cls.from_json(user_data)
        return None
    
    @classmethod
    def get_by_id(cls, user_id):
        """Get user by ID"""
        users = UserDatabase.load_users()
        for user_data in users:
            if user_data['user_id'] == user_id:
                return cls.from_json(user_data)
        return None
    
    def save(self):
        """Save user to database"""
        users = UserDatabase.load_users()
        
        # Check if user already exists
        for i, user_data in enumerate(users):
            if user_data['user_id'] == self.user_id:
                # Update existing user
                users[i] = self.to_json()
                UserDatabase.save_users(users)
                return self
        
        # Add new user
        users.append(self.to_json())
        UserDatabase.save_users(users)
        return self
    
    def generate_auth_token(self, expiration=86400, device_info=None):
        """
        Generate authentication token
        
        Args:
            expiration (int): Token expiration time in seconds
            device_info (dict): Information about the device used for login
            
        Returns:
            tuple: (token, expiration_time)
        """
        exp_time = datetime.utcnow() + timedelta(seconds=expiration)
        
        payload = {
            'user_id': self.user_id,
            'username': self.username,
            'role': self.role,
            'exp': exp_time,
            'iat': datetime.utcnow(),  # Issued at
            'jti': str(uuid.uuid4())   # JWT ID for tracking/revocation
        }
        
        # Create token
        token = jwt.encode(payload, JWT_SECRET, algorithm='HS256')
        
        # Record session
        session_id = payload['jti']
        SessionManager.create_session(
            session_id=session_id,
            user_id=self.user_id,
            token=token,
            expires_at=exp_time.isoformat(),
            device_info=device_info or {}
        )
        
        return token, exp_time
    
    @staticmethod
    def verify_auth_token(token):
        """
        Verify authentication token
        
        Args:
            token (str): JWT token to verify
            
        Returns:
            dict: Token payload if valid, None otherwise
        """
        try:
            # Check if token is blacklisted
            if TokenBlacklist.is_blacklisted(token):
                logger.warning("Token is blacklisted")
                return None
            
            # Decode and verify token
            payload = jwt.decode(token, JWT_SECRET, algorithms=['HS256'])
            
            # Check if this session exists
            session_id = payload.get('jti')
            if session_id and not SessionManager.session_exists(session_id):
                logger.warning("Session not found for token")
                return None
                
            return payload
            
        except jwt.ExpiredSignatureError:
            logger.warning("Token expired")
            return None
        except jwt.InvalidTokenError as e:
            logger.warning(f"Invalid token: {str(e)}")
            return None
    
    def invalidate_all_sessions(self):
        """Invalidate all sessions for this user"""
        return SessionManager.remove_user_sessions(self.user_id)


class Guest:
    """Guest user model for anonymous access"""
    
    def __init__(self, visitor_id=None):
        """Initialize a guest user"""
        self.visitor_id = visitor_id or str(uuid.uuid4())
        self.is_guest = True
    
    def to_dict(self):
        """Convert guest to dictionary for API responses"""
        return {
            'visitor_id': self.visitor_id,
            'is_guest': True
        }
    
    def generate_auth_token(self, expiration=86400, device_info=None):
        """
        Generate authentication token for guest
        
        Args:
            expiration (int): Token expiration time in seconds
            device_info (dict): Information about the device used for login
            
        Returns:
            tuple: (token, expiration_time)
        """
        exp_time = datetime.utcnow() + timedelta(seconds=expiration)
        
        payload = {
            'visitor_id': self.visitor_id,
            'is_guest': True,
            'exp': exp_time,
            'iat': datetime.utcnow(),  # Issued at
            'jti': str(uuid.uuid4())   # JWT ID for tracking/revocation
        }
        
        token = jwt.encode(payload, JWT_SECRET, algorithm='HS256')
        
        # Record session
        session_id = payload['jti']
        SessionManager.create_session(
            session_id=session_id,
            user_id=f"guest:{self.visitor_id}",
            token=token,
            expires_at=exp_time.isoformat(),
            device_info=device_info or {}
        )
        
        return token, exp_time


class UserDatabase:
    """User database operations"""
    
    @staticmethod
    def load_users():
        """Load users from database file"""
        if not USER_DB_FILE.exists():
            return []
        
        try:
            with open(USER_DB_FILE, 'r') as f:
                return json.load(f)
        except (json.JSONDecodeError, FileNotFoundError) as e:
            logger.error(f"Error loading user database: {str(e)}")
            return []
    
    @staticmethod
    def save_users(users):
        """Save users to database file"""
        try:
            with open(USER_DB_FILE, 'w') as f:
                json.dump(users, f, indent=2)
        except Exception as e:
            logger.error(f"Error saving user database: {str(e)}")
            raise

    @staticmethod
    def username_exists(username):
        """Check if username exists"""
        users = UserDatabase.load_users()
        return any(user['username'] == username for user in users)
    
    @staticmethod
    def email_exists(email):
        """Check if email exists"""
        users = UserDatabase.load_users()
        return any(user['email'] == email for user in users)


class SessionManager:
    """Manages user sessions"""
    
    @staticmethod
    def load_sessions():
        """Load sessions from database file"""
        if not SESSION_DB_FILE.exists():
            return {}
        
        try:
            with open(SESSION_DB_FILE, 'r') as f:
                return json.load(f)
        except (json.JSONDecodeError, FileNotFoundError) as e:
            logger.error(f"Error loading session database: {str(e)}")
            return {}
    
    @staticmethod
    def save_sessions(sessions):
        """Save sessions to database file"""
        try:
            with open(SESSION_DB_FILE, 'w') as f:
                json.dump(sessions, f, indent=2)
        except Exception as e:
            logger.error(f"Error saving session database: {str(e)}")
            raise
    
    @staticmethod
    def create_session(session_id, user_id, token, expires_at, device_info=None):
        """
        Create a new session
        
        Args:
            session_id (str): Session ID
            user_id (str): User ID
            token (str): JWT token
            expires_at (str): Expiration time ISO format
            device_info (dict): Device information
            
        Returns:
            bool: Success or failure
        """
        sessions = SessionManager.load_sessions()
        
        # Create new session
        sessions[session_id] = {
            'session_id': session_id,
            'user_id': user_id,
            'token_hash': hashlib.sha256(token.encode()).hexdigest() if token else None,
            'created_at': datetime.utcnow().isoformat(),
            'expires_at': expires_at,
            'device_info': device_info or {},
            'last_activity': datetime.utcnow().isoformat()
        }
        
        SessionManager.save_sessions(sessions)
        return True
    
    @staticmethod
    def session_exists(session_id):
        """
        Check if session exists
        
        Args:
            session_id (str): Session ID
            
        Returns:
            bool: True if session exists and is valid
        """
        sessions = SessionManager.load_sessions()
        
        if session_id not in sessions:
            return False
        
        # Check expiration
        session = sessions[session_id]
        expires_at = datetime.fromisoformat(session['expires_at'])
        
        if datetime.utcnow() > expires_at:
            # Session has expired, remove it
            del sessions[session_id]
            SessionManager.save_sessions(sessions)
            return False
        
        return True
    
    @staticmethod
    def get_session(session_id):
        """
        Get session by ID
        
        Args:
            session_id (str): Session ID
            
        Returns:
            dict: Session data or None if not found
        """
        sessions = SessionManager.load_sessions()
        return sessions.get(session_id)
    
    @staticmethod
    def update_session_activity(session_id):
        """
        Update session last activity time
        
        Args:
            session_id (str): Session ID
            
        Returns:
            bool: Success or failure
        """
        sessions = SessionManager.load_sessions()
        
        if session_id not in sessions:
            return False
        
        sessions[session_id]['last_activity'] = datetime.utcnow().isoformat()
        SessionManager.save_sessions(sessions)
        return True
    
    @staticmethod
    def remove_session(session_id):
        """
        Remove a session
        
        Args:
            session_id (str): Session ID
            
        Returns:
            bool: Success or failure
        """
        sessions = SessionManager.load_sessions()
        
        if session_id not in sessions:
            return False
        
        # Get token before removing
        session = sessions[session_id]
        
        # Remove session
        del sessions[session_id]
        SessionManager.save_sessions(sessions)
        
        return True
    
    @staticmethod
    def remove_user_sessions(user_id):
        """
        Remove all sessions for a user
        
        Args:
            user_id (str): User ID
            
        Returns:
            int: Number of sessions removed
        """
        sessions = SessionManager.load_sessions()
        
        # Find sessions for this user
        user_sessions = {
            session_id: session
            for session_id, session in sessions.items()
            if session['user_id'] == user_id
        }
        
        # Remove sessions
        for session_id in user_sessions:
            del sessions[session_id]
        
        SessionManager.save_sessions(sessions)
        return len(user_sessions)
    
    @staticmethod
    def cleanup_expired_sessions():
        """
        Clean up expired sessions
        
        Returns:
            int: Number of sessions removed
        """
        sessions = SessionManager.load_sessions()
        now = datetime.utcnow()
        
        expired_sessions = {
            session_id: session
            for session_id, session in sessions.items()
            if datetime.fromisoformat(session['expires_at']) < now
        }
        
        # Remove expired sessions
        for session_id in expired_sessions:
            del sessions[session_id]
        
        SessionManager.save_sessions(sessions)
        return len(expired_sessions)


class TokenBlacklist:
    """Manages blacklisted tokens"""
    
    @staticmethod
    def load_blacklist():
        """Load token blacklist from database file"""
        if not BLACKLIST_DB_FILE.exists():
            return {}
        
        try:
            with open(BLACKLIST_DB_FILE, 'r') as f:
                return json.load(f)
        except (json.JSONDecodeError, FileNotFoundError) as e:
            logger.error(f"Error loading token blacklist: {str(e)}")
            return {}
    
    @staticmethod
    def save_blacklist(blacklist):
        """Save token blacklist to database file"""
        try:
            with open(BLACKLIST_DB_FILE, 'w') as f:
                json.dump(blacklist, f, indent=2)
        except Exception as e:
            logger.error(f"Error saving token blacklist: {str(e)}")
            raise
    
    @staticmethod
    def blacklist_token(token, reason="logout"):
        """
        Add a token to the blacklist
        
        Args:
            token (str): JWT token to blacklist
            reason (str): Reason for blacklisting
            
        Returns:
            bool: Success or failure
        """
        try:
            # Parse token to get expiration
            payload = jwt.decode(token, JWT_SECRET, algorithms=['HS256'], options={"verify_signature": False})
            jti = payload.get('jti')
            
            if not jti:
                logger.warning("Token has no JTI, cannot blacklist")
                return False
                
            exp = payload.get('exp')
            if not exp:
                logger.warning("Token has no expiration, cannot blacklist")
                return False
            
            exp_time = datetime.fromtimestamp(exp)
            
            # Add to blacklist
            blacklist = TokenBlacklist.load_blacklist()
            blacklist[jti] = {
                'token_hash': hashlib.sha256(token.encode()).hexdigest(),
                'expires_at': exp_time.isoformat(),
                'blacklisted_at': datetime.utcnow().isoformat(),
                'reason': reason
            }
            
            TokenBlacklist.save_blacklist(blacklist)
            
            # Also remove the session
            SessionManager.remove_session(jti)
            
            return True
            
        except Exception as e:
            logger.error(f"Error blacklisting token: {str(e)}")
            return False
    
    @staticmethod
    def is_blacklisted(token):
        """
        Check if a token is blacklisted
        
        Args:
            token (str): JWT token to check
            
        Returns:
            bool: True if blacklisted, False otherwise
        """
        try:
            # Parse token to get JTI
            payload = jwt.decode(token, JWT_SECRET, algorithms=['HS256'], options={"verify_signature": False})
            jti = payload.get('jti')
            
            if not jti:
                # Token has no JTI, can't check blacklist
                return False
            
            # Check blacklist
            blacklist = TokenBlacklist.load_blacklist()
            return jti in blacklist
            
        except Exception as e:
            logger.error(f"Error checking token blacklist: {str(e)}")
            return False
    
    @staticmethod
    def cleanup_expired_entries():
        """
        Clean up expired blacklist entries
        
        Returns:
            int: Number of entries removed
        """
        blacklist = TokenBlacklist.load_blacklist()
        now = datetime.utcnow()
        
        expired_entries = {
            jti: entry
            for jti, entry in blacklist.items()
            if datetime.fromisoformat(entry['expires_at']) < now
        }
        
        # Remove expired entries
        for jti in expired_entries:
            del blacklist[jti]
        
        TokenBlacklist.save_blacklist(blacklist)
        return len(expired_entries)


class AuthLogger:
    """Logs authentication events"""
    
    @staticmethod
    def load_logs():
        """Load auth logs from file"""
        if not AUTH_LOG_FILE.exists():
            return []
        
        try:
            with open(AUTH_LOG_FILE, 'r') as f:
                return json.load(f)
        except (json.JSONDecodeError, FileNotFoundError) as e:
            logger.error(f"Error loading auth logs: {str(e)}")
            return []
    
    @staticmethod
    def save_logs(logs):
        """Save auth logs to file"""
        try:
            with open(AUTH_LOG_FILE, 'w') as f:
                json.dump(logs, f, indent=2)
        except Exception as e:
            logger.error(f"Error saving auth logs: {str(e)}")
            raise
    
    @staticmethod
    def log_event(event_type, user_id=None, username=None, success=True, details=None, ip_address=None, user_agent=None):
        """
        Log an authentication event
        
        Args:
            event_type (str): Type of event (login, logout, register, etc.)
            user_id (str): User ID (if available)
            username (str): Username (if available)
            success (bool): Whether the event was successful
            details (dict): Additional details about the event
            ip_address (str): IP address of the client
            user_agent (str): User agent of the client
            
        Returns:
            bool: Success or failure
        """
        logs = AuthLogger.load_logs()
        
        # Create log entry
        log_entry = {
            'event_id': str(uuid.uuid4()),
            'event_type': event_type,
            'user_id': user_id,
            'username': username,
            'success': success,
            'timestamp': datetime.utcnow().isoformat(),
            'details': details or {},
            'ip_address': ip_address,
            'user_agent': user_agent
        }
        
        # Add to logs
        logs.append(log_entry)
        
        # Limit log size (keep last 1000 entries)
        if len(logs) > 1000:
            logs = logs[-1000:]
        
        AuthLogger.save_logs(logs)
        return True
    
    @staticmethod
    def get_user_logs(user_id, limit=100):
        """
        Get logs for a specific user
        
        Args:
            user_id (str): User ID
            limit (int): Maximum number of logs to return
            
        Returns:
            list: Log entries
        """
        logs = AuthLogger.load_logs()
        
        # Filter logs for this user
        user_logs = [log for log in logs if log['user_id'] == user_id]
        
        # Sort by timestamp (newest first)
        user_logs.sort(key=lambda log: log['timestamp'], reverse=True)
        
        # Limit number of logs
        return user_logs[:limit] 