require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();

app.use(
  cors({
    origin: "http://localhost:5173", // Grant access ONLY to your React Vite app
    methods: ["GET", "POST"],
  }),
);
// app.use(
//   cors({
//     origin: ["https://live-chat-frontend-nu.vercel.app"], // <-- Replace with your real exact Vercel URL
//     methods: ["GET", "POST"],
//   }),
// );

const server = http.createServer(app);

 const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"],
  },
});
// const io = new Server(server, {
//   cors: {
//     origin: ["https://live-chat-frontend-nu.vercel.app"], // <-- Replace with your real exact Vercel URL
//     methods: ["GET", "POST"],
//   },
// });

// 4. Memory Storage: Map database user IDs to active Socket connections
// Structure: { "user_id_from_mysql": "active_socket_id" }
let onlineUsers = {};

const postUserOffline = (userId) => {
  const data = JSON.stringify({ user_id: userId });
  const options = {
    hostname: "127.0.0.1",
    port: 8000,
    path: "/api/users/offline",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(data),
    },
  };

  const req = http.request(options, (res) => {
    let body = "";
    res.on("data", (chunk) => {
      body += chunk;
    });
    res.on("end", () => {
      try {
        const parsed = JSON.parse(body);
        if (parsed.success) {
          console.log(
            `[Socket Server] Set user ${userId} offline in Laravel. Last seen: ${parsed.last_seen}`,
          );

          io.emit("userOffline", {
            userId: parsed.user_id,
            last_seen: parsed.last_seen,
          });
        } else {
          console.warn(
            "[Socket Server] Laravel returned non-success response:",
            parsed,
          );
        }
      } catch (err) {
        console.error(
          "[Socket Server] Error parsing response from Laravel:",
          err.message,
          "Body:",
          body,
        );
      }
    });
  });

  req.on("error", (err) => {
    console.error(
      "[Socket Server] Error posting user offline to Laravel:",
      err.message,
    );
  });

  req.write(data);
  req.end();
};

// 5. Establish the listener for active connections
io.on("connection", (socket) => {
  console.log("A user browser connected safely: " + socket.id);

  // EVENT A: User comes online or logs in

  socket.on("join", (user) => {
    const userId = typeof user === "object" && user !== null ? user.id : user;

    // Link their Database Primary Key ID to their changing Socket Connection ID
    onlineUsers[userId] = socket.id;

    // Broadcast the updated list of online user IDs back to everyone connected
    io.emit("getOnlineUsers", Object.keys(onlineUsers));

    // If a full user object was provided, broadcast it to other clients
    if (typeof user === "object" && user !== null) {
      socket.broadcast.emit("userJoined", user);
      console.log(`User ${userId} (${user.name}) joined and broadcasted.`);
    } else {
      console.log(`User ${userId} linked to connection ${socket.id}`);
    }
  });

  // EVENT B: Sending a Live Private Message
  socket.on("sendMessage", (data) => {
    const { sender_id, receiver_id, message, created_at, id } = data;

    // Look up if the target receiver is currently online
    const receiverSocketId = onlineUsers[receiver_id];
    if (receiverSocketId) {
      // Instantly push the message straight to the receiver's screen
      io.to(receiverSocketId).emit("getMessage", {
        id,
        sender_id,
        receiver_id,
        message,
        created_at,
      });
    }
  });

  // EVENT C: Typing Indicators
  socket.on("typing", ({ senderId, receiverId, isTyping }) => {
    const receiverSocketId = onlineUsers[receiverId];
    if (receiverSocketId) {
      // Signal to the recipient whether the sender is currently typing or stopped
      io.to(receiverSocketId).emit("userTyping", { senderId, isTyping });
    }
  });

  socket.on("messageSeen", ({ senderId, receiverId }) => {
    console.log(
      `[Socket Server] Received messageSeen event. senderId: ${senderId}, receiverId: ${receiverId}`,
    );
    const senderSocketId = onlineUsers[senderId];
    console.log(
      `[Socket Server] Looked up senderSocketId for senderId ${senderId}: ${senderSocketId}`,
    );

    if (senderSocketId) {
      console.log(
        `[Socket Server] Emitting messageSeenAck to senderSocketId ${senderSocketId} with receiverId ${receiverId}`,
      );
      io.to(senderSocketId).emit("messageSeenAck", {
        receiverId,
      });
    } else {
      console.warn(
        `[Socket Server] Sender ${senderId} is not online or socket not found in onlineUsers:`,
        Object.keys(onlineUsers),
      );
    }
  });

  socket.on("friendRequestSent", ({ senderId, receiverId }) => {
    console.log(
      `[Socket Server] Friend request sent from ${senderId} to ${receiverId}`,
    );
    const receiverSocketId = onlineUsers[receiverId];
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("friendRequestReceived", { senderId });
    }
  });

  socket.on("friendRequestAccepted", ({ senderId, receiverId }) => {
    console.log(
      `[Socket Server] Friend request accepted. senderId: ${senderId}, receiverId: ${receiverId}`,
    );
    const senderSocketId = onlineUsers[senderId];
    if (senderSocketId) {
      io.to(senderSocketId).emit("friendRequestAccepted", { receiverId });
    }
  });

  socket.on("disconnect", () => {
    console.log("A user disconnected: " + socket.id);

    for (let userId in onlineUsers) {
      if (onlineUsers[userId] === socket.id) {
        postUserOffline(userId);
        delete onlineUsers[userId];
        break;
      }
    }
    // Tell everyone left online that the user list changed
    io.emit("getOnlineUsers", Object.keys(onlineUsers));
  });

  socket.on("messageDeletedForEveryone", ({ messageId, receiverId }) => {
    const receiverSocketId = onlineUsers[receiverId];
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("messageDeletedForEveryone", { messageId });
    }
  });
});

// 6. Start listening on Port 3001
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Socket Server running natively on http://localhost:${PORT}`);
});
