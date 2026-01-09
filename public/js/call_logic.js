
/* --- WebRTC Call Logic (Features: PIP, Watch Stream, Status Mismatch Fix) --- */
let localStream = null;
let peerConnection = null;
let callIncomingData = null;
let isScreenSharing = false;

const rtcConfig = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

async function startCall() {
    if (!currentChatUser) return alert('Select a user to call!');

    // Emit call signal
    socket.emit('callUser', {
        userToCall: currentChatUser._id,
        from: currentUser._id,
        username: currentUser.username,
        profilePic: currentUser.profilePic
    });

    // Show Call Overlay (PIP Style)
    showCallOverlay();
    document.getElementById('call-status-text').textContent = `Calling ${currentChatUser.username}...`;
    updateCallButtons();
}

function showCallOverlay() {
    const overlay = document.getElementById('call-overlay');
    overlay.classList.remove('hidden');
    overlay.style.display = 'flex';
    // Ensure it's not minimized initially if desired, or keep user preference
    overlay.classList.remove('minimized');
}

// User Receiving Call
socket.on('callUser', (data) => {
    callIncomingData = data;
    const modal = document.getElementById('incoming-call-modal');
    modal.style.display = 'flex';
    document.getElementById('incoming-username').textContent = data.username;

    const pfp = document.getElementById('incoming-pfp');
    if (pfp) pfp.src = data.profilePic || 'https://via.placeholder.com/100';

    // Force play sound regardless of context
    playNotificationSound(true);
});

// Force play helper (modify main.js logic to accept force flag or duplicate logic here)
// For now, we reuse main.js function but assuming it might block based on Focus
// We will override this by ensuring we call valid AudioContext
function playRing() {
    // Simple ringer
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(400, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(600, ctx.currentTime + 0.5);
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 1);
    osc.start();
    osc.stop(ctx.currentTime + 1);
}

async function answerCall() {
    document.getElementById('incoming-call-modal').style.display = 'none';
    showCallOverlay();
    document.getElementById('call-status-text').textContent = 'Connecting...';

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        const localVideo = document.getElementById('local-video');
        if (localVideo) {
            localVideo.srcObject = localStream;
            localVideo.muted = true;
        }
    } catch (e) {
        console.error("No mic/cam", e);
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (err2) {
            alert("Could not access media devices");
            endCall();
            return;
        }
    }

    // Initiate WebRTC
    // FIX: Emit 'answerCall' event so Caller knows we accepted
    socket.emit('answerCall', { to: callIncomingData.from });

    createPeerConnection(callIncomingData.from, true);
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

socket.on('callAccepted', (signal) => {
    document.getElementById('call-status-text').textContent = 'Connected';
    // Caller logic: we are already waiting for 'offer' theoretically if Callee initiates
    // OR we just update UI here.
});

socket.on('callEnded', () => {
    endCall(true);
});

socket.on('offer', async (data) => {
    if (!peerConnection) {
        try {
            if (!localStream) {
                localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
                const localVideo = document.getElementById('local-video');
                if (localVideo) {
                    localVideo.srcObject = localStream;
                    localVideo.muted = true;
                }
            }
        } catch (e) { console.error(e); }

        createPeerConnection(data.from, false);
    }

    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.signal));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    socket.emit('answer', { to: data.from, signal: answer });
});

socket.on('answer', async (data) => {
    await peerConnection.setLocalDescription(new RTCSessionDescription(data.signal));
    document.getElementById('call-status-text').textContent = 'Connected';
});

socket.on('ice-candidate', async (candidate) => {
    if (peerConnection) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }
});

function createPeerConnection(targetId, isInitiator) {
    peerConnection = new RTCPeerConnection(rtcConfig);

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', { to: targetId, candidate: event.candidate });
        }
    };

    peerConnection.ontrack = (event) => {
        const remoteVideo = document.getElementById('remote-video');
        const container = document.getElementById('remote-video-container');

        // WATCH STREAM LOGIC
        // If it's a video track, show "Watch Stream" overlay first
        if (event.track.kind === 'video') {
            // Create Overlay if not exists
            let overlay = container.querySelector('.stream-overlay');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.className = 'stream-overlay';
                overlay.innerHTML = `
                    <h3>User is Sharing Video</h3>
                    <button onclick="this.parentElement.style.display='none'; document.getElementById('remote-video').play()">Watch Stream</button>
                 `;
                container.appendChild(overlay);
            } else {
                overlay.style.display = 'flex';
            }
        }

        if (remoteVideo) remoteVideo.srcObject = event.streams[0];
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

function endCall(isRemote = false) {
    document.getElementById('call-overlay').classList.add('hidden');
    document.getElementById('call-overlay').style.display = 'none';

    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }

    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }

    if (!isRemote && currentChatUser) {
        socket.emit('endCall', { to: currentChatUser._id });
    }

    isMuted = false;
    isDeafened = false;
    updateCallButtons();
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

function toggleCam() {
    if (localStream) {
        const vidTrack = localStream.getVideoTracks()[0];
        if (vidTrack) vidTrack.enabled = !vidTrack.enabled;
    }
}

async function toggleScreenShare() {
    try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const screenTrack = stream.getVideoTracks()[0];

        if (peerConnection) {
            const sender = peerConnection.getSenders().find(s => s.track.kind === 'video');
            if (sender) sender.replaceTrack(screenTrack);
        }

        const localVideo = document.getElementById('local-video');
        if (localVideo) localVideo.srcObject = stream;

        screenTrack.onended = () => {
            if (localStream) {
                const camTrack = localStream.getVideoTracks()[0];
                if (peerConnection) {
                    const sender = peerConnection.getSenders().find(s => s.track.kind === 'video');
                    if (sender) sender.replaceTrack(camTrack);
                }
                if (localVideo) localVideo.srcObject = localStream;
            }
        };
    } catch (err) {
        console.error("Screenshare cancelled", err);
    }
}

function updateCallButtons() {
    const btnMute = document.getElementById('btn-mute');
    const btnDeaf = document.getElementById('btn-deafen');

    if (btnMute) {
        if (isMuted) {
            btnMute.classList.add('active');
            btnMute.textContent = 'Unmute';
        } else {
            btnMute.classList.remove('active');
            btnMute.textContent = 'Mute Mic';
        }
    }

    if (btnDeaf) {
        if (isDeafened) {
            btnDeaf.classList.add('active');
            btnDeaf.textContent = 'Undeafen';
        } else {
            btnDeaf.classList.remove('active');
            btnDeaf.textContent = 'Deafen';
        }
    }
}
