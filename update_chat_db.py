#!/usr/bin/env python3
import os
import pickle
import datetime
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# File path
MOCK_DB_FILE = 'chat_service/data/mock_db.pickle'

def main():
    # Load the database
    try:
        with open(MOCK_DB_FILE, 'rb') as f:
            db = pickle.load(f)
        print(f"Loaded {len(db['chats'])} chats")
    except Exception as e:
        print(f"Error loading database: {e}")
        return
    
    # Update each chat with UI fields
    for chat in db['chats']:
        # Add ID field (frontend expects this)
        chat['id'] = chat['chat_id']
        
        # Add name field
        short_id = chat['chat_id'].split('-')[0]
        chat['name'] = f"Chat Room {short_id}"
        
        # Add participant count
        chat['participant_count'] = 2
        
        # Format timestamps
        if isinstance(chat['created_at'], datetime.datetime):
            chat['last_activity'] = chat['created_at'].isoformat()
            chat['created_at'] = chat['created_at'].isoformat()
        else:
            chat['last_activity'] = datetime.datetime.now().isoformat()
        
        print(f"Updated chat {chat['chat_id']}")
    
    # Save the updated database
    try:
        with open(MOCK_DB_FILE, 'wb') as f:
            pickle.dump(db, f)
        print("Saved updated database")
    except Exception as e:
        print(f"Error saving database: {e}")

if __name__ == '__main__':
    main()
