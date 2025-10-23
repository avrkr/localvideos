// Global state
let currentUser = null
let currentUserId = null
let socket = null
let activeUsers = []
let callHistory = []
const currentCallParticipants = []
let callStartTime = null
let isInCall = false

// io is already available from /socket.io/socket.io.js script

// Declare modal functions
function hideOutgoingCallModal() {
  document.getElementById("outgoing-call-modal").classList.add("hidden")
}

function showVideoCallContainer() {
  document.getElementById("video-call-container").classList.remove("hidden")
}

function hideIncomingCallModal() {
  document.getElementById("incoming-call-modal").classList.add("hidden")
}

// Initialize Socket.io connection
function initSocket() {
  socket = io()

  socket.on("connect", () => {
    console.log("Connected to server")
  })

  socket.on("user-list", (users) => {
    console.log("Received user list:", users)
    // Filter out current user and update the active users list
    activeUsers = users.filter(user => user.id !== currentUserId)
    updateUsersList()
  })

  socket.on("user-left", (userId) => {
    console.log("User left:", userId)
    activeUsers = activeUsers.filter(user => user.id !== userId)
    updateUsersList()
  })

  socket.on("user-status-changed", (data) => {
    const user = activeUsers.find((u) => u.id === data.userId)
    if (user) {
      user.status = data.status
      updateUsersList()
    }
  })

  socket.on("incoming-call", (data) => {
    handleIncomingCall(data)
  })

  socket.on("call-rejected", () => {
    hideOutgoingCallModal()
    handleCallRejected()
  })

  socket.on("call-cancelled", (data) => {
    hideIncomingCallModal()
    clearInterval(window.incomingCallTimer)
    alert("Call was cancelled by the caller")
  })

  socket.on("call-accepted", () => {
    hideOutgoingCallModal()
    showVideoCallContainer()
  })

  socket.on("call-ended", () => {
    endCall()
  })

  socket.on("call-timeout", () => {
    hideIncomingCallModal()
    alert("Call timed out")
  })

  socket.on("call-history", (history) => {
    callHistory = history
    updateCallHistory()
  })

  socket.on("disconnect", () => {
    console.log("Disconnected from server")
    activeUsers = []
    updateUsersList()
  })

  // Setup WebRTC socket event handlers (defined in webrtc.js)
  setupWebRTCSocketHandlers(socket)
}

// Login functionality
document.getElementById("login-btn").addEventListener("click", async () => {
  const username = document.getElementById("username-input").value.trim()

  if (!username) {
    alert("Please enter a username")
    return
  }

  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username }),
    })

    const data = await response.json()

    if (data.success) {
      currentUser = data.username
      currentUserId = data.userId
      localStorage.setItem("userId", data.userId)
      localStorage.setItem("username", data.username)
      localStorage.setItem("userUrl", `${window.location.origin}/?username=${data.username}`)

      // Request permissions
      await requestMediaPermissions()

      // Initialize socket and go online
      initSocket()
      socket.emit("user-online", { userId: currentUserId, username: currentUser })

      // Switch to app screen
      document.getElementById("login-screen").classList.remove("active")
      document.getElementById("app-screen").classList.add("active")
      document.getElementById("user-greeting").textContent = `Welcome, ${currentUser}!`

      // Load call history
      loadCallHistory()
    }
  } catch (error) {
    console.error("Login error:", error)
    alert("Login failed")
  }
})

// Request media permissions
async function requestMediaPermissions() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: { facingMode: "user" },
    })

    // Store stream for later use
    stream.getTracks().forEach((track) => track.stop())
    localStorage.setItem("mediaPermissions", "granted")
  } catch (error) {
    console.error("Media permission error:", error)
    alert("Please allow camera and microphone access")
  }
}

// Update users list
function updateUsersList() {
  const usersList = document.getElementById("users-list")
  usersList.innerHTML = ""

  activeUsers.forEach((user) => {
    if (user.username === currentUser) return

    const userCard = document.createElement("div")
    userCard.className = "user-card"
    userCard.innerHTML = `
      <div class="user-info">
        <div class="user-avatar">${user.username.charAt(0).toUpperCase()}</div>
        <div class="user-details">
          <h3>${user.username}</h3>
          <div class="user-status">
            <span class="status-indicator ${user.status}"></span>
            <span>${user.status === "idle" ? "Idle" : "In Call"}</span>
          </div>
        </div>
      </div>
      <div class="user-action">
        <button class="call-icon-btn" onclick="initiateCall('${user.username}', ${user.id})" 
                ${user.status !== "idle" ? "disabled" : ""}>
          📞
        </button>
      </div>
    `
    usersList.appendChild(userCard)
  })
}

