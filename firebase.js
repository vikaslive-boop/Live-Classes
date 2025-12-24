import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, doc, setDoc, onSnapshot, addDoc, collection, query, orderBy, limit, getDocs, getDoc, deleteDoc, where } 
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

// ✅ FIXED: Each screenshot gets its own document (no 1MB limit issue)
window.saveToCloud = async (data) => {
    try {
        const promises = [];
        
        for (const [facultyId, screenshots] of Object.entries(data)) {
            // Save each screenshot as individual document
            screenshots.forEach((screenshot, index) => {
                const docId = `${facultyId}_${screenshot.timestamp}`;
                promises.push(
                    setDoc(doc(db, "screenshots", docId), {
                        facultyId: facultyId,
                        url: screenshot.url,
                        course: screenshot.course,
                        cycle: screenshot.cycle,
                        day: screenshot.day,
                        timestamp: screenshot.timestamp
                    })
                );
            });
        }
        
        await Promise.all(promises);
        console.log("✅ Data saved to cloud (individual documents)");
    } catch (error) {
        console.error("❌ Error saving to cloud:", error);
        throw error;
    }
};

// ✅ FIXED: Load screenshots from individual documents
window.loadAllFacultyData = async () => {
    try {
        const snapshot = await getDocs(collection(db, "screenshots"));
        const data = {};
        
        snapshot.forEach(doc => {
            const screenshot = doc.data();
            const facultyId = screenshot.facultyId;
            
            if (!data[facultyId]) data[facultyId] = [];
            
            data[facultyId].push({
                id: doc.id,
                url: screenshot.url,
                course: screenshot.course,
                cycle: screenshot.cycle,
                day: screenshot.day,
                timestamp: screenshot.timestamp
            });
        });
        
        // Sort by timestamp for each faculty
        Object.keys(data).forEach(facultyId => {
            data[facultyId].sort((a, b) => a.timestamp - b.timestamp);
        });
        
        window.facultyAppreciations = data;
        console.log("📥 Loaded all faculty data from cloud");
        
        if (window.renderFacultyGrid) window.renderFacultyGrid();
        if (window.updateFacultyStats) window.updateFacultyStats();
        
        return data;
    } catch (error) {
        console.error("❌ Error loading faculty data:", error);
        return {};
    }
};

// ✅ FIXED: Delete individual screenshot documents
window.deleteScreenshotFromCloud = async (facultyId, screenshotId) => {
    try {
        await deleteDoc(doc(db, "screenshots", screenshotId));
        console.log("🗑️ Screenshot deleted from cloud");
    } catch (error) {
        console.error("❌ Error deleting screenshot:", error);
    }
};

// ✅ FIXED: Delete all screenshots for a faculty
window.deleteAllFacultyScreenshots = async (facultyId) => {
    try {
        const q = query(collection(db, "screenshots"), where("facultyId", "==", facultyId));
        const snapshot = await getDocs(q);
        
        const promises = [];
        snapshot.forEach(doc => {
            promises.push(deleteDoc(doc.ref));
        });
        
        await Promise.all(promises);
        console.log(`🗑️ All screenshots deleted for ${facultyId}`);
    } catch (error) {
        console.error("❌ Error deleting faculty screenshots:", error);
    }
};

// Listen to screenshot changes (real-time updates)
window.listenToScreenshots = () => {
    onSnapshot(collection(db, "screenshots"), (snapshot) => {
        const data = {};
        
        snapshot.forEach(doc => {
            const screenshot = doc.data();
            const facultyId = screenshot.facultyId;
            
            if (!data[facultyId]) data[facultyId] = [];
            
            data[facultyId].push({
                id: doc.id,
                url: screenshot.url,
                course: screenshot.course,
                cycle: screenshot.cycle,
                day: screenshot.day,
                timestamp: screenshot.timestamp
            });
        });
        
        // Sort by timestamp for each faculty
        Object.keys(data).forEach(facultyId => {
            data[facultyId].sort((a, b) => a.timestamp - b.timestamp);
        });
        
        window.facultyAppreciations = data;
        console.log("📥 Screenshots synced from cloud");
        
        if (window.renderFacultyGrid) window.renderFacultyGrid();
        if (window.updateFacultyStats) window.updateFacultyStats();
    });
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

// Load initial data and start listening
window.loadAllFacultyData();
window.listenToScreenshots();

export default db;
