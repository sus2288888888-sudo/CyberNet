
/* --- AFK Logic --- */
function setupAFKListeners() {
    resetAFKTimer();
    window.addEventListener('mousemove', resetAFKTimer);
    window.addEventListener('keydown', resetAFKTimer);
    window.addEventListener('click', resetAFKTimer);
}

function resetAFKTimer() {
    if (userStatus === 'idle') {
        // Only revert if we were auto-idle
        userStatus = 'online';
        // console.log('Welcome back!');
    }
    clearTimeout(afkTimeout);
    afkTimeout = setTimeout(() => {
        if (userStatus === 'online') {
            userStatus = 'idle';
            console.log('User is now AFK');
        }
    }, AFK_DELAY);
}

/* --- Call Logic --- */
async function startCall() {
    if (!currentChatUser) return alert('Select a user to call!');

    document.getElementById('call-overlay').classList.remove('hidden');
    document.getElementById('call-overlay').style.display = 'flex';
    document.getElementById('call-status-text').textContent = `In Call with ${currentChatUser.username}`;

    try {
        callStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        // In a real app we would send this stream via WebRTC
        // For now, visual feedback
        updateCallButtons();
    } catch (err) {
        console.error("Mic access denied", err);
        alert("Could not access microphone.");
        endCall();
    }
}

function endCall() {
    document.getElementById('call-overlay').classList.add('hidden');
    document.getElementById('call-overlay').style.display = 'none';
    if (callStream) {
        callStream.getTracks().forEach(track => track.stop());
        callStream = null;
    }
    isMuted = false;
    isDeafened = false;
    updateCallButtons();
}

function toggleMute() {
    isMuted = !isMuted;
    if (callStream) {
        callStream.getAudioTracks().forEach(track => track.enabled = !isMuted);
    }
    updateCallButtons();
}

function toggleDeafen() {
    isDeafened = !isDeafened;
    // Visually show deafen state
    updateCallButtons();
}

async function toggleScreenShare() {
    try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });

        const videoContainer = document.getElementById('remote-video-container');
        // Clear previous content
        videoContainer.innerHTML = '';

        const video = document.createElement('video');
        video.srcObject = stream;
        video.autoplay = true;
        video.style.maxWidth = '100%';
        video.style.maxHeight = '100%';
        video.style.borderRadius = '12px';
        videoContainer.appendChild(video);

        // Handle stop sharing
        stream.getVideoTracks()[0].onended = () => {
            videoContainer.innerHTML = '<p style="color: #666;">Remote Video / Audio Stream</p>';
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
