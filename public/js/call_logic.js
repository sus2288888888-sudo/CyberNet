
/* --- WebRTC Call Logic (Features: PIP, Watch Stream, On-Demand Camera) --- */
let localStream = null;
let peerConnection = null;
let callIncomingData = null;

const rtcConfig = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

// Start a call (Caller side)
async function startCall() {
    if (!currentChatUser) return alert('Select a user to call!');

    showCallOverlay();
    document.getElementById('call-status-text').textContent = `Ringing ${currentChatUser.username}...`;

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (e) {
        console.error("Mic access denied", e);
        alert("Microphone access is required for calls.");
        endCall();
        return;
    }

    socket.emit('callUser', {
        userToCall: currentChatUser._id,
        from: currentUser._id,
        username: currentUser.username,
        profilePic: currentUser.profilePic
    });

    updateCallButtons();
}

function showCallOverlay() {
    const overlay = document.getElementById('call-overlay');
    overlay.classList.remove('hidden');
    overlay.style.display = 'flex';
    overlay.classList.remove('minimized');
}

socket.on('callUser', (data) => {
    callIncomingData = data;
    const modal = document.getElementById('incoming-call-modal');
    modal.style.display = 'flex';
    document.getElementById('incoming-username').textContent = data.username;
    const pfp = document.getElementById('incoming-pfp');
    if (pfp) pfp.src = data.profilePic || 'https://via.placeholder.com/100';
    playNotificationSound(true);
});

// Answer Call (Callee side)
async function answerCall() {
    document.getElementById('incoming-call-modal').style.display = 'none';
    showCallOverlay();
    document.getElementById('call-status-text').textContent = 'Connecting...';

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (e) {
        alert("Microphone access is required.");
        endCall();
        return;
    }

    socket.emit('answerCall', { to: callIncomingData.from });
    // Callee waits for Caller to start the offer
}

function rejectCall() {
    document.getElementById('incoming-call-modal').style.display = 'none';
    socket.emit('rejectCall', { to: callIncomingData.from });
    callIncomingData = null;
}

socket.on('callRejected', () => {
    alert('Call Declined');
    endCall(true);
});

socket.on('callAccepted', (data) => {
    document.getElementById('call-status-text').textContent = 'Connecting...';
    // Only Caller initiates
    if (!peerConnection) {
        const targetId = callIncomingData ? callIncomingData.from : currentChatUser._id;
        createPeerConnection(targetId, true);
    }
});

socket.on('callEnded', () => {
    endCall(true);
});

// WebRTC Signaling Handlers
socket.on('offer', async (data) => {
    console.log("Offer received from:", data.from);
    if (!peerConnection) {
        createPeerConnection(data.from, false);
    }

    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.signal));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.emit('answer', { to: data.from, signal: answer });
    } catch (e) { console.error("Error handling offer", e); }
});

socket.on('answer', async (data) => {
    console.log("Answer received");
    if (peerConnection) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.signal));
        document.getElementById('call-status-text').textContent = 'Connected';
    }
});

socket.on('ice-candidate', async (data) => {
    if (peerConnection) {
        try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (e) { console.warn("ICE candidate error", e); }
    }
});

