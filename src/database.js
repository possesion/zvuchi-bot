const Database = require('better-sqlite3');

const db = new Database('bot.db');

// Создание таблицы для хранения пользователей
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    user_id INTEGER PRIMARY KEY,
    phone_number TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    notify BOOLEAN DEFAULT 0
  )
`);

// Миграция: добавляем колонку notify, если её ещё нет
function initializeNotifyColumn() {
    try {
        db.exec('ALTER TABLE users ADD COLUMN notify BOOLEAN DEFAULT 0');
        console.log('Добавлена колонка notify в таблицу users');
    } catch (error) {
        if (error.message.includes('duplicate column name')) {
            // Колонка уже существует — всё в порядке
        } else {
            throw error;
        }
    }
}

initializeNotifyColumn();

function savePhone(userId, phone) {
    const stmt = db.prepare('INSERT OR REPLACE INTO users (user_id, phone_number) VALUES (?, ?)');
    const formattedPhone = phone.replace(/\D/g, '');
    stmt.run(userId, formattedPhone);
}

function getPhone(userId) {
    const stmt = db.prepare('SELECT phone_number FROM users WHERE user_id = ?');
    const row = stmt.get(userId);
    return row ? row.phone_number : null;
}

function setNotify(userId, notify) {
    const stmt = db.prepare('UPDATE users SET notify = ? WHERE user_id = ?');
    stmt.run(notify ? 1 : 0, userId);
}

function getNotify(userId) {
    const stmt = db.prepare('SELECT notify FROM users WHERE user_id = ?');
    const row = stmt.get(userId);
    return row ? Boolean(row.notify) : false;
}

function getSubscribedUsers() {
    const stmt = db.prepare('SELECT user_id FROM users WHERE notify = 1');
    return stmt.all();
}

module.exports = {
    savePhone,
    getPhone,
    setNotify,
    getNotify,
    getSubscribedUsers,
    initializeNotifyColumn
};
