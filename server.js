const WebSocket = require('ws');
const { createClient } = require('@supabase/supabase-js');

const PORT = process.env.PORT || 8080;

// Supabase configuration (replace with your actual credentials)
const SUPABASE_URL = 'https://kzoacsovknswqolrpbeb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt6b2Fjc292a25zd3FvbHJwYmViIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTczMjA0MjksImV4cCI6MjA3Mjg5NjQyOX0.NKKqML6aHUe4_euUX4x9p6TcTWIfKWeeVn_PQ_pS_o4';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const wss = new WebSocket.Server({ port: PORT });
let clients = new Map();
let idCounter = 0;
let ongoingCalls = new Map();

async function broadcastUserList() {
    const users = Array.from(clients.values())
        .map(client => ({
            id: client.id,
            email: client.email,
            role: client.role,
            inCall: ongoingCalls.has(client.id)
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

    ws.on('message', async message => {
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

                if (partnerId) {
                    ongoingCalls.delete(id);
                    ongoingCalls.delete(partnerId);
                }
                
                broadcastUserList();

                const targetClient = clients.get(partnerId);
                if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
                    targetClient.ws.send(JSON.stringify({ type: 'call_ended' }));
                }
            } else if (data.type === 'submit_call_data') {
                // Handle database submission
                const { error } = await supabase
                    .from('calls')
                    .insert([
                        {
                            learner_email: data.learner_email,
                            speaker_email: data.speaker_email,
                            duration_seconds: data.duration,
                            start_time: data.startTime,
                            end_time: data.endTime,
                        },
                    ]);

                if (error) {
                    console.error('Error submitting call data:', error);
                } else {
                    console.log('Call data submitted successfully.');
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