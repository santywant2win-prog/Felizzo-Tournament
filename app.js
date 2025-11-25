// FELIZZO '25 Carrom Tournament App with Firebase
// Application State
const APP_STATE = {
    isAdmin: false,
    currentView: 'standings',
    currentTeam: null,
    adminPassword: 'f25',
    dataLoaded: false,
    isOnline: true
};

// Constants
const POINTS = {
    WIN: 2,
    DRAW: 1,
    LOSS: 0
};

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
});

function initializeApp() {
    console.log('Initializing app...');
    
    // Setup event listeners
    setupEventListeners();
    
    // Load data from Firebase
    loadDataFromFirebase();
    
    // Monitor connection status
    monitorConnectionStatus();
}

// Firebase Data Management
function loadDataFromFirebase() {
    updateSyncStatus('loading', '🔄 Loading data...');
    
    tournamentRef.once('value', (snapshot) => {
        if (snapshot.exists()) {
            // Data exists in Firebase - use it
            console.log('Loading data from Firebase...');
            const firebaseData = snapshot.val();
            Object.assign(tournamentData, firebaseData);
            APP_STATE.dataLoaded = true;
            updateSyncStatus('synced', '✅ Synced');
            renderAllViews();
        } else {
            // No data in Firebase - initialize with default data
            console.log('No data in Firebase. Initializing...');
            initializeFirebaseData();
        }
    }).catch((error) => {
        console.error('Error loading from Firebase:', error);
        updateSyncStatus('error', '❌ Load failed');
        // Fall back to local data
        APP_STATE.dataLoaded = true;
        renderAllViews();
    });
    
    // Listen for real-time updates
    tournamentRef.on('value', (snapshot) => {
        if (APP_STATE.dataLoaded && snapshot.exists()) {
            console.log('Data updated from Firebase');
            const firebaseData = snapshot.val();
            Object.assign(tournamentData, firebaseData);
            renderAllViews();
        }
    });
}

function initializeFirebaseData() {
    console.log('Initializing Firebase with default tournament data...');
    tournamentRef.set(tournamentData)
        .then(() => {
            console.log('Firebase initialized successfully!');
            APP_STATE.dataLoaded = true;
            updateSyncStatus('synced', '✅ Synced');
            renderAllViews();
        })
        .catch((error) => {
            console.error('Error initializing Firebase:', error);
            updateSyncStatus('error', '❌ Sync failed');
            APP_STATE.dataLoaded = true;
            renderAllViews();
        });
}

function saveToFirebase(callback) {
    updateSyncStatus('saving', '💾 Saving...');
    
    tournamentRef.set(tournamentData)
        .then(() => {
            console.log('Data saved to Firebase successfully!');
            updateSyncStatus('synced', '✅ Synced');
            if (callback) callback(true);
        })
        .catch((error) => {
            console.error('Error saving to Firebase:', error);
            updateSyncStatus('error', '❌ Save failed');
            if (callback) callback(false);
        });
}

function monitorConnectionStatus() {
    const connectedRef = database.ref('.info/connected');
    connectedRef.on('value', (snapshot) => {
        if (snapshot.val() === true) {
            console.log('Connected to Firebase');
            APP_STATE.isOnline = true;
            if (APP_STATE.dataLoaded) {
                updateSyncStatus('synced', '✅ Synced');
            }
        } else {
            console.log('Disconnected from Firebase');
            APP_STATE.isOnline = false;
            updateSyncStatus('offline', '📴 Offline');
        }
    });
}

function updateSyncStatus(status, text) {
    const statusElement = document.getElementById('syncStatus');
    if (statusElement) {
        statusElement.textContent = text;
        statusElement.className = 'sync-status sync-' + status;
    }
}

function renderAllViews() {
    if (!APP_STATE.dataLoaded) return;
    
    // Set initial team if not set
    if (!APP_STATE.currentTeam) {
        const firstTeam = Object.keys(tournamentData)[0];
        APP_STATE.currentTeam = firstTeam;
    }
    
    renderStandingsView();
    renderScheduleView();
    renderOverallView();
}

