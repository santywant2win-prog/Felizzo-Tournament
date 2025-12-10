// FELIZZO '25 Carrom Tournament - Efficient Rebuild
// Santo's Requirements: Tie-breakers + Standings + Complete Knockout

// ============================================
// GLOBAL STATE & CACHE
// ============================================
const APP_STATE = {
    isAdmin: false,
    currentView: 'home',
    adminPassword: 'f25ca',
    chamberPassword: 'f25ca'
};

// Calculation cache - prevents redundant calculations
const CACHE = {
    standings: {},      // {groupName: standings}
    tieBreakers: null,  // calculated once per data change
    qualified: null,    // knockout qualification
    lastUpdate: null    // timestamp of last calculation
};

// Data from Firebase (loaded via Firebase listeners)
let TOURNAMENT_DATA = {};
let KNOCKOUT_DATA = null;

// Firebase references
let tournamentRef, knockoutRef;

// ============================================
// FIREBASE INITIALIZATION
// ============================================
function initializeFirebase() {
    tournamentRef = firebase.database().ref('tournamentData');
    knockoutRef = firebase.database().ref('knockoutData');
    
    // Listen to tournament data changes
    tournamentRef.on('value', (snapshot) => {
        const data = snapshot.val();
        if (data) {
            TOURNAMENT_DATA = data;
            clearCache(); // Clear cache when data changes
            if (APP_STATE.currentView !== 'home') {
                renderCurrentView();
            }
        }
    });
    
    // Listen to knockout data changes
    knockoutRef.on('value', (snapshot) => {
        const data = snapshot.val();
        KNOCKOUT_DATA = data || {};
        if (APP_STATE.currentView === 'chamber') {
            renderCurrentView();
        }
    });
}

function clearCache() {
    CACHE.standings = {};
    CACHE.tieBreakers = null;
    CACHE.qualified = null;
    CACHE.lastUpdate = Date.now();
}

// ============================================
// STANDINGS CALCULATION (WITH CACHING)
// ============================================
function calculateStandings(groupName) {
    // Return cached if available
    if (CACHE.standings[groupName]) {
        return CACHE.standings[groupName];
    }
    
    const group = TOURNAMENT_DATA[groupName];
    if (!group || !group.participants || !group.matches) {
        return [];
    }
    
    // Initialize stats for each participant
    const stats = {};
    group.participants.forEach(p => {
        stats[p.teamId] = {
            teamId: p.teamId,
            name: `${p.name1} & ${p.name2}`,
            played: 0,
            won: 0,
            lost: 0,
            draw: 0,
            points: 0,
            h2h: {} // head-to-head: {opponentId: {w, l, d}}
        };
    });
    
    // Process all matches
    group.matches.forEach(match => {
        if (!match.w) return; // skip unplayed matches
        
        const team1 = match.o1;
        const team2 = match.o2;
        
        // Update played count
        stats[team1].played++;
        stats[team2].played++;
        
        if (match.draw) {
            // Draw
            stats[team1].draw++;
            stats[team2].draw++;
            stats[team1].points += 1;
            stats[team2].points += 1;
            
            // H2H tracking
            if (!stats[team1].h2h[team2]) stats[team1].h2h[team2] = {w:0, l:0, d:0};
            if (!stats[team2].h2h[team1]) stats[team2].h2h[team1] = {w:0, l:0, d:0};
            stats[team1].h2h[team2].d++;
            stats[team2].h2h[team1].d++;
        } else {
            // Win/Loss
            const winner = match.w;
            const loser = match.r;
            
            stats[winner].won++;
            stats[winner].points += 3;
            stats[loser].lost++;
            
            // H2H tracking
            if (!stats[winner].h2h[loser]) stats[winner].h2h[loser] = {w:0, l:0, d:0};
            if (!stats[loser].h2h[winner]) stats[loser].h2h[winner] = {w:0, l:0, d:0};
            stats[winner].h2h[loser].w++;
            stats[loser].h2h[winner].l++;
        }
    });
    
    // Convert to array and sort with tie-breaker rules
    const standings = Object.values(stats).sort((a, b) => {
        // Rule 1: Points
        if (b.points !== a.points) return b.points - a.points;
        
        // Rule 2: Head-to-head (if 2 teams tied)
        if (a.h2h[b.teamId]) {
            const h2h = a.h2h[b.teamId];
            const h2hPoints = (h2h.w * 3 + h2h.d) - (h2h.l * 3 + h2h.d);
            if (h2hPoints !== 0) return -h2hPoints; // negative because we want higher first
        }
        
        // Rule 3: Wins
        if (b.won !== a.won) return b.won - a.won;
        
        // Rule 4: Alphabetical (for consistency)
        return a.teamId.localeCompare(b.teamId);
    });
    
    // Add position
    standings.forEach((team, idx) => {
        team.position = idx + 1;
    });
    
    // Cache the result
    CACHE.standings[groupName] = standings;
    return standings;
}

