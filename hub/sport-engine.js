// FELIZZO '25 Universal Sport Engine
// Get sport from URL
const urlParams = new URLSearchParams(window.location.search);
const SPORT = urlParams.get('game') || 'unknown';

// Sport Configuration
const SPORT_CONFIG = {
    chess: { name: 'Chess', icon: '♟️', color: '#8b5cf6' },
    snooker: { name: 'Snooker', icon: '🎱', color: '#10b981' },
    foosball: { name: 'Foosball', icon: '⚽', color: '#f59e0b' },
    badminton: { name: 'Badminton', icon: '🏸', color: '#ec4899' },
    tabletennis: { name: 'Table Tennis', icon: '🏓', color: '#06b6d4' }
};

// App State
const APP_STATE = {
    isAdmin: false,
    adminPassword: 'f25ca',
    currentView: 'setup',
    sport: SPORT,
    setupComplete: false
};

// Tournament Data
let tournamentData = {};
let participantsList = [];

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initializeSport();
    setupEventListeners();
    checkExistingData();
});

function initializeSport() {
    const config = SPORT_CONFIG[SPORT];
    if (!config) {
        alert('Invalid sport!');
        window.location.href = '../';
        return;
    }
    
    document.getElementById('pageTitle').textContent = `${config.name} - FELIZZO '25`;
    document.getElementById('sportTitle').textContent = `${config.icon} ${config.name} Tournament`;
}

function setupEventListeners() {
    document.getElementById('adminBtn').addEventListener('click', () => {
        const password = prompt('Enter admin password:');
        if (password === APP_STATE.adminPassword) {
            APP_STATE.isAdmin = true;
            alert('✅ Admin mode activated!');
            updateAdminUI();
        } else {
            alert('❌ Incorrect password!');
        }
    });
    
    document.getElementById('viewModeBtn').addEventListener('click', () => {
        APP_STATE.isAdmin = false;
        alert('Switched to view mode');
        updateAdminUI();
    });
}

function updateAdminUI() {
    const adminBtn = document.getElementById('adminBtn');
    const viewModeBtn = document.getElementById('viewModeBtn');
    const backupBtn = document.getElementById('backupBtn');
    const restoreBtn = document.getElementById('restoreBtn');
    
    if (APP_STATE.isAdmin) {
        adminBtn.style.display = 'none';
        viewModeBtn.style.display = 'block';
        backupBtn.style.display = 'inline-block';
        restoreBtn.style.display = 'inline-block';
    } else {
        adminBtn.style.display = 'block';
        viewModeBtn.style.display = 'none';
        backupBtn.style.display = 'none';
        restoreBtn.style.display = 'none';
    }
}

function checkExistingData() {
    // Check Firebase for existing tournament
    const dbRef = firebase.database().ref(`felizzo2025/${SPORT}/tournamentData`);
    
    dbRef.once('value', (snapshot) => {
        if (snapshot.exists()) {
            tournamentData = snapshot.val();
            APP_STATE.setupComplete = true;
            showTournamentView();
        }
    });
}

// ============================================
// SETUP FUNCTIONS
// ============================================

function showCSVImport() {
    document.getElementById('csvImportSection').style.display = 'block';
    document.getElementById('manualEntrySection').style.display = 'none';
}

function showManualEntry() {
    document.getElementById('manualEntrySection').style.display = 'block';
    document.getElementById('csvImportSection').style.display = 'none';
}

function importCSV() {
    const fileInput = document.getElementById('csvFile');
    const file = fileInput.files[0];
    
    if (!file) {
        alert('Please select a CSV file');
        return;
    }
    
    const reader = new FileReader();
    reader.onload = function(e) {
        const text = e.target.result;
        parseCSV(text);
    };
    reader.readAsText(file);
}

function parseCSV(text) {
    const lines = text.split('\n').filter(line => line.trim());
    participantsList = [];
    
    lines.forEach((line, index) => {
        if (index === 0 && line.toLowerCase().includes('team')) return; // Skip header
        
        const parts = line.split(',').map(p => p.trim());
        if (parts.length >= 4) {
            participantsList.push({
                teamId: parts[0],
                name1: parts[1],
                name2: parts[2] || '',
                manager: parts[3],
                groupName: parts[4] || 'Group 1'
            });
        }
    });
    
    if (participantsList.length > 0) {
        showPreview();
    } else {
        alert('No valid data found in CSV');
    }
}

