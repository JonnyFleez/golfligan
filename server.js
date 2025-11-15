// server.js
const express = require('express');
const session = require('express-session');
const path = require('path');
const db = require('./db/database');

const app = express();
const PORT = 3000;

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(session({
    secret: 'golf-secret-2025',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// Hjälpfunktioner
const requireLogin = (req, res, next) => {
    if (!req.session.playerId) return res.redirect('/login');
    next();
};

const requireAdmin = (req, res, next) => {
    if (!req.session.playerId) return res.redirect('/login');
    db.get('SELECT isAdmin FROM players WHERE id = ?', [req.session.playerId], (err, row) => {
        if (err || !row || row.isAdmin !== 1) {
            return res.status(403).send('Endast admin har tillgång.');
        }
        next();
    });
};

// ROUTES
app.get('/', (req, res) => {
    res.render('index', {
        player: req.session.playerName,
        isAdmin: req.session.isAdmin
    });
});

app.get('/login', (req, res) => {
    db.all('SELECT id, name, nickname FROM players WHERE isActive = 1', (err, players) => {
        if (err) return res.status(500).send('Databasfel');
        res.render('login', { players });
    });
});

app.post('/login', (req, res) => {
    const { playerId } = req.body;
    db.get('SELECT name, isAdmin FROM players WHERE id = ?', [playerId], (err, player) => {
        if (err || !player) return res.redirect('/login');
        req.session.playerId = playerId;
        req.session.playerName = player.name;
        req.session.isAdmin = player.isAdmin;
        res.redirect('/');
    });
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// TEST: Lägg till spelare + gör Kalle admin
app.get('/setup', (req, res) => {
    const players = [
        ['Kalle', 'Birdie-Kalle'],
        ['Lisa', 'Eagle-Lisa'],
        ['Olle', 'Bunker-Olle'],
        ['Mona', 'Putt-Mona']
    ];

    db.run('DELETE FROM players');
    const stmt = db.prepare('INSERT INTO players (name, nickname, isAdmin) VALUES (?, ?, ?)');
    players.forEach((p, i) => stmt.run(p[0], p[1], i === 0 ? 1 : 0));
    stmt.finalize(() => {
        res.send('Spelare tillagda! Kalle är admin. Gå till <a href="/">startsidan</a>');
    });
});

// === TOTALSTÄLLNING ===
app.get('/total', requireLogin, (req, res) => {
    db.all('SELECT id, date FROM game_days WHERE isActive = 1 ORDER BY date', (err, gameDays) => {
        if (err) return res.status(500).send('Databasfel');

        db.all(`
      SELECT 
        r.playerId,
        p.name,
        p.nickname,
        r.placement,
        r.beerTokens,
        r.gameDayId,
        g.date
      FROM results r
      JOIN players p ON r.playerId = p.id
      JOIN game_days g ON r.gameDayId = g.id
      WHERE p.isActive = 1 AND r.submitted = 1
      ORDER BY p.name, g.date
    `, (err, results) => {
            if (err) return res.status(500).send('Databasfel');

            const playerStats = {};

            results.forEach(r => {
                if (!playerStats[r.playerId]) {
                    playerStats[r.playerId] = {
                        name: r.name,
                        nickname: r.nickname,
                        rounds: 0,
                        totalPoints: 0,
                        beerDebt: 0,
                        placements: []
                    };
                }
                const stat = playerStats[r.playerId];
                if (r.placement < 17) {
                    stat.rounds++;
                    stat.totalPoints += r.placement;
                    stat.placements.push(r.placement);
                }
                if (r.beerTokens < 0) {
                    stat.beerDebt += Math.abs(r.beerTokens);
                }
            });

            db.all('SELECT id, name, nickname FROM players WHERE isActive = 1', (err, allPlayers) => {
                allPlayers.forEach(p => {
                    if (!playerStats[p.id]) {
                        playerStats[p.id] = {
                            name: p.name,
                            nickname: p.nickname,
                            rounds: 0,
                            totalPoints: 0,
                            beerDebt: 0,
                            placements: []
                        };
                    }
                });

                const statsArray = Object.values(playerStats).map(stat => ({
                    ...stat,
                    avgPlacement: stat.rounds > 0 ? (stat.totalPoints / stat.rounds).toFixed(2) : '-'
                }));

                statsArray.sort((a, b) => {
                    if (a.rounds === 0 && b.rounds === 0) return a.name.localeCompare(b.name);
                    if (a.rounds === 0) return 1;
                    if (b.rounds === 0) return -1;
                    return a.totalPoints - b.totalPoints || b.rounds - a.rounds;
                });

                let seasonComplete = false;
                let winner = null;
                if (gameDays.length > 0) {
                    const lastGameDayId = gameDays[gameDays.length - 1].id;
                    db.get('SELECT COUNT(*) as count FROM results WHERE gameDayId = ? AND submitted = 1', [lastGameDayId], (err, row) => {
                        const expectedPlayers = Object.keys(playerStats).length;
                        const submitted = row ? row.count : 0;
                        seasonComplete = submitted >= expectedPlayers && submitted > 0;
                        if (seasonComplete && statsArray.length > 0) winner = statsArray[0];

                        res.render('total', {
                            stats: statsArray,
                            gameDays,
                            seasonComplete,
                            winner,
                            playerName: req.session.playerName,
                            isAdmin: req.session.isAdmin
                        });
                    });
                } else {
                    res.render('total', {
                        stats: statsArray,
                        gameDays: [],
                        seasonComplete: false,
                        winner: null,
                        playerName: req.session.playerName,
                        isAdmin: req.session.isAdmin
                    });
                }
            });
        });
    });
});

// === ADMIN ROUTES ===
app.get('/admin', requireAdmin, (req, res) => {
    db.all('SELECT * FROM game_days ORDER BY date DESC', (err, gameDays) => {
        if (err) return res.status(500).send('Databasfel');
        res.render('admin/index', { gameDays, playerName: req.session.playerName });
    });
});

app.get('/admin/game-day/new', requireAdmin, (req, res) => {
    db.all('SELECT id, name FROM players WHERE isActive = 1', (err, players) => {
        if (err) return res.status(500).send('Databasfel');
        res.render('admin/new-game-day', { players });
    });
});

app.post('/admin/game-day/create', requireAdmin, (req, res) => {
    const { date, tee, gameMode, sideGame, beerGameEnabled } = req.body;

    let sideGameGroups = null;
    if (sideGame === 'fyrbollstävling' && Array.isArray(req.body.groups)) {
        const groups = req.body.groups
            .filter(g => g.trim() !== '')
            .map(g => g.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id)));
        sideGameGroups = JSON.stringify(groups);
    }

    const beerEnabled = beerGameEnabled === 'on' ? 1 : 0;

    db.run(`
    INSERT INTO game_days (date, tee, gameMode, sideGame, sideGameGroups, beerGameEnabled)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [date, tee, gameMode, sideGame || null, sideGameGroups, beerEnabled], function (err) {
        if (err) return res.status(500).send('Kunde inte spara speldag');

        const gameDayId = this.lastID;

        db.all('SELECT id FROM players WHERE isActive = 1', (err, players) => {
            if (err) return console.error(err);
            const stmt = db.prepare(`
        INSERT OR IGNORE INTO results (playerId, gameDayId, placement, submitted)
        VALUES (?, ?, 17, 0)
      `);
            players.forEach(p => stmt.run(p.id, gameDayId));
            stmt.finalize();
        });

        res.redirect('/admin');
    });
});

// === SITE MESSAGE ===
app.get('/admin/message', requireAdmin, (req, res) => {
    db.get('SELECT site_message FROM game_days LIMIT 1', (err, row) => {
        if (err) return res.status(500).send('Databasfel');
        const message = row ? row.site_message || '' : '';
        res.render('admin/message', { message, playerName: req.session.playerName });
    });
});

app.post('/admin/message', requireAdmin, (req, res) => {
    const { message } = req.body;
    db.run('UPDATE game_days SET site_message = ? WHERE id = (SELECT id FROM game_days LIMIT 1)', [message], (err) => {
        if (err) return res.status(500).send('Kunde inte spara');
        res.redirect('/admin');
    });
});

// === SPELDAGAR FÖR SPELARE ===
app.get('/game-days', requireLogin, (req, res) => {
    db.all('SELECT id, date, tee, gameMode FROM game_days WHERE isActive = 1 ORDER BY date DESC', (err, gameDays) => {
        if (err) return res.status(500).send('Databasfel');
        res.render('game-day/index', { gameDays, playerName: req.session.playerName });
    });
});

// Rapportera resultat – visa formulär
app.get('/game-day/:id/report', requireLogin, (req, res) => {
    const gameDayId = req.params.id;
    const playerId = req.session.playerId;

    db.get('SELECT * FROM game_days WHERE id = ?', [gameDayId], (err, gameDay) => {
        if (err || !gameDay) return res.status(404).send('Speldag hittades inte');

        db.get('SELECT * FROM results WHERE playerId = ? AND gameDayId = ?', [playerId, gameDayId], (err, result) => {
            if (err) return res.status(500).send('Databasfel');

            if (result && result.submitted && !req.session.isAdmin) {
                return res.redirect(`/game-day/${gameDayId}/results`);
            }

            let sidePlacement = null;
            if (gameDay.sideGame === 'fyrbollstävling' && gameDay.sideGameGroups) {
                const groups = JSON.parse(gameDay.sideGameGroups);
                for (let i = 0; i < groups.length; i++) {
                    if (groups[i].includes(parseInt(playerId))) {
                        sidePlacement = (i + 1) * 4 + 1;
                        break;
                    }
                }
            }

            // Hämta befintligt resultat
            const placement = result ? result.placement : 17;
            const beerCount = result && result.beerTokens !== null ? Math.abs(result.beerTokens) : 0;
            const beerSign = result && result.beerTokens < 0 ? '-' : '+';

            // Hämta antal aktiva spelare
            db.get('SELECT COUNT(*) as count FROM players WHERE isActive = 1', (err, row) => {
                if (err) return res.status(500).send('Databasfel');
                const playerCount = row.count;

                res.render('game-day/report', {
                    gameDay,
                    result: result || { placement: 17, beerTokens: 0 },
                    sidePlacement,
                    isAdmin: req.session.isAdmin,
                    beerCount,
                    beerSign,
                    playerCount,
                    placement,
                    playerName: req.session.playerName,
                    playerId: req.session.playerId  // NYTT – SKICKA playerId
                });
            });
        });
    });
});

// Spara resultat – stödjer +/− knappar
app.post('/game-day/:id/report', requireLogin, (req, res) => {
    const gameDayId = req.params.id;
    const playerId = req.session.playerId;
    const placement = parseInt(req.body.placement);

    // Läs från +/− knappar
    const beerCount = parseInt(req.body.beerCount) || 0;
    const beerSign = req.body.beerSign || '+';
    const beerTokens = beerSign === '+' ? beerCount : -beerCount;

    const submittedAt = new Date().toISOString();

    if (!placement || placement < 1) {
        return res.status(400).send('Välj en giltig placering');
    }

    db.run(`
    INSERT OR REPLACE INTO results 
    (playerId, gameDayId, placement, beerTokens, submitted, submittedAt)
    VALUES (?, ?, ?, ?, 1, ?)
  `, [playerId, gameDayId, placement, beerTokens, submittedAt], (err) => {
        if (err) {
            console.error('DB Error:', err);
            return res.status(500).send('Kunde inte spara resultat');
        }
        res.redirect(`/game-day/${gameDayId}/results`);
    });
});

// Visa resultat (live)
app.get('/game-day/:id/results', requireLogin, (req, res) => {
    const gameDayId = req.params.id;

    db.get('SELECT * FROM game_days WHERE id = ?', [gameDayId], (err, gameDay) => {
        if (err || !gameDay) return res.status(404).send('Speldag hittades inte');

        db.all(`
      SELECT r.*, p.name, p.nickname
      FROM results r
      JOIN players p ON r.playerId = p.id
      WHERE r.gameDayId = ?
      ORDER BY r.submitted DESC
    `, [gameDayId], (err, results) => {
            if (err) return res.status(500).send('Databasfel');
            res.render('game-day/results', {
                gameDay,
                results,
                playerId: req.session.playerId,
                isAdmin: req.session.isAdmin
            });
        });
    });
});

// Starta server
app.listen(PORT, () => {
    console.log(`GolfLigan körs på http://localhost:${PORT}`);
    console.log(`Gå till /setup en gång för att lägga till spelare`);
});