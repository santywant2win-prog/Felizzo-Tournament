// Firebase Configuration for FELIZZO '25 Table Tennis
const firebaseConfig = {
  apiKey: "AIzaSyAleWSiaD_dzE01gf_KZQZkrDYiXUAYW-U",
  authDomain: "felizzo-tournament.firebaseapp.com",
  databaseURL: "https://felizzo-tournament-default-rtdb.firebaseio.com",
  projectId: "felizzo-tournament",
  storageBucket: "felizzo-tournament.firebasestorage.app",
  messagingSenderId: "81371463648",
  appId: "1:81371463648:web:609590913fdaaa11387585",
  measurementId: "G-14SD6DKMN2"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Database references - SPORT-SPECIFIC PATHS
const tournamentRef = firebase.database().ref('felizzo2025/tabletennis/tournamentData');
const knockoutRef = firebase.database().ref('felizzo2025/tabletennis/knockoutData');

console.log('Firebase initialized for Table Tennis');
console.log('Tournament path: felizzo2025/tabletennis/tournamentData');
