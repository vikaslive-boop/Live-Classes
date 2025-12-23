import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, doc, setDoc, onSnapshot, addDoc, collection, query, orderBy, limit, getDocs } 
from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyDCA8AUHLCFgYqzT9W9kBTyM3b0QNzp0pCs",
    authDomain: "live-360-6f7e6.firebaseapp.com",
    projectId: "live-360-6f7e6",
    storageBucket: "live-360-6f7e6.appspot.com",
    messagingSenderId: "962411291266",
    appId: "1:962411291266:web:7a2f4126a65349b7100a9b"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ========== LOGGING SYSTEM ==========
window.addLog = async (action, details, adminEmail) => {
    try {
        await addDoc(collection(db, "activityLogs"), {
            action: action,
            details: details,
            adminEmail: adminEmail,
            timestamp: Date.now(),
            date: new Date().toISOString()
        });
        console.log("📝 Log added:", action);
    } catch (error) {
        console.error("❌ Error adding log:", error);
    }
};

window.loadLogs = async () => {
    try {
        const logsQuery = query(
            collection(db, "activityLogs"),
            orderBy("timestamp", "desc"),
            limit(100)
        );
        const snapshot = await getDocs(logsQuery);
        const logs = [];
        snapshot.forEach(doc => {
            logs.push({ id: doc.id, ...doc.data() });
        });
        return logs;
    } catch (error) {
        console.error("❌ Error loading logs:", error);
        return [];
    }
};

// Save appreciation data to cloud
window.saveToCloud = async (data) => {
    try {
        await setDoc(doc(db, "facultyHub", "appreciationData"), data);
        console.log("✅ Data saved to cloud");
    } catch (error) {
        console.error("❌ Error saving to cloud:", error);
        showToast("Failed to save to cloud", "error");
    }
};

// Save faculty list to cloud
window.saveFacultyListToCloud = async (facultyList) => {
    try {
        await setDoc(doc(db, "facultyHub", "facultyList"), { list: facultyList });
        console.log("✅ Faculty list saved to cloud");
    } catch (error) {
        console.error("❌ Error saving faculty list:", error);
    }
};

// Save admin options to cloud
window.saveAdminOptionsToCloud = async (courses, cycles, days) => {
    try {
        await setDoc(doc(db, "facultyHub", "adminOptions"), {
            courses: courses,
            cycles: cycles,
            days: days
        });
        console.log("✅ Admin options saved to cloud");
    } catch (error) {
        console.error("❌ Error saving admin options:", error);
    }
};

// Save admin credentials to cloud
window.saveAdminCredentialsToCloud = async (credentials) => {
    try {
        await setDoc(doc(db, "facultyHub", "adminCredentials"), { list: credentials });
        console.log("✅ Admin credentials saved to cloud");
    } catch (error) {
        console.error("❌ Error saving admin credentials:", error);
    }
};

// Reset all data (dangerous!)
window.resetCloudData = async () => {
    if (confirm("DANGER: This will delete ALL screenshots for ALL faculty. Continue?")) {
        const emptyData = {};
        await window.saveToCloud(emptyData);
        showToast("Database Cleared", "success");
    }
};

// Listen to appreciation data changes
onSnapshot(doc(db, "facultyHub", "appreciationData"), (snapshot) => {
    if (snapshot.exists()) {
        window.facultyAppreciations = snapshot.data();
        console.log("📥 Appreciation data synced from cloud");
        
        if (window.renderFacultyGrid) window.renderFacultyGrid();
        if (window.updateFacultyStats) window.updateFacultyStats();
    } else {
        console.log("No appreciation data found in cloud");
        window.facultyAppreciations = {};
    }
});

// Listen to faculty list changes
onSnapshot(doc(db, "facultyHub", "facultyList"), (snapshot) => {
    if (snapshot.exists()) {
        const data = snapshot.data();
        if (data.list && Array.isArray(data.list)) {
            window.facultyData = data.list;
            console.log("📥 Faculty list synced from cloud:", data.list.length, "faculty");
            localStorage.setItem('facultyData', JSON.stringify(data.list));
            
            if (window.renderFacultyGrid) window.renderFacultyGrid();
            if (window.renderAdminPanel) window.renderAdminPanel();
        }
    }
});

// Listen to admin options changes
onSnapshot(doc(db, "facultyHub", "adminOptions"), (snapshot) => {
    if (snapshot.exists()) {
        const data = snapshot.data();
        if (data.courses) {
            window.adminCourses = data.courses;
            localStorage.setItem('adminCourses', JSON.stringify(data.courses));
        }
        if (data.cycles) {
            window.adminCycles = data.cycles;
            localStorage.setItem('adminCycles', JSON.stringify(data.cycles));
        }
        if (data.days) {
            window.adminDays = data.days;
            localStorage.setItem('adminDays', JSON.stringify(data.days));
        }
        
        console.log("📥 Admin options synced from cloud");
        
        if (window.updateAllDropdowns) window.updateAllDropdowns();
    }
});

// Listen to admin credentials changes
onSnapshot(doc(db, "facultyHub", "adminCredentials"), (snapshot) => {
    if (snapshot.exists()) {
        const data = snapshot.data();
        if (data.list && Array.isArray(data.list)) {
            window.adminCredentials = data.list;
            console.log("📥 Admin credentials synced from cloud");
            localStorage.setItem('adminCredentials', JSON.stringify(data.list));
        }
    }
});

export default db;