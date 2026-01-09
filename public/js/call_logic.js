
/* --- WebRTC Call Logic (Robust Signaling + Candidate Queuing + Mode Toggle) --- */
let localStream = null;
let peerConnection = null;
let activeCallPartnerId = null;
let screenStream = null;
let isFocusMode = false;
let iceCandidateQueue = [];

const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// Start a call (Caller side)
async function startCall() {
    if (!currentChatUser) return alert('Select a user to call!');
    activeCallPartnerId = currentChatUser._id;

    showCallOverlay();
    updateStatus('Initializing media...');

    try {
        // Get both initially to avoid permission loops
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        // Start with video disabled
        localStream.getVideoTracks().forEach(t => t.enabled = false);
    } catch (e) {
        console.warn("Cam/Mic failed, trying audio only", e);
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (err) {
            alert("Mic access denied. Cannot call.");
            endCall();
            return;
        }
    }

    const localVid = document.getElementById('local-video');
    if (localVid) localVid.srcObject = localStream;

    updateStatus(`Ringing ${currentChatUser.username}...`);
    socket.emit('callUser', {
        userToCall: activeCallPartnerId,
        from: currentUser._id,
        username: currentUser.username,
        profilePic: currentUser.profilePic
    });
}

// User Receiving Call (Callee)
socket.on('callUser', (data) => {
    activeCallPartnerId = data.from;
    const modal = document.getElementById('incoming-call-modal');
    modal.style.display = 'flex';
    document.getElementById('incoming-username').textContent = data.username;
    const pfp = document.getElementById('incoming-pfp');
    if (pfp) pfp.src = data.profilePic || 'https://via.placeholder.com/100';
    playNotificationSound(true);
});

// Answer Call (Callee)
async function answerCall() {
    document.getElementById('incoming-call-modal').style.display = 'none';
    showCallOverlay();
    updateStatus('Connecting...');

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        localStream.getVideoTracks().forEach(t => t.enabled = false);
    } catch (e) {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (err) {
            alert("Mic access required.");
            endCall();
            return;
        }
    }

    const localVid = document.getElementById('local-video');
    if (localVid) localVid.srcObject = localStream;

    socket.emit('answerCall', { to: activeCallPartnerId });
}

// Caller side receives this when Callee answers
socket.on('callAccepted', () => {
    console.log("Call Accepted, starting connection...");
    initiateWebRTC(true);
});

async function initiateWebRTC(isInitiator) {
    if (peerConnection) return;
    peerConnection = new RTCPeerConnection(rtcConfig);

    // Track handling
    if (localStream) {
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
    }

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', { to: activeCallPartnerId, candidate: event.candidate });
        }
    };

    peerConnection.ontrack = (event) => {
        console.log("Remote track received:", event.track.kind);
        const remoteVideo = document.getElementById('remote-video');
        const container = document.getElementById('remote-video-container');

        if (event.track.kind === 'video') {
            let overlay = container.querySelector('.stream-overlay');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.className = 'stream-overlay';
                overlay.innerHTML = `
                    <div style="background: rgba(0,0,0,0.8); padding: 20px; border-radius: 12px; border: 1px solid var(--primary);">
                        <p style="color:white; margin-bottom:10px;">User is sharing video</p>
                        <button onclick="this.parentElement.parentElement.style.display='none'; document.getElementById('remote-video').play()" 
                                style="background: var(--primary); border:none; padding: 8px 16px; border-radius: 4px; color:black; font-weight:bold; cursor:pointer;">WATCH</button>
                    </div>
                 `;
                container.appendChild(overlay);
            } else {
                overlay.style.display = 'flex';
            }
        }

        if (remoteVideo) {
            remoteVideo.srcObject = event.streams[0] || new MediaStream([event.track]);
            remoteVideo.muted = false;
            remoteVideo.play().catch(e => console.warn("Play blocked", e));
        }
    };

    peerConnection.onconnectionstatechange = () => {
        const s = peerConnection.connectionState;
        console.log("PC State:", s);
        if (s === 'connected') updateStatus('Connected');
        if (s === 'failed') endCall(true);
    };

    if (isInitiator) {
        try {
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            socket.emit('offer', { to: activeCallPartnerId, signal: offer, from: currentUser._id });
        } catch (e) { console.error("Offer Fail", e); }
    }
}