function processQuickEntry() {
    const text = document.getElementById('quickEntryText').value;
    const lines = text.split('\n').filter(line => line.trim());
    
    participantsList = [];
    
    lines.forEach(line => {
        const parts = line.split(',').map(p => p.trim());
        if (parts.length >= 4) {
            participantsList.push({
                teamId: parts[0],
                name1: parts[1],
                name2: parts[2] || '',
                manager: parts[3],
                groupName: parts[4] || 'Group 1'
            });
        }
    });
    
    if (participantsList.length > 0) {
        showPreview();
    } else {
        alert('Please enter at least one team');
    }
}

function showPreview() {
    const previewSection = document.getElementById('previewSection');
    const previewContent = document.getElementById('previewContent');
    
    // Group by groupName
    const grouped = {};
    participantsList.forEach(p => {
        if (!grouped[p.groupName]) grouped[p.groupName] = [];
        grouped[p.groupName].push(p);
    });
    
    let html = '<div style="margin-bottom: 1.5rem;">';
    html += `<p style="color: var(--text-light);"><strong>${participantsList.length} teams</strong> in <strong>${Object.keys(grouped).length} groups</strong></p>`;
    html += '</div>';
    
    html += '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1rem;">';
    
    Object.keys(grouped).forEach(groupName => {
        html += `
            <div style="padding: 1rem; background: var(--bg-dark); border-radius: 0.5rem; border: 2px solid var(--border-color);">
                <h4 style="color: var(--primary-color); margin-bottom: 0.75rem;">${groupName} (${grouped[groupName].length} teams)</h4>
        `;
        
        grouped[groupName].forEach(team => {
            html += `
                <div style="padding: 0.5rem; margin-bottom: 0.5rem; background: var(--bg-light); border-radius: 0.25rem;">
                    <strong style="color: var(--secondary-color);">${team.teamId}</strong> - 
                    ${team.name1}${team.name2 ? ' & ' + team.name2 : ''}
                </div>
            `;
        });
        
        html += '</div>';
    });
    
    html += '</div>';
    
    previewContent.innerHTML = html;
    previewSection.style.display = 'block';
}

function generateMatches() {
    if (!confirm('Generate round-robin matches for all groups?')) return;
    
    // Group participants
    const grouped = {};
    participantsList.forEach(p => {
        if (!grouped[p.groupName]) grouped[p.groupName] = [];
        grouped[p.groupName].push(p);
    });
    
    // Generate matches for each group
    tournamentData = {};
    
    Object.keys(grouped).forEach(groupName => {
        const teams = grouped[groupName];
        const matches = [];
        let matchNo = 1;
        
        // Round-robin: each team plays every other team once
        for (let i = 0; i < teams.length; i++) {
            for (let j = i + 1; j < teams.length; j++) {
                matches.push({
                    matchNo: matchNo++,
                    opponent1: teams[i].teamId,
                    opponent2: teams[j].teamId,
                    date: '',
                    winner: '',
                    runner: '',
                    draw: ''
                });
            }
        }
        
        tournamentData[groupName] = {
            teamName: groupName,
            participants: teams,
            matches: matches
        };
    });
    
    // Save to Firebase
    const dbRef = firebase.database().ref(`felizzo2025/${SPORT}/tournamentData`);
    dbRef.set(tournamentData, (error) => {
        if (error) {
            alert('❌ Failed to save tournament data');
        } else {
            alert(`✅ Generated ${Object.keys(tournamentData).reduce((sum, g) => sum + tournamentData[g].matches.length, 0)} matches!`);
            APP_STATE.setupComplete = true;
            showTournamentView();
        }
    });
}

function resetSetup() {
    if (!confirm('Clear all entered data and start over?')) return;
    
    participantsList = [];
    document.getElementById('quickEntryText').value = '';
    document.getElementById('csvFile').value = '';
    document.getElementById('previewSection').style.display = 'none';
    document.getElementById('csvImportSection').style.display = 'none';
    document.getElementById('manualEntrySection').style.display = 'none';
}

// ============================================
// TOURNAMENT VIEW (Reuse Carrom UI)
// ============================================

function showTournamentView() {
    document.getElementById('setupView').style.display = 'none';
    document.getElementById('tournamentView').style.display = 'block';
    
    alert('Tournament view coming soon! Will reuse Carrom UI.');
    // TODO: Load carrom app.js and render with tournamentData
}

