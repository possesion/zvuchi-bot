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
    const formattedPhone = phone.replace(/\D/g, '')
    stmt.run(userId, formattedPhone);
}

function getPhone(userId) {
    const stmt = db.prepare('SELECT phone_number FROM users WHERE user_id = ?');
    const row = stmt.get(userId);
    return row ? row.phone_number : null;
}

module.exports = {
    savePhone,
    getPhone
};
