const express = require("express")
const app = express()
const pool = require("./db") // Assuming db module exports the pool

app.get("/api/call-history/:userId", async (req, res) => {
  try {
    const { userId } = req.params
    const { limit = 50, offset = 0 } = req.query
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
       LIMIT ? OFFSET ?`,
      [userId, userId, Number.parseInt(limit), Number.parseInt(offset)],
    )

    connection.release()
    res.json(history)
  } catch (error) {
    console.error("Get call history error:", error)
    res.status(500).json({ error: "Failed to fetch call history" })
  }
})

app.get("/api/call-stats/:userId", async (req, res) => {
  try {
    const { userId } = req.params
    const connection = await pool.getConnection()

    const [stats] = await connection.query(
      `SELECT 
        COUNT(*) as total_calls,
        SUM(CASE WHEN call_status = 'answered' THEN 1 ELSE 0 END) as answered_calls,
        SUM(CASE WHEN call_status = 'missed' THEN 1 ELSE 0 END) as missed_calls,
        SUM(CASE WHEN call_status = 'rejected' THEN 1 ELSE 0 END) as rejected_calls,
        SUM(duration) as total_duration
       FROM call_history
       WHERE caller_id = ? OR receiver_id = ?`,
      [userId, userId],
    )

    connection.release()
    res.json(stats[0])
  } catch (error) {
    console.error("Get call stats error:", error)
    res.status(500).json({ error: "Failed to fetch call statistics" })
  }
})

app.put("/api/users/:userId/status", async (req, res) => {
  try {
    const { userId } = req.params
    const { status } = req.body

    if (!["idle", "in_call", "offline"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" })
    }

    const connection = await pool.getConnection()
    await connection.query("UPDATE users SET status = ? WHERE id = ?", [status, userId])
    connection.release()

    res.json({ success: true })
  } catch (error) {
    console.error("Update status error:", error)
    res.status(500).json({ error: "Failed to update status" })
  }
})
