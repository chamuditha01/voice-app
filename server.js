const WebSocket = require('ws');
const { createClient } = require('@supabase/supabase-js');

// Change the import of uuid here
let uuidv4;
import('uuid').then(uuidModule => {
    uuidv4 = uuidModule.v4;
}).catch(error => {
    console.error('Failed to load UUID module:', error);
});

const PORT = process.env.PORT || 8080;

const supabaseUrl = "https://kzoacsovknswqolrpbeb.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt6b2Fjc292a25zd3FvbHJwYmViIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTczMjA0MjksImV4cCI6MjA3Mjg5NjQyOX0.NKKqML6aHUe4_euUX4x9p6TcTWIfKWeeVn_PQ_pS_o4";

const supabase = createClient(supabaseUrl, supabaseAnonKey);

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
                    const tempCallId = uuidv4();
                    
                    const learner = clients.get(id);
                    const speakerEmail = speaker.email;
                    const learnerEmail = learner.email;
                    
                    ws.send(JSON.stringify({ type: 'call_accepted', senderId: speaker.id, callId: tempCallId, opponentEmail: speakerEmail }));
                    speaker.ws.send(JSON.stringify({ type: 'call_request', senderId: id, callId: tempCallId, opponentEmail: learnerEmail }));
                    
                    ongoingCalls.set(id, speaker.id);
                    ongoingCalls.set(speaker.id, id);
                    broadcastUserList();
                } else {
                    ws.send(JSON.stringify({ type: 'no_speaker_available' }));
                }
            } else if (data.type === 'call_accepted') {
                const targetClient = clients.get(data.targetId);
                const senderClient = clients.get(id);

                if (targetClient && targetClient.ws.readyState === WebSocket.OPEN && senderClient) {
                    data.senderId = id;
                    delete data.opponentEmail;
                    targetClient.ws.send(JSON.stringify(data));
                    
                    senderClient.ws.send(JSON.stringify({ type: 'call_started' }));
                    targetClient.ws.send(JSON.stringify({ type: 'call_started' }));
                }
            } else if (data.type === 'call_rejected') {
                const targetClient = clients.get(data.targetId);
                if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
                    targetClient.ws.send(JSON.stringify({ type: 'call_rejected' }));
                }
                const partnerId = ongoingCalls.get(id);
                if (partnerId) {
                    ongoingCalls.delete(id);
                    ongoingCalls.delete(partnerId);
                }
                broadcastUserList();
            } else if (data.type === 'call_ended') {
                const partnerId = ongoingCalls.get(id);
                const callerClient = clients.get(id);
                const partnerClient = clients.get(partnerId);

                // Immediately notify both clients that the call has ended
                if (callerClient && callerClient.ws.readyState === WebSocket.OPEN) {
                    callerClient.ws.send(JSON.stringify({ type: 'call_ended_prompt' }));
                }
                if (partnerClient && partnerClient.ws.readyState === WebSocket.OPEN) {
                    partnerClient.ws.send(JSON.stringify({ type: 'call_ended_prompt' }));
                }

                // Database submission logic
                const { learner_email, speaker_email, duration, startTime, endTime } = data;
                
                const { data: insertedData, error } = await supabase
                    .from('calls')
                    .insert([
                        {
                            learner_email,
                            speaker_email,
                            duration_seconds: duration,
                            start_time: startTime,
                            end_time: endTime,
                        },
                    ])
                    .select();
                
                if (error) {
                    console.error('Error submitting call data:', error);
                } else {
                    console.log('Call data submitted successfully.');
                    const dbCallId = insertedData[0].id;
                    
                    // Send the database ID to both clients for their review forms
                    if (callerClient && callerClient.ws.readyState === WebSocket.OPEN) {
                        callerClient.ws.send(JSON.stringify({ type: 'call_id_assigned', dbCallId }));
                    }
                    if (partnerClient && partnerClient.ws.readyState === WebSocket.OPEN) {
                         partnerClient.ws.send(JSON.stringify({ type: 'call_id_assigned', dbCallId }));
                    }
                }
                
                // Clean up call status and broadcast
                if (partnerId) {
                    ongoingCalls.delete(id);
                    ongoingCalls.delete(partnerId);
                }
                broadcastUserList();

            } else if (data.type === 'submit_review') {
                const { error } = await supabase
                    .from('reviews')
                    .insert([
                        {
                            call_id: data.call_id,
                            reviewed_email: data.reviewed_email,
                            reviewed_by_email: data.reviewed_by_email,
                            rating: data.rating,
                            feedback: data.feedback,
                        },
                    ]);

                if (error) {
                    console.error('Error submitting review:', error);
                } else {
                    console.log('Review submitted successfully.');
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