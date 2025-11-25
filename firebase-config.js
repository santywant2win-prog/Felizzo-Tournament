// Firebase Configuration
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

// Get database reference
const database = firebase.database();
const tournamentRef = database.ref('tournamentData');

console.log('Firebase initialized successfully!');