function setupEventListeners() {
    // Admin button
    document.getElementById('adminBtn').addEventListener('click', showAdminModal);
    
    // View mode button
    document.getElementById('viewModeBtn').addEventListener('click', () => {
        APP_STATE.isAdmin = false;
        updateAdminIndicator();
        renderCurrentView();
    });
    
    // Modal close
    document.querySelector('.close').addEventListener('click', hideAdminModal);
    
    // Login button
    document.getElementById('loginBtn').addEventListener('click', handleLogin);
    
    // Enter key in password field
    document.getElementById('adminPassword').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleLogin();
    });
    
    // Navigation buttons
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const view = e.target.dataset.view;
            switchView(view);
        });
    });
    
    // Close modal on outside click
    window.addEventListener('click', (e) => {
        const modal = document.getElementById('adminModal');
        if (e.target === modal) {
            hideAdminModal();
        }
    });
}

function showAdminModal() {
    document.getElementById('adminModal').style.display = 'block';
    document.getElementById('adminPassword').value = '';
    document.getElementById('loginError').textContent = '';
}

function hideAdminModal() {
    document.getElementById('adminModal').style.display = 'none';
}

function handleLogin() {
    const password = document.getElementById('adminPassword').value;
    const errorElement = document.getElementById('loginError');
    
    if (password === APP_STATE.adminPassword) {
        APP_STATE.isAdmin = true;
        hideAdminModal();
        updateAdminIndicator();
        renderCurrentView();
        errorElement.textContent = '';
    } else {
        errorElement.textContent = 'Incorrect password. Please try again.';
    }
}

function updateAdminIndicator() {
    let indicator = document.querySelector('.admin-mode');
    
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.className = 'admin-mode';
        indicator.textContent = '🔓 Admin Mode';
        document.body.appendChild(indicator);
    }
    
    if (APP_STATE.isAdmin) {
        indicator.classList.add('active');
    } else {
        indicator.classList.remove('active');
    }
}

function switchView(view) {
    APP_STATE.currentView = view;
    
    // Update navigation
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.view === view) {
            btn.classList.add('active');
        }
    });
    
    // Update view containers
    document.querySelectorAll('.view-container').forEach(container => {
        container.classList.remove('active');
    });
    
    document.getElementById(view + 'View').classList.add('active');
}

function renderCurrentView() {
    switch(APP_STATE.currentView) {
        case 'standings':
            renderStandingsView();
            break;
        case 'schedule':
            renderScheduleView();
            break;
        case 'overall':
            renderOverallView();
            break;
    }
}

// Calculate team standings
function calculateStandings(teamName) {
    const teamData = tournamentData[teamName];
    const standings = {};
    
    // Initialize standings for each participant
    teamData.participants.forEach(p => {
        standings[p.teamId] = {
            teamId: p.teamId,
            name1: p.name1,
            name2: p.name2,
            played: 0,
            won: 0,
            lost: 0,
            drawn: 0,
            points: 0
        };
    });
    
    // Calculate from matches
    teamData.matches.forEach(match => {
        if (match.winner && match.runner) {
            // Check for draw
            if (match.winner === match.runner) {
                // Draw
                if (standings[match.opponent1]) {
                    standings[match.opponent1].played++;
                    standings[match.opponent1].drawn++;
                    standings[match.opponent1].points += POINTS.DRAW;
                }
                if (standings[match.opponent2]) {
                    standings[match.opponent2].played++;
                    standings[match.opponent2].drawn++;
                    standings[match.opponent2].points += POINTS.DRAW;
                }
            } else {
                // Winner and runner
                if (standings[match.winner]) {
                    standings[match.winner].played++;
                    standings[match.winner].won++;
                    standings[match.winner].points += POINTS.WIN;
                }
                if (standings[match.runner]) {
                    standings[match.runner].played++;
                    standings[match.runner].lost++;
                    standings[match.runner].points += POINTS.LOSS;
                }
            }
        } else if (match.draw) {
            // Legacy draw format
            const drawTeams = match.draw.split(',').map(t => t.trim());
            drawTeams.forEach(teamId => {
                if (standings[teamId]) {
                    standings[teamId].played++;
                    standings[teamId].drawn++;
                    standings[teamId].points += POINTS.DRAW;
                }
            });
        }
    });
    
    // Convert to array and sort
    const standingsArray = Object.values(standings);
    standingsArray.sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        if (b.won !== a.won) return b.won - a.won;
        return a.played - b.played;
    });
    
    // Mark top 2 as qualified
    standingsArray.forEach((team, index) => {
        team.qualified = index < 2;
        team.rank = index + 1;
    });
    
    return standingsArray;
}

