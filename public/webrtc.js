// WebRTC Configuration
const STUN_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "stun:stun3.l.google.com:19302" },
  { urls: "stun:stun4.l.google.com:19302" },
]

const TURN_SERVERS = [
  {
    urls: "turn:numb.viagenie.ca",
    username: "webrtc@live.com",
    credential: "webrtc",
  },
]

// Global WebRTC state
let peerConnection = null
let localStream = null
let remoteStream = null
let dataChannel = null
let isRecording = false
let mediaRecorder = null
let recordedChunks = []

// Note: socket, currentUserId, activeUsers, and currentUser are already defined in client.js

// Initialize WebRTC
async function initializeWebRTC() {
  try {
    // Get local media stream
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: "user",
      },
    })

    // Display local video
    const localVideo = document.getElementById("local-video")
    localVideo.srcObject = localStream

    // Create peer connection
    createPeerConnection()

    // Add local stream tracks to peer connection
    localStream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, localStream)
    })
  } catch (error) {
    console.error("Error initializing WebRTC:", error)
    alert("Failed to access camera/microphone")
  }
}

// Create peer connection
function createPeerConnection() {
  const config = {
    iceServers: [...STUN_SERVERS, ...TURN_SERVERS],
  }

  peerConnection = new RTCPeerConnection(config)

  // Handle ICE candidates
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("webrtc-ice-candidate", {
        to: window.currentCallReceiverId,
        from: currentUserId,
        candidate: event.candidate,
      })
    }
  }

  // Handle remote stream
  peerConnection.ontrack = (event) => {
    console.log("Received remote track:", event.track.kind)
    if (!remoteStream) {
      remoteStream = new MediaStream()
      document.getElementById("remote-video").srcObject = remoteStream
    }
    remoteStream.addTrack(event.track)

    // Monitor audio levels for active speaker detection
    monitorAudioLevel(event.track)
  }

  // Handle connection state changes
  peerConnection.onconnectionstatechange = () => {
    console.log("Connection state:", peerConnection.connectionState)

    if (peerConnection.connectionState === "failed") {
      console.error("Connection failed")
      window.endCall()
    }
  }

  // Handle ICE connection state
  peerConnection.oniceconnectionstatechange = () => {
    console.log("ICE connection state:", peerConnection.iceConnectionState)
  }

  // Create data channel for additional features
  dataChannel = peerConnection.createDataChannel("chat", { ordered: true })
  setupDataChannel(dataChannel)

  peerConnection.ondatachannel = (event) => {
    setupDataChannel(event.channel)
  }
}

// Setup data channel
function setupDataChannel(channel) {
  channel.onopen = () => {
    console.log("Data channel opened")
  }

  channel.onmessage = (event) => {
    console.log("Data channel message:", event.data)
  }

  channel.onerror = (error) => {
    console.error("Data channel error:", error)
  }
}

// Create and send offer
async function createAndSendOffer() {
  try {
    const offer = await peerConnection.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    })

    await peerConnection.setLocalDescription(offer)

    socket.emit("webrtc-offer", {
      to: window.currentCallReceiverId,
      from: currentUserId,
      offer: offer,
    })
  } catch (error) {
    console.error("Error creating offer:", error)
  }
}

// Setup WebRTC socket event handlers
function setupWebRTCSocketHandlers(socket) {
  // Handle incoming offer
  socket.on("webrtc-offer", async (data) => {
    try {
      if (!peerConnection) {
        initializeWebRTC()
      }

      await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer))

      const answer = await peerConnection.createAnswer()
      await peerConnection.setLocalDescription(answer)

      socket.emit("webrtc-answer", {
        to: data.from,
        from: currentUserId,
        answer: answer,
      })
    } catch (error) {
      console.error("Error handling offer:", error)
    }
  })

  // Handle incoming answer
  socket.on("webrtc-answer", async (data) => {
    try {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer))
    } catch (error) {
      console.error("Error handling answer:", error)
    }
  })

  // Handle ICE candidates
  socket.on("webrtc-ice-candidate", async (data) => {
    try {
      if (data.candidate) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate))
      }
    } catch (error) {
      console.error("Error adding ICE candidate:", error)
    }
  })
}

