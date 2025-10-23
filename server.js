const express = require("express")
const http = require("http")
const socketIo = require("socket.io")
const mysql = require("mysql2/promise")
const path = require("path")
const cors = require("cors")

const app = express()
const server = http.createServer(app)
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
})

// Middleware
app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, "public")))

// MySQL connection pool
const pool = mysql.createPool({
  host: "localhost",
  user: "root",
  password: "",
  database: "webrtc",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
})

// Store active users and their socket connections
const activeUsers = new Map()
const activeCalls = new Map()

// Routes
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"))
})

app.post("/api/login", async (req, res) => {
  try {
    const { username } = req.body

    if (!username || username.trim() === "") {
      return res.status(400).json({ error: "Username is required" })
    }

    const connection = await pool.getConnection()

    // Check if user exists, if not create
    const [users] = await connection.query("SELECT id FROM users WHERE username = ?", [username])

    let userId
    if (users.length === 0) {
      const [result] = await connection.query("INSERT INTO users (username, status) VALUES (?, ?)", [username, "idle"])
      userId = result.insertId
    } else {
      userId = users[0].id
      await connection.query("UPDATE users SET status = ? WHERE id = ?", ["idle", userId])
    }

    connection.release()
    res.json({ success: true, userId, username })
  } catch (error) {
    console.error("Login error:", error)
    res.status(500).json({ error: "Login failed" })
  }
})

app.get("/api/users", async (req, res) => {
  try {
    const connection = await pool.getConnection()
    const [users] = await connection.query(
      "SELECT id, username, status FROM users WHERE status != ? ORDER BY username",
      ["offline"],
    )
    connection.release()
    res.json(users)
  } catch (error) {
    console.error("Get users error:", error)
    res.status(500).json({ error: "Failed to fetch users" })
  }
})

app.get("/api/call-history/:userId", async (req, res) => {
  try {
    const { userId } = req.params
    const connection = await pool.getConnection()

    const [history] = await connection.query(
      `SELECT ch.*, 
              u1.username as caller_name, 
              u2.username as receiver_name 
       FROM call_history ch
       JOIN users u1 ON ch.caller_id = u1.id
       JOIN users u2 ON ch.receiver_id = u2.id
       WHERE ch.caller_id = ? OR ch.receiver_id = ?
       ORDER BY ch.started_at DESC
       LIMIT 50`,
      [userId, userId],
    )

    connection.release()
    res.json(history)
  } catch (error) {
    console.error("Get call history error:", error)
    res.status(500).json({ error: "Failed to fetch call history" })
  }
})

app.post("/api/call-history", async (req, res) => {
  try {
    const { callerId, receiverId, status, duration } = req.body
    const connection = await pool.getConnection()

    const [result] = await connection.query(
      `INSERT INTO call_history (caller_id, receiver_id, call_status, duration) 
       VALUES (?, ?, ?, ?)`,
      [callerId, receiverId, status, duration],
    )

    connection.release()
    res.json({ success: true, callId: result.insertId })
  } catch (error) {
    console.error("Save call history error:", error)
    res.status(500).json({ error: "Failed to save call history" })
  }
})