// ============================================
// TIE-BREAKER DETECTION (WITH CACHING)
// ============================================
function detectTieBreakers() {
    // Return cached if available
    if (CACHE.tieBreakers !== null) {
        return CACHE.tieBreakers;
    }
    
    const tieBreakers = [];
    const groupNames = Object.keys(TOURNAMENT_DATA);
    
    groupNames.forEach(groupName => {
        const standings = calculateStandings(groupName);
        
        // Check for ties at each position (top 3)
        let i = 0;
        while (i < Math.min(3, standings.length)) {
            const currentPoints = standings[i].points;
            const tiedTeams = [standings[i]];
            let j = i + 1;
            
            // Find all teams with same points
            while (j < standings.length && standings[j].points === currentPoints) {
                tiedTeams.push(standings[j]);
                j++;
            }
            
            // If more than 1 team at this point level, it's a tie-breaker
            if (tiedTeams.length > 1) {
                tieBreakers.push({
                    group: groupName,
                    position: i + 1,
                    teams: tiedTeams,
                    points: currentPoints
                });
            }
            
            i = j; // Move to next group of points
        }
    });
    
    // Cache the result
    CACHE.tieBreakers = tieBreakers;
    return tieBreakers;
}

// ============================================
// KNOCKOUT QUALIFICATION
// ============================================
function calculateKnockoutQualification() {
    // Return cached if available
    if (CACHE.qualified) {
        return CACHE.qualified;
    }
    
    const qualified = {
        top2: [],      // 22 teams (top 2 from each of 11 groups)
        wildCards: [], // 10 teams (3rd from specific groups)
        playIn: []     // 2 teams (1P 3rd vs SE 3rd)
    };
    
    const groupNames = Object.keys(TOURNAMENT_DATA);
    const wildCardGroups = groupNames.filter(g => g !== '1 P' && g !== 'SE');
    
    // Step 1: Get top 2 from all groups
    groupNames.forEach(groupName => {
        const standings = calculateStandings(groupName);
        if (standings.length >= 1) {
            qualified.top2.push({
                teamId: standings[0].teamId,
                name: standings[0].name,
                group: groupName,
                position: 1,
                points: standings[0].points
            });
        }
        if (standings.length >= 2) {
            qualified.top2.push({
                teamId: standings[1].teamId,
                name: standings[1].name,
                group: groupName,
                position: 2,
                points: standings[1].points
            });
        }
    });
    
    // Step 2: Get 3rd place from wild card groups
    const thirdPlaceTeams = [];
    wildCardGroups.forEach(groupName => {
        const standings = calculateStandings(groupName);
        if (standings.length >= 3) {
            thirdPlaceTeams.push({
                teamId: standings[2].teamId,
                name: standings[2].name,
                group: groupName,
                points: standings[2].points,
                won: standings[2].won,
                played: standings[2].played
            });
        }
    });
    
    // Sort by points, then wins
    thirdPlaceTeams.sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        if (b.won !== a.won) return b.won - a.won;
        return b.played - a.played;
    });
    
    // Top 10 get wild cards
    qualified.wildCards = thirdPlaceTeams.slice(0, 10);
    
    // Step 3: Play-in match (1P 3rd vs SE 3rd)
    ['1 P', 'SE'].forEach(groupName => {
        const standings = calculateStandings(groupName);
        if (standings.length >= 3) {
            qualified.playIn.push({
                teamId: standings[2].teamId,
                name: standings[2].name,
                group: groupName,
                points: standings[2].points
            });
        }
    });
    
    // Cache the result
    CACHE.qualified = qualified;
    return qualified;
}

