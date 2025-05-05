#!/usr/bin/env python
"""
WebSocket test client for ABDRE Realtime Service
This script provides a simple CLI to test WebSocket connections to the realtime service.
"""

import argparse
import asyncio
import json
import logging
import os
import sys
from datetime import datetime

import requests
import socketio

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("realtime-test-client")

# Socket.IO client
sio = socketio.AsyncClient(logger=True, engineio_logger=True)

# Connected flag and rooms
connected = False
joined_rooms = set()

# Event handlers
@sio.event
async def connect():
    global connected
    connected = True
    logger.info("Connected to server!")
    print("✅ Connected to server!")

@sio.event
async def disconnect():
    global connected
    connected = False
    logger.info("Disconnected from server")
    print("❌ Disconnected from server")

@sio.event
async def connect_error(data):
    logger.error(f"Connection error: {data}")
    print(f"❌ Connection error: {data}")

@sio.event
async def message(data):
    logger.info(f"Received message: {data}")
    print(f"📨 Received message: {json.dumps(data, indent=2)}")

@sio.event
async def pong(data):
    logger.info(f"Received pong: {data}")
    print(f"🏓 Pong received: {json.dumps(data, indent=2)}")

@sio.event
async def join(data):
    logger.info(f"User joined: {data}")
    print(f"👋 User joined: {json.dumps(data, indent=2)}")

@sio.event
async def joined(data):
    logger.info(f"Successfully joined room: {data}")
    print(f"✅ Joined room: {json.dumps(data, indent=2)}")
    if data.get('room_id'):
        joined_rooms.add(data['room_id'])

@sio.event
async def error(data):
    logger.error(f"Error from server: {data}")
    print(f"❌ Error from server: {json.dumps(data, indent=2)}")

@sio.event
async def user_active(data):
    logger.info(f"User active: {data}")
    print(f"🟢 User active: {json.dumps(data, indent=2)}")

@sio.event
async def user_away(data):
    logger.info(f"User away: {data}")
    print(f"🔴 User away: {json.dumps(data, indent=2)}")

@sio.event
async def message_ack(data):
    logger.info(f"Message acknowledged: {data}")
    print(f"✅ Message acknowledged: {json.dumps(data, indent=2)}")

async def join_room(room_id):
    logger.info(f"Joining room: {room_id}")
    await sio.emit('join', {'room_id': room_id})
    print(f"🚪 Requested to join room: {room_id}")

async def send_message(room_id, message):
    if not connected:
        print("❌ Not connected to server")
        return False
    
    # Join room first if not already in it
    if room_id not in joined_rooms:
        print(f"⚠️ Not in room {room_id}, joining first...")
        await join_room(room_id)
        # Wait a moment for the join to complete
        await asyncio.sleep(1)
    
    message_id = f"test-{datetime.now().timestamp()}"
    logger.info(f"Sending message to room {room_id}: {message}")
    await sio.emit('message', {
        'room_id': room_id,
        'message': message,
        'message_id': message_id
    })
    print(f"📤 Message sent to room {room_id}: {message}")
    return True

async def send_ping():
    if not connected:
        print("❌ Not connected to server")
        return False
    
    timestamp = datetime.now().isoformat()
    logger.info("Sending ping")
    await sio.emit('ping', {'timestamp': timestamp})
    print(f"🏓 Ping sent at {timestamp}")
    return True

async def test_broadcast(url, message):
    """Send a test broadcast via the API"""
    try:
        response = requests.post(
            f"{url}/test-broadcast",
            json={"message": message},
            headers={"Content-Type": "application/json"},
            timeout=5
        )
        if response.status_code == 200:
            logger.info("Broadcast sent successfully")
            print(f"📢 Broadcast sent: {message}")
            return True
        else:
            logger.error(f"Failed to send broadcast: {response.status_code} - {response.text}")
            print(f"❌ Failed to send broadcast: {response.status_code}")
            return False
    except Exception as e:
        logger.error(f"Error sending broadcast: {e}")
        print(f"❌ Error sending broadcast: {e}")
        return False

