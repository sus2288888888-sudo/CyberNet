
/* --- WebRTC Call Logic (Overrides main.js stubs) --- */
let localStream = null;
let peerConnection = null;
let callIncomingData = null;

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

    // Show Call Overlay in "Calling..." state
    const overlay = document.getElementById('call-overlay');
    overlay.classList.remove('hidden');
    overlay.style.display = 'flex';
    document.getElementById('call-status-text').textContent = `Calling ${currentChatUser.username}...`;

    // Optional: Play calling sound
    updateCallButtons();
}

// User Receiving Call
socket.on('callUser', (data) => {
    callIncomingData = data;
    const modal = document.getElementById('incoming-call-modal');
    modal.style.display = 'flex';
    document.getElementById('incoming-username').textContent = data.username;

    const pfp = document.getElementById('incoming-pfp');
    if (pfp) pfp.src = data.profilePic || 'https://via.placeholder.com/100';

    playNotificationSound();
});

async function answerCall() {
    document.getElementById('incoming-call-modal').style.display = 'none';
    const overlay = document.getElementById('call-overlay');
    overlay.classList.remove('hidden');
    overlay.style.display = 'flex';
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
        // ... previously defined styling logic ...
        if (isDeafened) {
            btnDeaf.classList.add('active');
            btnDeaf.textContent = 'Undeafen';
        } else {
            btnDeaf.classList.remove('active');
            btnDeaf.textContent = 'Deafen';
        }
    }
}