// ============================================
// KNOCKOUT BRACKET GENERATION
// ============================================
function generateKnockoutBracket(playInWinner) {
    const qualified = calculateKnockoutQualification();
    
    // Combine all 32 teams
    const allTeams = [
        ...qualified.top2,
        ...qualified.wildCards,
        playInWinner
    ];
    
    // Shuffle for random draw
    const shuffled = [...allTeams].sort(() => Math.random() - 0.5);
    
    // Create Round of 16 matches (32 teams → 16 matches)
    const round16 = [];
    for (let i = 0; i < 16; i++) {
        round16.push({
            matchNo: i + 1,
            team1: shuffled[i * 2],
            team2: shuffled[i * 2 + 1],
            winner: null,
            completed: false
        });
    }
    
    return {
        round16: round16,
        quarterfinals: Array(8).fill(null).map((_, i) => ({
            matchNo: i + 1,
            team1: null,
            team2: null,
            winner: null,
            completed: false
        })),
        semifinals: Array(4).fill(null).map((_, i) => ({
            matchNo: i + 1,
            team1: null,
            team2: null,
            winner: null,
            completed: false
        })),
        finals: Array(2).fill(null).map((_, i) => ({
            matchNo: i + 1,
            team1: null,
            team2: null,
            winner: null,
            completed: false
        })),
        champion: null
    };
}

// ============================================
// UPDATE KNOCKOUT MATCH
// ============================================
function updateKnockoutMatch(round, matchNo, winnerTeam) {
    if (!KNOCKOUT_DATA || !KNOCKOUT_DATA.bracket) return;
    
    const bracket = KNOCKOUT_DATA.bracket;
    const matchIndex = matchNo - 1;
    
    if (round === 'round16') {
        const match = bracket.round16[matchIndex];
        match.winner = winnerTeam;
        match.completed = true;
        
        // Advance to quarterfinals
        const qfIndex = Math.floor(matchIndex / 2);
        if (matchIndex % 2 === 0) {
            bracket.quarterfinals[qfIndex].team1 = winnerTeam;
        } else {
            bracket.quarterfinals[qfIndex].team2 = winnerTeam;
        }
    }
    else if (round === 'quarterfinals') {
        const match = bracket.quarterfinals[matchIndex];
        match.winner = winnerTeam;
        match.completed = true;
        
        // Advance to semifinals
        const sfIndex = Math.floor(matchIndex / 2);
        if (matchIndex % 2 === 0) {
            bracket.semifinals[sfIndex].team1 = winnerTeam;
        } else {
            bracket.semifinals[sfIndex].team2 = winnerTeam;
        }
    }
    else if (round === 'semifinals') {
        const match = bracket.semifinals[matchIndex];
        match.winner = winnerTeam;
        match.completed = true;
        
        // Advance to finals
        const fIndex = Math.floor(matchIndex / 2);
        if (matchIndex % 2 === 0) {
            bracket.finals[fIndex].team1 = winnerTeam;
        } else {
            bracket.finals[fIndex].team2 = winnerTeam;
        }
    }
    else if (round === 'finals') {
        const match = bracket.finals[matchIndex];
        match.winner = winnerTeam;
        match.completed = true;
        
        // Set champion (finals[1] is the championship match)
        if (matchNo === 2) {
            bracket.champion = winnerTeam;
        }
    }
    
    // Save to Firebase
    knockoutRef.set(KNOCKOUT_DATA);
}

// ============================================
// RENDER FUNCTIONS
// ============================================

function renderStandings() {
    const container = document.getElementById('content');
    const tieBreakers = detectTieBreakers();
    
    let html = '<div class="content-wrapper"><h2>📊 Group Standings</h2>';
    
    // Tie-breaker alert
    if (tieBreakers.length > 0) {
        html += `<div class="alert alert-warning">
            ⚠️ ${tieBreakers.length} tie-breaker(s) detected across groups!
            <button onclick="showTieBreakers()" class="btn btn-sm btn-warning">View Tie-Breakers</button>
        </div>`;
    }
    
    const groupNames = Object.keys(TOURNAMENT_DATA);
    
    groupNames.forEach(groupName => {
        const standings = calculateStandings(groupName);
        
        html += `<div class="standings-group">
            <h3>${groupName}</h3>
            <div class="table-responsive">
                <table class="standings-table">
                    <thead>
                        <tr>
                            <th>Pos</th>
                            <th>Team</th>
                            <th>P</th>
                            <th>W</th>
                            <th>D</th>
                            <th>L</th>
                            <th>Pts</th>
                        </tr>
                    </thead>
                    <tbody>`;
        
        standings.forEach(team => {
            const rowClass = team.position <= 2 ? 'qualified' : (team.position === 3 ? 'wildcard' : '');
            html += `<tr class="${rowClass}">
                <td>${team.position}</td>
                <td>${team.name}</td>
                <td>${team.played}</td>
                <td>${team.won}</td>
                <td>${team.draw}</td>
                <td>${team.lost}</td>
                <td><strong>${team.points}</strong></td>
            </tr>`;
        });
        
        html += `</tbody>
                </table>
            </div>
        </div>`;
    });
    
    html += '</div>';
    container.innerHTML = html;
}