function createPeerConnection(targetId, isInitiator) {
    if (peerConnection) return;
    console.log("Creating PeerConnection. Initiator:", isInitiator);

    peerConnection = new RTCPeerConnection(rtcConfig);

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', { to: targetId, candidate: event.candidate });
        }
    };

    peerConnection.ontrack = (event) => {
        console.log("Remote track detected:", event.track.kind);
        const remoteVideo = document.getElementById('remote-video');
        const container = document.getElementById('remote-video-container');

        if (event.track.kind === 'video') {
            let overlay = container.querySelector('.stream-overlay');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.className = 'stream-overlay';
                overlay.innerHTML = `
                    <h3>Remote is Screen Sharing</h3>
                    <button onclick="this.parentElement.style.display='none'; document.getElementById('remote-video').play()">Watch Stream</button>
                 `;
                container.appendChild(overlay);
            } else {
                overlay.style.display = 'flex';
            }
        }

        if (remoteVideo) {
            remoteVideo.srcObject = event.streams[0];
            remoteVideo.play().catch(e => console.warn("Auto-play blocked", e));
        }
    };

    peerConnection.onconnectionstatechange = () => {
        console.log("Connection State:", peerConnection.connectionState);
        if (peerConnection.connectionState === 'connected') {
            document.getElementById('call-status-text').textContent = 'Connected';
        }
    };

    if (localStream) {
        localStream.getTracks().forEach(track => {
            console.log("Adding local track:", track.kind);
            peerConnection.addTrack(track, localStream);
        });
    }

    if (isInitiator) {
        peerConnection.onnegotiationneeded = async () => {
            try {
                console.log("Negotiation needed, creating offer...");
                const offer = await peerConnection.createOffer();
                await peerConnection.setLocalDescription(offer);
                socket.emit('offer', { to: targetId, signal: offer, from: currentUser._id });
            } catch (e) { console.error(e); }
        };
    }
}

async function toggleCam() {
    if (!localStream) return;
    let vidTrack = localStream.getVideoTracks()[0];

    if (vidTrack) {
        vidTrack.enabled = !vidTrack.enabled;
        document.getElementById('btn-cam').classList.toggle('active', !vidTrack.enabled);
    } else {
        try {
            const videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
            const newTrack = videoStream.getVideoTracks()[0];
            localStream.addTrack(newTrack);
            if (peerConnection) {
                peerConnection.addTrack(newTrack, localStream);
                // Trigger negotiation
                const offer = await peerConnection.createOffer();
                await peerConnection.setLocalDescription(offer);
                const target = callIncomingData ? callIncomingData.from : currentChatUser._id;
                socket.emit('offer', { to: target, signal: offer, from: currentUser._id });
            }
            const localVid = document.getElementById('local-video');
            if (localVid) {
                localVid.srcObject = localStream;
                localVid.play().catch(e => console.warn(e));
            }
        } catch (e) { alert("Camera access denied."); }
    }
}

async function toggleScreenShare() {
    try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const screenTrack = stream.getVideoTracks()[0];
        if (peerConnection) {
            const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
            if (sender) {
                sender.replaceTrack(screenTrack);
            } else {
                peerConnection.addTrack(screenTrack, stream);
                const offer = await peerConnection.createOffer();
                await peerConnection.setLocalDescription(offer);
                const target = callIncomingData ? callIncomingData.from : currentChatUser._id;
                socket.emit('offer', { to: target, signal: offer, from: currentUser._id });
            }
        }
        const localVid = document.getElementById('local-video');
        if (localVid) localVid.srcObject = stream;
        screenTrack.onended = () => {
            if (localStream) {
                const camTrack = localStream.getVideoTracks()[0];
                if (peerConnection) {
                    const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
                    if (sender && camTrack) sender.replaceTrack(camTrack);
                }
                if (localVid) localVid.srcObject = localStream;
            }
        };
    } catch (err) { console.error(err); }
}

function endCall(isRemote = false) {
    const overlay = document.getElementById('call-overlay');
    if (overlay) overlay.classList.add('hidden');
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    const targetId = callIncomingData ? callIncomingData.from : (currentChatUser ? currentChatUser._id : null);
    if (!isRemote && targetId) {
        socket.emit('endCall', { to: targetId });
    }
    callIncomingData = null;
    isMuted = false;
    isDeafened = false;
}

function toggleMute() {
    isMuted = !isMuted;
    if (localStream) {
        localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
    }
    updateCallButtons();
}

function toggleDeafen() {
    isDeafened = !isDeafened;
    const remoteVideo = document.getElementById('remote-video');
    if (remoteVideo) remoteVideo.muted = isDeafened;
    updateCallButtons();
}

function updateCallButtons() {
    const btnMute = document.getElementById('btn-mute');
    const btnDeaf = document.getElementById('btn-deafen');
    if (btnMute) btnMute.classList.toggle('active', isMuted);
    if (btnDeaf) btnDeaf.classList.toggle('active', isDeafened);
}