// Monitor audio level for active speaker detection
function monitorAudioLevel(audioTrack) {
  const audioContext = new (window.AudioContext || window.webkitAudioContext)()
  const analyser = audioContext.createAnalyser()
  const source = audioContext.createMediaStreamSource(new MediaStream([audioTrack]))

  source.connect(analyser)
  analyser.fftSize = 256

  const dataArray = new Uint8Array(analyser.frequencyBinCount)

  function checkAudioLevel() {
    analyser.getByteFrequencyData(dataArray)
    const average = dataArray.reduce((a, b) => a + b) / dataArray.length

    const indicator = document.querySelector(".active-speaker-indicator")
    if (average > 30) {
      indicator.classList.add("active")
    } else {
      indicator.classList.remove("active")
    }

    requestAnimationFrame(checkAudioLevel)
  }

  checkAudioLevel()
}

// Get connection stats
async function getConnectionStats() {
  if (!peerConnection) return

  const stats = await peerConnection.getStats()
  let signalStrength = 3
  let videoStats = {}
  let audioStats = {}

  stats.forEach((report) => {
    if (report.type === "inbound-rtp") {
      if (report.kind === "video") {
        videoStats = {
          bytesReceived: report.bytesReceived,
          packetsLost: report.packetsLost,
          packetsReceived: report.packetsReceived,
          framesDecoded: report.framesDecoded,
          frameRate: report.framesPerSecond,
        }

        const packetsLost = report.packetsLost || 0
        const packetsReceived = report.packetsReceived || 0

        if (packetsReceived > 0) {
          const lossRate = packetsLost / (packetsLost + packetsReceived)
          if (lossRate > 0.1) signalStrength = 1
          else if (lossRate > 0.05) signalStrength = 2
          else signalStrength = 3
        }
      } else if (report.kind === "audio") {
        audioStats = {
          bytesReceived: report.bytesReceived,
          packetsLost: report.packetsLost,
          packetsReceived: report.packetsReceived,
          audioLevel: report.audioLevel,
        }
      }
    }
  })

  updateSignalStrength(signalStrength)
  updateConnectionQuality(videoStats, audioStats)
}

function updateConnectionQuality(videoStats, audioStats) {
  // Store stats for debugging
  window.connectionStats = { video: videoStats, audio: audioStats }
}

// Update signal strength display
function updateSignalStrength(strength) {
  const bars = document.querySelectorAll(".signal-bars .bar")
  bars.forEach((bar, index) => {
    if (index < strength) {
      bar.style.opacity = "1"
    } else {
      bar.style.opacity = "0.3"
    }
  })
}

// Call controls
document.getElementById("mic-btn").addEventListener("click", function () {
  if (localStream) {
    const audioTracks = localStream.getAudioTracks()
    audioTracks.forEach((track) => {
      track.enabled = !track.enabled
    })
    this.classList.toggle("active")
  }
})

document.getElementById("video-btn").addEventListener("click", function () {
  if (localStream) {
    const videoTracks = localStream.getVideoTracks()
    videoTracks.forEach((track) => {
      track.enabled = !track.enabled
    })
    this.classList.toggle("active")
  }
})

document.getElementById("camera-flip-btn").addEventListener("click", async () => {
  if (localStream) {
    const videoTrack = localStream.getVideoTracks()[0]
    if (videoTrack) {
      const settings = videoTrack.getSettings()
      const newFacingMode = settings.facingMode === "user" ? "environment" : "user"

      try {
        const newStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: newFacingMode },
        })

        const newVideoTrack = newStream.getVideoTracks()[0]
        const sender = peerConnection.getSenders().find((s) => s.track?.kind === "video")

        if (sender) {
          await sender.replaceTrack(newVideoTrack)
        }

        videoTrack.stop()
        localStream.removeTrack(videoTrack)
        localStream.addTrack(newVideoTrack)

        document.getElementById("local-video").srcObject = localStream
      } catch (error) {
        console.error("Error flipping camera:", error)
      }
    }
  }
})

document.getElementById("record-btn").addEventListener("click", function () {
  if (!isRecording) {
    startRecording()
    this.classList.add("active")
  } else {
    stopRecording()
    this.classList.remove("active")
  }
})

