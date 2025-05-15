#!/usr/bin/env python3
"""
ABDRE Chat - Realtime Service
Real-time WebSocket service for ABDRE Chat
"""

import os
import sys
import logging
import json
import asyncio
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, Depends, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional, Dict, List

# Configure path to find local modules
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Import our modules
from auth.token_validator import validate_token, get_user_from_token
from services.connection_manager import ConnectionManager
from services.user_status_service import UserStatusService
from handlers.chat_handler import ChatHandler
from handlers.qr_handler import QrHandler
from models.events import EventTypes, WebSocketMessage, ChatMessage, StatusEvent, QrEvent

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Constants
SERVICE_NAME = "realtime-service"
SERVICE_PORT = int(os.environ.get("REALTIME_SERVICE_PORT", 5504))
SERVICE_HOST = os.environ.get("REALTIME_SERVICE_HOST", "0.0.0.0")
AUTH_SERVICE_URL = os.environ.get("AUTH_SERVICE_URL", "http://localhost:5501")
USER_SERVICE_URL = os.environ.get("USER_SERVICE_URL", "http://localhost:5502")
CHAT_SERVICE_URL = os.environ.get("CHAT_SERVICE_URL", "http://localhost:5505")  # Assuming this will be created
QR_SERVICE_URL = os.environ.get("QR_SERVICE_URL", "http://localhost:5503")

# Create FastAPI app
app = FastAPI(
    title=SERVICE_NAME,
    description="Real-time WebSocket service for ABDRE Chat",
    version="1.0.0"
)

# Setup CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, restrict this to your domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize services
connection_manager = ConnectionManager()
user_status_service = UserStatusService(USER_SERVICE_URL)
chat_handler = ChatHandler(CHAT_SERVICE_URL)
qr_handler = QrHandler(QR_SERVICE_URL)

# Health check endpoint
@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": SERVICE_NAME,
        "version": "1.0.0"
    }

# Service discovery endpoint
@app.get("/api/realtime/info")
async def service_info():
    """Service information endpoint"""
    return {
        "service": SERVICE_NAME,
        "version": "1.0.0",
        "features": [
            "websocket",
            "chat_messaging",
            "user_status",
            "qr_connection"
        ]
    }

# Stats endpoint
@app.get("/api/realtime/stats")
async def service_stats():
    """Service statistics endpoint"""
    return {
        "active_connections": connection_manager.get_connection_count(),
        "online_users": len(connection_manager.get_online_user_ids()),
        "total_messages_handled": chat_handler.get_message_count()
    }

# WebSocket endpoint
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket connection endpoint"""
    # Accept the connection first
    await websocket.accept()
    
    user_id = None
    authenticated = False
    
    try:
        # Send initial connection message
        await websocket.send_json({
            "type": "system",
            "event": "connected",
            "data": {"message": "Connected to ABDRE Chat realtime service"}
        })
        
        # Wait for authentication message
        auth_data = await websocket.receive_json()
        if auth_data.get("type") != "auth":
            await websocket.close(code=1008, reason="Authentication required")
            return
        
        # Validate token
        token = auth_data.get("token")
        if not token:
            await websocket.close(code=1008, reason="Auth token required")
            return
        
        # Get user from token
        try:
            user = await get_user_from_token(token)
            user_id = user.get("id")
            username = user.get("username")
            
            if not user_id:
                await websocket.close(code=1008, reason="Invalid auth token")
                return
            
            authenticated = True
            
            # Register the connection
            await connection_manager.connect(websocket, user_id, username)
            
            # Update user status to online
            await user_status_service.set_user_status(user_id, "online")
            
            # Send acknowledgment
            await websocket.send_json({
                "type": "system",
                "event": "authenticated",
                "data": {"user_id": user_id, "username": username}
            })
            
            # Send online users to the client
            online_users = await user_status_service.get_online_users()
            await websocket.send_json({
                "type": "status",
                "event": "online_users",
                "data": {"users": online_users}
            })
            
            # Notify others that user is online
            await connection_manager.broadcast_user_status(user_id, "online", exclude_user=user_id)
            
            # Listen for messages
            while True:
                message_data = await websocket.receive_json()
                message_type = message_data.get("type")
                
                if message_type == "ping":
                    # Handle heartbeat
                    await websocket.send_json({"type": "pong"})
                
                elif message_type == "chat":
                    # Process chat message
                    await chat_handler.handle_message(
                        connection_manager, 
                        user_id, 
                        message_data
                    )
                    
                elif message_type == "status":
                    # Handle status update
                    event = message_data.get("event")
                    if event == "typing":
                        chat_id = message_data.get("chat_id")
                        is_typing = message_data.get("is_typing", False)
                        username = message_data.get("username", "User")
                        
                        logger.info(f"Received typing status from user {user_id} ({username}) for chat {chat_id}: {is_typing}")
                        
                        # Add the user to the chat participants if not already there
                        await connection_manager.add_user_to_chat(user_id, chat_id)
                        
                        # Broadcast typing status, making sure to exclude the sender
                        await connection_manager.broadcast_typing_status(
                            user_id, 
                            chat_id, 
                            is_typing
                        )
                        
                elif message_type == "qr":
                    # Handle QR-related events
                    await qr_handler.handle_event(
                        connection_manager,
                        user_id,
                        message_data
                    )
                    
        except Exception as e:
            logger.error(f"Authentication error: {str(e)}")
            await websocket.close(code=1008, reason="Authentication failed")
            return
                
    except WebSocketDisconnect:
        # Handle disconnect
        if authenticated and user_id:
            await connection_manager.disconnect(user_id)
            await user_status_service.set_user_status(user_id, "offline")
            await connection_manager.broadcast_user_status(user_id, "offline")
    
    except Exception as e:
        logger.error(f"WebSocket error: {str(e)}")
        if authenticated and user_id:
            await connection_manager.disconnect(user_id)
            await user_status_service.set_user_status(user_id, "offline")
            await connection_manager.broadcast_user_status(user_id, "offline")

# HTTP endpoint to send messages to specific users (service-to-service)
@app.post("/api/realtime/messages")
async def send_message(request: Request):
    """Send a message to specific users"""
    try:
        data = await request.json()
        user_ids = data.get("user_ids", [])
        message = data.get("message", {})
        
        if not user_ids or not message:
            raise HTTPException(status_code=400, detail="Missing user_ids or message")
            
        # Check API key or internal auth
        # For now, we'll assume this is an internal API only
        
        # Send message to specified users
        for user_id in user_ids:
            await connection_manager.send_to_user(user_id, message)
            
        return {"success": True, "sent_to": len(user_ids)}
        
    except Exception as e:
        logger.error(f"Error sending message: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to send message: {str(e)}")

# HTTP endpoint to check if users are online
@app.get("/api/realtime/users/status")
async def get_users_status(request: Request):
    """Get online status for multiple users"""
    try:
        user_ids = request.query_params.get("user_ids", "").split(",")
        
        if not user_ids or user_ids[0] == '':
            raise HTTPException(status_code=400, detail="Missing user_ids parameter")
            
        status_dict = {}
        online_user_ids = connection_manager.get_online_user_ids()
        
        for user_id in user_ids:
            status_dict[user_id] = "online" if user_id in online_user_ids else "offline"
            
        return {"users": status_dict}
        
    except Exception as e:
        logger.error(f"Error getting user status: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to get user status: {str(e)}")

if __name__ == "__main__":
    logger.info(f"Starting {SERVICE_NAME} on {SERVICE_HOST}:{SERVICE_PORT}")
    uvicorn.run("main:app", host=SERVICE_HOST, port=SERVICE_PORT, reload=True) 