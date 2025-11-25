# 🔄 Reset Feature Update - Quick Guide

## ✅ What's New

Added TWO reset options for testing:

1. **🔄 Reset ALL Matches** - Clears all teams (top right, admin only)
2. **🔄 Reset [Team Name]** - Clears one team only (in schedule view)

---

## 📥 Step 13.2: Update Your Files

### Download These 2 Updated Files:

1. **index.html** - Added reset modal
2. **app.js** - Added reset functionality

(firebase-config.js, data.js, styles.css are unchanged)

---

## 🔄 Step 13.3: Update GitHub

### In GitHub Desktop:

1. **Replace** the 2 files in your local repository folder:
   - index.html (new version)
   - app.js (new version)

2. GitHub Desktop will show changes

3. In **Summary box**, type: `Added reset functionality`

4. Click **"Commit to main"**

5. Click **"Push origin"** (top right)

6. Wait 1-2 minutes

7. Netlify auto-deploys!

---

## 🧪 Testing the Reset Features

### Test Reset ALL:

1. Go to your site
2. Login as admin
3. Update 2-3 matches in different teams
4. Click **"🔄 Reset ALL Matches"** (top right)
5. Confirm
6. All matches cleared ✅

### Test Reset Team:

1. Login as admin
2. Go to "Match Schedule"
3. Select a team (e.g., "1 P")
4. Update 2-3 matches
5. Click **"🔄 Reset 1 P"** (next to team name)
6. Confirm
7. Only that team's matches cleared ✅

---

## ⚠️ Safety Features

- ✅ Confirmation modal (prevents accidents)
- ✅ Admin-only (viewers can't reset)
- ✅ Visual feedback (shows "Resetting...")
- ✅ Syncs to Firebase (all devices updated)

---

## 💡 When to Use Each

**Reset ALL:**
- End of testing session
- Start fresh for actual tournament
- Something went wrong

**Reset Team:**
- Testing specific team
- Made mistakes in one team
- Re-do one team's matches

---

## ✅ Checklist

- [ ] Downloaded 2 new files
- [ ] Replaced in GitHub folder
- [ ] Committed with message
- [ ] Pushed to GitHub
- [ ] Waited for Netlify deploy
- [ ] Tested Reset ALL
- [ ] Tested Reset Team

---

Ready? Let's update your files!
