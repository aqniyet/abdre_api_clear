"""
ABDRE Chat - Connection Manager
Manages WebSocket connections for the Realtime Service
"""

import asyncio
import logging
from fastapi import WebSocket
from typing import Dict, List, Set, Any, Optional

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class ConnectionManager:
    """
    Manages WebSocket connections and message broadcasting
    """
    
    def __init__(self):
        """Initialize connection manager"""
        # Map of user_id to WebSocket connection
        self.active_connections: Dict[str, WebSocket] = {}
        
        # Map of user_id to username
        self.user_info: Dict[str, str] = {}
        
        # Map of chat_id to set of user_ids in that chat
        self.chat_participants: Dict[str, Set[str]] = {}
        
        # Map of user_id to set of chat_ids they're in
        self.user_chats: Dict[str, Set[str]] = {}
        
        # Map of user_id to typing status per chat_id
        self.typing_status: Dict[str, Dict[str, bool]] = {}
        
    async def connect(self, websocket: WebSocket, user_id: str, username: str) -> None:
        """
        Register a new WebSocket connection for a user
        
        Args:
            websocket: WebSocket connection
            user_id: User ID
            username: User name
        """
        # If user already had a connection, disconnect the old one
        if user_id in self.active_connections:
            old_websocket = self.active_connections[user_id]
            await old_websocket.close(code=1012, reason="New connection established")
            logger.info(f"Closed previous connection for user {user_id}")
        
        # Store new connection
        self.active_connections[user_id] = websocket
        self.user_info[user_id] = username
        logger.info(f"User {user_id} ({username}) connected")
        
    async def disconnect(self, user_id: str) -> None:
        """
        Remove a WebSocket connection
        
        Args:
            user_id: User ID to disconnect
        """
        # Remove connection
        if user_id in self.active_connections:
            del self.active_connections[user_id]
            
        # Keep user info in case they reconnect
        # Clean up typing status
        if user_id in self.typing_status:
            del self.typing_status[user_id]
            
        logger.info(f"User {user_id} disconnected")
        
    async def send_to_user(self, user_id: str, message: Any) -> bool:
        """
        Send a message to a specific user
        
        Args:
            user_id: User ID to send to
            message: Message to send
            
        Returns:
            bool: True if sent successfully, False otherwise
        """
        if user_id not in self.active_connections:
            return False
            
        websocket = self.active_connections[user_id]
        try:
            await websocket.send_json(message)
            return True
        except Exception as e:
            logger.error(f"Error sending message to user {user_id}: {str(e)}")
            return False
            
    async def broadcast(self, message: Any, exclude_user: Optional[str] = None) -> None:
        """
        Broadcast a message to all connected users
        
        Args:
            message: Message to broadcast
            exclude_user: Optional user ID to exclude from broadcast
        """
        disconnected_users = []
        
        for user_id, websocket in self.active_connections.items():
            if exclude_user and user_id == exclude_user:
                continue
                
            try:
                await websocket.send_json(message)
            except Exception as e:
                logger.error(f"Error broadcasting to user {user_id}: {str(e)}")
                disconnected_users.append(user_id)
                
        # Clean up disconnected users
        for user_id in disconnected_users:
            await self.disconnect(user_id)
            
    async def broadcast_to_chat(self, chat_id: str, message: Any, exclude_user: Optional[str] = None) -> None:
        """
        Broadcast a message to all users in a chat
        
        Args:
            chat_id: Chat ID
            message: Message to broadcast
            exclude_user: Optional user ID to exclude from broadcast
        """
        if chat_id not in self.chat_participants:
            logger.info(f"No participants found for chat {chat_id}")
            return
            
        disconnected_users = []
        excluded_count = 0
        sent_count = 0
        
        logger.info(f"Broadcasting to chat {chat_id}, excluding user {exclude_user}, participants: {self.chat_participants[chat_id]}")
        
        for user_id in self.chat_participants[chat_id]:
            if exclude_user and user_id == exclude_user:
                logger.info(f"Excluding user {user_id} from broadcast")
                excluded_count += 1
                continue
                
            if user_id not in self.active_connections:
                logger.info(f"User {user_id} is not connected, skipping")
                continue
                
            try:
                await self.active_connections[user_id].send_json(message)
                sent_count += 1
                logger.info(f"Message sent to user {user_id}")
            except Exception as e:
                logger.error(f"Error broadcasting to chat user {user_id}: {str(e)}")
                disconnected_users.append(user_id)
        
        logger.info(f"Broadcast summary: sent to {sent_count} users, excluded {excluded_count} users")
                
        # Clean up disconnected users
        for user_id in disconnected_users:
            await self.disconnect(user_id)
            
    async def add_user_to_chat(self, user_id: str, chat_id: str) -> None:
        """
        Add a user to a chat room
        
        Args:
            user_id: User ID
            chat_id: Chat ID
        """
        # Initialize chat if not exists
        if chat_id not in self.chat_participants:
            self.chat_participants[chat_id] = set()
            
        # Add user to chat
        self.chat_participants[chat_id].add(user_id)
        
        # Add chat to user's chats
        if user_id not in self.user_chats:
            self.user_chats[user_id] = set()
            
        self.user_chats[user_id].add(chat_id)
        
    async def remove_user_from_chat(self, user_id: str, chat_id: str) -> None:
        """
        Remove a user from a chat room
        
        Args:
            user_id: User ID
            chat_id: Chat ID
        """
        # Remove user from chat
        if chat_id in self.chat_participants:
            self.chat_participants[chat_id].discard(user_id)
            
            # Clean up empty chats
            if not self.chat_participants[chat_id]:
                del self.chat_participants[chat_id]
                
        # Remove chat from user's chats
        if user_id in self.user_chats:
            self.user_chats[user_id].discard(chat_id)
            
    async def broadcast_user_status(self, user_id: str, status: str, exclude_user: Optional[str] = None) -> None:
        """
        Broadcast a user's status change to all relevant users
        
        Args:
            user_id: User ID
            status: Status ("online" or "offline")
            exclude_user: Optional user ID to exclude from broadcast
        """
        username = self.user_info.get(user_id, "Unknown User")
        
        # Build the status message
        status_message = {
            "type": "status",
            "event": "user_status",
            "data": {
                "user_id": user_id,
                "username": username,
                "status": status
            }
        }
        
        # If user is in chats, broadcast to those chat participants
        if user_id in self.user_chats:
            user_chats = self.user_chats[user_id].copy()
            
            for chat_id in user_chats:
                if chat_id in self.chat_participants:
                    for participant_id in self.chat_participants[chat_id]:
                        if participant_id != user_id and (not exclude_user or participant_id != exclude_user):
                            await self.send_to_user(participant_id, status_message)
        else:
            # Otherwise broadcast to all users
            await self.broadcast(status_message, exclude_user=exclude_user)
            
    async def broadcast_typing_status(self, user_id: str, chat_id: str, is_typing: bool) -> None:
        """
        Broadcast a user's typing status to chat participants
        
        Args:
            user_id: User ID
            chat_id: Chat ID
            is_typing: Whether the user is typing
        """
        username = self.user_info.get(user_id, "Unknown User")
        
        # Update typing status
        if user_id not in self.typing_status:
            self.typing_status[user_id] = {}
            
        old_status = self.typing_status[user_id].get(chat_id, False)
        self.typing_status[user_id][chat_id] = is_typing
        
        # Only broadcast if status changed
        if old_status != is_typing:
            logger.info(f"User {user_id} ({username}) typing status changed to {is_typing} in chat {chat_id}")
            
            # Build the typing status message
            typing_message = {
                "type": "status",
                "event": "typing",
                "chat_id": chat_id,
                "user_id": user_id,
                "username": username,
                "is_typing": is_typing
            }
            
            # IMPORTANT: Make sure we don't send typing status back to the sender
            logger.info(f"Broadcasting typing status, excluding sender {user_id}")
            await self.broadcast_to_chat(chat_id, typing_message, exclude_user=user_id)
            
    def get_connection_count(self) -> int:
        """
        Get the total number of active connections
        
        Returns:
            int: Number of connections
        """
        return len(self.active_connections)
        
    def get_online_user_ids(self) -> List[str]:
        """
        Get a list of online user IDs
        
        Returns:
            List[str]: List of user IDs
        """
        return list(self.active_connections.keys())
        
    def get_chat_participants(self, chat_id: str) -> List[str]:
        """
        Get a list of user IDs in a chat
        
        Args:
            chat_id: Chat ID
            
        Returns:
            List[str]: List of user IDs
        """
        if chat_id not in self.chat_participants:
            return []
            
        return list(self.chat_participants[chat_id])
        
    def is_user_online(self, user_id: str) -> bool:
        """
        Check if a user is online
        
        Args:
            user_id: User ID
            
        Returns:
            bool: True if online, False otherwise
        """
        return user_id in self.active_connections 