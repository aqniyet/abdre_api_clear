#!/bin/bash
# Script to create a test chat room in the PostgreSQL database using Docker

# Test room details
TEST_ROOM_ID="test-chat-room-123"
TEST_ROOM_QR_TOKEN="test-token-123"

echo "Creating test chat room with ID: $TEST_ROOM_ID"

# Execute SQL command in PostgreSQL container
docker-compose exec -T postgres psql -U postgres -d abdre -c "
-- Check if the room already exists
DO \$\$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM chats WHERE chat_id = '$TEST_ROOM_ID') THEN
        -- Insert the test chat room
        INSERT INTO chats (chat_id, qr_token) VALUES ('$TEST_ROOM_ID', '$TEST_ROOM_QR_TOKEN');
        RAISE NOTICE 'Test chat room created with ID: $TEST_ROOM_ID';
    ELSE
        RAISE NOTICE 'Test chat room already exists with ID: $TEST_ROOM_ID';
    END IF;
END
\$\$;
"

echo "Finished. You can now use the test chat room at: /chat/$TEST_ROOM_ID" 