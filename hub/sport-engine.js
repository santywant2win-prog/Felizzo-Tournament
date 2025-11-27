// 🎮 FELIZZO '25 - Universal Sport Tournament Engine
// Handles setup, match generation, and Firebase integration for all sports

class SportTournamentEngine {
    constructor(sportName) {
        this.sportName = sportName.toLowerCase();
        this.teams = [];
        this.matches = [];
        this.groups = new Set();
        
        // Firebase path for this sport
        this.firebasePath = `/felizzo2025/${this.sportName}`;
        
        console.log(`🎯 Tournament Engine initialized for: ${sportName}`);
        console.log(`📂 Firebase path: ${this.firebasePath}`);
    }

    // Parse CSV data
    parseCSV(csvText) {
        const lines = csvText.trim().split('\n');
        const teams = [];
        
        lines.forEach((line, index) => {
            const parts = line.split(',').map(p => p.trim());
            if (parts.length >= 4) {
                teams.push({
                    id: parts[0] || `T${index + 1}`,
                    player1: parts[1] || '',
                    player2: parts[2] || '',
                    manager: parts[3] || '',
                    group: parts[4] || 'Group 1'
                });
                this.groups.add(parts[4] || 'Group 1');
            }
        });
        
        this.teams = teams;
        console.log(`✅ Parsed ${teams.length} teams across ${this.groups.size} groups`);
        return teams;
    }

    // Add single team manually
    addTeam(teamData) {
        this.teams.push(teamData);
        this.groups.add(teamData.group);
        console.log(`✅ Added team: ${teamData.id}`);
    }

    // Generate round-robin matches for all groups
    generateMatches() {
        this.matches = [];
        let matchNumber = 1;
        
        // Get unique groups
        const groupList = Array.from(this.groups).sort();
        
        groupList.forEach(group => {
            const groupTeams = this.teams.filter(t => t.group === group);
            const groupMatches = this.generateRoundRobin(groupTeams, group, matchNumber);
            
            this.matches.push(...groupMatches);
            matchNumber += groupMatches.length;
            
            console.log(`✅ Generated ${groupMatches.length} matches for ${group}`);
        });
        
        console.log(`🎯 Total matches generated: ${this.matches.length}`);
        return this.matches;
    }

    // Round-robin algorithm for a single group
    generateRoundRobin(teams, groupName, startNumber) {
        const matches = [];
        const n = teams.length;
        
        // Each team plays each other team once
        for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
                matches.push({
                    matchNumber: startNumber + matches.length,
                    group: groupName,
                    teamA: teams[i].id,
                    teamB: teams[j].id,
                    teamAName: `${teams[i].player1}${teams[i].player2 ? ' & ' + teams[i].player2 : ''}`,
                    teamBName: `${teams[j].player1}${teams[j].player2 ? ' & ' + teams[j].player2 : ''}`,
                    date: null,
                    winner: null,
                    runner: null,
                    isDraw: false,
                    status: 'pending'
                });
            }
        }
        
        return matches;
    }

    // Calculate points and standings
    calculateStandings() {
        const standings = {};
        
        // Initialize standings for all teams
        this.teams.forEach(team => {
            standings[team.id] = {
                team: team.id,
                player1: team.player1,
                player2: team.player2,
                manager: team.manager,
                group: team.group,
                played: 0,
                won: 0,
                lost: 0,
                draw: 0,
                points: 0,
                qualified: false
            };
        });
        
        // Calculate from matches
        this.matches.forEach(match => {
            if (match.winner || match.isDraw) {
                const teamAStats = standings[match.teamA];
                const teamBStats = standings[match.teamB];
                
                teamAStats.played++;
                teamBStats.played++;
                
                if (match.isDraw) {
                    teamAStats.draw++;
                    teamBStats.draw++;
                    teamAStats.points += 1;
                    teamBStats.points += 1;
                } else if (match.winner === match.teamA) {
                    teamAStats.won++;
                    teamBStats.lost++;
                    teamAStats.points += 3;
                } else {
                    teamBStats.won++;
                    teamAStats.lost++;
                    teamBStats.points += 3;
                }
            }
        });
        
        // Determine qualification (top 2 from each group)
        const groupList = Array.from(this.groups);
        groupList.forEach(group => {
            const groupStandings = Object.values(standings)
                .filter(s => s.group === group)
                .sort((a, b) => b.points - a.points || b.won - a.won);
            
            // Top 2 qualify
            if (groupStandings.length >= 2) {
                groupStandings[0].qualified = true;
                groupStandings[1].qualified = true;
            }
        });
        
        return standings;
    }

    // Save tournament data to Firebase
    async saveToFirebase() {
        if (typeof firebase === 'undefined') {
            console.error('❌ Firebase not initialized');
            return false;
        }

        try {
            const db = firebase.database();
            const tournamentRef = db.ref(`${this.firebasePath}/tournamentData`);
            
            // Prepare data
            const tournamentData = {
                sport: this.sportName,
                teams: this.teams,
                matches: this.matches,
                groups: Array.from(this.groups),
                createdAt: new Date().toISOString(),
                lastUpdated: new Date().toISOString()
            };
            
            await tournamentRef.set(tournamentData);
            console.log(`✅ Tournament data saved to Firebase: ${this.firebasePath}/tournamentData`);
            return true;
            
        } catch (error) {
            console.error('❌ Firebase save error:', error);
            return false;
        }
    }

    // Load tournament data from Firebase
    async loadFromFirebase() {
        if (typeof firebase === 'undefined') {
            console.error('❌ Firebase not initialized');
            return false;
        }

        try {
            const db = firebase.database();
            const tournamentRef = db.ref(`${this.firebasePath}/tournamentData`);
            
            const snapshot = await tournamentRef.once('value');
            const data = snapshot.val();
            
            if (data) {
                this.teams = data.teams || [];
                this.matches = data.matches || [];
                this.groups = new Set(data.groups || []);
                
                console.log(`✅ Loaded ${this.teams.length} teams and ${this.matches.length} matches from Firebase`);
                return true;
            } else {
                console.log('⚠️ No existing tournament data found');
                return false;
            }
            
        } catch (error) {
            console.error('❌ Firebase load error:', error);
            return false;
        }
    }

    // Update match result
    async updateMatchResult(matchNumber, winner, runner, isDraw = false) {
        const match = this.matches.find(m => m.matchNumber === matchNumber);
        if (!match) {
            console.error(`❌ Match ${matchNumber} not found`);
            return false;
        }

        match.winner = winner;
        match.runner = runner;
        match.isDraw = isDraw;
        match.status = 'completed';
        match.lastUpdated = new Date().toISOString();

        // Save to Firebase
        return await this.saveToFirebase();
    }

    // Export data for display
    exportForDisplay() {
        const standings = this.calculateStandings();
        
        return {
            sport: this.sportName,
            teams: this.teams,
            matches: this.matches,
            standings: Object.values(standings),
            groups: Array.from(this.groups),
            summary: {
                totalTeams: this.teams.length,
                totalMatches: this.matches.length,
                completedMatches: this.matches.filter(m => m.status === 'completed').length,
                pendingMatches: this.matches.filter(m => m.status === 'pending').length
            }
        };
    }
}

// Global function to initialize tournament
function initializeSportTournament(sportName) {
    window.tournamentEngine = new SportTournamentEngine(sportName);
    console.log(`🚀 ${sportName} tournament engine ready!`);
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SportTournamentEngine;
}
