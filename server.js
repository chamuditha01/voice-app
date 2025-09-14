const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;

const wss = new WebSocket.Server({ port: PORT });

let clients = new Map(); // Use a Map for O(1) lookups by ID
let idCounter = 0;

function broadcastUserList() {
    const users = Array.from(clients.values()).map(client => client.id);
    const message = JSON.stringify({ type: 'user_list', users });
    
    clients.forEach(client => {
        if (client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(message);
        }
    });
}

wss.on('connection', ws => {
    const id = idCounter++;
    clients.set(id, { ws, id });

    console.log(`New client connected with ID: ${id}`);
    
    // Send the new client their ID and the current list of users
    ws.send(JSON.stringify({ type: 'your_id', id: id }));
    
    // Broadcast the updated user list to all connected clients
    broadcastUserList();

    ws.on('message', message => {
        try {
            const data = JSON.parse(message);
            
            // Messages must now include a targetId
            const targetClient = clients.get(data.targetId);
            
            if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
                // Add the sender's ID to the message before forwarding
                data.senderId = id;
                targetClient.ws.send(JSON.stringify(data));
            } else {
                console.log(`Target client ${data.targetId} not found or not ready.`);
            }
        } catch (error) {
            console.error('Invalid message format or forwarding error:', error);
        }
    });

    ws.on('close', () => {
        console.log(`Client disconnected: ${id}`);
        clients.delete(id);
        // Broadcast the updated user list
        broadcastUserList();
    });
});

console.log(`Signaling server listening on port ${PORT}`);