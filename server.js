const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;

const wss = new WebSocket.Server({ port: PORT });

let clients = []; // Array to hold connected clients

wss.on('connection', ws => {
    if (clients.length < 2) {
        const id = clients.length;
        ws.id = id;
        clients.push(ws);
        console.log(`New client connected with ID: ${id}`);
        ws.send(JSON.stringify({ type: 'id', id: id }));
        
        // Removed the line that automatically started the call.
        // The call is now initiated by a client-side request.
    } else {
        console.log('Server is full. New connection rejected.');
        ws.close();
        return;
    }

    ws.on('message', message => {
        try {
            const data = JSON.parse(message);
            const otherClient = clients.find(client => client.id !== ws.id);
            
            if (otherClient) {
                // Forward the message to the other client
                otherClient.send(JSON.stringify(data));
            } else {
                console.log('Peer not found. Waiting for another client to connect.');
            }
        } catch (error) {
            console.error('Invalid message format:', error);
        }
    });

    ws.on('close', () => {
        console.log(`Client disconnected: ${ws.id}`);
        clients = clients.filter(client => client.id !== ws.id);
    });
});

console.log(`Signaling server listening on port ${PORT}`);