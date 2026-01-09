
let localStream = null;
let peerConnection = null;
let callIncomingData = null;

const rtcConfig = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

/* --- Call UI Logic --- */
async function startCall() {
    if (!currentChatUser) return alert('Select a user to call!');

    // Play ringing sound?
    // Show calling modal
    alert(`Calling ${currentChatUser.username}...`); // Temp UI

    socket.emit('callUser', {
        userToCall: currentChatUser._id,
        from: currentUser._id,
        username: currentUser.username,
        profilePic: currentUser.profilePic
    });
}

// User Receiving Call
socket.on('callUser', (data) => {
    // Show Incoming Call Modal
    callIncomingData = data;
    const modal = document.getElementById('incoming-call-modal');
    modal.style.display = 'flex';
    document.getElementById('incoming-username').textContent = data.username;
    // document.getElementById('incoming-pfp').src = data.profilePic;

    playNotificationSound(); // Ringing
});

async function answerCall() {
    document.getElementById('incoming-call-modal').style.display = 'none';
    document.getElementById('call-overlay').classList.remove('hidden');
    document.getElementById('call-overlay').style.display = 'flex';
    document.getElementById('call-status-text').textContent = 'Connecting...';

    // Get Local Stream
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false }); // Start with audio
    } catch (e) {
        console.error("No mic", e);
    }

    // Initiate WebRTC
    createPeerConnection(callIncomingData.from, true);
}

function rejectCall() {
    document.getElementById('incoming-call-modal').style.display = 'none';
    socket.emit('rejectCall', { to: callIncomingData.from });
    callIncomingData = null;
}

socket.on('callRejected', () => {
    alert('Call Declined');
    // Stop local ring?
});

// --- WebRTC Logic ---
function createPeerConnection(targetId, isInitiator) {
    peerConnection = new RTCPeerConnection(rtcConfig);

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', { to: targetId, candidate: event.candidate });
        }
    };

    peerConnection.ontrack = (event) => {
        const remoteVideo = document.getElementById('remote-video');
        if (remoteVideo) remoteVideo.srcObject = event.streams[0];
        // Ensure overlay is proper
        document.getElementById('call-status-text').textContent = 'Connected';
    };

    if (localStream) {
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    }

    if (isInitiator) {
        peerConnection.createOffer().then(offer => {
            peerConnection.setLocalDescription(offer);
            socket.emit('offer', { to: targetId, signal: offer, from: currentUser._id });
        });
    }
}

socket.on('offer', async (data) => {
    // We are the ANSWERER in WebRTC terms (but we clicked 'Accept call')
    // Actually, usually the CALLER initiates Offer.
    // For this flow: 
    // 1. Caller "Rings"
    // 2. Callee "Accepts" -> Callee could be the one to 'initiate' the WebRTC connection? 
    //    OR Callee sends "answerCall" event to Caller, and Caller starts Offer.

    // Let's stick to standard: Caller offers.
    // If we receive an 'offer', it means the OTHER side started the peer connection.
    // In my logic above 'answerCall' started `createPeerConnection(..., true)`. 
    // This means the CALLEE is creating the Offer. This is fine, P2P is symmetric mostly.

    if (!peerConnection) createPeerConnection(data.from, false);

    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.signal));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    socket.emit('answer', { to: data.from, signal: answer });
});

socket.on('answer', async (data) => {
    await peerConnection.setLocalDescription(new RTCSessionDescription(data.signal));
});

socket.on('ice-candidate', async (candidate) => {
    if (peerConnection) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }
});

function toggleMic() {
    if (localStream) {
        localStream.getAudioTracks().forEach(t => t.enabled = !t.enabled);
        isMuted = !localStream.getAudioTracks()[0].enabled;
        updateCallButtons();
    }
}

// ... helper to attach to existing logic ...
