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

function initializeScheduleColumns() {
    const migrations = [
        'ALTER TABLE users ADD COLUMN next_lesson_date TEXT DEFAULT NULL',
        'ALTER TABLE users ADD COLUMN scheduled_at INTEGER DEFAULT NULL',
        'ALTER TABLE users ADD COLUMN sent BOOLEAN DEFAULT 0',
        'ALTER TABLE users ADD COLUMN name TEXT DEFAULT NULL',
        'ALTER TABLE users ADD COLUMN paid_count INTEGER DEFAULT NULL',
    ];
    for (const sql of migrations) {
        try {
            db.exec(sql);
        } catch (error) {
            if (!error.message.includes('duplicate column name')) throw error;
        }
    }
}

initializeScheduleColumns();

function savePhone(userId, phone) {
    const stmt = db.prepare('INSERT INTO users (user_id, phone_number) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET phone_number = excluded.phone_number');
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

function setSchedule(userId, name, nextLessonDate, scheduledAt, paidCount) {
    const stmt = db.prepare('UPDATE users SET name = ?, next_lesson_date = ?, scheduled_at = ?, sent = 0, paid_count = ? WHERE user_id = ?');
    stmt.run(name || null, nextLessonDate, scheduledAt, paidCount ?? null, userId);
}

function clearSchedule(userId) {
    const stmt = db.prepare('UPDATE users SET next_lesson_date = NULL, scheduled_at = NULL, sent = 0 WHERE user_id = ?');
    stmt.run(userId);
}

function getSchedule(userId) {
    const stmt = db.prepare('SELECT next_lesson_date, scheduled_at, sent, paid_count FROM users WHERE user_id = ?');
    const row = stmt.get(userId);
    return row || null;
}

function getPendingSchedules() {
    const stmt = db.prepare('SELECT user_id, name, next_lesson_date, scheduled_at, paid_count FROM users WHERE scheduled_at IS NOT NULL AND sent = 0 AND notify = 1');
    return stmt.all();
}

function markSent(userId) {
    const stmt = db.prepare('UPDATE users SET sent = 1 WHERE user_id = ?');
    stmt.run(userId);
}

module.exports = {
    savePhone,
    getPhone,
    setNotify,
    getNotify,
    getSubscribedUsers,
    initializeNotifyColumn,
    setSchedule,
    clearSchedule,
    getSchedule,
    getPendingSchedules,
    markSent,
};
