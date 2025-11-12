// db/database.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '..', 'golfligan.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Kunde inte ansluta till databasen:', err);
  } else {
    console.log('Ansluten till SQLite-databasen: golfligan.db');
  }
});

// Skapa tabeller
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      nickname TEXT,
      isActive INTEGER DEFAULT 1,
      isAdmin INTEGER DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS game_days (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      tee TEXT,
      gameMode TEXT,
      sideGame TEXT,
      sideGameGroups TEXT,
      beerGameEnabled INTEGER DEFAULT 0,
      isActive INTEGER DEFAULT 1
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playerId INTEGER,
      gameDayId INTEGER,
      placement INTEGER,
      sidePlacement INTEGER,
      beerTokens INTEGER,
      submitted INTEGER DEFAULT 0,
      submittedAt TEXT,
      FOREIGN KEY(playerId) REFERENCES players(id),
      FOREIGN KEY(gameDayId) REFERENCES game_days(id),
      UNIQUE(playerId, gameDayId)
    )
  `);
});

module.exports = db;