// Signaling Handlers
socket.on('offer', async (data) => {
    console.log("Offer received");
    if (!peerConnection) await initiateWebRTC(false);

    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.signal));
        // Process queued candidates
        while (iceCandidateQueue.length > 0) {
            const cand = iceCandidateQueue.shift();
            await peerConnection.addIceCandidate(new RTCIceCandidate(cand));
        }

        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.emit('answer', { to: data.from, signal: answer });
    } catch (e) { console.error("Offer/Answer Handshake Fail", e); }
});

socket.on('answer', async (data) => {
    console.log("Answer received");
    if (peerConnection) {
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.signal));
            updateStatus('Connected');
            // Process queued candidates
            while (iceCandidateQueue.length > 0) {
                const cand = iceCandidateQueue.shift();
                await peerConnection.addIceCandidate(new RTCIceCandidate(cand));
            }
        } catch (e) { console.error("Answer Set Fail", e); }
    }
});

socket.on('ice-candidate', async (data) => {
    if (peerConnection && peerConnection.remoteDescription) {
        try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(data));
        } catch (e) { }
    } else {
        iceCandidateQueue.push(data);
    }
});

socket.on('callRejected', () => { alert('Call Declined'); endCall(true); });
socket.on('callEnded', () => { endCall(true); });

// --- UI Helpers ---

function updateStatus(text) {
    const el = document.getElementById('call-status-text');
    if (el) el.textContent = text;
}

function showCallOverlay() {
    const overlay = document.getElementById('call-overlay');
    overlay.classList.remove('hidden');
    overlay.style.display = 'flex';
}

function toggleFocus() {
    const overlay = document.getElementById('call-overlay');
    const btn = document.getElementById('btn-fullscreen');
    isFocusMode = !isFocusMode;
    if (isFocusMode) {
        overlay.classList.add('focus-mode');
        if (btn) btn.textContent = 'PIP';
    } else {
        overlay.classList.remove('focus-mode');
        if (btn) btn.textContent = 'Focus';
    }
}

// Override the main.html fullscreen with a more flexible focus/pip toggle
function toggleFullScreen() {
    toggleFocus();
}

async function toggleCam() {
    if (!localStream) return;
    let vt = localStream.getVideoTracks()[0];
    if (vt) {
        vt.enabled = !vt.enabled;
        document.getElementById('btn-cam').classList.toggle('active', vt.enabled);
    }
}

async function toggleScreenShare() {
    if (screenStream) {
        screenStream.getTracks().forEach(t => t.stop());
        screenStream = null;
        if (peerConnection) {
            const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
            if (sender) sender.replaceTrack(localStream.getVideoTracks()[0] || null);
        }
        document.getElementById('local-video').srcObject = localStream;
        return;
    }
    try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const st = screenStream.getVideoTracks()[0];
        if (peerConnection) {
            const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
            if (sender) {
                sender.replaceTrack(st);
            } else {
                peerConnection.addTrack(st, screenStream);
                // Renegotiate
                const offer = await peerConnection.createOffer();
                await peerConnection.setLocalDescription(offer);
                socket.emit('offer', { to: activeCallPartnerId, signal: offer, from: currentUser._id });
            }
        }
        document.getElementById('local-video').srcObject = screenStream;
        st.onended = () => { if (screenStream) toggleScreenShare(); };
    } catch (err) { }
}

function endCall(isRemote = false) {
    const overlay = document.getElementById('call-overlay');
    if (overlay) {
        overlay.classList.add('hidden');
        overlay.classList.remove('focus-mode');
    }
    if (peerConnection) { peerConnection.close(); peerConnection = null; }
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    if (screenStream) { screenStream.getTracks().forEach(t => t.stop()); screenStream = null; }
    if (!isRemote && activeCallPartnerId) socket.emit('endCall', { to: activeCallPartnerId });
    activeCallPartnerId = null;
    iceCandidateQueue = [];
    isFocusMode = false;
}

function toggleMute() {
    isMuted = !isMuted;
    if (localStream) localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
    document.getElementById('btn-mute').classList.toggle('active', isMuted);
}

function toggleDeafen() {
    isDeafened = !isDeafened;
    const rv = document.getElementById('remote-video');
    if (rv) rv.muted = isDeafened;
    document.getElementById('btn-deafen').classList.toggle('active', isDeafened);
}

function rejectCall() {
    document.getElementById('incoming-call-modal').style.display = 'none';
    if (activeCallPartnerId) socket.emit('rejectCall', { to: activeCallPartnerId });
    activeCallPartnerId = null;
}