function renderTieBreakers() {
    const container = document.getElementById('content');
    const tieBreakers = detectTieBreakers();
    
    let html = '<div class="content-wrapper"><h2>⚖️ Tie-Breaker Sheet</h2>';
    
    if (tieBreakers.length === 0) {
        html += '<div class="alert alert-success">✅ No tie-breakers detected! All positions are clear.</div>';
    } else {
        html += `<div class="alert alert-info">Found ${tieBreakers.length} tie-breaker situation(s)</div>`;
        
        tieBreakers.forEach((tb, idx) => {
            html += `<div class="tie-breaker-card">
                <div class="tie-breaker-header">
                    <h4>Tie-Breaker ${idx + 1}: ${tb.group}</h4>
                    <span class="tie-badge">Position ${tb.position} (${tb.points} pts)</span>
                </div>
                <div class="tie-breaker-teams">
                    <h5>Tied Teams:</h5>
                    <ul>`;
            
            tb.teams.forEach(team => {
                html += `<li>${team.name} - ${team.won}W ${team.draw}D ${team.lost}L</li>`;
            });
            
            html += `</ul>
                </div>
                <div class="tie-breaker-h2h">
                    <h5>Head-to-Head Results:</h5>
                    <table class="h2h-table">
                        <thead>
                            <tr>
                                <th>Team</th>`;
            
            // Column headers
            tb.teams.forEach(t => {
                html += `<th>${t.teamId}</th>`;
            });
            html += `</tr></thead><tbody>`;
            
            // H2H matrix
            tb.teams.forEach(team1 => {
                html += `<tr><td><strong>${team1.teamId}</strong></td>`;
                tb.teams.forEach(team2 => {
                    if (team1.teamId === team2.teamId) {
                        html += '<td class="diagonal">-</td>';
                    } else {
                        const h2h = team1.h2h[team2.teamId];
                        if (h2h) {
                            const display = h2h.w > 0 ? `W(${h2h.w})` : (h2h.l > 0 ? `L(${h2h.l})` : `D(${h2h.d})`);
                            html += `<td>${display}</td>`;
                        } else {
                            html += '<td>-</td>';
                        }
                    }
                });
                html += '</tr>';
            });
            
            html += `</tbody></table>
                </div>
            </div>`;
        });
    }
    
    html += '<div style="margin-top: 2rem;"><button onclick="showStandings()" class="btn">← Back to Standings</button></div>';
    html += '</div>';
    container.innerHTML = html;
}

