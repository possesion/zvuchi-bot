const Database = require('better-sqlite3');

const db = new Database('bot.db');

// Создание таблицы для хранения пользователей
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    user_id INTEGER PRIMARY KEY,
    phone_number TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

function savePhone(userId, phone) {
    const stmt = db.prepare('INSERT OR REPLACE INTO users (user_id, phone_number) VALUES (?, ?)');
    stmt.run(userId, phone);
}

function getPhone(userId) {
    const stmt = db.prepare('SELECT phone_number FROM users WHERE user_id = ?');
    return stmt.get(userId)?.phone_number;
}

module.exports = {
    savePhone,
    getPhone
};
