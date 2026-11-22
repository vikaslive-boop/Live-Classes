// ─────────────────────────────────────────────────────────────
// DBMCI One · Firebase
// Authentication, member roles and all Firestore reads/writes.
// Collections used:
//   members/{email}            { role: 'viewer' | 'admin' | 'superadmin' }
//   screenshots/{id}           appreciation photos (unchanged format)
//   facultyHub/facultyList     { list: [{ id, name, avatar }] }
//   facultyHub/adminOptions    { courses, cycles, days }   (read only now)
//   activityLogs/{id}          audit trail
//   facultyScreenshots/{id}    older photos (list per faculty, read only)
// ─────────────────────────────────────────────────────────────
import { flattenLegacy, mergeShots } from './assets/data.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, deleteDoc, addDoc,
  onSnapshot, query, orderBy, limit, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import {
  getAuth, onAuthStateChanged, signOut, GoogleAuthProvider, signInWithPopup,
  signInWithRedirect, getRedirectResult, setPersistence, browserSessionPersistence,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

// The web config is public by design. Access is controlled by
// Authentication + the Firestore rules in firestore.rules.
const firebaseConfig = {
  apiKey: 'AIzaSyDCA8AUHLCFgYqzT9wgkBTyM3bQNzp0pCs',
  authDomain: 'live-360-6f7e6.firebaseapp.com',
  projectId: 'live-360-6f7e6',
  storageBucket: 'live-360-6f7e6.firebasestorage.app',
  messagingSenderId: '962411291266',
  appId: '1:962411291266:web:7a2f4126a65349b7100a9b',
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

// Signing out when the browser tab/window closes.
setPersistence(auth, browserSessionPersistence).catch(() => {});

const normEmail = e => String(e || '').trim().toLowerCase();

// ── Auth: Google sign-in ─────────────────────────────────────
// Anyone can complete Google sign-in, but only emails listed in `members`
// get in; everyone else is signed straight back out.
const google = new GoogleAuthProvider();
google.setCustomParameters({ prompt: 'select_account' });

async function admit(user) {
  const member = await getMember(user);
  if (!member) {
    await signOut(auth);
    const err = new Error('not-member');
    err.code = 'app/not-member';
    err.email = user?.email;
    throw err;
  }
  logActivity('Sign in', `${user.email} signed in with Google`, user.email);
  return member;
}

export async function signInWithGoogle() {
  try {
    const cred = await signInWithPopup(auth, google);
    return await admit(cred.user);
  } catch (err) {
    // Popup blocked (some phones / strict browsers): fall back to a full-page redirect.
    if (err.code === 'auth/popup-blocked' || err.code === 'auth/operation-not-supported-in-this-environment') {
      await signInWithRedirect(auth, google);
      return null;
    }
    throw err;
  }
}

// Call on the login page to finish a redirect sign-in, if one happened.
export async function finishRedirectSignIn() {
  const res = await getRedirectResult(auth);
  return res?.user ? admit(res.user) : null;
}

export async function signOutUser(reason = 'Sign out') {
  const email = auth.currentUser?.email;
  if (email) await logActivity(reason, `${email} signed out`, email);
  await signOut(auth);
}

async function getMember(user) {
  if (!user?.email || user.emailVerified === false) return null;
  try {
    const snap = await getDoc(doc(db, 'members', normEmail(user.email)));
    if (!snap.exists()) return null;
    const role = snap.data().role;
    return ['viewer', 'admin', 'superadmin'].includes(role)
      ? { email: normEmail(user.email), role, name: user.displayName || '', photo: user.photoURL || '' }
      : null;
  } catch {
    return null;
  }
}

// Resolves with { email, role, name, photo } for a signed-in member; otherwise sends the visitor to login.html.
export function requireMember() {
  return new Promise(resolve => {
    const stop = onAuthStateChanged(auth, async user => {
      stop();
      if (!user) return location.replace('login.html');
      const member = await getMember(user);
      if (!member) {
        await signOut(auth);
        return location.replace('login.html?reason=access');
      }
      resolve(member);
    });
  });
}

// For the login page: is someone already signed in?
export function currentMember() {
  return new Promise(resolve => {
    const stop = onAuthStateChanged(auth, async user => {
      stop();
      resolve(user ? await getMember(user) : null);
    });
  });
}

// ── Appreciation photos ──────────────────────────────────────
// New format: screenshots/{id}, one photo per document.
// Old format: facultyScreenshots/{facultyId}, a list of photos in one document
// (read-only; shown alongside the new ones so no old photo is lost).
const toShot = d => ({ id: d.id, ...d.data() });

async function loadLegacy() {
  try {
    const snap = await getDocs(collection(db, 'facultyScreenshots'));
    return flattenLegacy(snap.docs.map(d => ({ id: d.id, data: d.data() })));
  } catch (e) {
    console.warn('Older photos (facultyScreenshots) could not be read:', e.code || e);
    return [];
  }
}

export function watchScreenshots(onChange, onError) {
  let legacy = [], current = null;
  loadLegacy().then(l => { legacy = l; if (current) onChange(mergeShots(current, legacy)); });
  return onSnapshot(collection(db, 'screenshots'),
    snap => { current = snap.docs.map(toShot); onChange(mergeShots(current, legacy)); },
    err => onError?.(err));
}

export async function loadScreenshots() {
  const [snap, legacy] = await Promise.all([getDocs(collection(db, 'screenshots')), loadLegacy()]);
  return mergeShots(snap.docs.map(toShot), legacy);
}

// Adds new photos only. Each one is its own document; existing photos are never rewritten.
export async function addScreenshots(facultyId, items, onProgress) {
  let done = 0;
  for (const it of items) {
    const ts = it.timestamp;
    await setDoc(doc(db, 'screenshots', `${facultyId}_${ts}`), {
      facultyId, url: it.url, course: it.course, cycle: it.cycle, day: it.day, timestamp: ts,
    });
    onProgress?.(++done, items.length);
  }
}

export const deleteScreenshot = id => deleteDoc(doc(db, 'screenshots', id));

// ── Faculty list & options ───────────────────────────────────
export async function getFacultyList() {
  const snap = await getDoc(doc(db, 'facultyHub', 'facultyList'));
  return snap.exists() && Array.isArray(snap.data().list) ? snap.data().list : null;
}
export const saveFacultyList = list => setDoc(doc(db, 'facultyHub', 'facultyList'), { list });

export async function getAdminOptions() {
  try {
    const snap = await getDoc(doc(db, 'facultyHub', 'adminOptions'));
    return snap.exists() ? snap.data() : {};
  } catch { return {}; }
}

// ── Members (super admin) ────────────────────────────────────
export async function listMembers() {
  const snap = await getDocs(collection(db, 'members'));
  return snap.docs.map(d => ({ email: d.id, ...d.data() })).sort((a, b) => a.email.localeCompare(b.email));
}
export const setMember = (email, role, by) =>
  setDoc(doc(db, 'members', normEmail(email)), { role, updatedBy: by, updatedAt: serverTimestamp() });
export const removeMember = email => deleteDoc(doc(db, 'members', normEmail(email)));

// ── Activity log ─────────────────────────────────────────────
export async function logActivity(action, details, email = auth.currentUser?.email) {
  if (!email) return;
  try {
    await addDoc(collection(db, 'activityLogs'), {
      action, details, adminEmail: normEmail(email), timestamp: Date.now(), date: new Date().toISOString(),
    });
  } catch (e) { console.warn('Activity log not written:', e.code || e); }
}

export async function loadLogs(max = 200) {
  const snap = await getDocs(query(collection(db, 'activityLogs'), orderBy('timestamp', 'desc'), limit(max)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
