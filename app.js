// FELIZZO '25 Carrom Tournament App with Firebase
// Application State
const APP_STATE = {
    isAdmin: false,
    currentView: 'home',
    currentTeam: null,
    adminPassword: 'f25ca',
    dataLoaded: false,
    isOnline: true,
    resetAction: null, // stores pending reset action
    firstBackupDone: false, // tracks if initial backup was created
    deferredPrompt: null // stores PWA install prompt
};

// Store original data for reset functionality
let originalTournamentData = null;

// Constants
const POINTS = {
    WIN: 2,
    DRAW: 1,
    LOSS: 0
};

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
    registerServiceWorker();
    setupInstallPrompt();
});

function initializeApp() {
    console.log('Initializing app...');
    
    // Setup event listeners
    setupEventListeners();
    
    // Load data from Firebase
    loadDataFromFirebase();
    
    // Monitor connection status
    monitorConnectionStatus();
    
    // Check if first backup was done (from localStorage)
    const backupDone = localStorage.getItem('felizzo_first_backup');
    if (backupDone === 'true') {
        APP_STATE.firstBackupDone = true;
    }
}

// Firebase Data Management
function loadDataFromFirebase() {
    updateSyncStatus('loading', '🔄 Loading data...');
    
    // Store original data for reset functionality (deep clone)
    if (!originalTournamentData) {
        originalTournamentData = JSON.parse(JSON.stringify(tournamentData));
    }
    
    tournamentRef.once('value', (snapshot) => {
        if (snapshot.exists()) {
            // Data exists in Firebase - use it
            console.log('Loading data from Firebase...');
            const firebaseData = snapshot.val();
            Object.assign(tournamentData, firebaseData);
            APP_STATE.dataLoaded = true;
            updateSyncStatus('synced', '✅ Synced');
            loadTieBreakersFromFirebase(); // Load tie-breaker results
            loadBracketFromFirebase(); // Load bracket
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
    
    // Pre-populate dates before saving
    populateMatchDates();
    
    tournamentRef.set(tournamentData)
        .then(() => {
            console.log('Firebase initialized successfully with dates!');
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

// Sync all existing completed matches to parent dashboard
function syncAllMatchesToParent() {
    let syncCount = 0;
    let totalMatches = 0;
    
    console.log('🔄 Starting historical sync to parent dashboard...');
    
    // Loop through all groups
    Object.keys(tournamentData).forEach(groupName => {
        const group = tournamentData[groupName];
        
        if (group.matches) {
            group.matches.forEach(match => {
                // Only sync completed matches
                if (match.winner && match.runner) {
                    totalMatches++;
                    
                    // Small delay between requests to avoid overwhelming server
                    setTimeout(() => {
                        sendToParentDashboard(groupName, match);
                        syncCount++;
                        
                        if (syncCount === totalMatches) {
                            console.log(`✅ Historical sync complete: ${syncCount} matches sent`);
                            alert(`✅ Synced ${syncCount} existing matches to parent dashboard!`);
                        }
                    }, syncCount * 100); // 100ms delay between each request
                }
            });
        }
    });
    
    if (totalMatches === 0) {
        alert('ℹ️ No completed matches found to sync.');
    } else {
        alert(`🔄 Syncing ${totalMatches} completed matches to parent dashboard...`);
    }
}

// ==================== PARENT DASHBOARD INTEGRATION ====================
// Syncs match results to parent dashboard at felizzo25-dashboard.onrender.com
function sendToParentDashboard(groupName, match) {
    // Skip if match has no result yet
    if (!match.winner || !match.runner) {
        return;
    }
    
    // Build match_id in format: GroupName_M1
    const cleanGroupName = groupName.replace(/\s+/g, '_');
    const match_id = `${cleanGroupName}_M${match.matchNo}`;
    
    // Determine winner value (1, 2, or 0 for draw)
    let winner;
    if (match.winner === match.runner) {
        // Draw case
        winner = 0;
    } else if (match.winner === match.opponent1) {
        // opponent1 won
        winner = 1;
    } else if (match.winner === match.opponent2) {
        // opponent2 won
        winner = 2;
    } else {
        // Invalid state - don't send
        console.warn('Invalid match state:', match);
        return;
    }
    
    // Prepare payload
    const payload = {
        match_id: match_id,
        winner: winner
    };
    
    // Send to parent dashboard API
    fetch('https://felizzo25-dashboard.onrender.com/api/carrom/submit-score', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    })
    .then(response => {
        if (!response.ok) {
            throw new Error(`API returned ${response.status}`);
        }
        return response.json();
    })
    .then(data => {
        console.log('✅ Synced to parent dashboard:', payload, data);
    })
    .catch(error => {
        console.error('⚠️ Parent dashboard sync failed (local save still succeeded):', error);
        // NOTE: We don't block the local save if parent API fails
        // This ensures Carrom app keeps working even if parent is down
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
    
    renderHomeView();
    renderStandingsView();
    renderScheduleView();
    renderParticipantsView();
    renderKnockoutView();
    renderChamberView();
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
    
    // Reset All button
    document.getElementById('resetAllBtn').addEventListener('click', () => {
        showResetModal('all');
    });
    
    // Backup button
    document.getElementById('backupBtn').addEventListener('click', () => {
        downloadBackup();
    });
    
    // Restore button
    document.getElementById('restoreBtn').addEventListener('click', () => {
        document.getElementById('restoreFile').click();
    });
    
    // Restore file input
    document.getElementById('restoreFile').addEventListener('change', handleRestore);
    
    // Sync to parent dashboard button
    document.getElementById('syncParentBtn').addEventListener('click', () => {
        if (confirm('This will sync all completed Carrom matches to the parent dashboard. Continue?')) {
            syncAllMatchesToParent();
        }
    });
    
    // Populate dates button
    document.getElementById('populateDatesBtn').addEventListener('click', handlePopulateDates);
    
    // Modal close buttons
    document.querySelector('.close').addEventListener('click', hideAdminModal);
    document.querySelector('.close-reset').addEventListener('click', hideResetModal);
    
    // Reset modal buttons
    document.getElementById('confirmResetBtn').addEventListener('click', confirmReset);
    document.getElementById('cancelResetBtn').addEventListener('click', hideResetModal);
    
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
        
        // Check if first backup was done
        if (!APP_STATE.firstBackupDone) {
            showFirstBackupModal();
        }
    } else {
        errorElement.textContent = 'Incorrect password. Please try again.';
    }
}

function updateAdminIndicator() {
    // Remove any existing indicator first
    const oldIndicator = document.querySelector('.admin-mode');
    if (oldIndicator) {
        oldIndicator.remove();
    }
    
    // Create fresh indicator with INLINE STYLES to force it
    const indicator = document.createElement('div');
    indicator.className = 'admin-mode';
    
    // FORCE small styles inline
    indicator.style.cssText = `
        position: fixed !important;
        bottom: 110px !important;
        right: 20px !important;
        background: linear-gradient(135deg, #8b5cf6, #7c3aed) !important;
        color: white !important;
        padding: 0.5rem 0.75rem !important;
        border-radius: 0.5rem !important;
        font-weight: 700 !important;
        font-size: 0.75rem !important;
        box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5) !important;
        z-index: 999 !important;
        letter-spacing: 1px !important;
        width: auto !important;
        max-width: fit-content !important;
    `;
    
    document.body.appendChild(indicator);
    
    const resetAllBtn = document.getElementById('resetAllBtn');
    const backupBtn = document.getElementById('backupBtn');
    const restoreBtn = document.getElementById('restoreBtn');
    const populateDatesBtn = document.getElementById('populateDatesBtn');
    const addTeamBtn = document.getElementById('addTeamBtn');
    const addTeamBtnParticipants = document.getElementById('addTeamBtnParticipants');
    const adminBtn = document.getElementById('adminBtn');
    const viewModeBtn = document.getElementById('viewModeBtn');
    const quickMatchJump = document.getElementById('quickMatchJump');
    const syncParentBtn = document.getElementById('syncParentBtn');
    
    if (APP_STATE.isAdmin) {
        indicator.textContent = '🔓 SU';
        indicator.style.opacity = '1';
        indicator.style.animation = 'pulse 2s infinite';
        resetAllBtn.style.display = 'inline-block';
        backupBtn.style.display = 'inline-block';
        restoreBtn.style.display = 'inline-block';
        syncParentBtn.style.display = 'inline-block';
        populateDatesBtn.style.display = 'inline-block';
        addTeamBtn.style.display = 'inline-block';
        if (addTeamBtnParticipants) addTeamBtnParticipants.style.display = 'inline-block';
        adminBtn.style.display = 'none';
        viewModeBtn.style.display = 'block';
        if (quickMatchJump) quickMatchJump.style.display = 'block';
    } else {
        indicator.textContent = '👁️ VIEW';
        indicator.style.opacity = '0.4';
        resetAllBtn.style.display = 'none';
        backupBtn.style.display = 'none';
        restoreBtn.style.display = 'none';
        syncParentBtn.style.display = 'none';
        populateDatesBtn.style.display = 'none';
        addTeamBtn.style.display = 'none';
        if (addTeamBtnParticipants) addTeamBtnParticipants.style.display = 'none';
        adminBtn.style.display = 'block';
        viewModeBtn.style.display = 'none';
        if (quickMatchJump) quickMatchJump.style.display = 'none';
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
        case 'home':
            renderHomeView();
            break;
        case 'standings':
            renderStandingsView();
            break;
        case 'schedule':
            renderScheduleView();
            break;
        case 'participants':
            renderParticipantsView();
            break;
        case 'tiebreaker':
            renderTieBreakerView();
            break;
        case 'knockout':
            renderKnockoutView();
            break;
        case 'chamber':
            renderChamberView();
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
    
    // Check if all matches are complete
    const totalMatches = teamData.matches.length;
    let completedMatches = 0;
    
    // Calculate from matches
    teamData.matches.forEach(match => {
        if (match.winner && match.runner) {
            completedMatches++;
            
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
            completedMatches++;
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
    
    // Check if ALL matches are complete
    const allMatchesComplete = (completedMatches === totalMatches);
    
    // Convert to array and sort
    const standingsArray = Object.values(standings);
    standingsArray.sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        if (b.won !== a.won) return b.won - a.won;
        return a.played - b.played;
    });
    
    // Mark qualification status based on Santo's logic
    standingsArray.forEach((team, index) => {
        team.rank = index + 1;
        team.qualified = false;
        team.qualificationType = null;
        
        if (!allMatchesComplete) {
            return; // No qualification until all matches complete
        }
        
        // Check for ties at each position
        const position = index + 1;
        const currentPoints = team.points;
        const nextTeam = standingsArray[index + 1];
        const prevTeam = standingsArray[index - 1];
        
        // Position 1 - Always qualified unless tied with position 2
        if (position === 1) {
            if (nextTeam && nextTeam.points === currentPoints) {
                team.qualificationType = 'Tie-Breaker Needed';
            } else {
                team.qualified = true;
                team.qualificationType = 'Guaranteed (1st)';
            }
        }
        // Position 2 - Qualified unless tied with position 1 or 3
        else if (position === 2) {
            // SE hardcode: top 3 always qualified
            if (teamName === 'SE') {
                team.qualified = true;
                team.qualificationType = 'Guaranteed (2nd)';
            } else if (prevTeam && prevTeam.points === currentPoints) {
                team.qualificationType = 'Tie-Breaker Needed';
            } else if (nextTeam && nextTeam.points === currentPoints) {
                team.qualificationType = 'Tie-Breaker Needed';
            } else {
                team.qualified = true;
                team.qualificationType = 'Guaranteed (2nd)';
            }
        }
        // Position 3 - Wild card eligible (except 1P and SE)
        else if (position === 3) {
            if (teamName === '1 P') {
                // 1P 3rd place: doesn't qualify (no play-in anymore)
                team.qualificationType = null;
            } else if (teamName === 'SE') {
                // SE hardcode: top 3 always qualified
                team.qualified = true;
                team.qualificationType = 'Guaranteed (3rd)';
            } else if (prevTeam && prevTeam.points === currentPoints) {
                // Tied with position 2
                team.qualificationType = 'Tie-Breaker Needed';
            } else if (nextTeam && nextTeam.points === currentPoints) {
                // Tied with position 4 for wild card
                team.qualificationType = 'Wild Card Tie-Breaker';
            } else {
                // Clear 3rd place - gets wild card
                team.qualified = true;
                team.qualificationType = 'Wild Card (3rd)';
            }
        }
        // Position 4+ - Check if tied with position 3 for wild card
        else if (position === 4 && teamName !== '1 P' && teamName !== 'SE') {
            if (prevTeam && prevTeam.points === currentPoints) {
                team.qualificationType = 'Wild Card Tie-Breaker';
            }
        }
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
        let statusHtml = '-';
        
        if (team.qualificationType) {
            if (team.qualified) {
                // Qualified teams - green badge
                statusHtml = `<span class="qualified-badge">${team.qualificationType}</span>`;
            } else if (team.qualificationType.includes('Tie-Breaker') || team.qualificationType.includes('Play-In')) {
                // Pending matches - yellow badge
                statusHtml = `<span style="background: var(--warning-color); color: white; padding: 0.25rem 0.75rem; border-radius: 12px; font-size: 0.85rem; font-weight: 600;">${team.qualificationType}</span>`;
            }
        }
        
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
                <td>${statusHtml}</td>
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
    
    // Setup filter listeners (once)
    setupScheduleFilters();
    
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

function setupScheduleFilters() {
    const statusFilter = document.getElementById('scheduleFilterStatus');
    const dateFilter = document.getElementById('scheduleFilterDate');
    const searchText = document.getElementById('scheduleSearchText');
    
    if (!statusFilter || !dateFilter || !searchText) return;
    
    // Remove existing listeners by cloning
    const newStatusFilter = statusFilter.cloneNode(true);
    const newDateFilter = dateFilter.cloneNode(true);
    const newSearchText = searchText.cloneNode(true);
    
    statusFilter.parentNode.replaceChild(newStatusFilter, statusFilter);
    dateFilter.parentNode.replaceChild(newDateFilter, dateFilter);
    searchText.parentNode.replaceChild(newSearchText, searchText);
    
    // Add new listeners
    newStatusFilter.addEventListener('change', () => renderTeamSchedule(APP_STATE.currentTeam));
    newDateFilter.addEventListener('change', () => renderTeamSchedule(APP_STATE.currentTeam));
    newSearchText.addEventListener('input', () => renderTeamSchedule(APP_STATE.currentTeam));
}

function renderTeamSchedule(teamName) {
    const contentContainer = document.getElementById('scheduleContent');
    const teamData = tournamentData[teamName];
    
    // Get filter values
    const statusFilter = document.getElementById('scheduleFilterStatus')?.value || '';
    const dateFilter = document.getElementById('scheduleFilterDate')?.value || '';
    const searchText = document.getElementById('scheduleSearchText')?.value.toLowerCase() || '';
    
    let html = `
        <div class="card">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                <h2>${teamName} - Match Schedule</h2>
                ${APP_STATE.isAdmin ? `<button class="btn btn-danger reset-team-btn" data-team="${teamName}">🔄 Reset ${teamName}</button>` : ''}
            </div>
    `;
    
    let matchesDisplayed = 0;
    
    teamData.matches.forEach(match => {
        const status = getMatchStatus(match);
        const statusClass = status === 'Completed' ? 'completed' : (status === 'Draw' ? 'draw' : 'pending');
        
        // Apply filters
        let include = true;
        
        // Status filter
        if (statusFilter) {
            const matchStatus = status.toLowerCase();
            if (matchStatus !== statusFilter) {
                include = false;
            }
        }
        
        // Date filter
        if (dateFilter) {
            const matchDate = match.date || '';
            if (matchDate !== dateFilter) {
                include = false;
            }
        }
        
        // Search filter
        if (searchText) {
            const team1Data = getTeamData(teamName, match.opponent1);
            const team2Data = getTeamData(teamName, match.opponent2);
            const searchString = `${match.opponent1} ${match.opponent2} ${team1Data} ${team2Data}`.toLowerCase();
            if (!searchString.includes(searchText)) {
                include = false;
            }
        }
        
        if (!include) return;
        
        matchesDisplayed++;
        
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
    
    if (matchesDisplayed === 0) {
        html += '<p style="text-align: center; padding: 2rem; color: var(--text-light);">No matches found with current filters</p>';
    }
    
    html += '</div>';
    contentContainer.innerHTML = html;
    
    // Add event listeners for admin forms
    if (APP_STATE.isAdmin) {
        attachMatchFormListeners(teamName);
        
        // Reset team button
        const resetTeamBtn = document.querySelector('.reset-team-btn');
        if (resetTeamBtn) {
            resetTeamBtn.addEventListener('click', (e) => {
                const team = e.target.dataset.team;
                showResetModal('team', team);
            });
        }
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
                <label>📅 Match Date (can update independently)</label>
                <div style="display: flex; gap: 0.5rem;">
                    <input type="date" name="date" value="${match.date || ''}" style="flex: 1;">
                    <button type="button" class="btn btn-primary save-date-btn" style="padding: 0.5rem 1rem;">
                        💾 Save Date
                    </button>
                </div>
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
        
        // Save Date button (independent)
        const saveDateBtn = form.querySelector('.save-date-btn');
        if (saveDateBtn) {
            saveDateBtn.addEventListener('click', () => handleDateOnlySave(form));
        }
        
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
                
                // Sync to parent dashboard (non-blocking)
                sendToParentDashboard(teamName, match);
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
                
                // Sync to parent dashboard (non-blocking)
                sendToParentDashboard(teamName, match);
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

// Reset Functionality
function showResetModal(action, teamName = null) {
    const modal = document.getElementById('resetModal');
    const message = document.getElementById('resetMessage');
    
    if (action === 'all') {
        APP_STATE.resetAction = { type: 'all' };
        message.innerHTML = '<strong>This will clear ALL match results for ALL teams.</strong><br>Are you sure?';
    } else if (action === 'team') {
        APP_STATE.resetAction = { type: 'team', teamName: teamName };
        message.innerHTML = `<strong>This will clear all match results for ${teamName} only.</strong><br>Are you sure?`;
    }
    
    modal.style.display = 'block';
}

function hideResetModal() {
    document.getElementById('resetModal').style.display = 'none';
    APP_STATE.resetAction = null;
}

function confirmReset() {
    if (!APP_STATE.resetAction) return;
    
    const action = APP_STATE.resetAction;
    
    if (action.type === 'all') {
        resetAllMatches();
    } else if (action.type === 'team') {
        resetTeamMatches(action.teamName);
    }
    
    hideResetModal();
}

function resetAllMatches() {
    // Auto-backup before reset
    autoBackupBeforeAction('Reset All');
    
    updateSyncStatus('saving', '🔄 Resetting all...');
    
    // Reset all teams to original state (clear match results)
    Object.keys(tournamentData).forEach(teamName => {
        tournamentData[teamName].matches.forEach((match, index) => {
            match.winner = '';
            match.runner = '';
            match.draw = '';
            match.date = '';
        });
    });
    
    // Save to Firebase
    saveToFirebase((success) => {
        if (success) {
            updateSyncStatus('synced', '✅ All matches reset!');
            setTimeout(() => updateSyncStatus('synced', '✅ Synced'), 2000);
        } else {
            updateSyncStatus('error', '❌ Reset failed');
        }
    });
}

function resetTeamMatches(teamName) {
    updateSyncStatus('saving', '🔄 Resetting team...');
    
    // Reset only this team's matches
    tournamentData[teamName].matches.forEach(match => {
        match.winner = '';
        match.runner = '';
        match.draw = '';
        match.date = '';
    });
    
    // Save to Firebase
    saveToFirebase((success) => {
        if (success) {
            updateSyncStatus('synced', `✅ ${teamName} reset!`);
            renderTeamSchedule(teamName);
            setTimeout(() => updateSyncStatus('synced', '✅ Synced'), 2000);
        } else {
            updateSyncStatus('error', '❌ Reset failed');
        }
    });
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
            
            <div style="margin-top: 1.5rem; text-align: center;">
                <button onclick="showTieBreakerSheet()" class="btn btn-warning" style="font-size: 1.1rem; padding: 0.75rem 2rem;">
                    ⚖️ View Tie-Breaker Sheet
                </button>
            </div>
        </div>
    `;
    
    container.innerHTML = html;
}

// ============================================
// BACKUP & RESTORE SYSTEM
// ============================================

function showFirstBackupModal() {
    const modal = document.getElementById('firstBackupModal');
    modal.style.display = 'block';
}

function hideFirstBackupModal() {
    const modal = document.getElementById('firstBackupModal');
    modal.style.display = 'none';
}

function handleFirstBackup() {
    // Download backup
    downloadBackup('first-backup');
    
    // Mark as done
    APP_STATE.firstBackupDone = true;
    localStorage.setItem('felizzo_first_backup', 'true');
    
    // Close modal
    hideFirstBackupModal();
    
    // Show success message
    updateSyncStatus('synced', '✅ First backup created!');
    setTimeout(() => updateSyncStatus('synced', '✅ Synced'), 3000);
}

function downloadBackup(prefix = 'backup') {
    try {
        // Get current data
        const backupData = {
            tournamentData: tournamentData,
            timestamp: new Date().toISOString(),
            version: '2.0'
        };
        
        // Convert to JSON
        const dataStr = JSON.stringify(backupData, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        
        // Create download link
        const url = URL.createObjectURL(dataBlob);
        const link = document.createElement('a');
        link.href = url;
        
        // Generate filename with date
        const date = new Date().toISOString().split('T')[0];
        const time = new Date().toTimeString().split(' ')[0].replace(/:/g, '-');
        link.download = `felizzo-${prefix}-${date}-${time}.json`;
        
        // Trigger download
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
        console.log('Backup downloaded successfully');
        
        // Show success message
        if (!APP_STATE.firstBackupDone || prefix !== 'first-backup') {
            updateSyncStatus('synced', '✅ Backup downloaded!');
            setTimeout(() => updateSyncStatus('synced', '✅ Synced'), 2000);
        }
        
        return true;
    } catch (error) {
        console.error('Backup failed:', error);
        updateSyncStatus('error', '❌ Backup failed');
        setTimeout(() => updateSyncStatus('synced', '✅ Synced'), 3000);
        return false;
    }
}

function handleRestore(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    // Show confirmation
    if (!confirm('⚠️ WARNING: This will replace ALL current data with the backup. Are you absolutely sure?')) {
        event.target.value = ''; // Clear file input
        return;
    }
    
    const reader = new FileReader();
    
    reader.onload = function(e) {
        try {
            updateSyncStatus('loading', '🔄 Restoring...');
            
            const backupData = JSON.parse(e.target.result);
            
            // Validate backup structure
            if (!backupData.tournamentData) {
                throw new Error('Invalid backup file format');
            }
            
            // Restore data
            Object.assign(tournamentData, backupData.tournamentData);
            
            // Save to Firebase
            saveToFirebase((success) => {
                if (success) {
                    updateSyncStatus('synced', '✅ Data restored!');
                    alert('✅ Data restored successfully from backup!');
                    
                    // Reload views
                    renderAllViews();
                    
                    setTimeout(() => updateSyncStatus('synced', '✅ Synced'), 3000);
                } else {
                    updateSyncStatus('error', '❌ Restore failed');
                    alert('❌ Failed to save restored data to server. Please try again.');
                }
            });
            
        } catch (error) {
            console.error('Restore failed:', error);
            updateSyncStatus('error', '❌ Invalid backup file');
            alert('❌ Failed to restore backup. File may be corrupted or invalid.');
        }
        
        // Clear file input
        event.target.value = '';
    };
    
    reader.onerror = function() {
        updateSyncStatus('error', '❌ Failed to read file');
        alert('❌ Failed to read backup file.');
        event.target.value = '';
    };
    
    reader.readAsText(file);
}

function autoBackupBeforeAction(actionName) {
    console.log(`Auto-backup before: ${actionName}`);
    const success = downloadBackup(`auto-before-${actionName.toLowerCase().replace(/\s+/g, '-')}`);
    
    if (success) {
        // Show brief notification
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 80px;
            right: 20px;
            background: #10b981;
            color: white;
            padding: 1rem 1.5rem;
            border-radius: 0.5rem;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            z-index: 10000;
            font-weight: 600;
        `;
        notification.textContent = `💾 Auto-backup created before ${actionName}`;
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 3000);
    }
    
    return success;
}

// ============================================
// DATE POPULATION & HOME VIEW
// ============================================

function populateMatchDates() {
    console.log('Populating match dates with round-robin scheduling...');
    
    // Date range: Nov 24 - Dec 10, 2025
    const startDate = new Date('2025-11-24');
    const endDate = new Date('2025-12-10');
    
    // Generate all dates
    const dates = [];
    let currentDate = new Date(startDate);
    
    while (currentDate <= endDate) {
        const dayOfWeek = currentDate.getDay(); // 0 = Sunday, 5 = Friday
        const isFriday = (dayOfWeek === 5);
        const matchCount = isFriday ? 20 : 15;
        
        dates.push({
            date: currentDate.toISOString().split('T')[0],
            isFriday: isFriday,
            matchCount: matchCount,
            assigned: 0
        });
        
        currentDate.setDate(currentDate.getDate() + 1);
    }
    
    // Organize matches by group for round-robin rotation
    const groupNames = Object.keys(tournamentData);
    const groupMatches = {};
    
    groupNames.forEach(groupName => {
        groupMatches[groupName] = tournamentData[groupName].matches.map((match, index) => ({
            groupName: groupName,
            matchIndex: index,
            match: match
        }));
    });
    
    // Find max matches in any group
    let maxMatchesPerGroup = 0;
    groupNames.forEach(groupName => {
        if (groupMatches[groupName].length > maxMatchesPerGroup) {
            maxMatchesPerGroup = groupMatches[groupName].length;
        }
    });
    
    console.log(`Max matches per group: ${maxMatchesPerGroup}`);
    console.log(`Total groups: ${groupNames.length}`);
    
    // Round-robin scheduling: rotate through groups
    let dateIndex = 0;
    let scheduledCount = 0;
    
    // For each round (0 to maxMatchesPerGroup)
    for (let round = 0; round < maxMatchesPerGroup; round++) {
        // For each group in order
        for (let groupIndex = 0; groupIndex < groupNames.length; groupIndex++) {
            const groupName = groupNames[groupIndex];
            const matches = groupMatches[groupName];
            
            // If this group has a match for this round
            if (round < matches.length) {
                // Find next available date slot
                while (dateIndex < dates.length && dates[dateIndex].assigned >= dates[dateIndex].matchCount) {
                    dateIndex++;
                }
                
                if (dateIndex >= dates.length) {
                    console.warn('Ran out of dates! Adding to last date.');
                    dateIndex = dates.length - 1;
                }
                
                // Assign date
                const currentDateObj = dates[dateIndex];
                matches[round].match.date = currentDateObj.date;
                currentDateObj.assigned++;
                scheduledCount++;
                
                console.log(`Scheduled: ${groupName} Match ${round + 1} on ${currentDateObj.date} (${currentDateObj.assigned}/${currentDateObj.matchCount})`);
            }
        }
    }
    
    console.log(`Total matches scheduled: ${scheduledCount}`);
    console.log('Match dates populated with round-robin rotation!');
}

function renderHomeView() {
    if (!APP_STATE.dataLoaded) return;
    
    const tbody = document.getElementById('scheduleTableBody');
    if (!tbody) return;
    
    // Populate group filter dropdown
    const groupFilter = document.getElementById('homeFilterGroup');
    if (groupFilter && groupFilter.options.length === 1) {
        Object.keys(tournamentData).forEach(groupName => {
            const option = document.createElement('option');
            option.value = groupName;
            option.textContent = groupName;
            groupFilter.appendChild(option);
        });
    }
    
    // Add filter event listeners
    setupHomeFilters();
    
    // Render matches
    renderHomeMatches();
}

function setupHomeFilters() {
    const groupFilter = document.getElementById('homeFilterGroup');
    const statusFilter = document.getElementById('homeFilterStatus');
    const dateFilter = document.getElementById('homeFilterDate');
    const searchText = document.getElementById('homeSearchText');
    
    // Remove existing listeners
    const newGroupFilter = groupFilter.cloneNode(true);
    const newStatusFilter = statusFilter.cloneNode(true);
    const newDateFilter = dateFilter.cloneNode(true);
    const newSearchText = searchText.cloneNode(true);
    
    groupFilter.parentNode.replaceChild(newGroupFilter, groupFilter);
    statusFilter.parentNode.replaceChild(newStatusFilter, statusFilter);
    dateFilter.parentNode.replaceChild(newDateFilter, dateFilter);
    searchText.parentNode.replaceChild(newSearchText, searchText);
    
    // Add new listeners
    newGroupFilter.addEventListener('change', renderHomeMatches);
    newStatusFilter.addEventListener('change', renderHomeMatches);
    newDateFilter.addEventListener('change', renderHomeMatches);
    newSearchText.addEventListener('input', renderHomeMatches);
}

function renderHomeMatches() {
    const tbody = document.getElementById('scheduleTableBody');
    if (!tbody) return;
    
    // Get filter values
    const groupFilter = document.getElementById('homeFilterGroup')?.value || '';
    const statusFilter = document.getElementById('homeFilterStatus')?.value || '';
    const dateFilter = document.getElementById('homeFilterDate')?.value || '';
    const searchText = document.getElementById('homeSearchText')?.value.toLowerCase() || '';
    
    console.log('Date filter value:', dateFilter);
    
    // Collect all matches with ORIGINAL serial numbers (dynamic based on total)
    const allMatches = [];
    let serialNo = 1;
    
    Object.keys(tournamentData).forEach(groupName => {
        const group = tournamentData[groupName];
        
        group.matches.forEach(match => {
            // Get participant details
            const team1 = group.participants.find(p => p.teamId === match.opponent1);
            const team2 = group.participants.find(p => p.teamId === match.opponent2);
            
            const matchData = {
                originalSerialNo: serialNo, // KEEP ORIGINAL NUMBER (dynamic)
                groupName: groupName,
                matchNo: match.matchNo,
                team1Id: match.opponent1,
                team1Name1: team1?.name1 || 'Unknown',
                team1Name2: team1?.name2 || '',
                team2Id: match.opponent2,
                team2Name1: team2?.name1 || 'Unknown',
                team2Name2: team2?.name2 || '',
                date: match.date || '',
                winner: match.winner,
                runner: match.runner,
                draw: match.draw
            };
            
            // Apply filters
            let include = true;
            
            // Group filter
            if (groupFilter && matchData.groupName !== groupFilter) {
                include = false;
            }
            
            // Status filter
            if (statusFilter) {
                let matchStatus = 'pending';
                if (matchData.winner && matchData.runner) {
                    matchStatus = (matchData.winner === matchData.runner) ? 'draw' : 'completed';
                }
                if (matchStatus !== statusFilter) {
                    include = false;
                }
            }
            
            // Date filter - FIX: Compare dates properly
            if (dateFilter) {
                console.log('Comparing:', matchData.date, '===', dateFilter);
                if (matchData.date !== dateFilter) {
                    include = false;
                }
            }
            
            // Search filter
            if (searchText) {
                const searchString = `${matchData.team1Id} ${matchData.team1Name1} ${matchData.team1Name2} ${matchData.team2Id} ${matchData.team2Name1} ${matchData.team2Name2} ${matchData.groupName}`.toLowerCase();
                if (!searchString.includes(searchText)) {
                    include = false;
                }
            }
            
            if (include) {
                allMatches.push(matchData);
            }
            
            serialNo++; // Increment for EVERY match (filtered or not)
        });
    });
    
    console.log('Matches after filter:', allMatches.length);
    
    // Calculate summary statistics
    const summary = {
        total: allMatches.length,
        completed: 0,
        pending: 0,
        draw: 0
    };
    
    allMatches.forEach(match => {
        if (match.winner && match.runner) {
            if (match.winner === match.runner) {
                summary.draw++;
            } else {
                summary.completed++;
            }
        } else {
            summary.pending++;
        }
    });
    
    const completionPercentage = summary.total > 0 
        ? Math.round(((summary.completed + summary.draw) / summary.total) * 100) 
        : 0;
    
    // Update summary display
    const filterSummary = document.getElementById('filterSummary');
    const hasActiveFilters = groupFilter || statusFilter || dateFilter || searchText;
    
    if (filterSummary) {
        if (hasActiveFilters) {
            filterSummary.style.display = 'block';
            document.getElementById('summaryTotal').textContent = summary.total;
            document.getElementById('summaryCompleted').textContent = summary.completed;
            document.getElementById('summaryPending').textContent = summary.pending;
            document.getElementById('summaryDraw').textContent = summary.draw;
            document.getElementById('summaryPercentage').textContent = `${completionPercentage}%`;
        } else {
            filterSummary.style.display = 'none';
        }
    }
    
    // Sort by date
    allMatches.sort((a, b) => {
        if (!a.date) return 1;
        if (!b.date) return -1;
        return new Date(a.date) - new Date(b.date);
    });
    
    // Render table rows using ORIGINAL serial numbers
    let html = '';
    allMatches.forEach((match) => {
        const team1Players = `${match.team1Name1}${match.team1Name2 ? ' & ' + match.team1Name2 : ''}`;
        const team2Players = `${match.team2Name1}${match.team2Name2 ? ' & ' + match.team2Name2 : ''}`;
        
        // Determine status
        let status = 'Pending';
        let statusClass = 'pending';
        if (match.winner && match.runner) {
            if (match.winner === match.runner) {
                status = 'Draw';
                statusClass = 'draw';
            } else {
                status = 'Completed';
                statusClass = 'completed';
            }
        }
        
        // Format date
        const formattedDate = match.date 
            ? new Date(match.date).toLocaleDateString('en-US', { 
                month: 'short', 
                day: 'numeric', 
                year: 'numeric' 
              })
            : 'Not scheduled';
        
        html += `
            <tr>
                <td><strong>${match.originalSerialNo}</strong></td>
                <td>Match ${match.matchNo}</td>
                <td>
                    <strong>${match.team1Id}</strong><br>
                    <span style="font-size: 0.85rem; color: var(--text-light);">${team1Players}</span>
                </td>
                <td>
                    <strong>${match.team2Id}</strong><br>
                    <span style="font-size: 0.85rem; color: var(--text-light);">${team2Players}</span>
                </td>
                <td><strong>${match.groupName}</strong></td>
                <td>${formattedDate}</td>
                <td><span class="match-status ${statusClass}">${status}</span></td>
            </tr>
        `;
    });
    
    if (allMatches.length === 0) {
        html = '<tr><td colspan="7" style="text-align: center; padding: 2rem; color: var(--text-light);">No matches found with current filters</td></tr>';
    }
    
    tbody.innerHTML = html;
}

// ============================================
// QUICK MATCH JUMP & UPDATE
// ============================================

function jumpToMatch() {
    const matchNumber = parseInt(document.getElementById('quickMatchNumber').value);
    
    const totalMatches = getTotalMatches();
    
    if (!matchNumber || matchNumber < 1 || matchNumber > totalMatches) {
        alert(`Please enter a valid match number (1-${totalMatches})`);
        return;
    }
    
    // Find the match by global serial number from home schedule
    let foundMatch = null;
    let foundGroup = null;
    let serialNo = 1;
    
    Object.keys(tournamentData).forEach(groupName => {
        const group = tournamentData[groupName];
        
        group.matches.forEach(match => {
            if (serialNo === matchNumber) {
                foundMatch = match;
                foundGroup = groupName;
            }
            serialNo++;
        });
    });
    
    if (!foundMatch) {
        alert(`Match #${matchNumber} not found!`);
        return;
    }
    
    // Display the match update form
    displayQuickMatchForm(foundGroup, foundMatch, matchNumber);
}

function displayQuickMatchForm(groupName, match, globalMatchNo) {
    const formContainer = document.getElementById('quickMatchForm');
    const group = tournamentData[groupName];
    
    // Get team details
    const team1 = group.participants.find(p => p.teamId === match.opponent1);
    const team2 = group.participants.find(p => p.teamId === match.opponent2);
    
    const team1Players = `${team1?.name1 || 'Unknown'}${team1?.name2 ? ' & ' + team1.name2 : ''}`;
    const team2Players = `${team2?.name1 || 'Unknown'}${team2?.name2 ? ' & ' + team2.name2 : ''}`;
    
    const status = getMatchStatus(match);
    const formattedDate = match.date 
        ? new Date(match.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : 'Not scheduled';
    
    formContainer.innerHTML = `
        <div style="background: linear-gradient(135deg, rgba(14, 165, 233, 0.1), rgba(139, 92, 246, 0.1)); padding: 1.5rem; border-radius: 0.75rem; border: 2px solid var(--primary-color);">
            <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 1rem;">
                <div>
                    <h3 style="color: var(--primary-color); margin-bottom: 0.5rem;">
                        ⚡ Match #${globalMatchNo} - ${groupName}
                    </h3>
                    <p style="color: var(--text-light); margin: 0;">📅 ${formattedDate} | Status: ${status}</p>
                </div>
                <button onclick="closeQuickMatchForm()" class="btn btn-secondary" style="padding: 0.5rem 1rem;">✕</button>
            </div>
            
            <div style="display: grid; grid-template-columns: 1fr auto 1fr; gap: 1rem; align-items: center; margin-bottom: 1.5rem;">
                <div style="text-align: center; padding: 1rem; background: var(--bg-dark); border-radius: 0.5rem;">
                    <div style="font-size: 1.5rem; font-weight: 700; color: var(--primary-color);">${match.opponent1}</div>
                    <div style="font-size: 0.9rem; color: var(--text-light); margin-top: 0.25rem;">${team1Players}</div>
                </div>
                <div style="font-size: 1.5rem; font-weight: 700; color: var(--text-secondary);">VS</div>
                <div style="text-align: center; padding: 1rem; background: var(--bg-dark); border-radius: 0.5rem;">
                    <div style="font-size: 1.5rem; font-weight: 700; color: var(--secondary-color);">${match.opponent2}</div>
                    <div style="font-size: 0.9rem; color: var(--text-light); margin-top: 0.25rem;">${team2Players}</div>
                </div>
            </div>
            
            <div class="match-form">
                <div class="form-group">
                    <label>Winner</label>
                    <select id="quick_winner_${globalMatchNo}">
                        <option value="">Select Winner</option>
                        <option value="${match.opponent1}" ${match.winner === match.opponent1 ? 'selected' : ''}>${match.opponent1}</option>
                        <option value="${match.opponent2}" ${match.winner === match.opponent2 ? 'selected' : ''}>${match.opponent2}</option>
                        <option value="draw" ${match.winner === 'draw' ? 'selected' : ''}>Draw</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Runner-up</label>
                    <select id="quick_runner_${globalMatchNo}">
                        <option value="">Select Runner</option>
                        <option value="${match.opponent1}" ${match.runner === match.opponent1 ? 'selected' : ''}>${match.opponent1}</option>
                        <option value="${match.opponent2}" ${match.runner === match.opponent2 ? 'selected' : ''}>${match.opponent2}</option>
                        <option value="draw" ${match.runner === 'draw' ? 'selected' : ''}>Draw</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Match Date</label>
                    <input type="date" id="quick_date_${globalMatchNo}" value="${match.date || ''}" 
                           min="2025-11-24" max="2025-12-10">
                </div>
            </div>
            
            <div style="display: flex; gap: 1rem; margin-top: 1.5rem;">
                <button onclick="saveQuickMatch('${groupName}', ${match.matchNo}, ${globalMatchNo})" class="btn btn-success" style="flex: 1;">
                    💾 Save & Next Match
                </button>
                <button onclick="saveQuickMatch('${groupName}', ${match.matchNo}, ${globalMatchNo}, true)" class="btn btn-primary">
                    ✅ Save Only
                </button>
            </div>
        </div>
    `;
    
    formContainer.style.display = 'block';
    formContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function saveQuickMatch(groupName, groupMatchNo, globalMatchNo, stayOnMatch = false) {
    const winner = document.getElementById(`quick_winner_${globalMatchNo}`).value;
    const runner = document.getElementById(`quick_runner_${globalMatchNo}`).value;
    const date = document.getElementById(`quick_date_${globalMatchNo}`).value;
    
    if (!winner || !runner) {
        alert('Please select both winner and runner-up');
        return;
    }
    
    // Find and update the match
    const group = tournamentData[groupName];
    const match = group.matches.find(m => m.matchNo === groupMatchNo);
    
    if (match) {
        match.winner = winner;
        match.runner = runner;
        match.date = date;
        match.draw = (winner === 'draw' && runner === 'draw') ? 'yes' : '';
        
        updateSyncStatus('saving', '💾 Saving...');
        
        saveToFirebase((success) => {
            if (success) {
                updateSyncStatus('synced', '✅ Saved!');
                
                // Refresh views
                renderAllViews();
                
                if (!stayOnMatch) {
                    // Move to next match (global number)
                    const nextGlobalNo = globalMatchNo + 1;
                    const totalMatches = getTotalMatches();
                    if (nextGlobalNo <= totalMatches) {
                        document.getElementById('quickMatchNumber').value = nextGlobalNo;
                        jumpToMatch();
                    } else {
                        alert('✅ All matches completed!');
                        closeQuickMatchForm();
                    }
                } else {
                    closeQuickMatchForm();
                }
                
                setTimeout(() => updateSyncStatus('synced', '✅ Synced'), 2000);
            } else {
                updateSyncStatus('error', '❌ Save failed');
            }
        });
    }
}

function closeQuickMatchForm() {
    document.getElementById('quickMatchForm').style.display = 'none';
    document.getElementById('quickMatchNumber').value = '';
}

// ============================================
// COPY TABLE FOR EMAIL
// ============================================

function copyTableToClipboard() {
    const table = document.getElementById('scheduleTable');
    
    if (!table) {
        alert('No table found!');
        return;
    }
    
    // Create a clean text version
    let text = 'FELIZZO \'25 Carrom Tournament - Match Schedule\n';
    text += 'November 24 - December 10, 2025\n';
    text += '='.repeat(80) + '\n\n';
    
    const rows = table.querySelectorAll('tr');
    
    rows.forEach((row, index) => {
        const cells = row.querySelectorAll('th, td');
        let rowText = [];
        
        cells.forEach(cell => {
            // Get text content, clean up
            let cellText = cell.textContent.trim().replace(/\s+/g, ' ');
            rowText.push(cellText);
        });
        
        text += rowText.join('\t') + '\n';
        
        // Add separator after header
        if (index === 0) {
            text += '-'.repeat(80) + '\n';
        }
    });
    
    // Copy to clipboard
    navigator.clipboard.writeText(text).then(() => {
        // Show success message
        const btn = event.target;
        const originalText = btn.textContent;
        btn.textContent = '✅ Copied!';
        btn.style.background = 'var(--success-color)';
        
        setTimeout(() => {
            btn.textContent = originalText;
            btn.style.background = '';
        }, 2000);
    }).catch(err => {
        alert('Failed to copy. Please try selecting and copying manually.');
        console.error('Copy failed:', err);
    });
}

// ============================================
// PARTICIPANTS VIEW
// ============================================

function renderParticipantsView() {
    if (!APP_STATE.dataLoaded) return;
    
    const tbody = document.getElementById('participantsTableBody');
    const searchInput = document.getElementById('participantsSearch');
    
    if (!tbody) return;
    
    // Setup search listener
    if (searchInput && !searchInput.dataset.listenerAdded) {
        searchInput.addEventListener('input', renderParticipantsTable);
        searchInput.dataset.listenerAdded = 'true';
    }
    
    renderParticipantsTable();
}

function renderParticipantsTable() {
    const tbody = document.getElementById('participantsTableBody');
    const searchText = document.getElementById('participantsSearch')?.value.toLowerCase() || '';
    
    // Collect all participants
    const allParticipants = [];
    let serialNo = 1;
    
    Object.keys(tournamentData).forEach(groupName => {
        const group = tournamentData[groupName];
        
        group.participants.forEach(participant => {
            // Apply search filter
            if (searchText) {
                const searchString = `${groupName} ${participant.teamId} ${participant.name1} ${participant.name2} ${participant.manager}`.toLowerCase();
                if (!searchString.includes(searchText)) {
                    return;
                }
            }
            
            allParticipants.push({
                serialNo: serialNo++,
                groupName: groupName,
                teamId: participant.teamId,
                name1: participant.name1,
                name2: participant.name2 || '',
                manager: participant.manager
            });
        });
    });
    
    // Render table rows
    let html = '';
    allParticipants.forEach(p => {
        html += `
            <tr>
                <td><strong>${p.serialNo}</strong></td>
                <td><strong>${p.groupName}</strong></td>
                <td><span style="font-size: 1.1rem; font-weight: 700; color: var(--primary-color);">${p.teamId}</span></td>
                <td>${p.name1}</td>
                <td>${p.name2 || '-'}</td>
                <td>${p.manager}</td>
                <td class="admin-only" style="display: none;">
                    <button class="btn btn-secondary" style="padding: 0.5rem 1rem; font-size: 0.85rem;" 
                            onclick="editParticipant('${p.groupName}', '${p.teamId}')">
                        ✏️ Edit
                    </button>
                </td>
            </tr>
        `;
    });
    
    if (allParticipants.length === 0) {
        html = '<tr><td colspan="7" style="text-align: center; padding: 2rem; color: var(--text-light);">No participants found</td></tr>';
    }
    
    tbody.innerHTML = html;
    
    // Show/hide admin column
    const adminCells = document.querySelectorAll('.admin-only');
    adminCells.forEach(cell => {
        cell.style.display = APP_STATE.isAdmin ? 'table-cell' : 'none';
    });
}

function editParticipant(groupName, teamId) {
    const group = tournamentData[groupName];
    const participant = group.participants.find(p => p.teamId === teamId);
    
    if (!participant) return;
    
    const name1 = prompt(`Edit Player 1 name for Team ${teamId}:`, participant.name1);
    if (name1 !== null && name1.trim() !== '') {
        participant.name1 = name1.trim();
    }
    
    const name2 = prompt(`Edit Player 2 name for Team ${teamId} (leave empty if solo):`, participant.name2 || '');
    if (name2 !== null) {
        participant.name2 = name2.trim();
    }
    
    // Save to Firebase
    updateSyncStatus('saving', '💾 Saving...');
    saveToFirebase((success) => {
        if (success) {
            updateSyncStatus('synced', '✅ Saved!');
            renderAllViews();
            setTimeout(() => updateSyncStatus('synced', '✅ Synced'), 2000);
        } else {
            updateSyncStatus('error', '❌ Save failed');
        }
    });
}


function handlePopulateDates() {
    if (!confirm('⚠️ This will populate/update dates for ALL matches. Continue?')) {
        return;
    }
    
    updateSyncStatus('saving', '🔄 Populating dates...');
    
    // Populate dates
    populateMatchDates();
    
    // Save to Firebase
    saveToFirebase((success) => {
        if (success) {
            updateSyncStatus('synced', '✅ Dates populated!');
            alert('✅ All match dates have been populated successfully!');
            renderAllViews();
            setTimeout(() => updateSyncStatus('synced', '✅ Synced'), 2000);
        } else {
            updateSyncStatus('error', '❌ Failed to populate dates');
            alert('❌ Failed to save dates. Please try again.');
        }
    });
}



// ============================================
// PWA SUPPORT - MAKE IT AN APP!
// ============================================

function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/service-worker.js')
            .then(registration => {
                console.log('✅ PWA: Service Worker registered!');
            })
            .catch(error => {
                console.log('❌ PWA: Service Worker registration failed:', error);
            });
    }
}

function setupInstallPrompt() {
    // Capture install prompt
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        APP_STATE.deferredPrompt = e;
        showInstallButton();
    });
    
    // Track successful install
    window.addEventListener('appinstalled', () => {
        console.log('✅ PWA: App installed successfully!');
        APP_STATE.deferredPrompt = null;
        hideInstallButton();
    });
}

function showInstallButton() {
    // Create install button
    let installBtn = document.getElementById('pwaInstallBtn');
    
    if (!installBtn) {
        installBtn = document.createElement('button');
        installBtn.id = 'pwaInstallBtn';
        installBtn.className = 'floating-corner-btn';
        installBtn.style.cssText = `
            position: fixed;
            bottom: 220px;
            right: 20px;
            background: linear-gradient(135deg, #10b981, #059669);
            color: white;
            padding: 0.75rem;
            border: none;
            border-radius: 50%;
            font-weight: 700;
            font-size: 1.5rem;
            cursor: pointer;
            box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
            z-index: 998;
            animation: pulse 2s infinite;
            width: 3.5rem;
            height: 3.5rem;
            display: flex;
            align-items: center;
            justify-content: center;
        `;
        installBtn.innerHTML = '📱';
        installBtn.onclick = installPWA;
        document.body.appendChild(installBtn);
    }
}

function hideInstallButton() {
    const installBtn = document.getElementById('pwaInstallBtn');
    if (installBtn) {
        installBtn.remove();
    }
}

function installPWA() {
    const promptEvent = APP_STATE.deferredPrompt;
    
    if (!promptEvent) {
        return;
    }
    
    // Show install prompt
    promptEvent.prompt();
    
    // Wait for user choice
    promptEvent.userChoice.then((choiceResult) => {
        if (choiceResult.outcome === 'accepted') {
            console.log('✅ User accepted PWA install');
        } else {
            console.log('❌ User dismissed PWA install');
        }
        APP_STATE.deferredPrompt = null;
        hideInstallButton();
    });
}

// ============================================
// KNOCKOUT STAGE
// ============================================

// Knockout data structure
// ============================================
// TIE-BREAKER MANAGEMENT
// ============================================

function renderTieBreakerView() {
    if (!APP_STATE.dataLoaded) return;
    
    const container = document.getElementById('tiebreakerView');
    if (!container) return;
    
    const qualificationData = getQualificationSummary();
    
    let html = '<div class="card"><h2>⚖️ Tie-Breaker Management</h2>';
    html += '<p style="color: var(--text-secondary); margin-bottom: 2rem;">Update tie-breaker match results to determine final qualification</p>';
    
    if (qualificationData.tieBreakers.length === 0 && !qualificationData.playIn) {
        html += '<div class="alert alert-success">✅ No tie-breakers needed! All qualifications are clear.</div>';
    } else {
        // Tie-breaker matches
        if (qualificationData.tieBreakers.length > 0) {
            html += '<h3 style="color: #f59e0b; margin-bottom: 1rem;">⚠️ Tie-Breaker Matches</h3>';
            
            qualificationData.tieBreakers.forEach((tb, idx) => {
                const matchKey = `${tb.group}-${tb.team1}-${tb.team2}`;
                const currentWinner = knockoutData.tieBreakerResults[matchKey];
                const names1 = getTeamDisplay(tb.group, tb.team1);
                const names2 = getTeamDisplay(tb.group, tb.team2);
                
                html += `<div style="background: white; border: 2px solid ${currentWinner ? '#10b981' : '#f59e0b'}; border-radius: 12px; padding: 1.5rem; margin-bottom: 1.5rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                        <h4 style="color: #92400e; margin: 0;">Match ${idx + 1}: ${tb.group}</h4>
                        ${currentWinner ? '<span style="background: #10b981; color: white; padding: 0.25rem 0.75rem; border-radius: 12px; font-size: 0.85rem; font-weight: 600;">✅ Result Updated</span>' : ''}
                    </div>
                    
                    <div style="display: grid; grid-template-columns: 1fr auto 1fr; gap: 1rem; align-items: center; margin-bottom: 1rem;">
                        <div style="text-align: center; padding: 1rem; background: ${currentWinner === tb.team1 ? '#d1fae5' : '#f9fafb'}; border: 2px solid ${currentWinner === tb.team1 ? '#10b981' : '#e5e7eb'}; border-radius: 8px;">
                            <strong style="font-size: 1.1rem;">${names1}</strong><br>
                            <span style="font-size: 0.85rem; color: #64748b;">${tb.points} points</span>
                            ${currentWinner === tb.team1 ? '<div style="margin-top: 0.5rem; color: #10b981; font-weight: 700;">👑 WINNER</div>' : ''}
                        </div>
                        <div style="font-weight: 700; color: #64748b; font-size: 1.2rem;">VS</div>
                        <div style="text-align: center; padding: 1rem; background: ${currentWinner === tb.team2 ? '#d1fae5' : '#f9fafb'}; border: 2px solid ${currentWinner === tb.team2 ? '#10b981' : '#e5e7eb'}; border-radius: 8px;">
                            <strong style="font-size: 1.1rem;">${names2}</strong><br>
                            <span style="font-size: 0.85rem; color: #64748b;">${tb.points} points</span>
                            ${currentWinner === tb.team2 ? '<div style="margin-top: 0.5rem; color: #10b981; font-weight: 700;">👑 WINNER</div>' : ''}
                        </div>
                    </div>
                    
                    <div style="text-align: center; margin-bottom: 1rem; padding: 0.75rem; background: #fef3c7; border-radius: 8px; font-size: 0.9rem; color: #92400e;">
                        ${tb.type === 'guaranteed' ? '🏆 Winner → Guaranteed Spot | Loser → Wild Card' : '🎟️ Winner → Wild Card Spot'}
                    </div>
                    
                    <div style="display: flex; gap: 1rem; justify-content: center;">
                        <button onclick="updateTieBreakerResult('${matchKey}', '${tb.team1}')" class="btn ${currentWinner === tb.team1 ? 'btn-success' : 'btn-primary'}">
                            ${names1} Wins
                        </button>
                        <button onclick="updateTieBreakerResult('${matchKey}', '${tb.team2}')" class="btn ${currentWinner === tb.team2 ? 'btn-success' : 'btn-primary'}">
                            ${names2} Wins
                        </button>
                    </div>
                </div>`;
            });
        }
        
        // Play-in match
        if (qualificationData.playIn) {
            const playInKey = 'playin-1P-SE';
            const currentWinner = knockoutData.tieBreakerResults[playInKey];
            const names1 = getTeamDisplay('1 P', qualificationData.playIn.team1);
            const names2 = getTeamDisplay('SE', qualificationData.playIn.team2);
            
            html += '<h3 style="color: #8b5cf6; margin: 2rem 0 1rem 0;">🥊 Play-In Match (32nd Spot)</h3>';
            html += `<div style="background: white; border: 2px solid ${currentWinner ? '#10b981' : '#8b5cf6'}; border-radius: 12px; padding: 1.5rem;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                    <h4 style="color: #6d28d9; margin: 0;">Final Qualification Match</h4>
                    ${currentWinner ? '<span style="background: #10b981; color: white; padding: 0.25rem 0.75rem; border-radius: 12px; font-size: 0.85rem; font-weight: 600;">✅ Result Updated</span>' : ''}
                </div>
                
                <div style="display: grid; grid-template-columns: 1fr auto 1fr; gap: 1rem; align-items: center; margin-bottom: 1rem;">
                    <div style="text-align: center; padding: 1rem; background: ${currentWinner === qualificationData.playIn.team1 ? '#d1fae5' : '#f9fafb'}; border: 2px solid ${currentWinner === qualificationData.playIn.team1 ? '#10b981' : '#e5e7eb'}; border-radius: 8px;">
                        <strong style="font-size: 1.1rem;">${names1}</strong><br>
                        <span style="font-size: 0.85rem; color: #64748b;">1 P - 3rd place</span>
                        ${currentWinner === qualificationData.playIn.team1 ? '<div style="margin-top: 0.5rem; color: #10b981; font-weight: 700;">👑 WINNER</div>' : ''}
                    </div>
                    <div style="font-weight: 700; color: #64748b; font-size: 1.2rem;">VS</div>
                    <div style="text-align: center; padding: 1rem; background: ${currentWinner === qualificationData.playIn.team2 ? '#d1fae5' : '#f9fafb'}; border: 2px solid ${currentWinner === qualificationData.playIn.team2 ? '#10b981' : '#e5e7eb'}; border-radius: 8px;">
                        <strong style="font-size: 1.1rem;">${names2}</strong><br>
                        <span style="font-size: 0.85rem; color: #64748b;">SE - 3rd place</span>
                        ${currentWinner === qualificationData.playIn.team2 ? '<div style="margin-top: 0.5rem; color: #10b981; font-weight: 700;">👑 WINNER</div>' : ''}
                    </div>
                </div>
                
                <div style="text-align: center; margin-bottom: 1rem; padding: 0.75rem; background: #ede9fe; border-radius: 8px; font-size: 0.9rem; color: #6d28d9;">
                    🏆 Winner gets the 32nd and final knockout spot
                </div>
                
                <div style="display: flex; gap: 1rem; justify-content: center;">
                    <button onclick="updateTieBreakerResult('${playInKey}', '${qualificationData.playIn.team1}')" class="btn ${currentWinner === qualificationData.playIn.team1 ? 'btn-success' : 'btn-primary'}">
                        ${names1} Wins
                    </button>
                    <button onclick="updateTieBreakerResult('${playInKey}', '${qualificationData.playIn.team2}')" class="btn ${currentWinner === qualificationData.playIn.team2 ? 'btn-success' : 'btn-primary'}">
                        ${names2} Wins
                    </button>
                </div>
            </div>`;
        }
        
        // Action buttons
        html += `<div style="margin-top: 2rem; padding: 1.5rem; background: var(--bg-light); border-radius: 12px; display: flex; gap: 1rem; justify-content: center;">
            <button onclick="resetAllTieBreakers()" class="btn btn-danger">
                🔄 Reset All Results
            </button>
            <button onclick="saveTieBreakersToFirebase()" class="btn btn-success">
                💾 Save to Firebase
            </button>
        </div>`;
    }
    
    html += '</div>';
    container.innerHTML = html;
}

function updateTieBreakerResult(matchKey, winner) {
    knockoutData.tieBreakerResults[matchKey] = winner;
    
    // If bracket exists, update TBD slots with resolved teams
    if (knockoutData.bracket && !knockoutData.bracket.finalized) {
        updateBracketTBD();
    }
    
    renderTieBreakerView();
    renderKnockoutView();
    updateSyncStatus('modified', '⚠️ Unsaved changes');
}

function updateBracketTBD() {
    const qualData = getQualificationSummary();
    
    // Get newly qualified teams from resolved tie-breakers
    const newTeams = [...qualData.guaranteed, ...qualData.wildCards];
    
    knockoutData.bracket.round32.forEach(match => {
        // Update team1 if TBD
        if (match.team1.teamId === 'TBD') {
            const matchingTeam = newTeams.find(t => 
                match.team1.pendingMatch && match.team1.pendingMatch.includes(t.group)
            );
            if (matchingTeam) {
                match.team1 = matchingTeam;
            }
        }
        
        // Update team2 if TBD
        if (match.team2.teamId === 'TBD') {
            const matchingTeam = newTeams.find(t => 
                match.team2.pendingMatch && match.team2.pendingMatch.includes(t.group)
            );
            if (matchingTeam) {
                match.team2 = matchingTeam;
            }
        }
    });
}

function resetAllTieBreakers() {
    if (!confirm('Are you sure you want to reset all tie-breaker results? This cannot be undone.')) {
        return;
    }
    knockoutData.tieBreakerResults = {};
    renderTieBreakerView();
    renderKnockoutView();
    updateSyncStatus('modified', '⚠️ Unsaved changes');
}

function saveTieBreakersToFirebase() {
    const tieBreakerRef = firebase.database().ref('tieBreakerResults');
    tieBreakerRef.set(knockoutData.tieBreakerResults)
        .then(() => {
            alert('✅ Tie-breaker results saved successfully!');
            updateSyncStatus('synced', '✅ Synced');
        })
        .catch((error) => {
            console.error('Error saving tie-breakers:', error);
            alert('❌ Failed to save tie-breaker results');
        });
}

function loadTieBreakersFromFirebase() {
    const tieBreakerRef = firebase.database().ref('tieBreakerResults');
    tieBreakerRef.once('value', (snapshot) => {
        if (snapshot.exists()) {
            knockoutData.tieBreakerResults = snapshot.val();
            console.log('✅ Tie-breaker results loaded from Firebase');
            // Re-render views to show updated qualification
            if (APP_STATE.currentView === 'knockout') {
                renderKnockoutView();
            }
        }
    });
}

function loadBracketFromFirebase() {
    const bracketRef = firebase.database().ref('knockoutBracket');
    bracketRef.once('value', (snapshot) => {
        if (snapshot.exists()) {
            knockoutData.bracket = snapshot.val();
            console.log('✅ Bracket loaded from Firebase');
            if (APP_STATE.currentView === 'knockout') {
                renderKnockoutView();
            }
            if (APP_STATE.currentView === 'chamber') {
                renderChamberView();
            }
        }
    });
}

// ============================================
// KNOCKOUT STAGE
// ============================================

let knockoutData = {
    qualifiedTeams: [],
    playInMatch: null,
    bracket: null,
    tieBreakerResults: {} // Stores tie-breaker match results: { 'groupName-team1-team2': 'winner' }
};

// Manual save bracket
function manualSaveBracket() {
    const bracketRef = firebase.database().ref('knockoutBracket');
    bracketRef.set(knockoutData.bracket)
        .then(() => {
            const status = document.getElementById('saveStatus');
            if (status) {
                status.textContent = '✅ Saved successfully!';
                status.style.color = '#10b981';
            }
            // Refresh view after save to show updated winners
            setTimeout(() => renderChamberView(), 500);
        })
        .catch((error) => {
            console.error('Error saving:', error);
            alert('❌ Failed to save');
        });
}

// Select winner in bracket match
function selectWinner(matchId, teamId) {
    if (!knockoutData.bracket || !knockoutData.bracket.finalized) {
        alert('Bracket must be finalized first!');
        return;
    }
    
    const match = knockoutData.bracket.round32.find(m => m.matchId === matchId);
    if (!match) return;
    
    // Toggle: if clicking same winner, unset it (reset)
    if (match.winner === teamId) {
        match.winner = null;
    } else {
        match.winner = teamId;
    }
    
    // Update status without re-rendering entire page
    const status = document.getElementById('saveStatus');
    if (status) {
        status.textContent = '⚠️ Unsaved changes - Click Save button below';
        status.style.color = '#f59e0b';
        status.style.fontWeight = '700';
    }
    
    // Don't call renderChamberView() - keeps save button visible!
    console.log('Winner selected:', teamId, 'for match', matchId);
}

// Render NBA-style bracket
function renderBracketView(matches, interactive = false) {
    let html = '<div style="background: white; padding: 2rem; border-radius: 10px; overflow-x: auto;">';
    html += '<div style="display: grid; grid-template-columns: 1fr auto 1fr; gap: 3rem; min-width: 900px;">';
    
    // Left side (8 matches)
    html += '<div style="display: flex; flex-direction: column; gap: 1.5rem;">';
    for (let i = 0; i < 8; i++) {
        html += renderBracketMatch(matches[i], interactive);
    }
    html += '</div>';
    
    // Center (Finals placeholder)
    html += '<div style="display: flex; align-items: center; justify-content: center; padding: 0 2rem;"><div style="font-size: 2rem; color: #64748b;">🏆</div></div>';
    
    // Right side (8 matches)
    html += '<div style="display: flex; flex-direction: column; gap: 1.5rem;">';
    for (let i = 8; i < 16; i++) {
        html += renderBracketMatch(matches[i], interactive);
    }
    html += '</div>';
    
    html += '</div></div>';
    return html;
}

function renderBracketMatch(match, interactive) {
    const isTBD1 = match.team1.teamId === 'TBD';
    const isTBD2 = match.team2.teamId === 'TBD';
    
    const name1 = isTBD1 ? `TBD (${match.team1.pendingMatch})` : getTeamDisplay(match.team1.group, match.team1.teamId);
    const name2 = isTBD2 ? `TBD (${match.team2.pendingMatch})` : getTeamDisplay(match.team2.group, match.team2.teamId);
    
    const isWinner1 = match.winner === match.team1.teamId;
    const isWinner2 = match.winner === match.team2.teamId;
    
    let html = `<div style="border: 2px solid #e5e7eb; border-radius: 8px; background: white; padding: 0.5rem;">`;
    html += `<div style="font-size: 0.75rem; color: #64748b; margin-bottom: 0.25rem; text-align: center;">Match ${match.matchId}</div>`;
    
    // Team 1
    const bg1 = isWinner1 ? '#d1fae5' : (isTBD1 ? '#fef3c7' : 'white');
    const click1 = interactive && !isTBD1 ? `onclick="selectWinner(${match.matchId}, '${match.team1.teamId}')"` : '';
    const cursor1 = interactive && !isTBD1 ? 'cursor: pointer;' : '';
    html += `<div ${click1} style="padding: 0.75rem; border: 2px solid ${isWinner1 ? '#10b981' : '#e5e7eb'}; border-radius: 6px; margin-bottom: 0.25rem; background: ${bg1}; ${cursor1}">`;
    html += `<div style="font-weight: 600; font-size: 0.9rem; ${isTBD1 ? 'color: #f59e0b; font-style: italic;' : ''}">${name1}</div>`;
    if (!isTBD1) html += `<div style="font-size: 0.75rem; color: #64748b;">${match.team1.group}</div>`;
    if (isWinner1) html += `<div style="color: #10b981; font-size: 0.75rem; font-weight: 700;">✓ WINNER</div>`;
    html += '</div>';
    
    // Team 2
    const bg2 = isWinner2 ? '#d1fae5' : (isTBD2 ? '#fef3c7' : 'white');
    const click2 = interactive && !isTBD2 ? `onclick="selectWinner(${match.matchId}, '${match.team2.teamId}')"` : '';
    const cursor2 = interactive && !isTBD2 ? 'cursor: pointer;' : '';
    html += `<div ${click2} style="padding: 0.75rem; border: 2px solid ${isWinner2 ? '#10b981' : '#e5e7eb'}; border-radius: 6px; background: ${bg2}; ${cursor2}">`;
    html += `<div style="font-weight: 600; font-size: 0.9rem; ${isTBD2 ? 'color: #f59e0b; font-style: italic;' : ''}">${name2}</div>`;
    if (!isTBD2) html += `<div style="font-size: 0.75rem; color: #64748b;">${match.team2.group}</div>`;
    if (isWinner2) html += `<div style="color: #10b981; font-size: 0.75rem; font-weight: 700;">✓ WINNER</div>`;
    html += '</div>';
    
    html += '</div>';
    return html;
}

function renderKnockoutView() {
    if (!APP_STATE.dataLoaded) return;
    
    const container = document.getElementById('knockoutView');
    if (!container) return;
    
    // Calculate actual qualification status
    const qualificationData = getQualificationSummary();
    
    let html = '<div class="card"><h2>🏆 Knockout Qualification Status</h2>';
    
    // Summary stats
    html += `<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 2rem;">
        <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 1.5rem; border-radius: 12px; text-align: center;">
            <div style="font-size: 2.5rem; font-weight: 700;">${qualificationData.guaranteed.length}</div>
            <div>Guaranteed Qualified</div>
        </div>
        <div style="background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); color: white; padding: 1.5rem; border-radius: 12px; text-align: center;">
            <div style="font-size: 2.5rem; font-weight: 700;">${qualificationData.wildCards.length}</div>
            <div>Wild Cards Qualified</div>
        </div>
        <div style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; padding: 1.5rem; border-radius: 12px; text-align: center;">
            <div style="font-size: 2.5rem; font-weight: 700;">${qualificationData.tieBreakers.length}</div>
            <div>Tie-Breakers Needed</div>
        </div>
        <div style="background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%); color: white; padding: 1.5rem; border-radius: 12px; text-align: center;">
            <div style="font-size: 2.5rem; font-weight: 700;">1</div>
            <div>Play-In Match</div>
        </div>
    </div>`;
    
    // Guaranteed qualified teams
    if (qualificationData.guaranteed.length > 0) {
        html += '<h3 style="color: #10b981; margin: 2rem 0 1rem 0;">✅ Guaranteed Qualified (Top 2)</h3>';
        html += '<table class="standings-table"><thead><tr><th>#</th><th>Group</th><th>Participants</th><th>Points</th></tr></thead><tbody>';
        qualificationData.guaranteed.forEach((team, idx) => {
            const names = getTeamDisplay(team.group, team.teamId);
            html += `<tr>
                <td>${idx + 1}</td>
                <td><strong>${team.group}</strong></td>
                <td>${names}</td>
                <td><strong>${team.points}</strong></td>
            </tr>`;
        });
        html += '</tbody></table>';
    }
    
    // Wild card qualified teams
    if (qualificationData.wildCards.length > 0) {
        html += '<h3 style="color: #3b82f6; margin: 2rem 0 1rem 0;">🎟️ Wild Card Qualified (3rd Place)</h3>';
        html += '<table class="standings-table"><thead><tr><th>#</th><th>Group</th><th>Participants</th><th>Points</th></tr></thead><tbody>';
        qualificationData.wildCards.forEach((team, idx) => {
            const names = getTeamDisplay(team.group, team.teamId);
            html += `<tr>
                <td>${qualificationData.guaranteed.length + idx + 1}</td>
                <td><strong>${team.group}</strong></td>
                <td>${names}</td>
                <td><strong>${team.points}</strong></td>
            </tr>`;
        });
        html += '</tbody></table>';
    }
    
    // Tie-breakers needed
    if (qualificationData.tieBreakers.length > 0) {
        html += '<h3 style="color: #f59e0b; margin: 2rem 0 1rem 0;">⚠️ Tie-Breakers Needed</h3>';
        html += '<div style="background: #fef3c7; padding: 1rem; border-radius: 8px; margin-bottom: 1rem;">These matches need to be played to determine qualification</div>';
        qualificationData.tieBreakers.forEach((tb, idx) => {
            const names1 = getTeamDisplay(tb.group, tb.team1);
            const names2 = getTeamDisplay(tb.group, tb.team2);
            html += `<div style="background: white; border: 2px solid #f59e0b; border-radius: 12px; padding: 1.5rem; margin-bottom: 1rem;">
                <h4 style="color: #92400e; margin-bottom: 1rem;">Match ${idx + 1}: ${tb.group}</h4>
                <div style="display: flex; align-items: center; gap: 1rem; justify-content: center;">
                    <div style="flex: 1; text-align: center; padding: 1rem; background: #f9fafb; border-radius: 8px;">
                        <strong>${names1}</strong><br>
                        <span style="font-size: 0.85rem; color: #64748b;">${tb.points} points</span>
                    </div>
                    <div style="font-weight: 700; color: #64748b;">VS</div>
                    <div style="flex: 1; text-align: center; padding: 1rem; background: #f9fafb; border-radius: 8px;">
                        <strong>${names2}</strong><br>
                        <span style="font-size: 0.85rem; color: #64748b;">${tb.points} points</span>
                    </div>
                </div>
                <div style="margin-top: 1rem; text-align: center; font-size: 0.9rem; color: #64748b;">
                    ${tb.type === 'guaranteed' ? 'Winner → Guaranteed, Loser → Wild Card' : 'Winner → Wild Card'}
                </div>
            </div>`;
        });
    }
    
    // Play-in match
    if (qualificationData.playIn) {
        const names1 = getTeamDisplay('1 P', qualificationData.playIn.team1);
        const names2 = getTeamDisplay('SE', qualificationData.playIn.team2);
        html += '<h3 style="color: #8b5cf6; margin: 2rem 0 1rem 0;">🥊 Play-In Match (32nd Spot)</h3>';
        html += `<div style="background: white; border: 2px solid #8b5cf6; border-radius: 12px; padding: 1.5rem;">
            <div style="display: flex; align-items: center; gap: 1rem; justify-content: center;">
                <div style="flex: 1; text-align: center; padding: 1rem; background: #f9fafb; border-radius: 8px;">
                    <strong>${names1}</strong><br>
                    <span style="font-size: 0.85rem; color: #64748b;">1 P - 3rd place</span>
                </div>
                <div style="font-weight: 700; color: #64748b;">VS</div>
                <div style="flex: 1; text-align: center; padding: 1rem; background: #f9fafb; border-radius: 8px;">
                    <strong>${names2}</strong><br>
                    <span style="font-size: 0.85rem; color: #64748b;">SE - 3rd place</span>
                </div>
            </div>
            <div style="margin-top: 1rem; text-align: center; font-size: 0.9rem; color: #64748b;">
                Winner gets the 32nd and final knockout spot
            </div>
        </div>`;
    }
    
    // Generate Bracket section (allow if we have 30+ teams)
    const totalQualified = qualificationData.guaranteed.length + qualificationData.wildCards.length;
    const totalPending = qualificationData.tieBreakers.length + (qualificationData.playIn ? 1 : 0);
    
    if (totalQualified + totalPending === 32) {
        
        if (!knockoutData.bracket) {
            // No bracket yet - show generate button
            html += `<div style="margin-top: 2rem; padding: 2rem; background: linear-gradient(135deg, #10b981 0%, #059669 100%); border-radius: 15px; text-align: center;">
                <h3 style="color: white; margin-bottom: 1rem;">🎉 All 32 Teams Qualified!</h3>
                <button onclick="generateKnockoutBracket()" class="btn" style="background: white; color: #10b981; font-size: 1.1rem; padding: 1rem 2rem;">
                    🎲 Generate Random Bracket
                </button>
            </div>`;
        } else if (!knockoutData.bracket.finalized) {
            // Bracket generated but not finalized - show preview and options
            html += `<div style="margin-top: 2rem; padding: 2rem; background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); border-radius: 15px;">
                <h3 style="color: white; margin-bottom: 1rem;">🎲 Bracket Preview (Not Finalized)</h3>`;
            
            html += renderBracketView(knockoutData.bracket.round32, false);
            
            html += `<div style="margin-top: 1.5rem; display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap;">
                    <button onclick="generateKnockoutBracket()" class="btn" style="background: white; color: #f59e0b; font-size: 1rem; padding: 0.75rem 1.5rem;">
                        🔄 Re-Shuffle
                    </button>
                    <button onclick="saveBracketPreview()" class="btn btn-primary" style="font-size: 1rem; padding: 0.75rem 1.5rem;">
                        💾 Save Preview
                    </button>
                    <button onclick="finalizeBracket()" class="btn btn-success" style="font-size: 1rem; padding: 0.75rem 1.5rem;">
                        ✅ Finalize Bracket
                    </button>
                    <button onclick="resetBracket()" class="btn btn-danger" style="font-size: 1rem; padding: 0.75rem 1.5rem;">
                        🗑️ Reset
                    </button>
                </div>
            </div>`;
        } else {
            // Bracket finalized - show confirmation
            html += `<div style="margin-top: 2rem; padding: 2rem; background: linear-gradient(135deg, #10b981 0%, #059669 100%); border-radius: 15px; text-align: center;">
                <h3 style="color: white; margin-bottom: 1rem;">✅ Bracket Finalized!</h3>
                <p style="color: white; margin-bottom: 1rem;">View matches in Elimination Chamber tab</p>
                <button onclick="resetBracket()" class="btn btn-danger">
                    🗑️ Reset Bracket
                </button>
            </div>`;
        }
    }
    
    html += '</div>';
    container.innerHTML = html;
}

// Generate knockout bracket with random draw
function generateKnockoutBracket() {
    const qualData = getQualificationSummary();
    const allTeams = [...qualData.guaranteed, ...qualData.wildCards];
    
    console.log('🔍 Qualified teams before TBD:', {
        guaranteed: qualData.guaranteed.length,
        wildCards: qualData.wildCards.length,
        total: allTeams.length
    });
    
    // Add TBD placeholders for pending tie-breakers
    qualData.tieBreakers.forEach(tb => {
        allTeams.push({
            group: tb.group,
            teamId: 'TBD',
            points: 'Pending',
            pendingMatch: `${tb.group}: ${tb.team1} vs ${tb.team2}`
        });
    });
    
    // Add TBD for pending play-in
    if (qualData.playIn) {
        allTeams.push({
            group: 'Play-in',
            teamId: 'TBD',
            points: 'Pending',
            pendingMatch: `1P vs SE`
        });
    }
    
    console.log('🔍 Total teams with TBD:', allTeams.length);
    console.log('🔍 SE teams:', allTeams.filter(t => t.group === 'SE'));
    
    if (allTeams.length !== 32) {
        alert(`Error: Need exactly 32 teams. Currently have ${allTeams.length}`);
        return;
    }
    
    // Shuffle teams randomly
    for (let i = allTeams.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [allTeams[i], allTeams[j]] = [allTeams[j], allTeams[i]];
    }
    
    // Create bracket (16 matches)
    knockoutData.bracket = {
        round32: [],
        finalized: false
    };
    
    for (let i = 0; i < 16; i++) {
        knockoutData.bracket.round32.push({
            matchId: i + 1,
            team1: allTeams[i * 2],
            team2: allTeams[i * 2 + 1],
            winner: null
        });
    }
    
    renderKnockoutView();
}

function saveBracketPreview() {
    const bracketRef = firebase.database().ref('knockoutBracket');
    bracketRef.set(knockoutData.bracket)
        .then(() => {
            alert('✅ Bracket preview saved!');
        })
        .catch((error) => {
            console.error('Error saving bracket:', error);
            alert('❌ Failed to save bracket');
        });
}

function finalizeBracket() {
    if (!confirm('Finalize this bracket? This cannot be changed after finalization.')) {
        return;
    }
    
    knockoutData.bracket.finalized = true;
    
    // Save to Firebase
    const bracketRef = firebase.database().ref('knockoutBracket');
    bracketRef.set(knockoutData.bracket)
        .then(() => {
            alert('✅ Bracket finalized!');
            renderKnockoutView();
        })
        .catch((error) => {
            console.error('Error saving bracket:', error);
            alert('❌ Failed to finalize bracket');
        });
}

function resetBracket() {
    if (!confirm('Reset bracket? This will clear all matches.')) {
        return;
    }
    
    knockoutData.bracket = null;
    
    const bracketRef = firebase.database().ref('knockoutBracket');
    bracketRef.remove()
        .then(() => {
            alert('✅ Bracket reset!');
            renderKnockoutView();
        })
        .catch((error) => {
            console.error('Error resetting bracket:', error);
            alert('❌ Failed to reset bracket');
        });
}

// Get current qualification summary
// Helper to get participant names from team ID
function getTeamDisplay(groupName, teamId) {
    const group = tournamentData[groupName];
    if (!group) return teamId;
    
    const participant = group.participants.find(p => p.teamId === teamId);
    if (!participant) return teamId;
    
    const names = participant.name2 ? 
        `${participant.name1} & ${participant.name2}` : 
        participant.name1;
    
    return names;
}

function getQualificationSummary() {
    const guaranteed = [];
    const wildCards = [];
    const tieBreakers = [];
    let playIn = null;
    const processedTies = new Set(); // Track processed tie-breaker pairs
    
    console.log('🔍 getQualificationSummary called');
    
    Object.keys(tournamentData).forEach(groupName => {
        const standings = calculateStandings(groupName);
        
        if (groupName === 'SE') {
            console.log('🔍 SE standings:', standings.map(t => `${t.teamId}:${t.points}pts-${t.qualificationType}`));
        }
        
        standings.forEach((team, idx) => {
            // Skip if team has tie-breaker qualification type (they'll be processed later)
            const hasTieBreaker = team.qualificationType && team.qualificationType.includes('Tie-Breaker');
            
            if (!hasTieBreaker && (team.qualificationType === 'Guaranteed (1st)' || team.qualificationType === 'Guaranteed (2nd)' || team.qualificationType === 'Guaranteed (3rd)')) {
                guaranteed.push({
                    group: groupName,
                    position: idx + 1,
                    teamId: team.teamId,
                    points: team.points
                });
            } else if (team.qualificationType === 'Wild Card (3rd)') {
                wildCards.push({
                    group: groupName,
                    teamId: team.teamId,
                    points: team.points
                });
            } else if (team.qualificationType && team.qualificationType.includes('Tie-Breaker')) {
                // Find the tie-breaker pair
                const nextTeam = standings[idx + 1];
                if (nextTeam && nextTeam.points === team.points) {
                    const matchKey = `${groupName}-${team.teamId}-${nextTeam.teamId}`;
                    
                    // Skip if already processed
                    if (processedTies.has(matchKey)) {
                        return;
                    }
                    processedTies.add(matchKey);
                    
                    const winner = knockoutData.tieBreakerResults[matchKey];
                    
                    // If tie-breaker is resolved, add winner to appropriate category
                    if (winner) {
                        const isGuaranteedMatch = idx < 2;
                        if (isGuaranteedMatch) {
                            // Winner gets guaranteed spot
                            if (winner === team.teamId) {
                                guaranteed.push({
                                    group: groupName,
                                    position: idx + 1,
                                    teamId: team.teamId,
                                    points: team.points
                                });
                            } else if (winner === nextTeam.teamId) {
                                guaranteed.push({
                                    group: groupName,
                                    position: idx + 2,
                                    teamId: nextTeam.teamId,
                                    points: nextTeam.points
                                });
                            }
                            // Loser gets wild card (if not 1P or SE)
                            if (groupName !== '1 P' && groupName !== 'SE') {
                                const loser = winner === team.teamId ? nextTeam.teamId : team.teamId;
                                const loserPoints = winner === team.teamId ? nextTeam.points : team.points;
                                wildCards.push({
                                    group: groupName,
                                    teamId: loser,
                                    points: loserPoints
                                });
                            }
                        } else {
                            // Wild card match - only winner qualifies
                            if (winner === team.teamId) {
                                wildCards.push({
                                    group: groupName,
                                    teamId: team.teamId,
                                    points: team.points
                                });
                            } else if (winner === nextTeam.teamId) {
                                wildCards.push({
                                    group: groupName,
                                    teamId: nextTeam.teamId,
                                    points: nextTeam.points
                                });
                            }
                        }
                    } else {
                        // Tie-breaker not yet resolved - add to pending list
                        tieBreakers.push({
                            group: groupName,
                            team1: team.teamId,
                            team2: nextTeam.teamId,
                            points: team.points,
                            type: idx < 2 ? 'guaranteed' : 'wildcard'
                        });
                    }
                }
            }
        });
    });
    
    console.log('🔍 Final counts:', {
        guaranteed: guaranteed.length,
        wildCards: wildCards.length,
        tieBreakers: tieBreakers.length
    });
    console.log('🔍 SE teams in guaranteed:', guaranteed.filter(t => t.group === 'SE'));
    
    return { guaranteed, wildCards, tieBreakers, playIn: null };
}

// ============================================
// QUALIFICATION LOGIC
// ============================================

function calculateQualifiedTeams() {
    console.log('🏆 Calculating qualified teams...');
    
    const qualified = [];
    const standings = {};
    
    // Calculate standings for each group
    Object.keys(tournamentData).forEach(groupName => {
        const group = tournamentData[groupName];
        const groupStandings = calculateStandings(group);
        standings[groupName] = groupStandings;
        
        // Top 2 from each group (guaranteed)
        if (groupStandings.length >= 2) {
            qualified.push({
                teamId: groupStandings[0].teamId,
                groupName: groupName,
                position: 1,
                type: 'guaranteed',
                points: groupStandings[0].points,
                wins: groupStandings[0].wins
            });
            qualified.push({
                teamId: groupStandings[1].teamId,
                groupName: groupName,
                position: 2,
                type: 'guaranteed',
                points: groupStandings[1].points,
                wins: groupStandings[1].wins
            });
        }
    });
    
    // Wild card teams (3rd place from 10 groups, excluding 1P and SE)
    const wildCardGroups = ['Discovery', '3 P Apps', 'SDL', 'System Experience', 
                           'Core Experience', '3 P NDL', 'FBDA', 'MOD', 'Vega'];
    
    wildCardGroups.forEach(groupName => {
        const groupStandings = standings[groupName];
        if (groupStandings && groupStandings.length >= 3) {
            qualified.push({
                teamId: groupStandings[2].teamId,
                groupName: groupName,
                position: 3,
                type: 'wildcard',
                points: groupStandings[2].points,
                wins: groupStandings[2].wins
            });
        }
    });
    
    // Play-in match (3rd place from 1P vs SE)
    const onePStandings = standings['1 P'];
    const seStandings = standings['SE'];
    
    if (onePStandings && onePStandings.length >= 3 && seStandings && seStandings.length >= 3) {
        knockoutData.playInMatch = {
            team1: {
                teamId: onePStandings[2].teamId,
                groupName: '1 P',
                points: onePStandings[2].points,
                wins: onePStandings[2].wins
            },
            team2: {
                teamId: seStandings[2].teamId,
                groupName: 'SE',
                points: seStandings[2].points,
                wins: seStandings[2].wins
            },
            winner: null
        };
    }
    
    knockoutData.qualifiedTeams = qualified;
    
    alert(`✅ Calculated ${qualified.length} qualified teams + 1 play-in match!`);
    renderQualificationStatus();
}

function renderQualificationStatus() {
    const container = document.getElementById('qualificationStatus');
    if (!container) return;
    
    if (knockoutData.qualifiedTeams.length === 0) {
        container.innerHTML = `
            <div style="padding: 2rem; text-align: center; color: var(--text-light);">
                <p>No qualified teams yet. Click "Calculate Qualified Teams" to begin.</p>
            </div>
        `;
        return;
    }
    
    // Group qualified teams
    const guaranteed = knockoutData.qualifiedTeams.filter(t => t.type === 'guaranteed');
    const wildcards = knockoutData.qualifiedTeams.filter(t => t.type === 'wildcard');
    
    let html = `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
            <div style="padding: 1rem; background: linear-gradient(135deg, rgba(14, 165, 233, 0.1), rgba(6, 182, 212, 0.1)); border-radius: 0.75rem; border: 2px solid var(--primary-color);">
                <h3 style="color: var(--primary-color); margin-bottom: 0.5rem;">✅ Guaranteed (Top 2)</h3>
                <p style="font-size: 2rem; font-weight: 700; margin: 0;">${guaranteed.length} teams</p>
            </div>
            <div style="padding: 1rem; background: linear-gradient(135deg, rgba(139, 92, 246, 0.1), rgba(168, 85, 247, 0.1)); border-radius: 0.75rem; border: 2px solid var(--accent-color);">
                <h3 style="color: var(--accent-color); margin-bottom: 0.5rem;">🎟️ Wild Cards</h3>
                <p style="font-size: 2rem; font-weight: 700; margin: 0;">${wildcards.length} teams</p>
            </div>
            <div style="padding: 1rem; background: linear-gradient(135deg, rgba(234, 179, 8, 0.1), rgba(202, 138, 4, 0.1)); border-radius: 0.75rem; border: 2px solid #eab308;">
                <h3 style="color: #eab308; margin-bottom: 0.5rem;">🥊 Play-In</h3>
                <p style="font-size: 2rem; font-weight: 700; margin: 0;">${knockoutData.playInMatch ? '1 match' : 'Not set'}</p>
            </div>
        </div>
    `;
    
    // Show play-in match details
    if (knockoutData.playInMatch) {
        const pim = knockoutData.playInMatch;
        html += `
            <div style="padding: 1.5rem; background: linear-gradient(135deg, rgba(234, 179, 8, 0.1), rgba(202, 138, 4, 0.1)); border-radius: 0.75rem; margin-bottom: 1.5rem; border: 2px solid #eab308;">
                <h3 style="color: #eab308; margin-bottom: 1rem;">🥊 Play-In Match (Final Wild Card Spot)</h3>
                <div style="display: grid; grid-template-columns: 1fr auto 1fr; gap: 1rem; align-items: center;">
                    <div style="text-align: center; padding: 1rem; background: var(--bg-dark); border-radius: 0.5rem;">
                        <div style="font-size: 1.5rem; font-weight: 700; color: var(--primary-color);">${pim.team1.teamId}</div>
                        <div style="font-size: 0.9rem; color: var(--text-light);">${pim.team1.groupName} - 3rd Place</div>
                        <div style="font-size: 0.85rem; margin-top: 0.5rem;">Points: ${pim.team1.points} | Wins: ${pim.team1.wins}</div>
                    </div>
                    <div style="font-size: 2rem; font-weight: 700; color: #eab308;">VS</div>
                    <div style="text-align: center; padding: 1rem; background: var(--bg-dark); border-radius: 0.5rem;">
                        <div style="font-size: 1.5rem; font-weight: 700; color: var(--secondary-color);">${pim.team2.teamId}</div>
                        <div style="font-size: 0.9rem; color: var(--text-light);">${pim.team2.groupName} - 3rd Place</div>
                        <div style="font-size: 0.85rem; margin-top: 0.5rem;">Points: ${pim.team2.points} | Wins: ${pim.team2.wins}</div>
                    </div>
                </div>
                ${APP_STATE.isAdmin ? `
                    <div style="margin-top: 1rem; text-align: center;">
                        <button onclick="setPlayInWinner('${pim.team1.teamId}')" class="btn btn-primary">${pim.team1.teamId} Wins</button>
                        <button onclick="setPlayInWinner('${pim.team2.teamId}')" class="btn btn-primary" style="margin-left: 0.5rem;">${pim.team2.teamId} Wins</button>
                    </div>
                ` : ''}
                ${pim.winner ? `<div style="margin-top: 1rem; text-align: center; color: #10b981; font-weight: 700; font-size: 1.1rem;">✅ Winner: ${pim.winner}</div>` : ''}
            </div>
        `;
    }
    
    container.innerHTML = html;
}

function setPlayInWinner(winner) {
    if (!knockoutData.playInMatch) return;
    
    knockoutData.playInMatch.winner = winner;
    
    // Add winner to qualified teams
    const winnerTeam = winner === knockoutData.playInMatch.team1.teamId 
        ? knockoutData.playInMatch.team1 
        : knockoutData.playInMatch.team2;
    
    knockoutData.qualifiedTeams.push({
        teamId: winnerTeam.teamId,
        groupName: winnerTeam.groupName,
        position: 3,
        type: 'playin',
        points: winnerTeam.points,
        wins: winnerTeam.wins
    });
    
    alert(`✅ ${winner} wins the play-in match and qualifies for knockout!`);
    renderQualificationStatus();
}

// ============================================
// BRACKET GENERATION
// ============================================

function generateBracket() {
    // Check if we have 32 qualified teams (31 + play-in winner)
    const totalQualified = knockoutData.qualifiedTeams.length;
    const playInComplete = knockoutData.playInMatch && knockoutData.playInMatch.winner;
    
    if (totalQualified < 31) {
        alert('❌ Please calculate qualified teams first!');
        return;
    }
    
    if (!playInComplete) {
        alert('❌ Please complete the play-in match first!');
        return;
    }
    
    console.log('🎲 Generating bracket...');
    
    // Get all 32 qualified teams
    const teams = [...knockoutData.qualifiedTeams];
    
    // Shuffle teams randomly
    const shuffled = shuffleArray(teams);
    
    // Try to avoid same group matchups in Round of 32
    const bracket = createBracketWithGroupSeparation(shuffled);
    
    knockoutData.bracket = bracket;
    
    alert('✅ Bracket generated! 32 teams ready for knockout!');
    renderBracket();
}

function shuffleArray(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function createBracketWithGroupSeparation(teams) {
    // Try to separate same-group teams
    const positions = Array(32).fill(null);
    const grouped = {};
    
    // Group teams by their group
    teams.forEach(team => {
        if (!grouped[team.groupName]) grouped[team.groupName] = [];
        grouped[team.groupName].push(team);
    });
    
    // Place teams trying to avoid same group in adjacent positions
    let posIdx = 0;
    teams.forEach(team => {
        // Find best position (not next to same group if possible)
        let placed = false;
        for (let attempt = 0; attempt < 32 && !placed; attempt++) {
            const tryPos = (posIdx + attempt) % 32;
            if (!positions[tryPos]) {
                // Check if adjacent position has same group
                const adjacentPos = tryPos % 2 === 0 ? tryPos + 1 : tryPos - 1;
                const adjacentTeam = positions[adjacentPos];
                
                if (!adjacentTeam || adjacentTeam.groupName !== team.groupName) {
                    positions[tryPos] = team;
                    placed = true;
                    posIdx = tryPos + 1;
                }
            }
        }
        
        // If still not placed, just put it anywhere
        if (!placed) {
            const emptyPos = positions.findIndex(p => p === null);
            if (emptyPos !== -1) {
                positions[emptyPos] = team;
            }
        }
    });
    
    // Create bracket structure
    const bracket = {
        round32: [],
        round16: Array(16).fill(null),
        quarterFinals: Array(8).fill(null),
        semiFinals: Array(4).fill(null),
        final: null,
        winner: null
    };
    
    // Create Round of 32 matches
    for (let i = 0; i < 32; i += 2) {
        bracket.round32.push({
            matchNo: (i / 2) + 1,
            team1: positions[i],
            team2: positions[i + 1],
            winner: null
        });
    }
    
    return bracket;
}

function renderBracket() {
    const container = document.getElementById('bracketDisplay');
    if (!container) return;
    
    if (!knockoutData.bracket) {
        container.innerHTML = `
            <div style="padding: 2rem; text-align: center; color: var(--text-light);">
                <p>No bracket generated yet. Click "Generate Bracket" to create the knockout draw.</p>
            </div>
        `;
        return;
    }
    
    const bracket = knockoutData.bracket;
    
    let html = '<div style="margin-top: 2rem;">';
    
    // Round of 32
    html += '<h3 style="color: var(--primary-color); margin-bottom: 1rem;">🥇 Round of 32</h3>';
    html += '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1rem; margin-bottom: 2rem;">';
    
    bracket.round32.forEach(match => {
        html += `
            <div style="padding: 1rem; background: var(--bg-dark); border-radius: 0.75rem; border: 2px solid var(--border-color);">
                <div style="text-align: center; font-weight: 700; color: var(--text-secondary); margin-bottom: 0.75rem;">Match ${match.matchNo}</div>
                <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                    <div style="padding: 0.75rem; background: ${match.winner === match.team1.teamId ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(5, 150, 105, 0.2))' : 'var(--bg-light)'}; border-radius: 0.5rem; border: 2px solid ${match.winner === match.team1.teamId ? '#10b981' : 'transparent'};">
                        <strong style="color: var(--primary-color);">${match.team1.teamId}</strong>
                        <span style="font-size: 0.85rem; color: var(--text-light); margin-left: 0.5rem;">(${match.team1.groupName})</span>
                    </div>
                    <div style="text-align: center; color: var(--text-secondary); font-weight: 700;">VS</div>
                    <div style="padding: 0.75rem; background: ${match.winner === match.team2.teamId ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(5, 150, 105, 0.2))' : 'var(--bg-light)'}; border-radius: 0.5rem; border: 2px solid ${match.winner === match.team2.teamId ? '#10b981' : 'transparent'};">
                        <strong style="color: var(--secondary-color);">${match.team2.teamId}</strong>
                        <span style="font-size: 0.85rem; color: var(--text-light); margin-left: 0.5rem;">(${match.team2.groupName})</span>
                    </div>
                </div>
                ${APP_STATE.isAdmin && !match.winner ? `
                    <div style="display: flex; gap: 0.5rem; margin-top: 0.75rem;">
                        <button onclick="setKnockoutWinner(32, ${match.matchNo}, '${match.team1.teamId}')" class="btn btn-success" style="flex: 1; padding: 0.5rem; font-size: 0.85rem;">✓</button>
                        <button onclick="setKnockoutWinner(32, ${match.matchNo}, '${match.team2.teamId}')" class="btn btn-success" style="flex: 1; padding: 0.5rem; font-size: 0.85rem;">✓</button>
                    </div>
                ` : ''}
                ${match.winner ? `<div style="margin-top: 0.75rem; text-align: center; color: #10b981; font-weight: 700;">Winner: ${match.winner}</div>` : ''}
            </div>
        `;
    });
    
    html += '</div>';
    html += '</div>';
    
    container.innerHTML = html;
}

function setKnockoutWinner(round, matchNo, winner) {
    if (round === 32) {
        const match = knockoutData.bracket.round32[matchNo - 1];
        if (match) {
            match.winner = winner;
            
            // Advance to Round of 16
            const r16Index = Math.floor((matchNo - 1) / 2);
            const winnerTeam = winner === match.team1.teamId ? match.team1 : match.team2;
            
            if (!knockoutData.bracket.round16[r16Index]) {
                knockoutData.bracket.round16[r16Index] = {
                    matchNo: r16Index + 1,
                    team1: null,
                    team2: null,
                    winner: null
                };
            }
            
            // Assign to team1 or team2 based on match order
            if ((matchNo - 1) % 2 === 0) {
                knockoutData.bracket.round16[r16Index].team1 = winnerTeam;
            } else {
                knockoutData.bracket.round16[r16Index].team2 = winnerTeam;
            }
        }
    }
    
    alert(`✅ ${winner} advances!`);
    renderBracket();
    renderChamberView();
}

function setChamberWinner(round, matchNo, winner) {
    let match, nextRound, nextIndex;
    
    if (round === 16) {
        match = knockoutData.bracket.round16[matchNo - 1];
        nextRound = knockoutData.bracket.quarterFinals;
        nextIndex = Math.floor((matchNo - 1) / 2);
    } else if (round === 8) {
        match = knockoutData.bracket.quarterFinals[matchNo - 1];
        nextRound = knockoutData.bracket.semiFinals;
        nextIndex = Math.floor((matchNo - 1) / 2);
    } else if (round === 4) {
        match = knockoutData.bracket.semiFinals[matchNo - 1];
        nextRound = [knockoutData.bracket.final];
        nextIndex = 0;
    } else if (round === 2) {
        knockoutData.bracket.final.winner = winner;
        knockoutData.bracket.winner = winner;
        alert(`🏆 TOURNAMENT CHAMPION: ${winner}! 🏆`);
        renderChamberView();
        return;
    }
    
    if (match) {
        match.winner = winner;
        const winnerTeam = winner === match.team1.teamId ? match.team1 : match.team2;
        
        // Create next match if doesn't exist
        if (!nextRound[nextIndex]) {
            nextRound[nextIndex] = {
                matchNo: nextIndex + 1,
                team1: null,
                team2: null,
                winner: null
            };
        }
        
        // Assign to team1 or team2
        if ((matchNo - 1) % 2 === 0) {
            nextRound[nextIndex].team1 = winnerTeam;
        } else {
            nextRound[nextIndex].team2 = winnerTeam;
        }
    }
    
    alert(`✅ ${winner} advances!`);
    renderChamberView();
}

function resetKnockout() {
    if (!confirm('⚠️ This will reset all knockout data. Continue?')) return;
    
    knockoutData = {
        qualifiedTeams: [],
        playInMatch: null,
        bracket: null
    };
    
    alert('✅ Knockout stage reset!');
    renderKnockoutView();
}


// ============================================
// ELIMINATION CHAMBER VIEW
// ============================================

function renderChamberView() {
    const container = document.getElementById('chamberDisplay');
    if (!container) return;
    
    if (!knockoutData.bracket || !knockoutData.bracket.finalized) {
        container.innerHTML = `
            <div class="card">
                <h2>⚡ Elimination Chamber</h2>
                <div style="padding: 2rem; text-align: center; color: var(--text-light); background: #f9fafb; border-radius: 8px;">
                    <p style="font-size: 1.1rem; margin-bottom: 1rem;">🏆 Bracket not finalized yet</p>
                    <p>Go to <strong>🏆 Knockout</strong> tab to finalize the bracket.</p>
                </div>
            </div>
        `;
        return;
    }
    
    let html = '<div class="card"><h2>⚡ Elimination Chamber - Round of 32</h2>';
    html += '<p style="color: var(--text-secondary); margin-bottom: 1rem;">Click on a team to select winner.</p>';
    
    // Fixed save button at top
    html += `<div style="position: sticky; top: 0; z-index: 100; background: white; padding: 1rem; margin: -1rem -1rem 1rem -1rem; border-bottom: 2px solid #e5e7eb; text-align: center;">
        <button onclick="manualSaveBracket()" class="btn btn-success" style="font-size: 1.1rem; padding: 1rem 3rem;">
            💾 SAVE ALL RESULTS TO FIREBASE
        </button>
        <div id="saveStatus" style="margin-top: 0.5rem; color: #64748b; font-size: 0.9rem;">Ready to save</div>
    </div>`;
    
    html += renderBracketView(knockoutData.bracket.round32, true);
    
    html += '</div>';
    container.innerHTML = html;
}

function renderChamberRound(title, matches, round, bgGradient, color) {
    if (!matches || matches.length === 0 || !matches[0] || (!matches[0].team1 && !matches[0].team2)) {
        return '';
    }
    
    let html = `
        <div style="margin-bottom: 3rem;">
            <h3 style="color: ${color}; font-size: 1.75rem; text-align: center; margin-bottom: 1.5rem; text-transform: uppercase; letter-spacing: 2px;">${title}</h3>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(350px, 1fr)); gap: 1.5rem;">
    `;
    
    matches.forEach(match => {
        if (!match || (!match.team1 && !match.team2)) return;
        
        html += `
            <div style="padding: 1.5rem; background: ${bgGradient}; border-radius: 1rem; border: 3px solid ${color}; box-shadow: 0 10px 30px rgba(0,0,0,0.3);">
                <div style="text-align: center; font-weight: 700; color: ${color}; font-size: 1.1rem; margin-bottom: 1rem; text-transform: uppercase;">Match ${match.matchNo}</div>
                <div style="display: flex; flex-direction: column; gap: 0.75rem;">
        `;
        
        if (match.team1) {
            html += `
                <div style="padding: 1rem; background: ${match.winner === match.team1.teamId ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.3), rgba(5, 150, 105, 0.3))' : 'var(--bg-dark)'}; border-radius: 0.75rem; border: 3px solid ${match.winner === match.team1.teamId ? '#10b981' : 'transparent'}; transition: all 0.3s;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <div style="font-size: 1.3rem; font-weight: 700; color: var(--primary-color);">${match.team1.teamId}</div>
                            <div style="font-size: 0.85rem; color: var(--text-light); margin-top: 0.25rem;">${match.team1.groupName}</div>
                        </div>
                        ${APP_STATE.isAdmin && !match.winner ? `
                            <button onclick="setChamberWinner(${round}, ${match.matchNo}, '${match.team1.teamId}')" class="btn btn-success" style="padding: 0.5rem 1rem;">✓ WIN</button>
                        ` : ''}
                        ${match.winner === match.team1.teamId ? '<div style="font-size: 2rem;">🏆</div>' : ''}
                    </div>
                </div>
            `;
        }
        
        html += '<div style="text-align: center; color: ' + color + '; font-weight: 700; font-size: 1.2rem;">VS</div>';
        
        if (match.team2) {
            html += `
                <div style="padding: 1rem; background: ${match.winner === match.team2.teamId ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.3), rgba(5, 150, 105, 0.3))' : 'var(--bg-dark)'}; border-radius: 0.75rem; border: 3px solid ${match.winner === match.team2.teamId ? '#10b981' : 'transparent'}; transition: all 0.3s;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <div style="font-size: 1.3rem; font-weight: 700; color: var(--secondary-color);">${match.team2.teamId}</div>
                            <div style="font-size: 0.85rem; color: var(--text-light); margin-top: 0.25rem;">${match.team2.groupName}</div>
                        </div>
                        ${APP_STATE.isAdmin && !match.winner ? `
                            <button onclick="setChamberWinner(${round}, ${match.matchNo}, '${match.team2.teamId}')" class="btn btn-success" style="padding: 0.5rem 1rem;">✓ WIN</button>
                        ` : ''}
                        ${match.winner === match.team2.teamId ? '<div style="font-size: 2rem;">🏆</div>' : ''}
                    </div>
                </div>
            `;
        }
        
        html += `
                </div>
            </div>
        `;
    });
    
    html += '</div></div>';
    return html;
}

function renderFinalMatch(final, champion) {
    if (!final || (!final.team1 && !final.team2)) {
        return '';
    }
    
    return `
        <div style="margin-top: 3rem; padding: 3rem; background: linear-gradient(135deg, rgba(234, 179, 8, 0.2), rgba(202, 138, 4, 0.2)); border-radius: 1.5rem; border: 4px solid #eab308; box-shadow: 0 20px 50px rgba(234, 179, 8, 0.4);">
            <h2 style="color: #eab308; font-size: 2.5rem; text-align: center; margin-bottom: 2rem; text-transform: uppercase; letter-spacing: 3px;">
                🏆 GRAND FINAL 🏆
            </h2>
            
            <div style="display: grid; grid-template-columns: 1fr auto 1fr; gap: 2rem; align-items: center; max-width: 1000px; margin: 0 auto;">
                ${final.team1 ? `
                    <div style="text-align: center; padding: 2rem; background: ${final.winner === final.team1.teamId ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.4), rgba(5, 150, 105, 0.4))' : 'var(--bg-dark)'}; border-radius: 1rem; border: 4px solid ${final.winner === final.team1.teamId ? '#10b981' : '#eab308'};">
                        <div style="font-size: 2.5rem; font-weight: 700; color: var(--primary-color); margin-bottom: 0.5rem;">${final.team1.teamId}</div>
                        <div style="font-size: 1rem; color: var(--text-light); margin-bottom: 1rem;">${final.team1.groupName}</div>
                        ${APP_STATE.isAdmin && !final.winner ? `
                            <button onclick="setChamberWinner(2, 1, '${final.team1.teamId}')" class="btn btn-success" style="font-size: 1.1rem; padding: 0.75rem 1.5rem;">
                                👑 CHAMPION
                            </button>
                        ` : ''}
                        ${final.winner === final.team1.teamId ? '<div style="font-size: 4rem; margin-top: 1rem;">🏆</div>' : ''}
                    </div>
                ` : '<div></div>'}
                
                <div style="font-size: 3rem; font-weight: 700; color: #eab308;">VS</div>
                
                ${final.team2 ? `
                    <div style="text-align: center; padding: 2rem; background: ${final.winner === final.team2.teamId ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.4), rgba(5, 150, 105, 0.4))' : 'var(--bg-dark)'}; border-radius: 1rem; border: 4px solid ${final.winner === final.team2.teamId ? '#10b981' : '#eab308'};">
                        <div style="font-size: 2.5rem; font-weight: 700; color: var(--secondary-color); margin-bottom: 0.5rem;">${final.team2.teamId}</div>
                        <div style="font-size: 1rem; color: var(--text-light); margin-bottom: 1rem;">${final.team2.groupName}</div>
                        ${APP_STATE.isAdmin && !final.winner ? `
                            <button onclick="setChamberWinner(2, 1, '${final.team2.teamId}')" class="btn btn-success" style="font-size: 1.1rem; padding: 0.75rem 1.5rem;">
                                👑 CHAMPION
                            </button>
                        ` : ''}
                        ${final.winner === final.team2.teamId ? '<div style="font-size: 4rem; margin-top: 1rem;">🏆</div>' : ''}
                    </div>
                ` : '<div></div>'}
            </div>
            
            ${champion ? `
                <div style="margin-top: 3rem; text-align: center; padding: 2rem; background: linear-gradient(135deg, rgba(16, 185, 129, 0.3), rgba(5, 150, 105, 0.3)); border-radius: 1rem; border: 3px solid #10b981;">
                    <div style="font-size: 1.5rem; color: #10b981; font-weight: 700; margin-bottom: 1rem;">🏆 TOURNAMENT CHAMPION 🏆</div>
                    <div style="font-size: 3rem; font-weight: 700; color: var(--primary-color);">${champion}</div>
                    <div style="font-size: 1.5rem; margin-top: 1rem;">🎉 CONGRATULATIONS! 🎉</div>
                </div>
            ` : ''}
        </div>
    `;
}


// ============================================
// ADD TEAM FUNCTIONALITY
// ============================================

function initializeAddTeamButtons() {
    const addTeamBtn = document.getElementById('addTeamBtn');
    const addTeamBtnParticipants = document.getElementById('addTeamBtnParticipants');
    
    if (addTeamBtn) {
        addTeamBtn.addEventListener('click', showAddTeamDialog);
    }
    
    if (addTeamBtnParticipants) {
        addTeamBtnParticipants.addEventListener('click', showAddTeamDialog);
    }
}

function showAddTeamDialog() {
    const groupName = prompt('Enter Group Name:\n(Examples: 1 P, Discovery, Core Experience, etc.)');
    
    if (!groupName || !groupName.trim()) {
        return;
    }
    
    // Check if group exists
    if (!tournamentData[groupName]) {
        const create = confirm(`Group "${groupName}" doesn't exist. Create new group?`);
        if (!create) return;
        
        tournamentData[groupName] = {
            teamName: groupName,
            participants: [],
            matches: []
        };
    }
    
    // Get team details
    const teamId = prompt('Enter Team ID:\n(Example: E, F, AA, etc.)');
    if (!teamId || !teamId.trim()) {
        alert('Team ID is required!');
        return;
    }
    
    // Check if team ID already exists in this group
    const group = tournamentData[groupName];
    if (group.participants.find(p => p.teamId === teamId.trim())) {
        alert(`Team ID "${teamId}" already exists in ${groupName}!`);
        return;
    }
    
    const name1 = prompt('Enter Player 1 Name:');
    if (!name1 || !name1.trim()) {
        alert('Player 1 name is required!');
        return;
    }
    
    const name2 = prompt('Enter Player 2 Name (or leave empty for solo):') || '';
    
    const manager = prompt('Enter Manager Name:');
    if (!manager || !manager.trim()) {
        alert('Manager name is required!');
        return;
    }
    
    // Check if players exist in other teams (warn but allow)
    checkPlayerDuplicates(name1, name2, teamId, groupName);
    
    // Add team to group
    addNewTeamToGroup(groupName, {
        teamId: teamId.trim(),
        name1: name1.trim(),
        name2: name2.trim(),
        manager: manager.trim()
    });
}

function checkPlayerDuplicates(name1, name2, newTeamId, newGroupName) {
    const duplicates = [];
    
    Object.keys(tournamentData).forEach(groupName => {
        const group = tournamentData[groupName];
        group.participants.forEach(participant => {
            if (participant.teamId === newTeamId && groupName === newGroupName) return;
            
            if (participant.name1.toLowerCase() === name1.toLowerCase() ||
                (name2 && participant.name1.toLowerCase() === name2.toLowerCase()) ||
                (name2 && participant.name2 && participant.name2.toLowerCase() === name1.toLowerCase()) ||
                (name2 && participant.name2 && participant.name2.toLowerCase() === name2.toLowerCase())) {
                duplicates.push(`${participant.teamId} (${groupName})`);
            }
        });
    });
    
    if (duplicates.length > 0) {
        const proceed = confirm(`⚠️ WARNING: Player(s) found in other teams:\n${duplicates.join(', ')}\n\nContinue anyway?`);
        if (!proceed) {
            throw new Error('User cancelled due to duplicates');
        }
    }
}

function addNewTeamToGroup(groupName, newTeam) {
    const group = tournamentData[groupName];
    
    // Add team to participants
    group.participants.push(newTeam);
    
    // Get current highest match number globally
    let maxMatchNo = 0;
    Object.keys(tournamentData).forEach(gName => {
        const g = tournamentData[gName];
        g.matches.forEach(match => {
            if (match.matchNo > maxMatchNo) {
                maxMatchNo = match.matchNo;
            }
        });
    });
    
    // Generate matches: new team vs all existing teams in group
    const newMatches = [];
    let nextMatchNo = maxMatchNo + 1;
    
    group.participants.forEach(participant => {
        if (participant.teamId === newTeam.teamId) return; // Skip self
        
        newMatches.push({
            matchNo: nextMatchNo++,
            opponent1: newTeam.teamId,
            opponent2: participant.teamId,
            date: '',
            winner: '',
            runner: '',
            draw: ''
        });
    });
    
    // Add new matches to group
    group.matches.push(...newMatches);
    
    // Assign dates to new matches (distribute across Nov 24 - Dec 10)
    assignDatesToNewMatches(newMatches);
    
    // Save to Firebase
    updateSyncStatus('saving', '💾 Adding team...');
    
    saveToFirebase((success) => {
        if (success) {
            updateSyncStatus('synced', '✅ Team added!');
            alert(`✅ Success!\n\n• Added team ${newTeam.teamId} to ${groupName}\n• Generated ${newMatches.length} new matches\n• Match numbers: ${newMatches[0].matchNo} - ${newMatches[newMatches.length - 1].matchNo}\n• Total matches now: ${getTotalMatches()}`);
            renderAllViews();
            updateTotalMatchCount(); // Force update count display
            setTimeout(() => updateSyncStatus('synced', '✅ Synced'), 2000);
        } else {
            updateSyncStatus('error', '❌ Failed to add team');
            alert('❌ Failed to save. Please try again.');
        }
    });
}

function assignDatesToNewMatches(newMatches) {
    // Date range: Nov 24 - Dec 10, 2025
    const startDate = new Date('2025-11-24');
    const endDate = new Date('2025-12-10');
    
    // Build available dates list (same as populateMatchDates logic)
    const availableDates = [];
    let currentDate = new Date(startDate);
    
    while (currentDate <= endDate) {
        const dayOfWeek = currentDate.getDay();
        const matchesForDay = (dayOfWeek === 5) ? 20 : 15; // Friday: 20, Others: 15
        
        for (let i = 0; i < matchesForDay; i++) {
            availableDates.push(currentDate.toISOString().split('T')[0]);
        }
        
        currentDate.setDate(currentDate.getDate() + 1);
    }
    
    // Count existing matches per date
    const dateUsage = {};
    Object.keys(tournamentData).forEach(groupName => {
        const group = tournamentData[groupName];
        group.matches.forEach(match => {
            if (match.date) {
                dateUsage[match.date] = (dateUsage[match.date] || 0) + 1;
            }
        });
    });
    
    // Find dates with capacity
    const datesWithCapacity = [];
    availableDates.forEach(date => {
        const used = dateUsage[date] || 0;
        const dayOfWeek = new Date(date).getDay();
        const capacity = (dayOfWeek === 5) ? 20 : 15;
        
        if (used < capacity) {
            datesWithCapacity.push(date);
        }
    });
    
    // Distribute new matches across available dates
    newMatches.forEach((match, index) => {
        if (datesWithCapacity.length > 0) {
            // Use round-robin distribution
            const dateIndex = index % datesWithCapacity.length;
            match.date = datesWithCapacity[dateIndex];
        } else {
            // Fallback: add to first date (over capacity if needed)
            match.date = availableDates[0];
        }
    });
}

function getTotalMatches() {
    let total = 0;
    Object.keys(tournamentData).forEach(groupName => {
        total += tournamentData[groupName].matches.length;
    });
    return total;
}

// Initialize add team buttons when app loads
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initializeAddTeamButtons, 1000);
});


// ============================================
// UPDATE TOTAL MATCH COUNT DISPLAY
// ============================================

function updateTotalMatchCount() {
    const countElement = document.getElementById('totalMatchCount');
    if (countElement) {
        const total = getTotalMatches();
        countElement.textContent = `All ${total} league matches`;
    }
}

// Call this when rendering home view
const originalRenderHomeMatches = renderHomeMatches;
renderHomeMatches = function() {
    originalRenderHomeMatches();
    updateTotalMatchCount();
};


// ============================================
// DATE-ONLY SAVE (For Rescheduling)
// ============================================

function handleDateOnlySave(form) {
    const teamName = form.dataset.team;
    const matchNo = parseInt(form.dataset.match);
    const messageElement = form.querySelector('.message-area');
    
    const newDate = form.querySelector('[name="date"]').value;
    
    if (!newDate) {
        showMessage(messageElement, 'error', '⚠️ Please select a date');
        return;
    }
    
    // Update only the date, leave results unchanged
    const match = tournamentData[teamName].matches.find(m => m.matchNo === matchNo);
    if (match) {
        const oldDate = match.date || 'Not set';
        match.date = newDate;
        
        updateSyncStatus('saving', '💾 Saving date...');
        
        // Save to Firebase
        saveToFirebase((success) => {
            if (success) {
                updateSyncStatus('synced', '✅ Date saved!');
                showMessage(messageElement, 'success', `✓ Date updated: ${oldDate} → ${newDate}`);
                
                // Refresh all views to show updated date
                renderAllViews();
                
                setTimeout(() => updateSyncStatus('synced', '✅ Synced'), 2000);
            } else {
                updateSyncStatus('error', '❌ Save failed');
                showMessage(messageElement, 'error', '❌ Failed to save date. Try again.');
            }
        });
    }
}


// ============================================
// TIE-BREAKER DETECTION - ADDED FOR SANTO
// ============================================
function detectTieBreakers() {
    const tieBreakers = [];
    const groupNames = Object.keys(tournamentData);
    
    groupNames.forEach(groupName => {
        const standings = calculateStandings(groupName);
        let i = 0;
        while (i < Math.min(3, standings.length)) {
            const currentPoints = standings[i].points;
            const tiedTeams = [standings[i]];
            let j = i + 1;
            while (j < standings.length && standings[j].points === currentPoints) {
                tiedTeams.push(standings[j]);
                j++;
            }
            if (tiedTeams.length > 1) {
                tieBreakers.push({
                    group: groupName,
                    position: i + 1,
                    teams: tiedTeams,
                    points: currentPoints
                });
            }
            i = j;
        }
    });
    return tieBreakers;
}

function showTieBreakerSheet() {
    const tieBreakers = detectTieBreakers();
    const container = document.getElementById('overallStandings');
    
    let html = '<div class="card"><h2>⚖️ Tie-Breaker Sheet</h2>';
    
    if (tieBreakers.length === 0) {
        html += '<div class="alert alert-success">✅ No tie-breakers needed! All positions are clear.</div>';
    } else {
        html += `<div class="alert alert-warning">⚠️ Found ${tieBreakers.length} tie-breaker situation(s)</div>`;
        
        tieBreakers.forEach((tb, idx) => {
            html += `<div style="margin: 2rem 0; padding: 1.5rem; border: 2px solid #f59e0b; border-radius: 12px; background: #fffbeb;">
                <h3 style="color: #92400e; margin-bottom: 1rem;">${idx + 1}. ${tb.group} - Position ${tb.position} (${tb.points} pts)</h3>
                <div style="margin: 1rem 0;"><strong>Tied Teams:</strong><br>`;
            
            tb.teams.forEach(team => {
                html += `<div style="padding: 0.5rem; margin: 0.5rem 0; background: white; border-radius: 6px;">
                    ${team.team} - W:${team.won} D:${team.drawn} L:${team.lost}
                </div>`;
            });
            
            html += `</div><div style="margin-top: 1rem;"><strong>Head-to-Head Results:</strong>
                <table class="standings-table" style="margin-top: 0.5rem;"><thead><tr><th>Team</th>`;
            
            tb.teams.forEach(t => html += `<th>${t.team}</th>`);
            html += `</tr></thead><tbody>`;
            
            tb.teams.forEach(team1 => {
                html += `<tr><td><strong>${team1.team}</strong></td>`;
                tb.teams.forEach(team2 => {
                    if (team1.team === team2.team) {
                        html += '<td style="background: #374151; color: white;">-</td>';
                    } else {
                        const group = tournamentData[tb.group];
                        const h2h = group.matches.filter(m => 
                            (m.o1 === team1.team && m.o2 === team2.team) || 
                            (m.o1 === team2.team && m.o2 === team1.team)
                        );
                        
                        let result = '-';
                        h2h.forEach(m => {
                            if (m.w) {
                                if (m.draw) result = 'D';
                                else if (m.w === team1.team) result = 'W';
                                else result = 'L';
                            }
                        });
                        
                        const bg = result === 'W' ? '#d1fae5' : (result === 'L' ? '#fee2e2' : '#fef3c7');
                        html += `<td style="background: ${bg};">${result}</td>`;
                    }
                });
                html += '</tr>';
            });
            
            html += `</tbody></table></div></div>`;
        });
    }
    
    html += '<button onclick="renderOverallView()" class="btn btn-secondary" style="margin-top: 1rem;">← Back</button></div>';
    container.innerHTML = html;
}