// Socket.io events
io.on("connection", (socket) => {
  console.log("New connection:", socket.id)

  socket.on("user-online", (data) => {
    const { userId, username } = data
    // Add the user to active users map
    activeUsers.set(userId, {
      id: userId,  // Include id in the user object
      socketId: socket.id,
      username,
      status: "idle",
    })

    // Get all users as an array
    const usersList = Array.from(activeUsers.values()).map(user => ({
      id: user.id,
      username: user.username,
      status: user.status
    }))

    // Send complete user list to the new user
    socket.emit("user-list", usersList)

    // Broadcast updated user list to all connected users
    socket.broadcast.emit("user-list", usersList)
  })

  socket.on("call-initiate", (data) => {
    const { callerId, receiverId, callerName } = data
    const receiver = activeUsers.get(receiverId)

    if (receiver) {
      const callId = `${callerId}-${receiverId}-${Date.now()}`
      activeCalls.set(callId, {
        callerId,
        receiverId,
        status: "ringing",
        startTime: Date.now(),
      })

      io.to(receiver.socketId).emit("incoming-call", {
        callId,
        callerId,
        callerName,
        receiverId,
      })

      // Auto-reject after 30 seconds
      setTimeout(() => {
        if (activeCalls.has(callId)) {
          const call = activeCalls.get(callId)
          if (call.status === "ringing") {
            io.to(receiver.socketId).emit("call-timeout")
            socket.emit("call-timeout")
            activeCalls.delete(callId)

            // Save as missed call
            saveCallHistory(callerId, receiverId, "missed", 0)
          }
        }
      }, 30000)
    }
  })

  socket.on("call-answer", (data) => {
    const { callId, receiverId, callerSocketId } = data
    const call = activeCalls.get(callId)

    if (call) {
      call.status = "active"
      io.to(callerSocketId).emit("call-answered", { callId, receiverId })

      // Update user statuses
      const caller = activeUsers.get(call.callerId)
      const receiver = activeUsers.get(receiverId)
      if (caller) caller.status = "in_call"
      if (receiver) receiver.status = "in_call"

      io.emit("users-updated", Array.from(activeUsers.values()))
    }
  })

  // Handle call rejection
  socket.on("call-reject", (data) => {
    const { callId, callerSocketId } = data
    const call = activeCalls.get(callId)

    if (call) {
      io.to(callerSocketId).emit("call-rejected", { callId })
      activeCalls.delete(callId)
      saveCallHistory(call.callerId, call.receiverId, "rejected", 0)
    }
  })

  // Handle call cancellation by caller
  socket.on("call-cancel", (data) => {
    const { callId, receiverId } = data
    const call = activeCalls.get(callId)
    
    if (call) {
      const receiver = activeUsers.get(receiverId)
      if (receiver) {
        io.to(receiver.socketId).emit("call-cancelled", { callId })
      }
      activeCalls.delete(callId)
      saveCallHistory(call.callerId, call.receiverId, "cancelled", 0)
    }
  })

  socket.on("call-end", (data) => {
    const { callId, callerId, receiverId, duration } = data
    const call = activeCalls.get(callId)

    if (call) {
      activeCalls.delete(callId)
      saveCallHistory(callerId, receiverId, "answered", duration)

      // Update user statuses back to idle
      const caller = activeUsers.get(callerId)
      const receiver = activeUsers.get(receiverId)
      if (caller) caller.status = "idle"
      if (receiver) receiver.status = "idle"

      io.emit("users-updated", Array.from(activeUsers.values()))
    }
  })

  socket.on("webrtc-offer", (data) => {
    const { to, offer } = data
    const receiver = activeUsers.get(to)
    if (receiver) {
      io.to(receiver.socketId).emit("webrtc-offer", { offer, from: data.from })
    }
  })

  socket.on("webrtc-answer", (data) => {
    const { to, answer } = data
    const caller = activeUsers.get(to)
    if (caller) {
      io.to(caller.socketId).emit("webrtc-answer", { answer, from: data.from })
    }
  })

  socket.on("webrtc-ice-candidate", (data) => {
    const { to, candidate } = data
    const user = activeUsers.get(to)
    if (user) {
      io.to(user.socketId).emit("webrtc-ice-candidate", { candidate, from: data.from })
    }
  })

  socket.on("user-offline", (data) => {
    const { userId } = data
    activeUsers.delete(userId)
    
    // Notify all clients about the user going offline
    io.emit("user-left", userId)
    
    // Send updated user list to all remaining clients
    const usersList = Array.from(activeUsers.values()).map(user => ({
      id: user.id,
      username: user.username,
      status: user.status
    }))
    io.emit("user-list", usersList)
  })

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id)
    let disconnectedUserId = null;
    
    // Find and remove the disconnected user
    for (const [userId, user] of activeUsers.entries()) {
      if (user.socketId === socket.id) {
        disconnectedUserId = userId;
        activeUsers.delete(userId)
        break
      }
    }

    if (disconnectedUserId) {
      // Notify others about the user who left
      io.emit("user-left", disconnectedUserId)
      
      // Send updated user list to all remaining clients
      const usersList = Array.from(activeUsers.values()).map(user => ({
        id: user.id,
        username: user.username,
        status: user.status
      }))
      io.emit("user-list", usersList)
    }
  })
})

async function saveCallHistory(callerId, receiverId, status, duration) {
  try {
    const connection = await pool.getConnection()
    await connection.query(
      `INSERT INTO call_history (caller_id, receiver_id, call_status, duration) 
       VALUES (?, ?, ?, ?)`,
      [callerId, receiverId, status, duration],
    )
    connection.release()
  } catch (error) {
    console.error("Error saving call history:", error)
  }
}

const PORT = 8000
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