// Render Standings View
function renderStandingsView() {
    if (!APP_STATE.dataLoaded) return;
    
    const tabsContainer = document.getElementById('teamTabs');
    const contentContainer = document.getElementById('teamContent');
    
    // Render team tabs
    tabsContainer.innerHTML = '';
    Object.keys(tournamentData).forEach((teamName, index) => {
        const tab = document.createElement('button');
        tab.className = 'team-tab' + (teamName === APP_STATE.currentTeam ? ' active' : '');
        tab.textContent = teamName;
        tab.addEventListener('click', () => switchTeamTab(teamName, 'standings'));
        tabsContainer.appendChild(tab);
    });
    
    // Render current team's content
    renderTeamStandings(APP_STATE.currentTeam);
}

function switchTeamTab(teamName, context) {
    APP_STATE.currentTeam = teamName;
    
    const tabsContainer = context === 'standings' ? 
        document.getElementById('teamTabs') : 
        document.getElementById('scheduleTeamTabs');
    
    // Update active tab
    tabsContainer.querySelectorAll('.team-tab').forEach(tab => {
        tab.classList.remove('active');
        if (tab.textContent === teamName) {
            tab.classList.add('active');
        }
    });
    
    // Render content
    if (context === 'standings') {
        renderTeamStandings(teamName);
    } else {
        renderTeamSchedule(teamName);
    }
}

function renderTeamStandings(teamName) {
    const contentContainer = document.getElementById('teamContent');
    const teamData = tournamentData[teamName];
    const standings = calculateStandings(teamName);
    
    let html = `
        <div class="card">
            <h2>${teamName} - Standings</h2>
            <p style="color: var(--text-light); margin-bottom: 1rem;">
                Manager: ${teamData.participants[0]?.manager || 'N/A'}
            </p>
            
            <div class="table-container">
                <table class="standings-table">
                    <thead>
                        <tr>
                            <th>Rank</th>
                            <th>Team</th>
                            <th>Players</th>
                            <th>P</th>
                            <th>W</th>
                            <th>L</th>
                            <th>D</th>
                            <th>Pts</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
    `;
    
    standings.forEach(team => {
        const rowClass = team.qualified ? 'qualified' : '';
        html += `
            <tr class="${rowClass}">
                <td><strong>${team.rank}</strong></td>
                <td><strong>${team.teamId}</strong></td>
                <td>${team.name1}${team.name2 ? ' & ' + team.name2 : ''}</td>
                <td>${team.played}</td>
                <td>${team.won}</td>
                <td>${team.lost}</td>
                <td>${team.drawn}</td>
                <td><strong>${team.points}</strong></td>
                <td>${team.qualified ? '<span class="qualified-badge">Qualified</span>' : '-'}</td>
            </tr>
        `;
    });
    
    html += `
                    </tbody>
                </table>
            </div>
            
            <div style="margin-top: 1rem; padding: 1rem; background: var(--bg-light); border-radius: 0.5rem; font-size: 0.875rem;">
                <strong>Points System:</strong> Win = ${POINTS.WIN} points | Draw = ${POINTS.DRAW} point | Loss = ${POINTS.LOSS} points<br>
                <strong>Qualification:</strong> Top 2 teams qualify for the next round
            </div>
        </div>
    `;
    
    contentContainer.innerHTML = html;
}

