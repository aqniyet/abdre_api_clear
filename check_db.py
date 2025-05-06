#!/usr/bin/env python3
import os
import pickle
import datetime
import logging

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# File path
MOCK_DB_FILE = 'chat_service/data/mock_db.pickle'

def main():
    # Load the database
    try:
        with open(MOCK_DB_FILE, 'rb') as f:
            db = pickle.load(f)
        logger.info(f"Loaded {len(db['chats'])} chats")
    except Exception as e:
        logger.error(f"Error loading database: {e}")
        return
    
    # Check each chat's structure
    for i, chat in enumerate(db['chats']):
        logger.info(f"Chat {i+1}: {chat['chat_id']}")
        
        # Print all fields for debugging
        for key, value in chat.items():
            logger.info(f"  - {key}: {value} (type: {type(value).__name__})")
            
        # If created_at is a string, convert it to datetime
        if 'created_at' in chat and isinstance(chat['created_at'], str):
            try:
                # Try to parse the ISO format string
                chat['created_at'] = datetime.datetime.fromisoformat(chat['created_at'])
                logger.info(f"  Converted created_at from string to datetime for chat {chat['chat_id']}")
            except ValueError:
                # If parsing fails, set to current time
                chat['created_at'] = datetime.datetime.utcnow()
                logger.info(f"  Failed to parse created_at, set to current time for chat {chat['chat_id']}")
        
        # Remove string fields that should be datetimes to avoid confusion
        if 'last_activity' in chat:
            del chat['last_activity']
            logger.info(f"  Removed last_activity field from chat {chat['chat_id']}")
            
    # Save the updated database
    try:
        with open(MOCK_DB_FILE, 'wb') as f:
            pickle.dump(db, f)
        logger.info("Saved updated database")
        return True
    except Exception as e:
        logger.error(f"Error saving database: {e}")
        return False

if __name__ == '__main__':
    main() 