async def interactive_mode(args):
    """Interactive command line mode"""
    global connected
    
    print("\n=== ABDRE Realtime Service Test Client ===")
    print(f"Target URL: {args.url}")
    print("Type 'help' for available commands")
    
    while True:
        try:
            if not connected:
                status = "❌ Disconnected"
            else:
                status = "✅ Connected"
                
            cmd = input(f"\n[{status}] > ").strip()
            
            if not cmd:
                continue
                
            if cmd == "exit" or cmd == "quit":
                print("Exiting...")
                await sio.disconnect()
                break
                
            elif cmd == "help":
                print("\nAvailable commands:")
                print("  connect       - Connect to the server")
                print("  disconnect    - Disconnect from the server")
                print("  status        - Show connection status")
                print("  ping          - Send a ping")
                print("  join <room>   - Join a room")
                print("  msg <room> <message> - Send a message to a room")
                print("  broadcast <message>  - Send a broadcast message")
                print("  rooms         - List joined rooms")
                print("  exit/quit     - Exit the client")
                
            elif cmd == "connect":
                if connected:
                    print("Already connected")
                else:
                    print(f"Connecting to {args.url}...")
                    try:
                        await sio.connect(
                            args.url,
                            headers={"Authorization": f"Bearer {args.token}"},
                            auth={"token": args.token},
                            wait_timeout=10
                        )
                    except Exception as e:
                        print(f"❌ Connection failed: {e}")
                
            elif cmd == "disconnect":
                if not connected:
                    print("Not connected")
                else:
                    print("Disconnecting...")
                    await sio.disconnect()
                
            elif cmd == "status":
                if connected:
                    print(f"✅ Connected to {args.url}")
                    print(f"Session ID: {sio.sid}")
                    print(f"Transport: {sio.transport}")
                    print(f"Joined rooms: {', '.join(joined_rooms) if joined_rooms else 'None'}")
                else:
                    print("❌ Not connected")
                
            elif cmd == "ping":
                await send_ping()
                
            elif cmd.startswith("join "):
                if not connected:
                    print("❌ Not connected to server")
                    continue
                    
                try:
                    room_id = cmd.split(" ", 1)[1].strip()
                    if not room_id:
                        print("❌ Room ID required")
                        continue
                        
                    await join_room(room_id)
                except Exception as e:
                    print(f"❌ Error joining room: {e}")
                
            elif cmd.startswith("msg "):
                if not connected:
                    print("❌ Not connected to server")
                    continue
                    
                try:
                    parts = cmd.split(" ", 2)
                    if len(parts) < 3:
                        print("❌ Usage: msg <room> <message>")
                        continue
                        
                    room_id = parts[1].strip()
                    message = parts[2].strip()
                    
                    if not room_id or not message:
                        print("❌ Room ID and message required")
                        continue
                        
                    await send_message(room_id, message)
                except Exception as e:
                    print(f"❌ Error sending message: {e}")
                
            elif cmd.startswith("broadcast "):
                try:
                    message = cmd.split(" ", 1)[1].strip()
                    if not message:
                        print("❌ Message required")
                        continue
                        
                    await test_broadcast(args.url, message)
                except Exception as e:
                    print(f"❌ Error broadcasting message: {e}")
                
            elif cmd == "rooms":
                if joined_rooms:
                    print("Joined rooms:")
                    for room in joined_rooms:
                        print(f"  - {room}")
                else:
                    print("Not in any rooms")
                
            else:
                print(f"Unknown command: {cmd}")
                print("Type 'help' for available commands")
                
        except KeyboardInterrupt:
            print("\nExiting...")
            await sio.disconnect()
            break
        except Exception as e:
            print(f"Error processing command: {e}")

async def main():
    """Main function for the test client"""
    parser = argparse.ArgumentParser(description="WebSocket test client for ABDRE Realtime Service")
    parser.add_argument("--url", default="http://localhost:5006", help="URL of the realtime service")
    parser.add_argument("--token", default="guest", help="Authentication token")
    parser.add_argument("--join", help="Room ID to join")
    parser.add_argument("--message", help="Message to send (requires --join)")
    parser.add_argument("--broadcast", help="Message to broadcast to all clients")
    parser.add_argument("--ping", action="store_true", help="Send a ping")
    parser.add_argument("--interactive", "-i", action="store_true", help="Run in interactive mode")
    
    args = parser.parse_args()
    
    if args.interactive:
        await interactive_mode(args)
        return
    
    # Connect to the server
    print(f"Connecting to {args.url}...")
    try:
        await sio.connect(
            args.url,
            headers={"Authorization": f"Bearer {args.token}"},
            auth={"token": args.token},
            wait_timeout=10
        )
        
        # Process commands
        if args.ping:
            await send_ping()
            
        if args.broadcast:
            await test_broadcast(args.url, args.broadcast)
            
        if args.join:
            await join_room(args.join)
            await asyncio.sleep(1)  # Wait for join to complete
            
            if args.message:
                await send_message(args.join, args.message)
        
        # Keep the connection open for a few seconds to receive responses
        await asyncio.sleep(5)
        
    except socketio.exceptions.ConnectionError as e:
        logger.error(f"Failed to connect: {e}")
        print(f"❌ Connection failed: {e}")
        sys.exit(1)
    finally:
        if sio.connected:
            await sio.disconnect()

if __name__ == "__main__":
    asyncio.run(main()) 