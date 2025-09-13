const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;

const wss = new WebSocket.Server({ port: PORT });

let clients = new Map();

function broadcastUserList() {
    clients.forEach(client => {
        if (client.ws.readyState === WebSocket.OPEN) {
            const oppositeRole = client.role === 'learner' ? 'speaker' : 'learner';
            const users = Array.from(clients.values())
                .filter(c => c.id !== client.id && c.role === oppositeRole)
                .map(c => c.id);
            const message = JSON.stringify({ type: 'user_list', users });
            client.ws.send(message);
        }
    });
}

wss.on('connection', ws => {
    let clientId = null;

    ws.on('message', message => {
        try {
            const data = JSON.parse(message);
            
            if (data.type === 'init_user' && data.email && data.role) {
                clientId = data.email;
                if (clients.has(clientId)) {
                    // Handle reconnecting client
                    clients.delete(clientId);
                }
                clients.set(clientId, { ws, id: clientId, role: data.role, targetId: null });
                console.log(`New client connected with email: ${clientId} and role: ${data.role}`);
                ws.send(JSON.stringify({ type: 'your_id', id: clientId }));
                broadcastUserList();
                return;
            }

            if (!clientId) {
                return; // Ignore messages from uninitialized clients
            }

            const targetClient = clients.get(data.targetId);
            
            if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
                data.senderId = clientId;
                targetClient.ws.send(JSON.stringify(data));

                if (data.type === 'call_request' || data.type === 'call_accepted') {
                    clients.get(clientId).targetId = data.targetId;
                    clients.get(data.targetId).targetId = clientId;
                }
            } else {
                console.log(`Target client ${data.targetId} not found or not ready.`);
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'peer_unavailable' }));
                }
            }
        } catch (error) {
            console.error('Invalid message format or forwarding error:', error);
        }
    });

    ws.on('close', () => {
        console.log(`Client disconnected: ${clientId}`);
        if (clientId && clients.has(clientId)) {
            const disconnectedClient = clients.get(clientId);
            if (disconnectedClient.targetId !== null && clients.has(disconnectedClient.targetId)) {
                const otherClient = clients.get(disconnectedClient.targetId);
                if (otherClient && otherClient.ws.readyState === WebSocket.OPEN) {
                    otherClient.ws.send(JSON.stringify({ type: 'call_ended' }));
                }
            }
            clients.delete(clientId);
        }
        broadcastUserList();
    });
});

console.log(`Signaling server listening on port ${PORT}`);