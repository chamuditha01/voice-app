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

wss.on('connection', ws => {
    const id = idCounter++;
    clients.set(id, { ws, id, email: null, role: null });

    console.log(`New client connected with ID: ${id}`);
    ws.send(JSON.stringify({ type: 'your_id', id: id }));

    ws.on('message', async message => {
        try {
            const data = JSON.parse(message);
            console.log(`Received message of type: ${data.type} from ID: ${id}`);

            if (data.type === 'user_info') {
                const client = clients.get(id);
                if (client) {
                    client.email = data.email;
                    client.role = data.role;
                }
                broadcastUserList();
            } else if (data.type === 'call_request') {
                const targetId = data.targetId; // Get the specific target ID from the caller
                const speaker = clients.get(targetId);
                const learner = clients.get(id);

                if (speaker && !ongoingCalls.has(speaker.id)) {
                    const tempCallId = uuidv4();
                    
                    // Notify the speaker about the incoming call
                    speaker.ws.send(JSON.stringify({ 
                        type: 'call_request', 
                        senderId: id, 
                        callId: tempCallId, 
                        opponentEmail: learner.email 
                    }));

                    // Note: The learner is NOT immediately sent a `call_accepted` message here.
                    // This will happen only after the speaker accepts the call.
                    // The learner will remain in 'Requesting Call...' state until the speaker responds.

                    // Update ongoingCalls only after the call is accepted, not here.
                    // For now, let's keep it simple and assume `inCall` status is managed by the clients.
                    broadcastUserList();

                } else {
                    ws.send(JSON.stringify({ type: 'no_speaker_available' }));
                }
            } else if (data.type === 'call_accepted') {
                const targetClient = clients.get(data.targetId);
                const senderClient = clients.get(id);
                
                if (targetClient && targetClient.ws.readyState === WebSocket.OPEN && senderClient) {
                    // Update the ongoingCalls map for both clients
                    ongoingCalls.set(id, targetClient.id);
                    ongoingCalls.set(targetClient.id, id);
                    broadcastUserList();
                    
                    // Notify both clients that the call is accepted and started
                    senderClient.ws.send(JSON.stringify({ type: 'call_started' }));
                    targetClient.ws.send(JSON.stringify({ 
                        type: 'call_accepted', 
                        senderId: id,
                        opponentEmail: senderClient.email
                    }));
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

                if (callerClient && callerClient.ws.readyState === WebSocket.OPEN) {
                    callerClient.ws.send(JSON.stringify({ type: 'call_ended_prompt' }));
                }
                if (partnerClient && partnerClient.ws.readyState === WebSocket.OPEN) {
                    partnerClient.ws.send(JSON.stringify({ type: 'call_ended_prompt' }));
                }

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
                    
                    if (callerClient && callerClient.ws.readyState === WebSocket.OPEN) {
                        callerClient.ws.send(JSON.stringify({ type: 'call_id_assigned', dbCallId }));
                    }
                    if (partnerClient && partnerClient.ws.readyState === WebSocket.OPEN) {
                         partnerClient.ws.send(JSON.stringify({ type: 'call_id_assigned', dbCallId }));
                    }
                }
                
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