// Recording functionality
function startRecording() {
  recordedChunks = []

  // Create canvas for video composition
  const canvas = document.createElement("canvas")
  const ctx = canvas.getContext("2d")
  canvas.width = 1280
  canvas.height = 720

  const canvasStream = canvas.captureStream(30)

  // Create audio context for mixing
  const audioContext = new (window.AudioContext || window.webkitAudioContext)()
  const audioDestination = audioContext.createMediaStreamAudioDestinationStream()

  // Add local audio
  if (localStream) {
    const localAudioTrack = localStream.getAudioTracks()[0]
    if (localAudioTrack) {
      const localAudioSource = audioContext.createMediaStreamSource(new MediaStream([localAudioTrack]))
      localAudioSource.connect(audioDestination)
    }
  }

  // Add remote audio
  if (remoteStream) {
    const remoteAudioTrack = remoteStream.getAudioTracks()[0]
    if (remoteAudioTrack) {
      const remoteAudioSource = audioContext.createMediaStreamSource(new MediaStream([remoteAudioTrack]))
      remoteAudioSource.connect(audioDestination)
    }
  }

  // Combine video and mixed audio
  const recordingStream = new MediaStream()
  canvasStream.getVideoTracks().forEach((track) => recordingStream.addTrack(track))
  audioDestination.stream.getAudioTracks().forEach((track) => recordingStream.addTrack(track))

  // Draw video frames on canvas
  function drawFrame() {
    const localVideo = document.getElementById("local-video")
    const remoteVideo = document.getElementById("remote-video")

    // Draw remote video (main)
    if (remoteVideo.readyState === remoteVideo.HAVE_ENOUGH_DATA) {
      ctx.drawImage(remoteVideo, 0, 0, canvas.width, canvas.height)
    }

    // Draw local video (picture-in-picture)
    if (localVideo.readyState === localVideo.HAVE_ENOUGH_DATA) {
      const pipWidth = 200
      const pipHeight = 150
      ctx.drawImage(localVideo, canvas.width - pipWidth - 10, canvas.height - pipHeight - 10, pipWidth, pipHeight)

      // Draw border around PIP
      ctx.strokeStyle = "#2563eb"
      ctx.lineWidth = 2
      ctx.strokeRect(canvas.width - pipWidth - 10, canvas.height - pipHeight - 10, pipWidth, pipHeight)
    }

    requestAnimationFrame(drawFrame)
  }

  drawFrame()

  mediaRecorder = new MediaRecorder(recordingStream, {
    mimeType: "video/webm;codecs=vp9",
    videoBitsPerSecond: 2500000,
  })

  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      recordedChunks.push(event.data)
    }
  }

  mediaRecorder.onstop = () => {
    const blob = new Blob(recordedChunks, { type: "video/webm" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `call-recording-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.webm`
    a.click()
    URL.revokeObjectURL(url)
  }

  mediaRecorder.start()
  isRecording = true
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop()
    isRecording = false
  }
}

// Add member to call
document.getElementById("add-member-btn").addEventListener("click", () => {
  showAddMemberModal()
})

function showAddMemberModal() {
  const modal = document.getElementById("add-member-modal")
  const usersList = document.getElementById("available-users-list")
  usersList.innerHTML = ""

  activeUsers.forEach((user) => {
    if (user.username === currentUser || user.status !== "idle") return

    const userItem = document.createElement("div")
    userItem.className = "available-user-item"
    userItem.innerHTML = `
      <div class="user-info">
        <span>${user.username}</span>
      </div>
      <button class="btn btn-primary" onclick="inviteUserToCall(${user.id}, '${user.username}')">
        Invite
      </button>
    `
    usersList.appendChild(userItem)
  })

  if (usersList.children.length === 0) {
    usersList.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">No idle users available</p>'
  }

  modal.classList.remove("hidden")
}

function inviteUserToCall(userId, username) {
  socket.emit("call-initiate", {
    callerId: currentUserId,
    receiverId: userId,
    callerName: currentUser,
  })

  alert(`Invitation sent to ${username}`)
  document.getElementById("add-member-modal").classList.add("hidden")
}

// Override startVideoCall to initialize WebRTC
const originalStartVideoCall = window.startVideoCall
window.startVideoCall = async () => {
  originalStartVideoCall()

  // Initialize WebRTC
  await initializeWebRTC()

  // Create and send offer
  await createAndSendOffer()

  // Monitor connection stats
  setInterval(getConnectionStats, 1000)
}

// Cleanup on call end
const originalEndCall = window.endCall
window.endCall = () => {
  // Stop recording if active
  if (isRecording) {
    stopRecording()
  }

  // Close peer connection
  if (peerConnection) {
    peerConnection.close()
    peerConnection = null
  }

  // Stop local stream
  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop())
    localStream = null
  }

  // Clear remote stream
  remoteStream = null

  originalEndCall()
}
