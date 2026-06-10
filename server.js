const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

// 1. Initialize Express and configure CORS permissions
const app = express();
app.use(cors({
    origin: "http://localhost:5173", // Grant access ONLY to your React Vite app
    methods: ["GET", "POST"]
}));

// 2. Create the standard HTTP Server using Express
const server = http.createServer(app);

// 3. Mount Socket.io onto our HTTP server instance
const io = new Server(server, {
    cors: {
        origin: "http://localhost:5173",
        methods: ["GET", "POST"]
    }
});

// 4. Memory Storage: Map database user IDs to active Socket connections
// Structure: { "user_id_from_mysql": "active_socket_id" }
let onlineUsers = {};

// 5. Establish the listener for active connections
io.on('connection', (socket) => {
    console.log('A user browser connected safely: ' + socket.id);

    // EVENT A: User comes online or logs in
   
    socket.on('join', (user) => {
        const userId = typeof user === 'object' && user !== null ? user.id : user;
        
        // Link their Database Primary Key ID to their changing Socket Connection ID
        onlineUsers[userId] = socket.id;
        
        // Broadcast the updated list of online user IDs back to everyone connected
        io.emit('getOnlineUsers', Object.keys(onlineUsers));
        
        // If a full user object was provided, broadcast it to other clients
        if (typeof user === 'object' && user !== null) {
            socket.broadcast.emit('userJoined', user);
            console.log(`User ${userId} (${user.name}) joined and broadcasted.`);
        } else {
            console.log(`User ${userId} linked to connection ${socket.id}`);
        }
    });

    // EVENT B: Sending a Live Private Message
    socket.on('sendMessage', (data) => {
        const { sender_id, receiver_id, message, created_at, id } = data;
        
        // Look up if the target receiver is currently online
        const receiverSocketId = onlineUsers[receiver_id]; 
        if (receiverSocketId) {  
            // Instantly push the message straight to the receiver's screen
            io.to(receiverSocketId).emit('getMessage', {
                id,
                sender_id,
                receiver_id,
                message,
                created_at
            });
        }
    });

    // EVENT C: Typing Indicators
    socket.on('typing', ({ senderId, receiverId, isTyping }) => {
        const receiverSocketId = onlineUsers[receiverId];
        if (receiverSocketId) {
            // Signal to the recipient whether the sender is currently typing or stopped
            io.to(receiverSocketId).emit('userTyping', { senderId, isTyping });
        }
    });

    socket.on('messageSeen', ({ senderId, receiverId }) => {
        console.log(`[Socket Server] Received messageSeen event. senderId: ${senderId}, receiverId: ${receiverId}`);
        const senderSocketId = onlineUsers[senderId];
        console.log(`[Socket Server] Looked up senderSocketId for senderId ${senderId}: ${senderSocketId}`);

        if (senderSocketId) { 
            console.log(`[Socket Server] Emitting messageSeenAck to senderSocketId ${senderSocketId} with receiverId ${receiverId}`);
            io.to(senderSocketId).emit('messageSeenAck', {
                receiverId
            });
        } else {
            console.warn(`[Socket Server] Sender ${senderId} is not online or socket not found in onlineUsers:`, Object.keys(onlineUsers));
        }
    });
  
    socket.on('disconnect', () => {
        console.log('A user disconnected: ' + socket.id);
         
        for (let userId in onlineUsers) {
            if (onlineUsers[userId] === socket.id) {
                delete onlineUsers[userId];
                break;
            }
        }
        // Tell everyone left online that the user list changed
        io.emit('getOnlineUsers', Object.keys(onlineUsers));
    });
});

// 6. Start listening on Port 3001
const PORT = 3001;
server.listen(PORT, () => {
    console.log(`Socket Server running natively on http://localhost:${PORT}`);
});