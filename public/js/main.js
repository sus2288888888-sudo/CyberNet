const token = localStorage.getItem('token');
if (!token) {
    window.location.href = '/';
}

const socket = io();
let currentUser = null;
let currentChatUser = null; // The user we are talking to
let unreadCounts = {}; // Track unread messages

// New State
let userStatus = 'online'; // online, idle, dnd
let isMuted = false;
let isDeafened = false;
let afkTimeout;
let callStream = null;
const AFK_DELAY = 5 * 60 * 1000; // 5 minutes

// UI Elements
const profileUsername = document.getElementById('profile-username');
const profileBio = document.getElementById('profile-bio');
const profilePic = document.getElementById('profile-pic');
const searchInput = document.getElementById('user-search');
const searchResults = document.getElementById('search-results');
const messagesContainer = document.getElementById('messages-container');
const messageInput = document.getElementById('message-input');
const chatHeader = document.getElementById('current-chat-user');

// Initialize
async function init() {
    try {
        const res = await fetch('/api/me', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('Auth Failed');
        currentUser = await res.json();

        // Setup Profile
        profileUsername.textContent = currentUser.username;
        profileBio.textContent = currentUser.bio;
        profilePic.src = currentUser.profilePic && (currentUser.profilePic.startsWith('http') || currentUser.profilePic.startsWith('/')) ? currentUser.profilePic : 'https://via.placeholder.com/50/0f0/000?text=USER';

        // Connect Socket
        socket.emit('join', currentUser._id);

        // Fetch Friends and Requests
        fetchFriendsAndRequests();

        // Load saved settings
        const savedStatus = localStorage.getItem('userStatus');
        if (savedStatus) userStatus = savedStatus;
        setupAFKListeners();

    } catch (err) {
        console.error(err);
        localStorage.removeItem('token');
        window.location.href = '/';
    }
}

init();

// Drag and Drop
const dropzone = document.getElementById('chat-dropzone');
const dragOverlay = dropzone.querySelector('.drag-overlay');

dropzone.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dropzone.classList.add('drag-active');
});

dropzone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    if (e.relatedTarget && !dropzone.contains(e.relatedTarget)) {
        dropzone.classList.remove('drag-active');
    }
});

dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
});

dropzone.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-active');

    if (!currentChatUser) return alert('Select a chat first!');

    if (e.dataTransfer.files.length) {
        await handleFiles(e.dataTransfer.files);
    }
});

// File Input Change
document.getElementById('media-input').addEventListener('change', async (e) => {
    if (e.target.files.length) {
        await handleFiles(e.target.files);
    }
});

async function handleFiles(files) {
    for (const file of files) {
        // Show indicator
        const uploadId = 'upload-' + Date.now();
        const tempDiv = document.createElement('div');
        tempDiv.id = uploadId;
        tempDiv.className = 'message own';
        tempDiv.style.opacity = '0.7';
        tempDiv.innerHTML = `<div style="display:flex; align-items:center; gap:10px;">
                                <div class="loader"></div>
                                <span>Uploading ${file.name}...</span>
                             </div>`;
        messagesContainer.appendChild(tempDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;

        const formData = new FormData();
        formData.append('file', file);

        try {
            // Upload to server first
            const res = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });
            const data = await res.json();

            // Remove temp indicator
            const el = document.getElementById(uploadId);
            if (el) el.remove();

            if (!res.ok) throw new Error(data.message);

            // Determine Media Type
            let mediaType = 'file';
            if (file.type.startsWith('image/')) mediaType = 'image';
            else if (file.type.startsWith('video/')) mediaType = 'video';
            else if (file.type.startsWith('audio/')) mediaType = 'audio';

            // Send Message
            const msgData = {
                senderId: currentUser._id,
                receiverId: currentChatUser._id,
                content: mediaType === 'file' ? data.name : '',
                media: data.url,
                mediaType: mediaType,
                fileName: data.name
            };

            socket.emit('sendMessage', msgData);
            appendMessage(msgData, true);

        } catch (err) {
            console.error(err);
            const el = document.getElementById(uploadId);
            if (el) {
                el.style.backgroundColor = 'var(--danger)';
                el.innerHTML = `Failed: ${err.message}`;
            }
        }
    }
}

