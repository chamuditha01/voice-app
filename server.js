const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;

const wss = new WebSocket.Server({ port: PORT });

let clients = []; // Array to hold connected clients

wss.on('connection', ws => {
    // A new client connects. If we have less than 2 clients, add them.
    if (clients.length < 2) {
        const id = clients.length;
        ws.id = id;
        clients.push(ws);
        console.log(`New client connected with ID: ${id}`);
        ws.send(JSON.stringify({ type: 'id', id: id }));
        
        // If two clients are now connected, send a "start" signal to the second client
        if (clients.length === 2) {
            clients[1].send(JSON.stringify({ type: 'start_call' }));
        }
    } else {
        // If there are already two clients, close the new connection
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
        // Remove the disconnected client
        clients = clients.filter(client => client.id !== ws.id);
    });
});

console.log(`Signaling server listening on port ${PORT}`);