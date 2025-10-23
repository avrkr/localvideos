-- Create users table
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(255) UNIQUE NOT NULL,
  status ENUM('idle', 'in_call', 'offline') DEFAULT 'offline',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Create call history table
CREATE TABLE IF NOT EXISTS call_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  caller_id INT NOT NULL,
  receiver_id INT NOT NULL,
  call_status ENUM('answered', 'missed', 'rejected') DEFAULT 'missed',
  duration INT DEFAULT 0,
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ended_at TIMESTAMP NULL,
  FOREIGN KEY (caller_id) REFERENCES users(id),
  FOREIGN KEY (receiver_id) REFERENCES users(id)
);

-- Create call participants table for group calls
CREATE TABLE IF NOT EXISTS call_participants (
  id INT AUTO_INCREMENT PRIMARY KEY,
  call_id INT NOT NULL,
  user_id INT NOT NULL,
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  left_at TIMESTAMP NULL,
  FOREIGN KEY (call_id) REFERENCES call_history(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