// Load call history
async function loadCallHistory() {
  try {
    const response = await fetch(`/api/call-history/${currentUserId}`)
    callHistory = await response.json()
    updateCallHistory()
  } catch (error) {
    console.error("Error loading call history:", error)
  }
}

// Update call history list
function updateCallHistory() {
  const historyList = document.getElementById("call-history-list")
  historyList.innerHTML = ""

  callHistory.forEach((call) => {
    const otherUser = call.caller_id === currentUserId ? call.receiver_name : call.caller_name
    const duration = formatDuration(call.duration)
    const date = new Date(call.started_at).toLocaleString()

    const historyItem = document.createElement("div")
    historyItem.className = "call-history-item"
    historyItem.innerHTML = `
      <div class="call-history-info">
        <h4>${otherUser}</h4>
        <div class="call-history-meta">
          <span>${date}</span>
          <span>${duration}</span>
        </div>
      </div>
      <span class="call-status-badge ${call.call_status}">${call.call_status}</span>
    `
    historyItem.addEventListener("click", () => showCallDetails(call))
    historyList.appendChild(historyItem)
  })
}

// Format duration
function formatDuration(seconds) {
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${minutes}m ${secs}s`
}

// Show call details
function showCallDetails(call) {
  const modal = document.getElementById("call-details-modal")
  const content = document.getElementById("call-details-content")

  const otherUser = call.caller_id === currentUserId ? call.receiver_name : call.caller_name
  const duration = formatDuration(call.duration)
  const date = new Date(call.started_at).toLocaleString()

  content.innerHTML = `
    <div class="detail-row">
      <span class="detail-label">Contact:</span>
      <span class="detail-value">${otherUser}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Date:</span>
      <span class="detail-value">${date}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Duration:</span>
      <span class="detail-value">${duration}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Status:</span>
      <span class="detail-value">${call.call_status}</span>
    </div>
  `

  modal.classList.remove("hidden")
}

// Tab switching
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"))
    document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"))

    btn.classList.add("active")
    const tabId = btn.dataset.tab + "-tab"
    document.getElementById(tabId).classList.add("active")

    if (btn.dataset.tab === "history") {
      loadCallHistory()
    }
  })
})

// Close modals
document.querySelectorAll(".close-btn").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.target.closest(".modal").classList.add("hidden")
  })
})

// Logout
document.getElementById("logout-btn").addEventListener("click", () => {
  // End any ongoing call
  if (isInCall) {
    endCall()
  }

  // Clear any pending call modals
  hideOutgoingCallModal()
  hideIncomingCallModal()
  clearInterval(window.outgoingCallTimer)
  clearInterval(window.incomingCallTimer)

  if (socket) {
    // Notify server about user going offline
    socket.emit("user-offline", { userId: currentUserId })
    socket.disconnect()
  }

  // Reset all state
  currentUser = null
  currentUserId = null
  activeUsers = []
  callHistory = []
  isInCall = false

  document.getElementById("logout-modal").classList.remove("hidden")
})

document.getElementById("relogin-btn").addEventListener("click", () => {
  localStorage.clear()
  location.reload()
})

// Initiate call
function initiateCall(username, userId) {
  const callId = `${currentUserId}-${userId}-${Date.now()}`
  window.currentCallId = callId
  window.currentCallReceiverId = userId
  window.currentCallReceiverName = username
  window.currentCallParticipants = [currentUserId, userId]

  socket.emit("call-initiate", {
    callerId: currentUserId,
    receiverId: userId,
    callerName: currentUser,
  })

  showOutgoingCallModal(username)
}

// Show outgoing call modal with enhanced timer
function showOutgoingCallModal(username) {
  const modal = document.getElementById("outgoing-call-modal")
  document.getElementById("outgoing-user-name").textContent = `Calling ${username}...`
  modal.classList.remove("hidden")

  let timeLeft = 30
  const timerInterval = setInterval(() => {
    document.getElementById("outgoing-timer").textContent = timeLeft
    timeLeft--

    if (timeLeft < 0) {
      clearInterval(timerInterval)
      modal.classList.add("hidden")
      handleCallTimeout()
    }
  }, 1000)

  window.outgoingCallTimer = timerInterval
}

// Handle incoming call with better state management
function handleIncomingCall(data) {
  window.incomingCallData = data
  const modal = document.getElementById("incoming-call-modal")
  document.getElementById("caller-name").textContent = data.callerName
  modal.classList.remove("hidden")

  let timeLeft = 30
  const timerInterval = setInterval(() => {
    document.getElementById("call-timer").textContent = timeLeft
    timeLeft--

    if (timeLeft < 0) {
      clearInterval(timerInterval)
      modal.classList.add("hidden")
      socket.emit("call-reject", {
        callId: data.callId,
        callerSocketId: data.callerId,
      })
      handleCallTimeout()
    }
  }, 1000)

  window.incomingCallTimer = timerInterval
}

// Answer call with proper state initialization
document.getElementById("answer-btn").addEventListener("click", () => {
  clearInterval(window.incomingCallTimer)
  const data = window.incomingCallData

  socket.emit("call-answer", {
    callId: data.callId,
    receiverId: currentUserId,
    callerSocketId: data.callerId,
  })

  document.getElementById("incoming-call-modal").classList.add("hidden")
  window.currentCallId = data.callId
  window.currentCallReceiverId = data.callerId
  window.currentCallReceiverName = data.callerName
  window.currentCallParticipants = [currentUserId, data.callerId]
  isInCall = true

  startVideoCall()
})

// Reject call
document.getElementById("reject-btn").addEventListener("click", () => {
  clearInterval(window.incomingCallTimer)
  const data = window.incomingCallData

  socket.emit("call-reject", {
    callId: data.callId,
    callerSocketId: data.callerId,
  })

  document.getElementById("incoming-call-modal").classList.add("hidden")
})

// Cancel outgoing call
document.getElementById("cancel-call-btn").addEventListener("click", () => {
  clearInterval(window.outgoingCallTimer)
  document.getElementById("outgoing-call-modal").classList.add("hidden")
  
  // Notify server about call cancellation
  socket.emit("call-cancel", {
    callId: window.currentCallId,
    receiverId: window.currentCallReceiverId
  })
})

// Handle call answered
function handleCallAnswered(data) {
  clearInterval(window.outgoingCallTimer)
  document.getElementById("outgoing-call-modal").classList.add("hidden")
  isInCall = true
  startVideoCall()
}

// Handle call rejected
function handleCallRejected() {
  clearInterval(window.outgoingCallTimer)
  document.getElementById("outgoing-call-modal").classList.add("hidden")
  alert("Call was rejected")
}

// Handle call timeout
function handleCallTimeout() {
  clearInterval(window.outgoingCallTimer)
  clearInterval(window.incomingCallTimer)
  document.getElementById("outgoing-call-modal").classList.add("hidden")
  document.getElementById("incoming-call-modal").classList.add("hidden")
  alert("Call timeout - no answer")
}

// Start video call
function startVideoCall() {
  document.getElementById("video-call-container").classList.remove("hidden")
  document.getElementById("remote-user-label").textContent = window.currentCallReceiverName
  callStartTime = Date.now()
  window.callStartTime = callStartTime
}

// End call with proper cleanup
document.getElementById("end-call-btn").addEventListener("click", () => {
  endCall()
})

function endCall() {
  if (!isInCall) return

  const duration = Math.floor((Date.now() - callStartTime) / 1000)

  socket.emit("call-end", {
    callId: window.currentCallId,
    callerId: currentUserId,
    receiverId: window.currentCallReceiverId,
    duration,
  })

  isInCall = false
  document.getElementById("video-call-container").classList.add("hidden")
  loadCallHistory()
  updateUsersList()
}

// Secure link display
window.addEventListener("load", () => {
  const params = new URLSearchParams(window.location.search)
  const username = params.get("username")

  if (username) {
    document.getElementById("username-input").value = username
  }

  const secureLink = `${window.location.origin}/?username=YourUsername`
  document.getElementById("secure-link").textContent = secureLink
})

// Auto-login on page load if credentials exist
window.addEventListener("DOMContentLoaded", async () => {
  const storedUserId = localStorage.getItem("userId")
  const storedUsername = localStorage.getItem("username")
  if (storedUserId && storedUsername) {
    currentUserId = parseInt(storedUserId)
    currentUser = storedUsername
    document.getElementById("username-input").value = storedUsername
    document.getElementById("login-screen").classList.remove("active")
    document.getElementById("app-screen").classList.add("active")
    document.getElementById("user-greeting").textContent = `Welcome, ${currentUser}!`
    await requestMediaPermissions()
    initSocket()
    socket.emit("user-online", { userId: currentUserId, username: currentUser })
    loadCallHistory()
  }
})