function renderChamber() {
    const container = document.getElementById('content');
    
    let html = '<div class="content-wrapper"><h2>⚡ Elimination Chamber</h2>';
    
    if (!APP_STATE.isAdmin) {
        html += `<div class="chamber-login">
            <p>Admin access required to manage knockout bracket</p>
            <input type="password" id="chamberPass" placeholder="Enter password" />
            <button onclick="loginChamber()" class="btn btn-primary">Login</button>
        </div>`;
    } else {
        // Show qualification summary
        const qualified = calculateKnockoutQualification();
        
        html += `<div class="qualification-section">
            <h3>Step 1: Qualification Summary</h3>
            <div class="qualification-grid">
                <div class="qual-card">
                    <div class="qual-number">${qualified.top2.length}</div>
                    <div class="qual-label">Top 2 Guaranteed</div>
                </div>
                <div class="qual-card">
                    <div class="qual-number">${qualified.wildCards.length}</div>
                    <div class="qual-label">Wild Cards</div>
                </div>
                <div class="qual-card">
                    <div class="qual-number">${qualified.playIn.length}</div>
                    <div class="qual-label">Play-In Teams</div>
                </div>
                <div class="qual-card qual-total">
                    <div class="qual-number">${qualified.top2.length + qualified.wildCards.length + 1}</div>
                    <div class="qual-label">Total Teams</div>
                </div>
            </div>
        </div>`;
        
        // Play-in match
        if (qualified.playIn.length === 2) {
            html += `<div class="playin-section">
                <h3>Step 2: Play-In Match</h3>
                <div class="playin-match">
                    <div class="playin-team">
                        <strong>${qualified.playIn[0].name}</strong>
                        <span>${qualified.playIn[0].group} - 3rd (${qualified.playIn[0].points} pts)</span>
                    </div>
                    <div class="playin-vs">VS</div>
                    <div class="playin-team">
                        <strong>${qualified.playIn[1].name}</strong>
                        <span>${qualified.playIn[1].group} - 3rd (${qualified.playIn[1].points} pts)</span>
                    </div>
                </div>`;
            
            if (!KNOCKOUT_DATA.playInWinner) {
                html += `<div class="playin-actions">
                    <button onclick="setPlayInWinner(0)" class="btn btn-success">✓ ${qualified.playIn[0].teamId} Wins</button>
                    <button onclick="setPlayInWinner(1)" class="btn btn-success">✓ ${qualified.playIn[1].teamId} Wins</button>
                </div>`;
            } else {
                html += `<div class="playin-winner">Winner: ${KNOCKOUT_DATA.playInWinner.name} ✅</div>`;
            }
            
            html += '</div>';
        }
        
        // Bracket generation or display
        if (!KNOCKOUT_DATA.bracket && KNOCKOUT_DATA.playInWinner) {
            html += `<div class="bracket-generate">
                <h3>Step 3: Generate Bracket</h3>
                <button onclick="generateBracket()" class="btn btn-primary btn-lg">🎲 Generate Elimination Bracket</button>
            </div>`;
        } else if (KNOCKOUT_DATA.bracket) {
            html += renderBracket();
        }
    }
    
    html += '</div>';
    container.innerHTML = html;
}

function renderBracket() {
    const bracket = KNOCKOUT_DATA.bracket;
    
    let html = '<div class="bracket-container"><h3>Elimination Bracket</h3>';
    
    // Round of 16
    html += '<div class="bracket-round">';
    html += '<h4 class="round-title">Round of 16 (32→16)</h4>';
    html += '<div class="matches-grid">';
    
    bracket.round16.forEach(match => {
        html += renderMatchCard(match, 'round16');
    });
    
    html += '</div></div>';
    
    // Quarterfinals
    const qfReady = bracket.quarterfinals.some(m => m.team1 && m.team2);
    if (qfReady) {
        html += '<div class="bracket-round">';
        html += '<h4 class="round-title">Quarterfinals (16→8)</h4>';
        html += '<div class="matches-grid">';
        
        bracket.quarterfinals.forEach(match => {
            if (match.team1 && match.team2) {
                html += renderMatchCard(match, 'quarterfinals');
            }
        });
        
        html += '</div></div>';
    }
    
    // Semifinals
    const sfReady = bracket.semifinals.some(m => m.team1 && m.team2);
    if (sfReady) {
        html += '<div class="bracket-round">';
        html += '<h4 class="round-title">Semifinals (8→4)</h4>';
        html += '<div class="matches-grid">';
        
        bracket.semifinals.forEach(match => {
            if (match.team1 && match.team2) {
                html += renderMatchCard(match, 'semifinals');
            }
        });
        
        html += '</div></div>';
    }
    
    // Finals
    const finalsReady = bracket.finals.some(m => m.team1 && m.team2);
    if (finalsReady) {
        html += '<div class="bracket-round">';
        html += '<h4 class="round-title">Finals</h4>';
        html += '<div class="matches-grid">';
        
        bracket.finals.forEach(match => {
            if (match.team1 && match.team2) {
                html += renderMatchCard(match, 'finals');
            }
        });
        
        html += '</div></div>';
    }
    
    // Champion
    if (bracket.champion) {
        html += `<div class="champion-section">
            <div class="champion-trophy">🏆</div>
            <div class="champion-name">${bracket.champion.name}</div>
            <div class="champion-subtitle">FELIZZO '25 Champion</div>
        </div>`;
    }
    
    html += '</div>';
    return html;
}