async function fetchFriendsAndRequests() {
    const res = await fetch('/api/friends', {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();

    // Render Friends
    const friendsList = document.getElementById('friends-list');
    friendsList.innerHTML = '';
    data.friends.forEach(friend => {
        const div = document.createElement('div');
        div.className = 'user-item';
        // Add individual badge logic here if needed
        let badgeHtml = '';
        if (unreadCounts[friend._id] > 0) {
            badgeHtml = `<span class="badge" style="display:inline-flex; width:20px; height:20px;">${unreadCounts[friend._id]}</span>`;
        }

        div.innerHTML = `
            <div style="display:flex; align-items:center;">
                <img src="${friend.profilePic || 'https://via.placeholder.com/40'}" style="width:30px; height:30px; border-radius:50%; margin-right:10px; object-fit:cover;">
                <span>${friend.username}</span>
                ${badgeHtml}
            </div>
            <span style="font-size: 0.7em; color: var(--success-color)">●</span>
        `;
        div.onclick = () => openChat(friend);
        friendsList.appendChild(div);
    });

    // Render Requests
    const reqArea = document.getElementById('notifications-area');
    const reqList = document.getElementById('requests-list');
    reqList.innerHTML = '';

    if (data.friendRequests.length > 0) {
        reqArea.style.display = 'block';
        data.friendRequests.forEach(req => {
            const div = document.createElement('div');
            div.style.marginBottom = '8px';
            div.style.fontSize = '0.85rem';
            div.innerHTML = `
                <div style="display:flex; align-items:center; margin-bottom:5px;">
                     <strong style="color:white; margin-right:5px;">${req.username}</strong> wants to connect
                </div>
                <button onclick="acceptRequest('${req._id}')" style="font-size:0.7rem; padding: 4px 8px; width:auto; border-radius:6px; margin-right:5px;">Accept</button>
                <button onclick="declineRequest('${req._id}')" style="font-size:0.7rem; padding: 4px 8px; width:auto; border-radius:6px; background:rgba(255,59,48,0.2); color:#ff3b30;">Decline</button>
            `;
            reqList.appendChild(div);
        });
    } else {
        reqArea.style.display = 'none';
    }
}

// Socket listener for new requests
socket.on('friendRequestReceived', (data) => {
    playNotificationSound();
    alert(`Incoming request from ${data.username}`);
    fetchFriendsAndRequests();
});

// Search Users
async function searchUsers() {
    const query = searchInput.value;
    if (query.length < 2) {
        searchResults.innerHTML = '';
        return;
    }

    const res = await fetch(`/api/search?username=${query}`);
    const users = await res.json();

    searchResults.innerHTML = '';
    users.forEach(user => {
        if (user._id === currentUser._id) return;
        const div = document.createElement('div');
        div.className = 'user-item';
        div.innerHTML = `
            <span>${user.username}</span>
            <button onclick="sendFriendRequest('${user._id}', event)" style="width: auto; padding: 4px 8px; font-size: 0.7rem;">Add</button>
        `;
        div.onclick = (e) => {
            if (e.target.tagName !== 'BUTTON') openChat(user);
        }
        searchResults.appendChild(div);
    });
}

async function sendFriendRequest(targetId, event) {
    if (event) event.stopPropagation();
    try {
        const res = await fetch('/api/friend-request', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ targetUserId: targetId })
        });
        const data = await res.json();
        alert(data.message);
    } catch (err) {
        console.error(err);
    }
}

async function acceptRequest(senderId) {
    try {
        const res = await fetch('/api/friend-request/accept', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ senderId })
        });
        const data = await res.json();
        fetchFriendsAndRequests();
    } catch (err) {
        console.error(err);
    }
}

async function declineRequest(senderId) {
    try {
        const res = await fetch('/api/friend-request/decline', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ senderId })
        });
        const data = await res.json();
        fetchFriendsAndRequests();
    } catch (err) {
        console.error(err);
    }
}