// Render Schedule View
function renderScheduleView() {
    if (!APP_STATE.dataLoaded) return;
    
    const tabsContainer = document.getElementById('scheduleTeamTabs');
    const contentContainer = document.getElementById('scheduleContent');
    
    // Render team tabs
    tabsContainer.innerHTML = '';
    Object.keys(tournamentData).forEach((teamName, index) => {
        const tab = document.createElement('button');
        tab.className = 'team-tab' + (teamName === APP_STATE.currentTeam ? ' active' : '');
        tab.textContent = teamName;
        tab.addEventListener('click', () => switchTeamTab(teamName, 'schedule'));
        tabsContainer.appendChild(tab);
    });
    
    // Render current team's content
    renderTeamSchedule(APP_STATE.currentTeam);
}

function renderTeamSchedule(teamName) {
    const contentContainer = document.getElementById('scheduleContent');
    const teamData = tournamentData[teamName];
    
    let html = `
        <div class="card">
            <h2>${teamName} - Match Schedule</h2>
    `;
    
    teamData.matches.forEach(match => {
        const status = getMatchStatus(match);
        const statusClass = status === 'Completed' ? 'completed' : (status === 'Draw' ? 'draw' : 'pending');
        
        html += `
            <div class="match-item">
                <div class="match-header">
                    <div>
                        <span class="match-number">Match ${match.matchNo}</span>
                        <span class="match-status ${statusClass}">${status}</span>
                    </div>
                </div>
                
                ${APP_STATE.isAdmin ? renderMatchForm(teamName, match) : renderMatchDisplay(match)}
            </div>
        `;
    });
    
    html += '</div>';
    contentContainer.innerHTML = html;
    
    // Add event listeners for admin forms
    if (APP_STATE.isAdmin) {
        attachMatchFormListeners(teamName);
    }
}

function getMatchStatus(match) {
    if (match.winner && match.runner) {
        return match.winner === match.runner ? 'Draw' : 'Completed';
    }
    if (match.draw) {
        return 'Draw';
    }
    return 'Pending';
}

function renderMatchDisplay(match) {
    const opponent1Data = getTeamData(APP_STATE.currentTeam, match.opponent1);
    const opponent2Data = getTeamData(APP_STATE.currentTeam, match.opponent2);
    
    let resultText = 'Not played yet';
    if (match.winner && match.runner) {
        if (match.winner === match.runner) {
            resultText = `Draw between ${match.winner} and ${match.runner}`;
        } else {
            resultText = `Winner: ${match.winner} | Runner: ${match.runner}`;
        }
    } else if (match.draw) {
        resultText = `Draw: ${match.draw}`;
    }
    
    return `
        <div class="match-details">
            <div class="match-detail">
                <span class="match-detail-label">Team 1</span>
                <span class="match-detail-value">${match.opponent1} - ${opponent1Data}</span>
            </div>
            <div class="match-detail">
                <span class="match-detail-label">Team 2</span>
                <span class="match-detail-value">${match.opponent2} - ${opponent2Data}</span>
            </div>
            <div class="match-detail">
                <span class="match-detail-label">Date</span>
                <span class="match-detail-value">${match.date || 'Not scheduled'}</span>
            </div>
            <div class="match-detail" style="grid-column: 1 / -1;">
                <span class="match-detail-label">Result</span>
                <span class="match-detail-value">${resultText}</span>
            </div>
        </div>
    `;
}