function renderMatchCard(match, round) {
    const team1Win = match.winner && match.winner.teamId === match.team1.teamId;
    const team2Win = match.winner && match.winner.teamId === match.team2.teamId;
    
    let html = `<div class="match-card ${match.completed ? 'completed' : ''}">
        <div class="match-number">Match ${match.matchNo}</div>
        <div class="match-teams">
            <div class="match-team ${team1Win ? 'winner' : ''}">
                <span class="team-name">${match.team1.name}</span>
                <span class="team-group">${match.team1.group}</span>
            </div>
            <div class="match-divider">VS</div>
            <div class="match-team ${team2Win ? 'winner' : ''}">
                <span class="team-name">${match.team2.name}</span>
                <span class="team-group">${match.team2.group}</span>
            </div>
        </div>`;
    
    if (!match.completed && APP_STATE.isAdmin) {
        html += `<div class="match-actions">
            <button onclick="setMatchWinner('${round}', ${match.matchNo}, ${JSON.stringify(match.team1).replace(/"/g, '&quot;')})" 
                    class="btn btn-sm btn-success">✓ Team 1</button>
            <button onclick="setMatchWinner('${round}', ${match.matchNo}, ${JSON.stringify(match.team2).replace(/"/g, '&quot;')})" 
                    class="btn btn-sm btn-success">✓ Team 2</button>
        </div>`;
    }
    
    if (match.completed) {
        html += `<div class="match-result">Winner: ${match.winner.name}</div>`;
    }
    
    html += '</div>';
    return html;
}

// ============================================
// UI ACTION HANDLERS
// ============================================

function loginChamber() {
    const pass = document.getElementById('chamberPass').value;
    if (pass === APP_STATE.chamberPassword) {
        APP_STATE.isAdmin = true;
        renderChamber();
    } else {
        alert('Incorrect password!');
    }
}

function showStandings() {
    APP_STATE.currentView = 'standings';
    renderStandings();
    updateNavigation();
}

function showTieBreakers() {
    APP_STATE.currentView = 'tiebreakers';
    renderTieBreakers();
}

function showChamber() {
    APP_STATE.currentView = 'chamber';
    renderChamber();
    updateNavigation();
}

function setPlayInWinner(index) {
    const qualified = calculateKnockoutQualification();
    const winner = qualified.playIn[index];
    
    if (!KNOCKOUT_DATA) {
        KNOCKOUT_DATA = {};
    }
    
    KNOCKOUT_DATA.playInWinner = winner;
    knockoutRef.set(KNOCKOUT_DATA);
    
    alert(`✅ ${winner.name} advances to Round of 16!`);
    renderChamber();
}

function generateBracket() {
    if (!KNOCKOUT_DATA.playInWinner) {
        alert('Play-in match must be completed first!');
        return;
    }
    
    const bracket = generateKnockoutBracket(KNOCKOUT_DATA.playInWinner);
    KNOCKOUT_DATA.bracket = bracket;
    knockoutRef.set(KNOCKOUT_DATA);
    
    alert('✅ Bracket generated! 32 teams ready for elimination!');
    renderChamber();
}

function setMatchWinner(round, matchNo, winnerTeamJson) {
    const winnerTeam = JSON.parse(winnerTeamJson.replace(/&quot;/g, '"'));
    updateKnockoutMatch(round, matchNo, winnerTeam);
    alert(`✅ ${winnerTeam.name} advances!`);
    renderChamber();
}

function updateNavigation() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.view === APP_STATE.currentView) {
            btn.classList.add('active');
        }
    });
}

function renderCurrentView() {
    switch(APP_STATE.currentView) {
        case 'standings':
            renderStandings();
            break;
        case 'tiebreakers':
            renderTieBreakers();
            break;
        case 'chamber':
            renderChamber();
            break;
        default:
            renderStandings();
    }
}

// ============================================
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    initializeFirebase();
    
    // Setup navigation
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const view = btn.dataset.view;
            APP_STATE.currentView = view;
            renderCurrentView();
            updateNavigation();
        });
    });
    
    // Initial render
    setTimeout(() => {
        renderStandings();
    }, 500);
});