async function openChat(user) {
    currentChatUser = user;
    // Clear unreads
    unreadCounts[user._id] = 0;
    fetchFriendsAndRequests(); // Re-render to clear badge

    chatHeader.innerHTML = `<h2 style="margin:0">${user.username}</h2>`;
    document.getElementById('header-actions').style.display = 'block';

    messagesContainer.innerHTML = '';

    // Fetch History
    try {
        const res = await fetch(`/api/messages/${user._id}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const messages = await res.json();

        messages.forEach(msg => {
            appendMessage(msg, msg.sender === currentUser._id);
        });
    } catch (err) {
        console.error(err);
    }
}

function sendMessage() {
    if (!currentChatUser) return alert('Select a user to chat with first.');
    const content = messageInput.value;
    if (!content) return;

    const msgData = {
        senderId: currentUser._id,
        receiverId: currentChatUser._id,
        content: content,
        media: '',
        mediaType: 'none',
        fileName: ''
    };

    socket.emit('sendMessage', msgData);
    appendMessage(msgData, true);
    messageInput.value = '';
}

// Enter to send
messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        sendMessage();
    }
});

function appendMessage(msg, isOwn) {
    const div = document.createElement('div');
    div.className = `message ${isOwn ? 'own' : ''}`;

    let contentHtml = '';
    // Text (handle legacy messages too)
    const textContent = msg.content || '';

    // If it's a file type but has content, treat content as filename/description
    if (msg.mediaType === 'file') {
        contentHtml = `
            <a href="${msg.media}" target="_blank" download class="message-file">
                <span style="font-size:1.5rem">📄</span>
                <div style="text-align:left">
                    <div style="font-weight:bold; word-break:break-word;">${textContent || 'Document'}</div>
                    <div style="font-size:0.7rem; opacity:0.7">Click to download</div>
                </div>
            </a>
        `;
    } else {
        if (textContent) {
            contentHtml += `<p>${textContent}</p>`;
        }
    }

    // Media
    if (msg.mediaType === 'image') {
        contentHtml += `<a href="${msg.media}" target="_blank"><img src="${msg.media}"></a>`;
    } else if (msg.mediaType === 'video') {
        contentHtml += `<video controls src="${msg.media}"></video>`;
    } else if (msg.mediaType === 'audio') {
        contentHtml += `<audio controls src="${msg.media}"></audio>`;
    }

    div.innerHTML = contentHtml;
    messagesContainer.appendChild(div);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Notification Sound (Oscillator)
function playNotificationSound() {
    if (isDeafened || userStatus === 'dnd') return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = 'sine';
    osc.frequency.setValueAtTime(500, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1000, ctx.currentTime + 0.1);

    gain.gain.setValueAtTime(0.05, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);

    osc.start();
    osc.stop(ctx.currentTime + 0.2);
}

// Global Message Listener
socket.on('newMessage', (msg) => {
    // Check if it's relevant to current chat
    if (currentChatUser && (msg.sender === currentChatUser._id || msg.sender === currentUser._id)) {
        if (msg.sender === currentUser._id) return; // Already appended
        appendMessage(msg, false);
        playNotificationSound(); // Optional: play sound even if open?
    } else {
        // Notification for other chats
        if (msg.sender !== currentUser._id) {
            playNotificationSound();
            // Increment unread for that user
            if (!unreadCounts[msg.sender]) unreadCounts[msg.sender] = 0;
            unreadCounts[msg.sender]++;

            // Update UI
            fetchFriendsAndRequests();

            // Update Title
            document.title = `(1) CyberNet`;
            setTimeout(() => document.title = 'CyberNet', 3000);
        }
    }
});

function logout() {
    localStorage.removeItem('token');
    window.location.href = '/';
}

function toggleSettings() {
    const modal = document.getElementById('settings-modal');
    modal.style.display = modal.style.display === 'none' ? 'flex' : 'none';

    // Load current values
    if (modal.style.display === 'flex') {
        document.getElementById('set-status').value = userStatus;
        document.getElementById('vol-input').value = localStorage.getItem('vol-input') || 100;
        document.getElementById('vol-output').value = localStorage.getItem('vol-output') || 100;
    }
}

document.getElementById('settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const newUsername = document.getElementById('set-username').value;
    const newBio = document.getElementById('set-bio').value;
    const newPfp = document.getElementById('set-pfp').files[0];

    const formData = new FormData();
    if (newUsername) formData.append('username', newUsername);
    if (newBio) formData.append('bio', newBio);
    if (newPfp) formData.append('profilePic', newPfp);

    const res = await fetch('/api/me', {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
    });

    if (res.ok) {
        // Save local settings
        const newStatus = document.getElementById('set-status').value;
        userStatus = newStatus;
        localStorage.setItem('userStatus', newStatus);

        localStorage.setItem('vol-input', document.getElementById('vol-input').value);
        localStorage.setItem('vol-output', document.getElementById('vol-output').value);

        alert('Profile & Settings Updated');
        location.reload();
    }
});