function renderMatchForm(teamName, match) {
    const teamData = tournamentData[teamName];
    const opponent1Data = getTeamData(teamName, match.opponent1);
    const opponent2Data = getTeamData(teamName, match.opponent2);
    
    return `
        <form class="match-form" data-team="${teamName}" data-match="${match.matchNo}">
            <div class="form-group">
                <label>Team 1: ${match.opponent1}</label>
                <input type="text" value="${opponent1Data}" disabled style="background: var(--bg-light);">
            </div>
            
            <div class="form-group">
                <label>Team 2: ${match.opponent2}</label>
                <input type="text" value="${opponent2Data}" disabled style="background: var(--bg-light);">
            </div>
            
            <div class="form-group">
                <label>Date</label>
                <input type="date" name="date" value="${match.date || ''}">
            </div>
            
            <div class="form-group">
                <label>Winner</label>
                <select name="winner">
                    <option value="">Select Winner</option>
                    <option value="${match.opponent1}" ${match.winner === match.opponent1 ? 'selected' : ''}>
                        ${match.opponent1} - ${opponent1Data}
                    </option>
                    <option value="${match.opponent2}" ${match.winner === match.opponent2 ? 'selected' : ''}>
                        ${match.opponent2} - ${opponent2Data}
                    </option>
                </select>
            </div>
            
            <div class="form-group">
                <label>Runner</label>
                <select name="runner">
                    <option value="">Select Runner</option>
                    <option value="${match.opponent1}" ${match.runner === match.opponent1 ? 'selected' : ''}>
                        ${match.opponent1} - ${opponent1Data}
                    </option>
                    <option value="${match.opponent2}" ${match.runner === match.opponent2 ? 'selected' : ''}>
                        ${match.opponent2} - ${opponent2Data}
                    </option>
                </select>
            </div>
            
            <div class="form-actions" style="grid-column: 1 / -1;">
                <button type="submit" class="btn btn-success">Save Match</button>
                <button type="button" class="btn btn-secondary mark-draw-btn">Mark as Draw</button>
                <button type="button" class="btn btn-danger clear-btn">Clear Result</button>
            </div>
            <div class="message-area" style="grid-column: 1 / -1;"></div>
        </form>
    `;
}

function getTeamData(teamName, teamId) {
    const teamData = tournamentData[teamName];
    const participant = teamData.participants.find(p => p.teamId === teamId);
    if (!participant) return 'Unknown';
    return participant.name1 + (participant.name2 ? ' & ' + participant.name2 : '');
}

function attachMatchFormListeners(teamName) {
    const forms = document.querySelectorAll('.match-form');
    
    forms.forEach(form => {
        // Save button
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            handleMatchSave(form);
        });
        
        // Draw button
        const drawBtn = form.querySelector('.mark-draw-btn');
        drawBtn.addEventListener('click', () => handleMarkDraw(form));
        
        // Clear button
        const clearBtn = form.querySelector('.clear-btn');
        clearBtn.addEventListener('click', () => handleClearMatch(form));
    });
}

function handleMatchSave(form) {
    const teamName = form.dataset.team;
    const matchNo = parseInt(form.dataset.match);
    const messageElement = form.querySelector('.message-area');
    
    const formData = {
        date: form.querySelector('[name="date"]').value,
        winner: form.querySelector('[name="winner"]').value,
        runner: form.querySelector('[name="runner"]').value
    };
    
    // Validation
    if (formData.winner && formData.runner) {
        if (formData.winner === formData.runner) {
            showMessage(messageElement, 'error', '⚠️ Winner and Runner cannot be the same team (unless it\'s a draw - use "Mark as Draw" button)');
            return;
        }
    }
    
    if ((formData.winner && !formData.runner) || (!formData.winner && formData.runner)) {
        showMessage(messageElement, 'error', '⚠️ Both Winner and Runner must be selected, or use "Mark as Draw"');
        return;
    }
    
    // Update data
    const match = tournamentData[teamName].matches.find(m => m.matchNo === matchNo);
    if (match) {
        match.date = formData.date;
        match.winner = formData.winner;
        match.runner = formData.runner;
        match.draw = '';
        
        // Save to Firebase
        saveToFirebase((success) => {
            if (success) {
                showMessage(messageElement, 'success', '✓ Match saved successfully!');
            } else {
                showMessage(messageElement, 'error', '❌ Failed to save to server. Try again.');
            }
        });
    }
}

function handleMarkDraw(form) {
    const teamName = form.dataset.team;
    const matchNo = parseInt(form.dataset.match);
    const messageElement = form.querySelector('.message-area');
    
    const match = tournamentData[teamName].matches.find(m => m.matchNo === matchNo);
    if (match) {
        // Set both winner and runner to indicate draw
        match.winner = match.opponent1;
        match.runner = match.opponent1;
        match.draw = `${match.opponent1},${match.opponent2}`;
        match.date = form.querySelector('[name="date"]').value;
        
        // Save to Firebase
        saveToFirebase((success) => {
            if (success) {
                showMessage(messageElement, 'success', '✓ Match marked as draw!');
            } else {
                showMessage(messageElement, 'error', '❌ Failed to save to server. Try again.');
            }
        });
    }
}

