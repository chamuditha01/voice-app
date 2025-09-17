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
            name: client.name || null,
            age: client.age || null,
            bio: client.bio || null,
            imageUrl: client.imageUrl || null,
            inCall: ongoingCalls.has(client.id)
        }))
        .filter(user => user.email && user.role);

    console.log('Broadcasting user list:', users);
    const message = JSON.stringify({ type: 'user_list', users });

    clients.forEach(client => {
        if (client.ws.readyState === WebSocket.OPEN) {
            console.log(`Sending user list to client ID: ${client.id}`);
            client.ws.send(message);
        }
    });
}

wss.on('connection', ws => {
    const id = idCounter++;
    clients.set(id, { ws, id, email: null, role: null, name: null, age: null, bio: null, imageUrl: null });

    console.log(`New client connected with ID: ${id}`);
    ws.send(JSON.stringify({ type: 'your_id', id: id }));

    ws.on('message', async message => {
        try {
            const data = JSON.parse(message);
            console.log(`Received message of type: ${data.type} from ID: ${id}`, data);

            if (data.type === 'user_info') {
                const client = clients.get(id);
                if (client) {
                    client.email = data.email;
                    client.role = data.role;
                    client.name = data.name;
                    client.age = data.age;
                    client.bio = data.bio;
                    client.imageUrl = data.imageUrl;
                    console.log(`Updated client ${id} info:`, { email: client.email, role: client.role, name: client.name, age: client.age, bio: client.bio, imageUrl: client.imageUrl });
                }
                broadcastUserList();
            } else if (data.type === 'call_request') {
                const targetId = data.targetId;
                const speaker = clients.get(targetId);
                const learner = clients.get(id);

                console.log(`Call request from ${id} to ${targetId}. Speaker:`, speaker, 'Learner:', learner);
                if (speaker && !ongoingCalls.has(speaker.id)) {
                    const tempCallId = uuidv4();
                    
                    // Notify the speaker about the incoming call with additional data
                    const callRequestMessage = {
                        type: 'call_request',
                        senderId: id,
                        callId: tempCallId,
                        opponentEmail: learner.email,
                        opponentName: learner.name,
                        opponentAge: learner.age,
                        opponentBio: learner.bio,
                        opponentImageUrl: learner.imageUrl
                    };
                    console.log(`Sending call request to speaker ${targetId}:`, callRequestMessage);
                    speaker.ws.send(JSON.stringify(callRequestMessage));

                    // Learner remains in 'Requesting Call...' state until speaker responds
                    broadcastUserList();
                } else {
                    console.log(`No available speaker for call request from ${id}`);
                    ws.send(JSON.stringify({ type: 'no_speaker_available' }));
                }
            } else if (data.type === 'call_accepted') {
                const targetClient = clients.get(data.targetId);
                const senderClient = clients.get(id);
                
                console.log(`Call accepted by ${id} for target ${data.targetId}. Target:`, targetClient, 'Sender:', senderClient);
                if (targetClient && targetClient.ws.readyState === WebSocket.OPEN && senderClient) {
                    ongoingCalls.set(id, targetClient.id);
                    ongoingCalls.set(targetClient.id, id);
                    broadcastUserList();
                    
                    // Notify both clients with additional data
                    const callStartedMessage = {
                        type: 'call_started',
                        opponentEmail: targetClient.email,
                        opponentName: targetClient.name,
                        opponentAge: targetClient.age,
                        opponentBio: targetClient.bio,
                        opponentImageUrl: targetClient.imageUrl
                    };
                    console.log(`Sending call_started to ${id}:`, callStartedMessage);
                    senderClient.ws.send(JSON.stringify(callStartedMessage));

                    const callAcceptedMessage = {
                        type: 'call_accepted',
                        senderId: id,
                        opponentEmail: senderClient.email,
                        opponentName: senderClient.name,
                        opponentAge: senderClient.age,
                        opponentBio: senderClient.bio,
                        opponentImageUrl: senderClient.imageUrl
                    };
                    console.log(`Sending call_accepted to ${targetClient.id}:`, callAcceptedMessage);
                    targetClient.ws.send(JSON.stringify(callAcceptedMessage));
                }
            } else if (data.type === 'call_rejected') {
                const targetClient = clients.get(data.targetId);
                console.log(`Call rejected by ${id} for target ${data.targetId}. Target:`, targetClient);
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

                console.log(`Call ended by ${id}. Partner ID: ${partnerId}. Caller:`, callerClient, 'Partner:', partnerClient);
                if (callerClient && callerClient.ws.readyState === WebSocket.OPEN) {
                    callerClient.ws.send(JSON.stringify({ type: 'call_ended_prompt' }));
                }
                if (partnerClient && partnerClient.ws.readyState === WebSocket.OPEN) {
                    partnerClient.ws.send(JSON.stringify({ type: 'call_ended_prompt' }));
                }

                const { learner_email, speaker_email, duration, startTime, endTime, opponentName, opponentAge, opponentBio, opponentImageUrl } = data;
                
                console.log('Submitting call data to Supabase:', { learner_email, speaker_email, duration, startTime, endTime, opponentName, opponentAge, opponentBio, opponentImageUrl });
                const { data: insertedData, error } = await supabase
                    .from('calls')
                    .insert([
                        {
                            learner_email,
                            speaker_email,
                            opponent_name: opponentName,
                            opponent_age: opponentAge,
                            opponent_bio: opponentBio,
                            opponent_image_url: opponentImageUrl,
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
                console.log('Submitting review data to Supabase:', data);
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
                console.log(`Forwarding message of type ${data.type} from ${id} to ${data.targetId}. Target:`, targetClient);
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