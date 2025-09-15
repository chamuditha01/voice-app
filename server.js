const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;

const wss = new WebSocket.Server({ port: PORT });

let clients = new Map();
let idCounter = 0;
let ongoingCalls = new Map(); // Use a Map to store call pairs

function broadcastUserList() {
    const users = Array.from(clients.values())
        .map(client => ({
            id: client.id,
            email: client.email,
            role: client.role,
            inCall: ongoingCalls.has(client.id) // Check if the user is a key in the map
        }))
        .filter(user => user.email && user.role);

    const message = JSON.stringify({ type: 'user_list', users });

    clients.forEach(client => {
        if (client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(message);
        }
    });
}

function findRandomAvailableSpeaker() {
    const speakers = Array.from(clients.values()).filter(client =>
        client.role === 'speaker' && !ongoingCalls.has(client.id)
    );
    if (speakers.length > 0) {
        const randomIndex = Math.floor(Math.random() * speakers.length);
        return speakers[randomIndex];
    }
    return null;
}

wss.on('connection', ws => {
    const id = idCounter++;
    clients.set(id, { ws, id, email: null, role: null });

    console.log(`New client connected with ID: ${id}`);
    
    ws.send(JSON.stringify({ type: 'your_id', id: id }));

    ws.on('message', message => {
        try {
            const data = JSON.parse(message);
            
            if (data.type === 'user_info') {
                const client = clients.get(id);
                if (client) {
                    client.email = data.email;
                    client.role = data.role;
                }
                broadcastUserList();
            } else if (data.type === 'call_request') {
                const speaker = findRandomAvailableSpeaker();
                if (speaker) {
                    data.senderId = id;
                    data.targetId = speaker.id;
                    speaker.ws.send(JSON.stringify(data));
                    
                    // Mark both users as in a call
                    ongoingCalls.set(id, speaker.id);
                    ongoingCalls.set(speaker.id, id);
                    
                    broadcastUserList();
                } else {
                    ws.send(JSON.stringify({ type: 'no_speaker_available' }));
                }
            } else if (data.type === 'call_accepted') {
                const targetClient = clients.get(data.targetId);
                if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
                    data.senderId = id;
                    targetClient.ws.send(JSON.stringify(data));
                }
            } else if (data.type === 'call_ended') {
                const partnerId = ongoingCalls.get(id);

                // Remove both users from the ongoingCalls map
                if (partnerId) {
                    ongoingCalls.delete(id);
                    ongoingCalls.delete(partnerId);
                }
                
                // Broadcast the updated user list to all clients
                broadcastUserList();

                // Inform the other client that the call has ended
                const targetClient = clients.get(partnerId);
                if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
                    targetClient.ws.send(JSON.stringify({ type: 'call_ended', senderId: id }));
                }
            } else {
                const targetClient = clients.get(data.targetId);
                if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
                    data.senderId = id;
                    targetClient.ws.send(JSON.stringify(data));
                }
            }
        } catch (error) {
            console.error('Invalid message format or forwarding error:', error);
        }
    });

    ws.on('close', () => {
        console.log(`Client disconnected: ${id}`);
        // Clean up the call status for the disconnected user
        const partnerId = ongoingCalls.get(id);
        if (partnerId) {
            ongoingCalls.delete(id);
            ongoingCalls.delete(partnerId);
        }
        clients.delete(id);
        broadcastUserList();
    });
});

console.log(`Signaling server listening on port ${PORT}`);