function handleClearMatch(form) {
    const teamName = form.dataset.team;
    const matchNo = parseInt(form.dataset.match);
    const messageElement = form.querySelector('.message-area');
    
    const match = tournamentData[teamName].matches.find(m => m.matchNo === matchNo);
    if (match) {
        match.winner = '';
        match.runner = '';
        match.draw = '';
        match.date = '';
        
        // Save to Firebase
        saveToFirebase((success) => {
            if (success) {
                showMessage(messageElement, 'success', '✓ Match cleared!');
            } else {
                showMessage(messageElement, 'error', '❌ Failed to save to server. Try again.');
            }
        });
    }
}

function showMessage(element, type, text) {
    element.className = 'message-area ' + (type === 'success' ? 'success-message' : 'error-message');
    element.textContent = text;
    
    setTimeout(() => {
        element.textContent = '';
        element.className = 'message-area';
    }, 3000);
}

// Render Overall Tournament View
function renderOverallView() {
    if (!APP_STATE.dataLoaded) return;
    
    const container = document.getElementById('overallStandings');
    
    const allStandings = [];
    
    Object.keys(tournamentData).forEach(teamName => {
        const standings = calculateStandings(teamName);
        standings.forEach(team => {
            allStandings.push({
                ...team,
                group: teamName
            });
        });
    });
    
    // Sort by qualification first, then by points
    allStandings.sort((a, b) => {
        if (a.qualified !== b.qualified) return b.qualified ? 1 : -1;
        if (b.points !== a.points) return b.points - a.points;
        if (b.won !== a.won) return b.won - a.won;
        return a.played - b.played;
    });
    
    let html = `
        <div class="card">
            <div class="table-container">
                <table class="standings-table">
                    <thead>
                        <tr>
                            <th>Group</th>
                            <th>Team</th>
                            <th>Players</th>
                            <th>P</th>
                            <th>W</th>
                            <th>L</th>
                            <th>D</th>
                            <th>Pts</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
    `;
    
    allStandings.forEach(team => {
        const rowClass = team.qualified ? 'qualified' : '';
        html += `
            <tr class="${rowClass}">
                <td><strong>${team.group}</strong></td>
                <td><strong>${team.teamId}</strong></td>
                <td>${team.name1}${team.name2 ? ' & ' + team.name2 : ''}</td>
                <td>${team.played}</td>
                <td>${team.won}</td>
                <td>${team.lost}</td>
                <td>${team.drawn}</td>
                <td><strong>${team.points}</strong></td>
                <td>${team.qualified ? '<span class="qualified-badge">Qualified</span>' : '-'}</td>
            </tr>
        `;
    });
    
    html += `
                    </tbody>
                </table>
            </div>
            
            <div style="margin-top: 1.5rem; padding: 1rem; background: var(--bg-light); border-radius: 0.5rem;">
                <h3>Tournament Statistics</h3>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-top: 1rem;">
                    <div>
                        <div style="font-size: 0.875rem; color: var(--text-light);">Total Teams</div>
                        <div style="font-size: 1.5rem; font-weight: 700; color: var(--primary-color);">${allStandings.length}</div>
                    </div>
                    <div>
                        <div style="font-size: 0.875rem; color: var(--text-light);">Qualified Teams</div>
                        <div style="font-size: 1.5rem; font-weight: 700; color: var(--success-color);">
                            ${allStandings.filter(t => t.qualified).length}
                        </div>
                    </div>
                    <div>
                        <div style="font-size: 0.875rem; color: var(--text-light);">Total Groups</div>
                        <div style="font-size: 1.5rem; font-weight: 700; color: var(--primary-color);">
                            ${Object.keys(tournamentData).length}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    container.innerHTML = html;
}
