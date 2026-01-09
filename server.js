require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const http = require('http');
const socketIo = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const User = require('./models/User');
const Message = require('./models/Message');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Ensure uploads directory exists
if (!fs.existsSync('./uploads')) {
    fs.mkdirSync('./uploads');
}

// Storage for Multer
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/')
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname)
    }
});
const upload = multer({ storage: storage });

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('MongoDB Connected'))
    .catch(err => console.log(err));

// Routes

// Serve Pages
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'main.html'));
});

// Auth Routes
app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        const existingUser = await User.findOne({ username });
        if (existingUser) return res.status(400).json({ message: 'User already exists' });

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ username, password: hashedPassword });
        await newUser.save();
        res.status(201).json({ message: 'User registered successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username });
        if (!user) return res.status(400).json({ message: 'User not found' });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ message: 'Invalid credentials' });

        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET);
        res.json({ token, user: { id: user._id, username: user.username, profilePic: user.profilePic } });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// User Routes
app.get('/api/search', async (req, res) => {
    const { username } = req.query;
    try {
        const users = await User.find({ username: new RegExp(username, 'i') }).select('-password');
        res.json(users);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/me', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'No token' });
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id).select('-password');
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/me', upload.single('profilePic'), async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'No token' });
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const updates = { ...req.body };
        if (req.file) {
            updates.profilePic = '/uploads/' + req.file.filename;
        }
        const user = await User.findByIdAndUpdate(decoded.id, updates, { new: true }).select('-password');
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
    res.json({
        url: '/uploads/' + req.file.filename,
        type: req.file.mimetype,
        name: req.file.originalname,
        size: req.file.size
    });
});

// Friend Request Routes
app.post('/api/friend-request', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'No token' });
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const { targetUserId } = req.body;

        const targetUser = await User.findById(targetUserId);
        if (!targetUser) return res.status(404).json({ message: 'User not found' });

        if (targetUser.friendRequests.includes(decoded.id)) {
            return res.status(400).json({ message: 'Request already sent' });
        }
        if (targetUser.friends.includes(decoded.id)) {
            return res.status(400).json({ message: 'Already friends' });
        }

        targetUser.friendRequests.push(decoded.id);
        await targetUser.save();

        // Notify via Socket
        const senderFn = await User.findById(decoded.id).select('username profilePic');
        io.to(targetUserId).emit('friendRequestReceived', {
            senderId: decoded.id,
            username: senderFn.username,
            profilePic: senderFn.profilePic
        });

        res.json({ message: 'Friend request sent' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/friend-request/accept', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'No token' });
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const { senderId } = req.body;

        const user = await User.findById(decoded.id);
        const sender = await User.findById(senderId);

        if (!user.friendRequests.includes(senderId)) {
            return res.status(400).json({ message: 'No request found' });
        }

        user.friendRequests = user.friendRequests.filter(id => id.toString() !== senderId);
        user.friends.push(senderId);
        await user.save();

        sender.friends.push(decoded.id);
        await sender.save();

        res.json({ message: 'Friend request accepted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/friend-request/decline', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'No token' });
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const { senderId } = req.body;

        const user = await User.findById(decoded.id);
        user.friendRequests = user.friendRequests.filter(id => id.toString() !== senderId);
        await user.save();

        res.json({ message: 'Friend request declined' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/friends', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'No token' });
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id).populate('friends', '-password').populate('friendRequests', '-password');
        res.json({ friends: user.friends, friendRequests: user.friendRequests });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/messages/:otherUserId', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'No token' });
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const { otherUserId } = req.params;

        const messages = await Message.find({
            $or: [
                { sender: decoded.id, receiver: otherUserId },
                { sender: otherUserId, receiver: decoded.id }
            ]
        }).sort({ timestamp: 1 });

        res.json(messages);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Socket.io Logic
io.on('connection', (socket) => {
    console.log('New user connected');

    socket.on('join', (userId) => {
        socket.join(userId);
    });

    socket.on('sendMessage', async (data) => {
        // data: { senderId, receiverId, content, media, mediaType }
        try {
            const newMessage = new Message({
                sender: data.senderId,
                receiver: data.receiverId,
                content: data.content,
                media: data.media,
                mediaType: data.mediaType
            });
            await newMessage.save();

            // Emit to receiver
            io.to(data.receiverId).emit('newMessage', newMessage);
            // Emit back to sender (confirm)
            io.to(data.senderId).emit('newMessage', newMessage);
        } catch (err) {
            console.error(err);
        }
    });

    socket.on('disconnect', () => {
        console.log('user disconnected');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
