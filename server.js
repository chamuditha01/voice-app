const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;

const wss = new WebSocket.Server({ port: PORT });

// Use a Map to store client information for efficient lookup
let clients = new Map();
let idCounter = 0;

/**
 * Broadcasts the updated list of users to all connected clients.
 * It filters out any users whose role and email haven't been set yet.
 */
function broadcastUserList() {
    // Create a list of user objects with their ID, email, and role
    const users = Array.from(clients.values())
        .map(client => ({
            id: client.id,
            email: client.email,
            role: client.role,
        }))
        // Only include users with complete info in the broadcast list
        .filter(user => user.email && user.role); 

    const message = JSON.stringify({ type: 'user_list', users });

    // Send the user list to every client
    clients.forEach(client => {
        if (client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(message);
        }
    });
}

// Event listener for new client connections
wss.on('connection', ws => {
    // Assign a unique ID to the new client
    const id = idCounter++;
    clients.set(id, { ws, id, email: null, role: null }); // Initialize with null info

    console.log(`New client connected with ID: ${id}`);
    
    // Immediately send the new client their assigned ID
    ws.send(JSON.stringify({ type: 'your_id', id: id }));

    // Event listener for messages from this client
    ws.on('message', message => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'user_info') {
                // Update the client's info in our Map
                const client = clients.get(id);
                if (client) {
                    client.email = data.email;
                    client.role = data.role;
                }
                // Now that the client's info is complete, broadcast the updated user list.
                broadcastUserList();
            } else {
                // For all other messages (SDP, ICE, call requests, etc.), forward them
                // to the target client specified in the message.
                const targetClient = clients.get(data.targetId);
                
                if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
                    // Add the sender's ID before forwarding for the recipient's context
                    data.senderId = id;
                    targetClient.ws.send(JSON.stringify(data));
                } else {
                    console.log(`Target client ${data.targetId} not found or not ready.`);
                }
            }
        } catch (error) {
            console.error('Invalid message format or forwarding error:', error);
        }
    });

    // Event listener for a client disconnecting
    ws.on('close', () => {
        console.log(`Client disconnected: ${id}`);
        clients.delete(id);
        // Broadcast the updated user list to reflect the user's departure
        broadcastUserList();
    });
});

console.log(`Signaling server listening on port ${PORT}`);