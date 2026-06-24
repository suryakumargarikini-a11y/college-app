// ============================================================
// SITAM SMART CAMPUS ERP — Complete SPA
// Matches Stitch UI design exactly, all modules functional
// ============================================================

const isMobileNative = window.Capacitor && window.Capacitor.platform !== 'web';
const API_BASE = window.API_BASE_URL || 'https://college-app-production-0fd2.up.railway.app/api';

let _decryptedToken = null;

// --- Secure Persistence Service (Hybrid primary AES-GCM + secondary XOR bit-rotation obfuscation) ---
const secureStorage = {
    _scramble(str) {
        if (!str) return '';
        const key = 'SITAM_Campus_Smart_ERP_Secure_Entropy_Salt_Key';
        let result = '';
        for (let i = 0; i < str.length; i++) {
            const charCode = str.charCodeAt(i);
            const keyChar = key.charCodeAt(i % key.length);
            const xored = charCode ^ keyChar;
            const shifted = ((xored << 3) & 0xFF) | (xored >> 5);
            result += String.fromCharCode(shifted ^ 0x5A);
        }
        return btoa(unescape(encodeURIComponent(result)));
    },
    _unscramble(scrambled) {
        if (!scrambled) return '';
        try {
            const key = 'SITAM_Campus_Smart_ERP_Secure_Entropy_Salt_Key';
            const raw = decodeURIComponent(escape(atob(scrambled)));
            let result = '';
            for (let i = 0; i < raw.length; i++) {
                const charCode = raw.charCodeAt(i) ^ 0x5A;
                const unshifted = ((charCode >> 3) | (charCode << 5)) & 0xFF;
                const keyChar = key.charCodeAt(i % key.length);
                result += String.fromCharCode(unshifted ^ keyChar);
            }
            return result;
        } catch (e) {
            return '';
        }
    },

    // Asynchronous startup bootstrap to decrypt hardware key payloads
    async bootstrap() {
        try {
            const scrambledKey = this._scramble('token');
            let rawData = localStorage.getItem(scrambledKey);
            
            // Mirror check from Capacitor Preferences sandbox
            if (!rawData && window.Capacitor?.Plugins?.Preferences) {
                const res = await window.Capacitor.Plugins.Preferences.get({ key: scrambledKey }).catch(() => null);
                if (res && res.value) {
                    rawData = res.value;
                }
            }

            if (!rawData) {
                _decryptedToken = null;
                return;
            }

            // Step 1: Unscramble the secondary obfuscation layer
            const jsonStr = this._unscramble(rawData);
            if (!jsonStr) return;
            const payload = JSON.parse(jsonStr);

            // Step 2: Decrypt using primary hardware/software crypt layer
            if (window.Capacitor?.Plugins?.SecureKeystore && payload.ciphertext && payload.iv) {
                const decRes = await window.Capacitor.Plugins.SecureKeystore.decrypt({
                    ciphertext: payload.ciphertext,
                    iv: payload.iv
                });
                _decryptedToken = decRes.value;
            } else if (payload.data && payload.iv) {
                // WebCrypto fallback for local/browser environments
                let keyRaw = localStorage.getItem('_secure_entropy');
                if (keyRaw && keyRaw.length !== 32) {
                    localStorage.removeItem('_secure_entropy');
                    keyRaw = null;
                }
                if (keyRaw) {
                    const keyBuf = new TextEncoder().encode(keyRaw);
                    const cryptoKey = await crypto.subtle.importKey(
                        'raw', keyBuf, { name: 'AES-GCM', length: 256 }, false, ['decrypt']
                    );
                    const iv = new Uint8Array(atob(payload.iv).split('').map(c => c.charCodeAt(0)));
                    const ciphertext = new Uint8Array(atob(payload.data).split('').map(c => c.charCodeAt(0)));
                    const decrypted = await crypto.subtle.decrypt(
                        { name: 'AES-GCM', iv }, cryptoKey, ciphertext
                    );
                    _decryptedToken = new TextDecoder().decode(decrypted);
                }
            } else {
                _decryptedToken = jsonStr;
            }
        } catch (err) {
            console.warn('[secureStorage] Bootstrap failed:', err);
            _decryptedToken = null;
        }
    },

    getItem(key) {
        if (key === 'token') {
            return _decryptedToken;
        }
        const scrambledKey = this._scramble(key);
        const val = localStorage.getItem(scrambledKey);
        return val ? this._unscramble(val) : null;
    },

    async setItem(key, value) {
        if (key === 'token') {
            _decryptedToken = value;
            try {
                let serializedPayload = '';

                if (window.Capacitor?.Plugins?.SecureKeystore) {
                    // Encrypt with native Android hardware KeyStore
                    const encRes = await window.Capacitor.Plugins.SecureKeystore.encrypt({ value });
                    serializedPayload = JSON.stringify({
                        ciphertext: encRes.ciphertext,
                        iv: encRes.iv
                    });
                } else {
                    // WebCrypto GCM-256 fallback
                    let keyRaw = localStorage.getItem('_secure_entropy');
                    if (keyRaw && keyRaw.length !== 32) {
                        localStorage.removeItem('_secure_entropy');
                        keyRaw = null;
                    }
                    if (!keyRaw) {
                        keyRaw = Array.from(crypto.getRandomValues(new Uint8Array(16)))
                            .map(b => b.toString(16).padStart(2, '0')).join('');
                        localStorage.setItem('_secure_entropy', keyRaw);
                    }
                    const keyBuf = new TextEncoder().encode(keyRaw);
                    const cryptoKey = await crypto.subtle.importKey(
                        'raw', keyBuf, { name: 'AES-GCM', length: 256 }, false, ['encrypt']
                    );
                    const iv = crypto.getRandomValues(new Uint8Array(12));
                    const encoded = new TextEncoder().encode(value);
                    const ciphertext = await crypto.subtle.encrypt(
                        { name: 'AES-GCM', iv }, cryptoKey, encoded
                    );
                    serializedPayload = JSON.stringify({
                        iv: btoa(String.fromCharCode(...iv)),
                        data: btoa(String.fromCharCode(...new Uint8Array(ciphertext)))
                    });
                }

                const scrambledKey = this._scramble(key);
                const scrambledVal = this._scramble(serializedPayload);

                localStorage.setItem(scrambledKey, scrambledVal);
                if (window.Capacitor?.Plugins?.Preferences) {
                    await window.Capacitor.Plugins.Preferences.set({
                        key: scrambledKey,
                        value: scrambledVal
                    }).catch(() => {});
                }
            } catch (err) {
                console.error('[secureStorage] Set failed:', err);
            }
            return;
        }

        const scrambledKey = this._scramble(key);
        const scrambledVal = this._scramble(value);
        localStorage.setItem(scrambledKey, scrambledVal);
        if (window.Capacitor?.Plugins?.Preferences) {
            await window.Capacitor.Plugins.Preferences.set({
                key: scrambledKey,
                value: scrambledVal
            }).catch(() => {});
        }
    },

    async removeItem(key) {
        if (key === 'token') {
            _decryptedToken = null;
        }
        const scrambledKey = this._scramble(key);
        localStorage.removeItem(scrambledKey);
        if (window.Capacitor?.Plugins?.Preferences) {
            await window.Capacitor.Plugins.Preferences.remove({ key: scrambledKey }).catch(() => {});
        }
    }
};

// One-time session token migration
const legacyToken = localStorage.getItem('token');
if (legacyToken && !secureStorage.getItem('token')) {
    secureStorage.setItem('token', legacyToken);
    localStorage.removeItem('token');
}

// --- Production Firebase Client Service ---
const firebaseConfig = {
    apiKey: "AIzaSyDummyKeyForSandboxTestingReadyPlaceholder",
    authDomain: "sitam-smart-erp.firebaseapp.com",
    projectId: "sitam-smart-erp",
    storageBucket: "sitam-smart-erp.appspot.com",
    messagingSenderId: "123456789012",
    appId: "1:123456789012:web:abcdef123456"
};

let messaging = null;
try {
    if (typeof firebase !== 'undefined') {
        if (firebase.apps.length === 0) {
            firebase.initializeApp(firebaseConfig);
        }
        if (firebase.messaging.isSupported()) {
            messaging = firebase.messaging();
        }
    } else {
        console.log('[Firebase Client] Web Firebase SDK not loaded, bypassing initialization.');
    }
} catch (err) {
    console.warn('[Firebase Client] Initialization bypassed or unsupported:', err);
}

// Foreground push alert card renderer
function showPushBanner(title, body, route) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const banner = document.createElement('div');
    banner.className = 'glass-card px-5 py-4 rounded-2xl shadow-2xl border border-blue-200/50 flex items-center gap-3.5 translate-x-12 opacity-0 transition-all duration-300 pointer-events-auto cursor-pointer hover:scale-[1.02] active-scale w-full';
    banner.style.background = 'rgba(255, 255, 255, 0.9)';
    banner.innerHTML = `
        <div class="w-9 h-9 rounded-xl bg-blue-100/80 flex items-center justify-center flex-shrink-0">
            <span class="material-symbols-outlined text-blue-700" style="font-variation-settings:'FILL' 1">campaign</span>
        </div>
        <div class="flex-1 min-w-0">
            <h4 class="text-xs font-black text-slate-800 uppercase tracking-wider">${title}</h4>
            <p class="text-[11px] text-slate-600 truncate mt-0.5">${body}</p>
        </div>
    `;

    container.appendChild(banner);

    // Animate in
    setTimeout(() => {
        banner.classList.remove('translate-x-12', 'opacity-0');
    }, 10);

    const dismiss = () => {
        banner.classList.add('translate-x-12', 'opacity-0');
        setTimeout(() => { banner.remove(); }, 300);
    };

    banner.addEventListener('click', () => {
        dismiss();
        if (route) {
            router.navigate(route);
        }
    });

    setTimeout(dismiss, 6000);
}

// Register FCM token with backend API on successful session establishment
async function registerPush() {
    if (window.Capacitor?.Plugins?.PushNotifications) {
        try {
            const PushNotifications = window.Capacitor.Plugins.PushNotifications;
            let permStatus = await PushNotifications.checkPermissions();
            
            if (permStatus.receive === 'prompt') {
                permStatus = await PushNotifications.requestPermissions();
            }
            
            if (permStatus.receive !== 'granted') {
                console.warn('[Push] Native permission denied');
                return;
            }

            // Register with FCM
            await PushNotifications.register();

            // Add listeners
            if (!window._pushListenersRegistered) {
                window._pushListenersRegistered = true;
                PushNotifications.addListener('registration', async (token) => {
                    console.log('[Push] Native token registration successful:', token.value);
                    try {
                        await api.post('/auth/fcm-token', { token: token.value, deviceType: 'android' });
                    } catch (err) {
                        console.error('[Push] Failed to register token on backend:', err);
                    }
                });

                PushNotifications.addListener('registrationError', (error) => {
                    console.error('[Push] Native token registration error:', error);
                });

                PushNotifications.addListener('pushNotificationReceived', (notification) => {
                    console.log('[Push] Native push notification received:', notification);
                    const title = notification.title || 'SITAM Smart ERP';
                    const body = notification.body || '';
                    const route = notification.data?.sitam_route || notification.data?.route;
                    showPushBanner(title, body, route);
                    if (route && route === router.currentRoute) {
                        router.routes[route]?.afterRender?.();
                    }
                });

                PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
                    console.log('[Push] Native push action performed:', action);
                    const route = action.notification.data?.sitam_route || action.notification.data?.route;
                    if (route) {
                        router.navigate(route);
                    }
                });
            }
        } catch (err) {
            console.error('[Push] Error setting up native PushNotifications:', err);
        }
        return;
    }

    if (!messaging) return;
    try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            console.warn('[Push] Permission denied for FCM.');
            return;
        }

        // Register worker explicitly
        const registration = await navigator.serviceWorker.register('./firebase-messaging-sw.js');
        const token = await messaging.getToken({ serviceWorkerRegistration: registration });
        
        if (token) {
            console.log('[Push] Acquired FCM token:', token);
            await api.post('/auth/fcm-token', { token, deviceType: 'android' });
        }
    } catch (err) {
        console.error('[Push] FCM registration failed:', err);
    }
}

// Wire foreground message listener
if (messaging) {
    messaging.onMessage((payload) => {
        console.log('[Push] Foreground packet received:', payload);
        const title = payload.notification.title || 'SITAM Smart ERP';
        const body = payload.notification.body || '';
        const route = payload.data?.sitam_route || payload.data?.route;
        
        showPushBanner(title, body, route);
        
        // Dynamic revalidation if looking at the same page
        if (route && route === router.currentRoute) {
            router.routes[route]?.afterRender?.();
        }
    });
}

// --- Global State ---
const state = {
    token: secureStorage.getItem('token') || null,
    profile: null,
    _syncPollTimer: null,
    _isSyncPolling: false,
    navHistory: [],
    paymentTimeout: null,
    _lastBackPress: 0
};

// --- Pulsing Real-time Live Status Indicator ---
function updateLiveIndicator(active) {
    const el = document.getElementById('live-indicator');
    if (!el) return;
    if (active) {
        el.classList.remove('scale-0', 'opacity-0');
        el.classList.add('scale-100', 'opacity-100');
    } else {
        el.classList.remove('scale-100', 'opacity-100');
        el.classList.add('scale-0', 'opacity-0');
    }
}

// --- Floating Toast Notifications ---
function showToast(message, icon = 'info', duration = 4000) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'glass-card px-5 py-3.5 rounded-xl shadow-lg border border-blue-200/40 flex items-center gap-3 translate-x-12 opacity-0 transition-all duration-300 pointer-events-auto cursor-pointer hover:scale-[1.02]';
    toast.style.background = 'rgba(255, 255, 255, 0.85)';
    toast.innerHTML = `
        <span class="material-symbols-outlined text-secondary text-lg" style="font-variation-settings:'FILL' 1">${icon}</span>
        <span class="text-xs font-bold text-on-surface select-none tracking-wide">${message}</span>
    `;

    container.appendChild(toast);

    // Animate in
    setTimeout(() => {
        toast.classList.remove('translate-x-12', 'opacity-0');
    }, 10);

    // Auto dismiss
    const dismiss = () => {
        toast.classList.add('translate-x-12', 'opacity-0');
        setTimeout(() => {
            toast.remove();
        }, 300);
    };

    toast.addEventListener('click', dismiss);
    setTimeout(dismiss, duration);
}

// --- Unread Badge Updater ---
async function updateUnreadBadge() {
    if (!state.token) return;
    try {
        const res = await api.get('/notifications/unread');
        const count = res.data?.count || 0;
        const dot = $('notif-dot');
        if (dot) {
            if (count > 0) {
                dot.classList.remove('hidden');
            } else {
                dot.classList.add('hidden');
            }
        }
    } catch (err) {
        console.warn('[Badge] Failed to update unread badge:', err);
    }
}

// --- Real-time WebSocket Service ---
const wsService = {
    socket: null,
    connect(userId) {
        if (!userId) return;
        if (this.socket && (this.socket.readyState === WebSocket.CONNECTING || this.socket.readyState === WebSocket.OPEN)) {
            return;
        }

        console.log(`[WebSocket] Establishing real-time sync socket for user: ${userId}`);
        const wsUrl = API_BASE.replace(/^http/, 'ws').replace(/\/api$/, '') + `/?userId=${userId}`;

        this.socket = new WebSocket(wsUrl);

        this.socket.onopen = () => {
            console.log(`[WebSocket] Connection established for student: ${userId}`);
            updateLiveIndicator(true);
        };

        this.socket.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                this.handleEvent(message.event, message.data);
            } catch (err) {
                console.error('[WebSocket] Parsing error:', err);
            }
        };

        this.socket.onclose = () => {
            console.log(`[WebSocket] Sync socket disconnected. Attempting reconnection in 5 seconds...`);
            updateLiveIndicator(false);
            setTimeout(() => this.connect(userId), 5000);
        };

        this.socket.onerror = (err) => {
            console.error('[WebSocket] Error:', err);
            updateLiveIndicator(false);
        };
    },

    handleEvent(event, data) {
        console.log(`[WebSocket] Event: ${event}`, data);
        
        if (event === 'attendance_update') {
            if (data.message) {
                showToast(data.message, 'calendar_today');
                updateUnreadBadge().catch(() => {});
            } else {
                setCachedData('/attendance', { success: true, attendance: data.subjects });
                if (router.currentRoute === '/attendance') {
                    router.routes['/attendance']?.afterRender?.();
                }
                const overallText = data.overall || '0%';
                setEl('dash-att-val', 'innerText', overallText);
                const overallPct = parseFloat(overallText.replace('%', '')) || 0;
                setEl('dash-att-bar', 'style.width', overallPct + '%');
                showToast('Live Attendance Synchronized!', 'calendar_today');
            }
        }
        
        else if (event === 'marks_update') {
            if (data.message) {
                showToast(data.message, 'analytics');
                updateUnreadBadge().catch(() => {});
            } else {
                setCachedData('/marks', { success: true, cgpa: data.cgpa, sgpa: data.sgpa, subjects: data.subjects });
                if (router.currentRoute === '/marks') {
                    router.routes['/marks']?.afterRender?.();
                }
                setEl('dash-gpa-val', 'innerText', data.cgpa || '--');
                showToast('Live Academic Results Synchronized!', 'analytics');
            }
        }
        
        else if (event === 'fees_update') {
            if (data.message) {
                showToast(data.message, 'account_balance_wallet');
                updateUnreadBadge().catch(() => {});
            } else {
                setCachedData('/fees', { success: true, ...data });
                if (router.currentRoute === '/fees') {
                    router.routes['/fees']?.afterRender?.();
                }
                setEl('dash-fee-text', 'innerText', `Due: ${data.dueAmount || '--'}`);
                showToast('Live Fees Statement Synchronized!', 'account_balance_wallet');
            }
        }

        else if (event === 'assignments_update') {
            showToast(data.message || 'Live Assignment updated!', 'assignment_turned_in');
            updateUnreadBadge().catch(() => {});
        }

        else if (event === 'timetable_update') {
            showToast(data.message || 'Live Timetable updated!', 'schedule');
            updateUnreadBadge().catch(() => {});
        }

        else if (event === 'notification_refresh') {
            updateUnreadBadge().catch(() => {});
            if (router.currentRoute === '/notifications') {
                router.routes['/notifications']?.afterRender?.();
            }
        }
        
        else if (event === 'sync_complete') {
            showToast('ERP Background Sync Complete!', 'sync');
            const banner = $('sync-banner');
            if (banner) {
                banner.classList.remove('scale-100', 'opacity-100');
                banner.classList.add('scale-0', 'opacity-0');
            }
            router.routes[router.currentRoute]?.afterRender?.();
        }
    }
};

// --- Cache Helpers (IndexedDB-backed, localStorage fallback) ---
function getCacheKey(ep) {
    const tok = state.token ? state.token.slice(-10) : 'anon';
    return 'erp_cache_' + ep.replace(/\//g, '_') + '_' + tok;
}
function getCachedData(ep) {
    // Legacy localStorage path — used as synchronous fallback only
    try { return JSON.parse(localStorage.getItem(getCacheKey(ep))); } catch { return null; }
}
function setCachedData(ep, data) {
    // Write to IndexedDB (primary) and localStorage (legacy fallback)
    SITAMDb.set('erp_cache', ep, data, 10 * 60 * 1000).catch(() => {});
    try {
        localStorage.setItem(getCacheKey(ep), JSON.stringify(data));
        localStorage.setItem(getCacheKey(ep) + '_ts', Date.now().toString());
    } catch {}
}
function isCacheFresh(ep, maxAgeMs = 5 * 60 * 1000) {
    const ts = parseInt(localStorage.getItem(getCacheKey(ep) + '_ts') || '0', 10);
    return ts > 0 && (Date.now() - ts) < maxAgeMs;
}
function clearUserCache() {
    // Wipe IndexedDB entries for this user
    SITAMDb.clearUser().catch(() => {});
    // Wipe localStorage cache
    const tok = state.token ? state.token.slice(-10) : 'anon';
    Object.keys(localStorage).forEach(k => {
        if (k.startsWith('erp_cache_') && k.includes(tok)) localStorage.removeItem(k);
    });
}

// --- Prefetch Engine: fire all 6 primary endpoints in parallel after login ---
async function prefetchAll() {
    const endpoints = ['/attendance', '/marks', '/fees', '/assignments', '/timetable', '/notifications', '/profile', '/exams'];
    console.log('[Prefetch] Warming IndexedDB with all ERP endpoints...');
    await Promise.allSettled(
        endpoints.map(ep =>
            api.request(ep)
               .then(data => SITAMDb.set('erp_cache', ep, data, 10 * 60 * 1000))
               .catch(() => {}) // silent — offline or stale is acceptable
        )
    );
    // Record prefetch timestamp → feeds 'last synced' chip
    SITAMDb.set('session', 'last_synced', Date.now(), 7 * 24 * 60 * 60 * 1000).catch(() => {});
    _updateLastSyncedChip();
    console.log('[Prefetch] All endpoints warmed.');
}

// --- Last-Synced chip updater ---
function _updateLastSyncedChip() {
    SITAMDb.get('session', 'last_synced', 7 * 24 * 60 * 60 * 1000).then(ts => {
        const chip = $('last-synced-chip');
        if (!chip || !ts) return;
        chip.style.display = 'inline';
        const diff = Math.round((Date.now() - ts) / 1000);
        const label = diff < 60 ? 'Just now'
            : diff < 3600 ? `${Math.floor(diff / 60)}m ago`
            : diff < 86400 ? `${Math.floor(diff / 3600)}h ago`
            : 'Yesterday';
        chip.innerText = `Synced ${label}`;
    }).catch(() => {});
}

// --- Haptic helper (10ms micro-vibration on nav taps) ---
const haptic = () => { try { navigator.vibrate?.(10); } catch {} };

// --- Attendance Overall Calculator ---
function calcOverallAttendance(attData) {
    const list = Array.isArray(attData) ? attData :
                 (attData && Array.isArray(attData.attendance)) ? attData.attendance : [];
    if (!list.length) return { pct: 0, text: '0%' };
    let totalHeld = 0, totalPresent = 0;
    list.forEach(s => { totalHeld += (s.total || s.held || 0); totalPresent += (s.present || s.attended || 0); });
    const pct = totalHeld > 0 ? parseFloat(((totalPresent / totalHeld) * 100).toFixed(1)) : 0;
    return { pct, text: pct + '%' };
}

// --- DOM Helpers ---
function $(id) { return document.getElementById(id); }
function setEl(id, prop, val) {
    const el = $(id);
    if (!el) return;
    if (prop.startsWith('style.')) el.style[prop.split('.')[1]] = val;
    else el[prop] = val;
}

// --- In-flight Request Deduplication ---
const _inflight = {};

// --- Core API Service ---
const api = {
    async request(endpoint, options = {}) {
        if (!navigator.onLine) {
            throw new Error('OFFLINE');
        }

        const headers = { 'Content-Type': 'application/json' };
        if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
        
        try {
            const resp = await fetch(API_BASE + endpoint, { ...options, headers: { ...headers, ...(options.headers || {}) } });
            const text = await resp.text();
            
            // Detect if the response is HTML and contains login page elements (ERP session expired)
            const isHtml = text.trim().startsWith('<') || text.includes('Default.aspx') || text.includes('imgBtn2') || text.includes('txtId2');
            if (isHtml) {
                console.warn(`[API] HTML login page detected on endpoint: ${endpoint}`);
                // Attempt to re-authenticate and retry the request once
                if (!options._retried) {
                    options._retried = true;
                    console.log('[API] Attempting auto-reauthentication and request retry...');
                    
                    try {
                        const refreshRes = await fetch(API_BASE + '/sync', {
                            method: 'GET',
                            headers: { 'Authorization': `Bearer ${state.token}` }
                        });
                        
                        if (refreshRes.ok) {
                            console.log('[API] Session refreshed successfully. Retrying original request...');
                            return await this.request(endpoint, options);
                        }
                    } catch (refreshErr) {
                        console.error('[API] Auto-reauthentication failed:', refreshErr);
                    }
                }
                
                // If retry failed or already retried, perform logout
                api.logout();
                throw new Error('ERP session expired. Please re-login.');
            }

            // Parse response body as JSON
            let data;
            try {
                data = JSON.parse(text);
            } catch (jsonErr) {
                throw new Error('Invalid server response format.');
            }

            if (resp.status === 503 && data && data.maintenanceMode === true) {
                state.maintenance = {
                    active: true,
                    message: data.message || 'System maintenance in progress.'
                };
                window.location.hash = '#/maintenance';
                throw new Error('MAINTENANCE');
            }

            if (!resp.ok) {
                if (resp.status === 401) { api.logout(); }
                throw new Error(data.error || data.message || `HTTP ${resp.status}`);
            }
            return data;
        } catch (err) {
            if (err.message === 'Failed to fetch' || err.name === 'TypeError') {
                throw new Error('OFFLINE');
            }
            throw err;
        }
    },

    post(ep, body) {
        return this.request(ep, { method: 'POST', body: JSON.stringify(body) });
    },

    // SWR: returns IndexedDB cache immediately, revalidates from network in background
    async get(ep, { bypassCache = false, onRevalidate } = {}) {
        // 1. Check IndexedDB first (5-min default TTL)
        if (!bypassCache) {
            const idbCached = await SITAMDb.get('erp_cache', ep, 5 * 60 * 1000);
            if (idbCached) {
                // Trigger silent background revalidation for next navigation
                if (navigator.onLine && !_inflight[ep]) {
                    const bgPromise = this.request(ep).then(fresh => {
                        setCachedData(ep, fresh);
                        if (onRevalidate) onRevalidate(fresh);
                    }).catch(() => {}).finally(() => { delete _inflight[ep]; });
                    _inflight[ep] = bgPromise;
                }
                return idbCached;
            }
        }

        // 2. Offline fallback: return stale IndexedDB data or localStorage data
        if (!navigator.onLine) {
            const idbStale = await SITAMDb.get('erp_cache', ep, 7 * 24 * 60 * 60 * 1000);
            if (idbStale) return idbStale;
            const lsStale = getCachedData(ep);
            if (lsStale) return lsStale;
            throw new Error('OFFLINE');
        }

        // 3. If already fetching, wait for in-flight promise
        if (_inflight[ep]) {
            try { return await _inflight[ep]; }
            catch {
                const idbFallback = await SITAMDb.get('erp_cache', ep, 7 * 24 * 60 * 60 * 1000);
                return idbFallback || getCachedData(ep);
            }
        }

        // 4. Network fetch + cache write
        const promise = this.request(ep).then(fresh => {
            setCachedData(ep, fresh);
            if (onRevalidate) onRevalidate(fresh);
            return fresh;
        }).catch(async err => {
            const idbFallback = await SITAMDb.get('erp_cache', ep, 7 * 24 * 60 * 60 * 1000);
            const lsFallback  = getCachedData(ep);
            const fallback = idbFallback || lsFallback;
            if (fallback) {
                console.warn(`[API] Fell back to cache for ${ep}:`, err.message);
                return fallback;
            }
            throw err;
        }).finally(() => { delete _inflight[ep]; });

        _inflight[ep] = promise;

        // Return stale IndexedDB data immediately if available (SWR pattern)
        if (!bypassCache) {
            const stale = await SITAMDb.get('erp_cache', ep, 7 * 24 * 60 * 60 * 1000)
                          .catch(() => null) || getCachedData(ep);
            if (stale) return stale;
        }

        return promise;
    },

    logout() {
        const performLogout = () => {
            clearUserCache();
            secureStorage.removeItem('token');
            state.token = null;
            state.profile = null;
            if (state._syncPollTimer) clearInterval(state._syncPollTimer);
            router.navigate('/login');
        };

        if (messaging) {
            messaging.getToken().then(async (currentToken) => {
                if (currentToken) {
                    await api.request('/auth/fcm-token', {
                        method: 'DELETE',
                        body: JSON.stringify({ token: currentToken })
                    }).catch(() => {});
                }
            }).catch(() => {}).finally(performLogout);
        } else {
            performLogout();
        }
    }
};

// --- Premium Non-blocking Top Progress Bar ---
const loading = {
    show(text = 'Loading...') {
        let bar = $('top-progress-bar');
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'top-progress-bar';
            bar.className = 'fixed top-0 left-0 h-1 bg-gradient-to-r from-[#2563EB] to-[#6366F1] z-[100] transition-all duration-500 ease-out';
            bar.style.width = '0%';
            document.body.appendChild(bar);
        }
        bar.style.opacity = '1';
        bar.style.width = '40%';
        
        // Minor fallback for legacy overlay if it exists in DOM but make it transparent/non-blocking
        const ov = $('loading-overlay');
        if (ov) {
            const tx = $('loading-text');
            if (tx) tx.innerText = text;
            ov.classList.remove('hidden');
            ov.className = "fixed inset-0 bg-transparent pointer-events-none z-[100] flex flex-col items-center justify-center transition-opacity duration-300 opacity-100";
        }
    },
    hide() {
        const bar = $('top-progress-bar');
        if (bar) {
            bar.style.width = '100%';
            setTimeout(() => {
                bar.style.opacity = '0';
                setTimeout(() => { bar.style.width = '0%'; }, 500);
            }, 300);
        }
        const ov = $('loading-overlay');
        if (ov) {
            ov.classList.add('opacity-0');
            setTimeout(() => ov.classList.add('hidden'), 300);
        }
    }
};

// --- Sync Status Banner (non-blocking, one-shot check) ---
function checkSyncStatus() {
    if (!state.token) return;
    api.get('/profile', { bypassCache: true }).then(res => {
        if (res && res.data && res.data.userId) {
            // Establish real-time sync socket connection
            wsService.connect(res.data.userId);
            
            // Drawer labels mapping
            setEl('drawer-name', 'innerText', res.data.name || 'Student');
            setEl('drawer-roll', 'innerText', res.data.userId);
            
            // Sync and register Firebase Push tokens on startup
            registerPush().catch(() => {});
            updateUnreadBadge().catch(() => {});
        }

        const isSyncing = res && res.data && res.data.isSyncing;
        const banner = $('sync-banner');
        if (!banner) return;
        if (isSyncing) {
            banner.classList.remove('scale-0', 'opacity-0');
            banner.classList.add('scale-100', 'opacity-100');
            // Poll until done — but max 16 seconds (4 ticks)
            if (!state._isSyncPolling) {
                state._isSyncPolling = true;
                let ticks = 0;
                state._syncPollTimer = setInterval(async () => {
                    ticks++;
                    try {
                        const r = await api.request('/profile');
                        if (!r.data.isSyncing || ticks >= 4) {
                            clearInterval(state._syncPollTimer);
                            state._isSyncPolling = false;
                            banner.classList.add('scale-0', 'opacity-0');
                            banner.classList.remove('scale-100', 'opacity-100');
                            // Invalidate all caches on successful sync
                            clearUserCache();
                            router.routes[router.currentRoute]?.afterRender?.();
                        }
                    } catch { 
                        clearInterval(state._syncPollTimer); 
                        state._isSyncPolling = false; 
                        banner.classList.add('scale-0', 'opacity-0');
                        banner.classList.remove('scale-100', 'opacity-100');
                    }
                }, 4000);
            }
        } else {
            banner.classList.add('scale-0', 'opacity-0');
            banner.classList.remove('scale-100', 'opacity-100');
        }
    }).catch(() => {});
}

// --- Shell Toggle ---
function toggleShell(show) {
    const shell = $('app-shell');
    if (shell) shell.style.display = show ? '' : 'none';
}

// --- Active Nav Highlight ---
function setActiveNav(route) {
    document.querySelectorAll('[data-nav]').forEach(el => {
        const active = el.dataset.nav === route;

        // ── Floating Glass Dock items ──
        if (el.classList.contains('bottom-nav-item')) {
            if (active) {
                el.classList.add('dock-active');
            } else {
                el.classList.remove('dock-active');
            }
            return;
        }

        // ── Drawer nav links ──
        if (el.tagName === 'A') {
            if (active) {
                el.className = "flex items-center gap-3 px-3.5 py-3 rounded-xl bg-blue-100/60 text-blue-800 font-extrabold border-l-4 border-blue-600 transition-all duration-300 shadow-sm active-scale";
            } else {
                el.className = "flex items-center gap-3 px-4 py-3 rounded-xl text-slate-500 hover:bg-blue-50 hover:text-blue-700 transition-all duration-300 font-bold active-scale";
            }
        }
    });

    // Page enter animation
    const appEl = document.getElementById('app');
    if (appEl) {
        appEl.classList.remove('page-enter');
        void appEl.offsetWidth; // force reflow
        appEl.classList.add('page-enter');
    }
}

// --- Drawer ---
function openDrawer() {
    $('nav-drawer')?.classList.remove('-translate-x-full');
    $('drawer-overlay')?.classList.remove('hidden');
    setTimeout(() => $('drawer-overlay')?.classList.remove('opacity-0'), 10);
}
function closeDrawer() {
    $('nav-drawer')?.classList.add('-translate-x-full');
    $('drawer-overlay')?.classList.add('opacity-0');
    setTimeout(() => $('drawer-overlay')?.classList.add('hidden'), 300);
}

// ============================================================
// PAGE DEFINITIONS
// ============================================================
function showFeeWarningPopup(title, description) {
    if (document.getElementById('fee-warning-modal')) return;
    const modal = document.createElement('div');
    modal.id = 'fee-warning-modal';
    modal.className = 'fixed inset-0 z-[120] bg-black/60 backdrop-blur-md flex items-center justify-center p-4 transition-all duration-300 opacity-0';
    modal.innerHTML = `
        <div class="bg-white rounded-3xl p-6 max-w-sm w-full border border-red-100 shadow-2xl space-y-4 scale-95 transition-transform duration-300">
            <div class="flex flex-col items-center text-center">
                <div class="w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center mb-3">
                    <span class="material-symbols-outlined text-2xl font-bold">warning</span>
                </div>
                <h3 class="text-base font-extrabold text-slate-900 leading-snug">⚠ \${title || 'Fee Due Warning'}</h3>
                <p class="text-xs text-slate-500 mt-2 leading-relaxed">
                    \${description || 'Please clear your pending fee dues immediately.'}
                </p>
                <div class="mt-4 p-3 bg-red-50 border border-red-100 text-red-700 rounded-xl text-xs font-bold text-left leading-relaxed">
                    Pay before Mid Examination. Hall Tickets may not be issued until dues are cleared.
                </div>
            </div>
            <div class="flex gap-2 justify-center">
                <button id="fee-warning-pay-btn" class="bg-blue-600 text-white px-5 py-2.5 rounded-full font-bold text-xs shadow-md active-scale transition-transform">
                    Pay Fees
                </button>
                <button id="fee-warning-close-btn" class="bg-slate-100 text-slate-600 px-5 py-2.5 rounded-full font-bold text-xs active-scale transition-transform">
                    Dismiss
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    setTimeout(() => {
        modal.classList.remove('opacity-0');
        modal.querySelector('.bg-white').classList.remove('scale-95');
    }, 50);

    const closeBtn = modal.querySelector('#fee-warning-close-btn');
    const payBtn = modal.querySelector('#fee-warning-pay-btn');
    const closeModal = () => {
        modal.classList.add('opacity-0');
        modal.querySelector('.bg-white').classList.add('scale-95');
        setTimeout(() => modal.remove(), 300);
    };
    closeBtn.addEventListener('click', closeModal);
    payBtn.addEventListener('click', () => {
        closeModal();
        router.navigate('/fees');
    });
}

const pages = {

    // ---- MAINTENANCE ----
    maintenance: {
        render: () => {
            const msg = state.maintenance?.message || 'We are upgrading our services. Please check back shortly.';
            return `<div class="min-h-screen w-full flex flex-col items-center justify-center bg-slate-900 text-white p-6 select-none relative overflow-hidden">
                <div style="filter:blur(100px);opacity:0.15;position:absolute;z-index:0;" class="w-[500px] h-[500px] rounded-full top-[-10%] left-[-10%] bg-blue-500"></div>
                <div style="filter:blur(100px);opacity:0.15;position:absolute;z-index:0;" class="w-[400px] h-[400px] rounded-full bottom-[-5%] right-[-5%] bg-indigo-500"></div>
                <main class="relative z-10 w-full max-w-md text-center space-y-6">
                    <div class="flex flex-col items-center">
                        <div class="w-20 h-20 bg-white/10 backdrop-blur-md border border-white/20 rounded-3xl flex items-center justify-center shadow-xl mb-4 animate-pulse">
                            <span class="material-symbols-outlined text-4xl text-amber-500">construction</span>
                        </div>
                        <h1 class="text-2xl font-extrabold tracking-tight text-white">🚧 SITAM Smart ERP</h1>
                        <p class="text-xs uppercase tracking-widest text-slate-400 mt-1 font-bold">System Maintenance In Progress</p>
                    </div>
                    <div class="bg-white/5 backdrop-blur-lg border border-white/10 rounded-2xl p-6 shadow-2xl">
                        <p class="text-sm text-slate-300 leading-relaxed font-medium">
                            \${msg}
                        </p>
                    </div>
                    <div class="pt-4 text-[10px] text-slate-500 font-mono">
                        EXPECTED DOWNTIME: 15 - 30 MINS
                    </div>
                </main>
            </div>`;
        },
        afterRender: () => {
            toggleShell(false);
        }
    },

    // ---- LOGIN ----
    login: {
        render: () => `<div class="min-h-screen w-full flex flex-col items-center justify-center relative bg-[#F8FAFC] overflow-hidden">
            <!-- Organic Background Orbs -->
            <div style="filter:blur(90px);opacity:0.35;position:absolute;z-index:0;" class="w-[500px] h-[500px] rounded-full top-[-10%] left-[-10%] bg-blue-200"></div>
            <div style="filter:blur(90px);opacity:0.30;position:absolute;z-index:0;" class="w-[400px] h-[400px] rounded-full bottom-[-5%] right-[-5%] bg-indigo-200"></div>
            <div style="filter:blur(90px);opacity:0.20;position:absolute;z-index:0;" class="w-[600px] h-[600px] rounded-full top-[20%] right-[10%] bg-white"></div>
            <main class="relative z-10 w-full max-w-md px-6 flex flex-col items-center">
                <!-- Logo -->
                <div class="mb-10 text-center">
                    <div class="w-24 h-24 bg-white/60 backdrop-blur-3xl rounded-3xl flex items-center justify-center shadow-2xl mx-auto mb-5 border border-white/70 active-scale hover:scale-105 transition-all">
                        <svg class="w-16 h-16" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <rect width="100" height="100" rx="30" fill="url(#sitamGrad)" />
                            <path d="M50 18L22 32L50 46L78 32L50 18Z" fill="#fff" />
                            <path d="M22 36.5V56C22 66.5 50 78 50 78C50 78 78 66.5 78 56V36.5L50 51.5L22 36.5Z" fill="#ffffff" fill-opacity="0.85" />
                            <circle cx="50" cy="51.5" r="5" fill="#6366F1" />
                            <defs>
                                <linearGradient id="sitamGrad" x1="0" y1="0" x2="1" y2="1">
                                    <stop offset="0%" stop-color="#2563EB"/>
                                    <stop offset="100%" stop-color="#6366F1"/>
                                </linearGradient>
                            </defs>
                        </svg>
                    </div>
                    <h1 class="text-3xl font-extrabold tracking-tighter text-slate-900 bg-clip-text text-transparent bg-gradient-to-r from-blue-700 to-indigo-600" style="font-family:'Inter',sans-serif">SITAM Smart ERP</h1>
                    <p class="text-xs uppercase tracking-widest text-blue-600/70 mt-2 font-extrabold" style="font-family:'Inter',sans-serif">Official Student Campus App</p>
                </div>
                <!-- Login Card -->
                <div class="w-full bg-white/55 backdrop-blur-3xl rounded-3xl p-8 shadow-2xl border border-white/65" style="box-shadow:0 20px 60px rgba(37,99,235,0.1),0 4px 20px rgba(15,23,42,0.06)">
                    <div class="mb-7">
                        <h2 class="text-xl font-bold text-slate-900 tracking-tight" style="font-family:'Inter',sans-serif">Welcome Back</h2>
                        <p class="text-slate-500 text-sm mt-1">Enter your academic credentials to continue.</p>
                    </div>
                    <form class="space-y-5" id="login-form">
                        <div class="space-y-1.5">
                            <label class="text-[11px] font-bold uppercase tracking-widest text-blue-600 ml-1" for="login-userid">Student ID</label>
                            <div class="relative">
                                <div class="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                                    <span class="material-symbols-outlined text-slate-400 text-lg">badge</span>
                                </div>
                                <input class="block w-full pl-11 pr-4 py-3.5 bg-slate-50/80 border border-slate-200/80 rounded-2xl text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400 transition-all placeholder:text-slate-400" id="login-userid" placeholder="Enter your Student ID" type="text" autocomplete="username"/>
                            </div>
                        </div>
                        <div class="space-y-1.5">
                            <label class="text-[11px] font-bold uppercase tracking-widest text-blue-600 ml-1" for="login-password">Password</label>
                            <div class="relative">
                                <div class="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                                    <span class="material-symbols-outlined text-slate-400 text-lg">lock</span>
                                </div>
                                <input class="block w-full pl-11 pr-12 py-3.5 bg-slate-50/80 border border-slate-200/80 rounded-2xl text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400 transition-all placeholder:text-slate-400" id="login-password" placeholder="••••••••" type="password" autocomplete="current-password"/>
                            </div>
                        </div>
                        <div id="login-error" class="hidden text-sm text-red-600 font-bold text-center py-2.5 px-4 bg-red-50 border border-red-200 rounded-2xl"></div>
                        <button class="w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold py-4 rounded-2xl shadow-lg hover:from-blue-700 hover:to-indigo-700 active:scale-[0.98] transition-all duration-200 flex items-center justify-center gap-2 group mt-2" type="submit" id="login-btn" style="font-family:'Inter',sans-serif;box-shadow:0 8px 30px rgba(37,99,235,0.35)">
                            <span id="login-btn-text">Sign In</span>
                            <span class="material-symbols-outlined text-lg transition-transform group-hover:translate-x-1">arrow_forward</span>
                        </button>
                    </form>
                </div>
                <div class="mt-8 flex flex-col items-center gap-3 opacity-50 text-[10px] font-bold tracking-widest uppercase">
                    <div class="flex items-center gap-6">
                        <a href="#" onclick="router.navigate('/privacy');return false;" class="hover:underline text-slate-600">Privacy Policy</a>
                        <div class="w-px h-3 bg-slate-300"></div>
                        <a href="#" onclick="router.navigate('/terms');return false;" class="hover:underline text-slate-600">Terms of Service</a>
                    </div>
                    <div class="flex items-center gap-2 opacity-70">
                        <span class="material-symbols-outlined text-xs">verified_user</span>
                        <span class="text-slate-600">Secured · Encrypted</span>
                    </div>
                </div>
            </main>
        </div>`,
        afterRender: () => {
            toggleShell(false);
            const form = $('login-form');
            if (!form) return;
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                const uid = $('login-userid')?.value?.trim();
                const pwd = $('login-password')?.value?.trim();
                const errEl = $('login-error');
                const btnText = $('login-btn-text');
                if (!uid || !pwd) { if(errEl){errEl.textContent='Please fill all fields.';errEl.classList.remove('hidden');} return; }
                if(errEl) errEl.classList.add('hidden');
                if(btnText) btnText.textContent = 'Signing in...';
                try {
                    const res = await api.post('/auth/login', { userId: uid, password: pwd });
                    if (res.success && res.token) {
                        state.token = res.token;
                        await secureStorage.setItem('token', res.token);
                        // ── DASHBOARD-FIRST: navigate immediately, sync in background ──
                        router.navigate('/dashboard');
                        // Fire push registration and full prefetch asynchronously
                        // Dashboard will paint from IndexedDB cache in <300ms
                        Promise.all([
                            registerPush().catch(() => {}),
                            prefetchAll().catch(() => {})
                        ]);
                    } else {
                        throw new Error(res.message || 'Login failed');
                    }
                } catch(err) {
                    if(errEl){errEl.textContent=err.message||'Login failed. Check credentials.';errEl.classList.remove('hidden');}
                } finally {
                    if(btnText) btnText.textContent = 'Login';
                }
            });
        }
    },

    // ---- DASHBOARD ----
    dashboard: {
        render: () => `<div class="min-h-screen pb-32 bg-[#F8FAFC]">
            <main class="pt-20 px-4 sm:px-6 max-w-xl mx-auto">

                <!-- ══════════════════════════════════════════ -->
                <!-- WOW HERO CARD                             -->
                <!-- ══════════════════════════════════════════ -->
                <section class="mb-5">
                    <div class="hero-card p-6 relative overflow-hidden" id="hero-card">
                        <!-- Glass shine sweep -->
                        <div class="hero-shine"></div>
                        <!-- Greeting -->
                        <div class="relative z-10 flex items-start justify-between mb-5">
                            <div>
                                <p class="text-blue-300/80 text-[11px] font-bold uppercase tracking-widest mb-1.5" id="hero-date-label">Today</p>
                                <h2 class="text-white text-[25px] font-black tracking-tight leading-tight" id="dash-greeting">👋 Good Morning</h2>
                                <p class="text-blue-200/90 text-sm mt-1.5 font-medium" id="hero-sub">Ready for a productive day?</p>
                            </div>
                            <div class="w-12 h-12 bg-white/15 backdrop-blur-sm rounded-2xl flex items-center justify-center border border-white/20 flex-shrink-0 ml-3">
                                <span class="material-symbols-outlined text-white" style="font-size:24px;font-variation-settings:'FILL' 1">school</span>
                            </div>
                        </div>
                        <!-- Stats Row -->
                        <div class="relative z-10 grid grid-cols-4 gap-2">
                            <!-- Attendance -->
                            <div class="bg-white/10 backdrop-blur-sm rounded-2xl p-2.5 border border-white/15 cursor-pointer active-scale transition-all" onclick="router.navigate('/attendance')">
                                <div class="flex items-center gap-1 mb-1">
                                    <span class="material-symbols-outlined text-emerald-300 text-[10px]" style="font-variation-settings:'FILL' 1">check_circle</span>
                                    <p class="text-blue-200/80 text-[8px] font-bold uppercase tracking-wider">Attend</p>
                                </div>
                                <p class="text-white text-lg font-black leading-none" id="hero-att">--%</p>
                                <div class="mt-2 w-full bg-white/15 rounded-full h-1 overflow-hidden">
                                    <div class="h-full bg-emerald-400 rounded-full progress-animated" id="hero-att-bar" style="width:0%"></div>
                                </div>
                            </div>
                            <!-- CGPA -->
                            <div class="bg-white/10 backdrop-blur-sm rounded-2xl p-2.5 border border-white/15 cursor-pointer active-scale transition-all" onclick="router.navigate('/marks')">
                                <div class="flex items-center gap-1 mb-1">
                                    <span class="material-symbols-outlined text-amber-300 text-[10px]" style="font-variation-settings:'FILL' 1">stars</span>
                                    <p class="text-blue-200/80 text-[8px] font-bold uppercase tracking-wider">CGPA</p>
                                </div>
                                <p class="text-white text-lg font-black leading-none" id="hero-cgpa">--</p>
                                <p class="text-blue-200/60 text-[7px] mt-2.5 font-bold uppercase">Current</p>
                            </div>
                            <!-- Assignments Due -->
                            <div class="bg-white/10 backdrop-blur-sm rounded-2xl p-2.5 border border-white/15 cursor-pointer active-scale transition-all" onclick="router.navigate('/assignments')">
                                <div class="flex items-center gap-1 mb-1">
                                    <span class="material-symbols-outlined text-rose-300 text-[10px]" style="font-variation-settings:'FILL' 1">assignment_late</span>
                                    <p class="text-blue-200/80 text-[8px] font-bold uppercase tracking-wider">Due</p>
                                </div>
                                <p class="text-white text-lg font-black leading-none" id="hero-asn">--</p>
                                <p class="text-blue-200/60 text-[7px] mt-2.5 font-bold uppercase">Tasks</p>
                            </div>
                            <!-- Academic Health -->
                            <div class="bg-white/15 backdrop-blur-sm rounded-2xl p-2.5 border border-white/20 cursor-pointer active-scale transition-all animate-pulse" style="animation-duration:3s" onclick="showToast('Academic Health Score is calculated from CGPA and overall attendance.', 'info')">
                                <div class="flex items-center gap-1 mb-1">
                                    <span class="material-symbols-outlined text-blue-300 text-[10px]" style="font-variation-settings:'FILL' 1">favorite</span>
                                    <p class="text-blue-200/80 text-[8px] font-bold uppercase tracking-wider">Health</p>
                                </div>
                                <p class="text-white text-lg font-black leading-none" id="dash-health-score">--</p>
                                <p class="text-blue-200/60 text-[7px] mt-2.5 font-bold uppercase">Rating</p>
                            </div>
                        </div>
                    </div>
                </section>

                <!-- Live Brief Section: Upcoming Class and Next Exam -->
                <section class="grid grid-cols-2 gap-3 mb-6">
                    <div id="dash-upcoming-class-container">
                        <div class="glass-card p-3 rounded-2xl border border-white/40 shadow-sm text-center bg-white/40 py-5 text-slate-400 text-[10px] font-bold">
                            Loading schedule...
                        </div>
                    </div>
                    <div id="dash-upcoming-exam-container">
                        <div class="glass-card p-3 rounded-2xl border border-white/40 shadow-sm text-center bg-white/40 py-5 text-slate-400 text-[10px] font-bold">
                            Loading exams...
                        </div>
                    </div>
                </section>

                <!-- Today's Timetable -->
                <section class="mb-7">
                    <div class="flex justify-between items-end mb-3">
                        <h3 class="text-[11px] font-extrabold uppercase tracking-widest text-slate-400">Today's Timetable</h3>
                        <a href="#" onclick="router.navigate('/timetable');return false;" class="text-[10px] font-bold text-primary hover:underline uppercase tracking-wider">VIEW FULL</a>
                    </div>
                    <div class="flex gap-4 pb-2 -mx-4 px-4 momentum-scroll hide-scrollbar" id="dash-timetable">
                        <div class="flex gap-3">
                            <div class="min-w-[170px] h-24 bg-white/40 border border-white/20 rounded-2xl shimmer-loading"></div>
                            <div class="min-w-[170px] h-24 bg-white/40 border border-white/20 rounded-2xl shimmer-loading"></div>
                            <div class="min-w-[170px] h-24 bg-white/40 border border-white/20 rounded-2xl shimmer-loading"></div>
                        </div>
                    </div>
                </section>

                <!-- Notice Banner -->
                <section class="mb-6" id="notice-banner-section">
                    <div class="w-full bg-amber-50 text-amber-900 p-4 rounded-2xl flex items-center gap-3.5 relative overflow-hidden border border-amber-200/60" id="notice-banner">
                        <div class="absolute right-0 top-0 w-20 h-full bg-gradient-to-l from-amber-100/40 to-transparent"></div>
                        <span class="material-symbols-outlined text-2xl flex-shrink-0 text-amber-500">campaign</span>
                        <div class="min-w-0 flex-1">
                            <p class="text-xs font-bold tracking-tight leading-snug break-words" id="notice-text">ERP sync active. Your data is being synchronized.</p>
                        </div>
                    </div>
                </section>

                <!-- Companies On Campus Today Section -->
                <section class="mb-6 hidden" id="companies-today-section">
                    <div class="glass-card p-5 rounded-[2rem] border border-white/40 shadow-sm bg-white/60">
                        <div class="flex items-center gap-2 mb-3">
                            <span class="text-xl">🔥</span>
                            <h3 class="text-xs font-extrabold uppercase tracking-widest text-slate-900">Companies On Campus Today</h3>
                        </div>
                        <div class="flex flex-wrap gap-2" id="companies-today-list">
                            <!-- Company badges go here -->
                        </div>
                    </div>
                </section>

                <!-- Workspace Header -->
                <div class="flex justify-between items-center mb-4">
                    <div>
                        <h3 class="text-[11px] font-extrabold uppercase tracking-widest text-slate-400">Workspace</h3>
                        <p class="text-[10px] text-slate-400">Your academic quick links</p>
                    </div>
                    <button class="w-9 h-9 bg-slate-900 text-white rounded-full flex items-center justify-center shadow-lg active-scale transition-transform" onclick="showToast('Custom workspaces are managed by academic administration.', 'info')">
                        <span class="material-symbols-outlined text-lg">add</span>
                    </button>
                </div>

                <!-- Feature Bento Grid -->
                <section class="grid grid-cols-2 gap-3 sm:gap-4 mb-10">
                    <!-- Announce -->
                    <div class="glass-card p-4 sm:p-5 flex flex-col justify-between h-32 sm:h-36 cursor-pointer hover:scale-[1.02] active-scale transition-all" onclick="router.navigate('/notifications')">
                        <div class="flex justify-between items-start">
                            <span class="material-symbols-outlined text-secondary" style="font-variation-settings:'FILL' 1">campaign</span>
                            <span class="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-[9px] font-extrabold rounded-full border border-indigo-200/50" id="dash-notif-count">--</span>
                        </div>
                        <div>
                            <h4 class="text-sm font-bold text-on-surface">Announce</h4>
                            <p class="text-[9px] text-slate-400">Campus updates</p>
                        </div>
                    </div>
                    <!-- Curriculum/Syllabus -->
                    <div class="bg-indigo-50/60 p-4 sm:p-5 rounded-3xl flex flex-col justify-between h-32 sm:h-36 cursor-pointer hover:scale-[1.02] active-scale transition-all border border-indigo-100" onclick="router.navigate('/syllabus')">
                        <div class="flex justify-between items-start">
                            <span class="material-symbols-outlined text-secondary" style="font-variation-settings:'FILL' 1">auto_stories</span>
                            <span class="px-2 py-0.5 bg-white text-indigo-600 text-[9px] font-extrabold rounded-full border border-indigo-200">NEW</span>
                        </div>
                        <div>
                            <h4 class="text-sm font-bold text-indigo-900">Curriculum</h4>
                            <p class="text-[9px] text-indigo-500/70">Syllabus &amp; Books</p>
                        </div>
                    </div>
                    <!-- Fee Statement -->
                    <div class="glass-card p-4 sm:p-5 flex flex-col justify-between h-32 sm:h-36 cursor-pointer hover:scale-[1.02] active-scale transition-all" onclick="router.navigate('/fees')">
                        <span class="material-symbols-outlined text-slate-400">account_balance_wallet</span>
                        <div>
                            <h4 class="text-sm font-bold text-on-surface">Fee Statement</h4>
                            <p class="text-[9px] text-slate-400 truncate" id="dash-fee-text">Dues &amp; History</p>
                        </div>
                    </div>
                    <!-- Attendance -->
                    <div class="glass-card p-4 sm:p-5 flex flex-col justify-between h-32 sm:h-36 cursor-pointer hover:scale-[1.02] active-scale transition-all border-l-4 border-l-primary" onclick="router.navigate('/attendance')">
                        <div class="flex justify-between items-start">
                            <span class="material-symbols-outlined text-primary">calendar_today</span>
                            <span class="text-[11px] font-black text-primary" id="dash-att-val">--%</span>
                        </div>
                        <div>
                            <h4 class="text-sm font-bold text-on-surface">Attendance</h4>
                            <div class="w-full bg-slate-100/80 h-1.5 rounded-full mt-2 overflow-hidden">
                                <div class="bg-primary h-full rounded-full transition-all duration-1000 w-0" id="dash-att-bar"></div>
                            </div>
                        </div>
                    </div>
                    <!-- Assignment -->
                    <div class="glass-card p-4 sm:p-5 flex flex-col justify-between h-32 sm:h-36 cursor-pointer hover:scale-[1.02] active-scale transition-all" onclick="router.navigate('/assignments')">
                        <div class="flex justify-between items-start">
                            <span class="material-symbols-outlined text-slate-400">assignment</span>
                            <span class="px-2 py-0.5 bg-slate-100 text-slate-600 text-[9px] font-extrabold rounded-full border border-slate-200" id="dash-asn-count">--</span>
                        </div>
                        <div>
                            <h4 class="text-sm font-bold text-on-surface">Assignment</h4>
                            <p class="text-[9px] text-slate-400">Pending deliverables</p>
                        </div>
                    </div>
                    <!-- Results / Marks -->
                    <div class="bg-amber-50/60 p-4 sm:p-5 rounded-3xl flex flex-col justify-between h-32 sm:h-36 border border-amber-100 cursor-pointer hover:scale-[1.02] active-scale transition-all" onclick="router.navigate('/marks')">
                        <div class="flex justify-between items-start">
                            <span class="material-symbols-outlined text-amber-500">analytics</span>
                            <span class="text-sm font-extrabold text-amber-600" id="dash-gpa-val">--</span>
                        </div>
                        <div>
                            <h4 class="text-sm font-bold text-slate-800">Results</h4>
                            <p class="text-[9px] text-amber-500 font-bold tracking-widest uppercase">CGPA</p>
                        </div>
                    </div>
                    <!-- Exams -->
                    <div class="glass-card p-4 sm:p-5 flex flex-col justify-between h-32 sm:h-36 cursor-pointer hover:scale-[1.02] active-scale transition-all" onclick="router.navigate('/exams')">
                        <div class="flex justify-between items-start">
                            <span class="material-symbols-outlined text-slate-400">description</span>
                            <span class="px-2 py-0.5 bg-rose-50 text-rose-600 text-[9px] font-extrabold rounded-full border border-rose-200" id="dash-exams-count">--</span>
                        </div>
                        <div>
                            <h4 class="text-sm font-bold text-on-surface">Exams</h4>
                            <p class="text-[9px] text-slate-400">Dates &amp; Seats</p>
                        </div>
                    </div>
                    <!-- Timetable -->
                    <div class="glass-card p-4 sm:p-5 flex flex-col justify-between h-32 sm:h-36 cursor-pointer hover:scale-[1.02] active-scale transition-all" onclick="router.navigate('/timetable')">
                        <span class="material-symbols-outlined text-slate-400">event_note</span>
                        <div>
                            <h4 class="text-sm font-bold text-on-surface">Timetable</h4>
                            <p class="text-[9px] text-slate-400">Full Schedule</p>
                        </div>
                    </div>
                    <!-- Clubs — Full Width -->
                </section>
            </main>
        </div>`,
        afterRender: () => {
            toggleShell(true);
            setActiveNav('dashboard');
            checkSyncStatus();
            _updateLastSyncedChip();

            // ── Dashboard-First: serve IndexedDB immediately, revalidate in background ──

            // 1. Profile / greeting card
            // Time-based greeting
            const hour = new Date().getHours();
            const greeting = hour < 12 ? 'Good Morning' : hour < 17 ? 'Good Afternoon' : 'Good Evening';
            const greetEmoji = '\u{1F44B}'; // wave hand emoji
            // Set the hero date label
            const heroDateEl = $('hero-date-label');
            if (heroDateEl) {
                const now = new Date();
                const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
                const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                heroDateEl.innerText = `${dayNames[now.getDay()]}, ${now.getDate()} ${monthNames[now.getMonth()]}`;
            }
            api.get('/profile').then(profRes => {
                const name = (profRes.data?.name || 'Student').split(' ')[0];
                setEl('dash-greeting', 'innerText', `${greetEmoji} ${greeting}, ${name}`);
                setEl('hero-sub', 'innerText', 'Ready for a productive day?');
                setEl('drawer-name', 'innerText', profRes.data?.name || '');
                setEl('drawer-roll', 'innerText', profRes.data?.roll || '');
            }).catch(e => {
                console.error('[Dashboard] Profile fail:', e);
                setEl('dash-greeting', 'innerText', `${greetEmoji} ${greeting}`);
                setEl('hero-sub', 'innerText', 'Ready for a productive day?');
            });

            // Count-up animation utility
            const animateCount = (elId, targetStr, suffix = '') => {
                const el = $(elId);
                if (!el) return;
                const target = parseFloat(targetStr);
                if (isNaN(target)) { el.innerText = targetStr; return; }
                const duration = 800;
                const start = Date.now();
                const startVal = 0;
                const tick = () => {
                    const elapsed = Date.now() - start;
                    const progress = Math.min(elapsed / duration, 1);
                    const ease = 1 - Math.pow(1 - progress, 3);
                    const current = startVal + (target - startVal) * ease;
                    el.innerText = (Number.isInteger(target) ? Math.round(current) : current.toFixed(2)) + suffix;
                    if (progress < 1) requestAnimationFrame(tick);
                    else el.innerText = targetStr + suffix;
                };
                requestAnimationFrame(tick);
            };

            // Values to track and compute Academic Health Score dynamically
            let attendancePct = null;
            let currentCgpa = null;
            const updateHealthScore = () => {
                if (attendancePct !== null && currentCgpa !== null) {
                    const score = Math.round((attendancePct * 0.4) + (currentCgpa * 10 * 0.6));
                    animateCount('dash-health-score', score.toString(), '%');
                }
            };

            // 2. Attendance card + hero card
            api.get('/attendance').then(attRes => {
                const attList = attRes.attendance || [];
                const overall = calcOverallAttendance(attList);
                setEl('dash-att-val', 'innerText', overall.text);
                setEl('hero-att', 'innerText', overall.text);
                
                attendancePct = overall.pct || 0;
                updateHealthScore();

                setTimeout(() => {
                    setEl('dash-att-bar', 'style.width', overall.text);
                    setEl('hero-att-bar', 'style.width', overall.text);
                }, 200);
            }).catch(e => {
                console.error('[Dashboard] Attendance fail:', e);
                setEl('dash-att-val', 'innerText', '--%');
                setEl('hero-att', 'innerText', '--%');
                setTimeout(() => {
                    setEl('dash-att-bar', 'style.width', '0%');
                    setEl('hero-att-bar', 'style.width', '0%');
                }, 200);
            });

            // 3. Results (CGPA) card + hero card
            api.get('/marks').then(marksRes => {
                const cgpa = marksRes.data?.cgpa || '--';
                setEl('dash-gpa-val', 'innerText', cgpa);
                
                currentCgpa = parseFloat(cgpa) || 0;
                updateHealthScore();

                // Count-up for hero CGPA
                animateCount('hero-cgpa', cgpa);
            }).catch(e => {
                console.error('[Dashboard] Marks fail:', e);
                setEl('dash-gpa-val', 'innerText', '--');
                setEl('hero-cgpa', 'innerText', '--');
            });

            // 4. Assignments card + hero card
            api.get('/assignments').then(asnRes => {
                const asnCount = asnRes.data?.activeCount ?? 0;
                setEl('dash-asn-count', 'innerText', asnCount.toString());
                setEl('hero-asn', 'innerText', asnCount.toString());
            }).catch(e => {
                console.error('[Dashboard] Assignments fail:', e);
                setEl('dash-asn-count', 'innerText', '0');
                setEl('hero-asn', 'innerText', '0');
            });

            // 5. Fees card
            api.get('/fees').then(feesRes => {
                const due = feesRes.data?.dueAmount || feesRes.data?.totalDue;
                if (due) {
                    setEl('dash-fee-text', 'innerText', `Due: \${due}`);
                    api.get('/fee-notices').then(noticesRes => {
                        const notices = noticesRes.notices || [];
                        const warningNotice = notices.find(n => n.hallTicketBlockWarning === true);
                        if (warningNotice) {
                            showFeeWarningPopup(warningNotice.title, warningNotice.description);
                        }
                    }).catch(() => {});
                } else {
                    setEl('dash-fee-text', 'innerText', 'Dues & History');
                }
            }).catch(e => {
                console.error('[Dashboard] Fees fail:', e);
                setEl('dash-fee-text', 'innerText', 'Dues & History');
            });

            // 6. Notifications notice banner
            api.get('/notifications').then(notifRes => {
                const notifList = notifRes.data || [];
                const unread = Array.isArray(notifList) ? notifList.filter(n => !n.isRead).length : 0;
                setEl('dash-notif-count', 'innerText', unread.toString());

                // Find first notice that is NOT fee-related
                const nonFeeNotif = notifList.find(n => {
                    const text = ((n.message || '') + ' ' + (n.title || '')).toLowerCase();
                    return !text.includes('fee') && !text.includes('pay') && !text.includes('due') && !text.includes('tuition') && !text.includes('statement');
                });
                if (nonFeeNotif) {
                    setEl('notice-text', 'innerText', nonFeeNotif.message || nonFeeNotif.title);
                } else {
                    const bannerSec = $('notice-banner-section');
                    if (bannerSec) bannerSec.classList.add('hidden');
                }
            }).catch(e => {
                console.error('[Dashboard] Notifications fail:', e);
                setEl('dash-notif-count', 'innerText', '--');
                const bannerSec = $('notice-banner-section');
                if (bannerSec) bannerSec.classList.add('hidden');
            });

            // 7. Exams count card & Live Next Exam
            api.get('/exams').then(examsRes => {
                const examSchedules = examsRes.data?.schedules || [];
                setEl('dash-exams-count', 'innerText', examSchedules.length.toString());

                const examContainer = $('dash-upcoming-exam-container');
                if (examContainer && examSchedules.length > 0) {
                    const nextExam = examSchedules[0];
                    examContainer.innerHTML = `
                        <div class="glass-card p-3.5 rounded-2xl border border-white/50 shadow-sm flex items-center gap-3.5 bg-white/70 active-scale transition-transform" onclick="router.navigate('/exams')">
                            <div class="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center flex-shrink-0 border border-indigo-100">
                                <span class="material-symbols-outlined text-[18px]">event</span>
                            </div>
                            <div class="min-w-0 flex-1">
                                <p class="text-[9px] font-extrabold text-indigo-600 uppercase tracking-widest leading-none">Next Exam</p>
                                <h4 class="text-xs font-black text-slate-800 truncate mt-1.5">${nextExam.subjectName || nextExam.subjectCode || 'Exam'}</h4>
                                <p class="text-[10px] text-slate-500 mt-1 leading-none">${nextExam.date || ''}</p>
                            </div>
                        </div>
                    `;
                } else if (examContainer) {
                    examContainer.innerHTML = `
                        <div class="glass-card p-3.5 rounded-2xl border border-white/40 shadow-sm text-center bg-white/40 py-5 text-slate-400 text-[10px] font-bold">
                            No upcoming exams
                        </div>
                    `;
                }
            }).catch(e => {
                console.error('[Dashboard] Exams fail:', e);
                setEl('dash-exams-count', 'innerText', '0');
            });

            // 8. Today's Timetable card & Live Next Class
            api.get('/timetable').then(ttRes => {
                const slots = Array.isArray(ttRes) ? ttRes : (ttRes.data || []);
                const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
                let day = days[new Date().getDay()];
                if (day === 'Sunday') day = 'Monday';
                const todaySlots = slots.filter(s => s.day === day).sort((a, b) => (a.period||0) - (b.period||0));
                const container = $('dash-timetable');
                if (!container) return;

                const colors = ['bg-primary-container text-primary', 'bg-indigo-100 text-indigo-600', 'bg-slate-100 text-slate-600'];
                const icons = ['terminal','calculate','language','science','menu_book','code'];

                if (todaySlots.length === 0) {
                    container.innerHTML = `<div class="min-w-full flex items-center justify-center h-24 text-slate-400 text-xs font-semibold bg-white/40 border border-white/20 rounded-2xl shadow-sm">No classes today</div>`;
                    
                    const classContainer = $('dash-upcoming-class-container');
                    if (classContainer) {
                        classContainer.innerHTML = `
                            <div class="glass-card p-3.5 rounded-2xl border border-white/40 shadow-sm text-center bg-white/40 py-5 text-slate-400 text-[10px] font-bold">
                                No classes today
                            </div>
                        `;
                    }
                } else {
                    container.innerHTML = `<div class="flex gap-3">${todaySlots.map((s, i) => `
                        <div class="min-w-[170px] bg-white/75 backdrop-blur-xl border border-white/55 p-4 rounded-2xl flex flex-col gap-2.5 shadow-[0_4px_20px_rgba(48,51,55,0.02)] active-scale transition-all" onclick="router.navigate('/timetable')">
                            <div class="w-9 h-9 rounded-xl flex items-center justify-center ${colors[i % colors.length]}">
                                <span class="material-symbols-outlined text-sm" style="font-variation-settings:'FILL' 1">${icons[i % icons.length]}</span>
                            </div>
                            <div>
                                <p class="text-[9px] font-extrabold text-slate-400 tracking-wider">${s.subjectCode || '---'}</p>
                                <h4 class="text-xs font-bold text-on-surface truncate">${s.subjectName || s.subjectCode || 'Class'}</h4>
                            </div>
                            <div class="flex flex-col gap-0.5 mt-0.5">
                                <div class="flex items-center gap-1.5 text-[10px] text-slate-500">
                                    <span class="material-symbols-outlined text-xs text-slate-400" style="font-size:12px">meeting_room</span>
                                    <span class="truncate">${s.room || '--'}</span>
                                </div>
                                <div class="flex items-center gap-1.5 text-[10px] text-slate-500">
                                    <span class="material-symbols-outlined text-xs text-slate-400" style="font-size:12px">person</span>
                                    <span class="truncate">${s.facultyName || '--'}</span>
                                </div>
                                <div class="flex items-center gap-1.5 text-[10px] text-secondary font-extrabold">
                                    <span class="material-symbols-outlined text-xs" style="font-size:12px">schedule</span>
                                    <span class="truncate">${(s.time || '--').replace(/^"|"$/g, '').trim()}</span>
                                </div>
                            </div>
                        </div>`).join('')}</div>`;
                }
            }).catch(e => {
                console.error('[Dashboard] Timetable fail:', e);
                const container = $('dash-timetable');
                if (container) {
                    container.innerHTML = `<div class="min-w-full flex items-center justify-center h-24 text-slate-400 text-xs font-semibold bg-white/40 border border-white/20 rounded-2xl shadow-sm">No classes today</div>`;
                }
            });

            // 9. Fetch Companies on Campus Today
            api.get('/placements').then(placeRes => {
                const placements = placeRes.placements || [];
                const arrivedToday = placements.filter(p => p.companyArrivedToday === true || p.companyArrivedToday === 'true');
                const section = $('companies-today-section');
                const list = $('companies-today-list');
                if (section && list) {
                    if (arrivedToday.length > 0) {
                        section.classList.remove('hidden');
                        list.innerHTML = arrivedToday.map(c => `
                            <span class="px-3.5 py-1.5 bg-blue-50 text-blue-700 text-xs font-bold rounded-full border border-blue-100 uppercase tracking-wide flex items-center gap-1.5 animate-reveal">
                                <span class="w-2 h-2 rounded-full bg-blue-600 animate-pulse"></span>
                                \${c.companyName}
                            </span>
                        `).join('');
                    } else {
                        section.classList.add('hidden');
                    }
                }
            }).catch(e => {
                console.error('[Dashboard] Placements fetch failed:', e);
            });
        }
    },

    // ---- ATTENDANCE ----
    attendance: {
        render: () => `<body class="bg-background min-h-screen pb-32">
            <main class="pt-20 pb-28 px-6 max-w-4xl mx-auto">
                <section class="mb-6 text-center">
                    <p class="text-[9px] font-bold uppercase tracking-[0.2em] text-on-surface-variant mb-1">Academic Presence</p>
                    <h2 class="text-3xl font-extrabold tracking-tight text-on-surface" style="font-family:'Plus Jakarta Sans',sans-serif">Attendance Overview</h2>
                </section>
                <!-- Overall Ring -->
                <div class="flex justify-center mb-8">
                    <div class="relative w-48 h-48 flex items-center justify-center">
                        <div class="absolute inset-0 rounded-full bg-surface-container-lowest shadow-[0_15px_40px_rgba(48,51,55,0.08)]"></div>
                        <div class="absolute inset-3 rounded-full opacity-20" id="att-ring"></div>
                        <div class="z-10 w-36 h-36 rounded-full flex flex-col items-center justify-center border border-white/40 shadow-lg" style="background:rgba(255,255,255,0.7);backdrop-filter:blur(24px)">
                            <span class="text-4xl font-extrabold text-[#10b981] tracking-tighter" id="att-overall" style="font-family:'Plus Jakarta Sans',sans-serif">--%</span>
                            <span class="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant">Overall</span>
                        </div>
                        <div class="absolute -top-2 -right-2 w-8 h-8 bg-secondary-container/60 rounded-full blur-lg"></div>
                        <div class="absolute -bottom-3 -left-3 w-10 h-10 bg-tertiary-container/40 rounded-full blur-xl"></div>
                    </div>
                </div>
                <!-- Subject Breakdown -->
                <section class="space-y-3">
                    <div class="flex justify-between items-end mb-2 px-1">
                        <h3 class="text-lg font-bold text-on-surface" style="font-family:'Plus Jakarta Sans',sans-serif">Subject Performance</h3>
                        <span class="text-[10px] font-bold text-secondary uppercase tracking-widest" id="att-semester-label">Semester</span>
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-3" id="att-grid">
                        ${[1,2,3,4].map(() => `<div class="glass-card border border-white/20 p-4 rounded-2xl shimmer-loading h-24"></div>`).join('')}
                    </div>
                </section>
                <!-- Insight Block -->
                <section class="mt-8">
                    <div class="bg-secondary-container/30 p-6 rounded-[2rem] relative overflow-hidden">
                        <div class="relative z-10">
                            <h3 class="text-base font-bold text-on-secondary-container mb-1" style="font-family:'Plus Jakarta Sans',sans-serif">SITAM Insight</h3>
                            <p class="text-xs text-on-secondary-container/80 leading-relaxed max-w-md" id="att-insight">Maintain above 75% attendance in all subjects for seamless semester registration.</p>
                        </div>
                        <div class="absolute top-0 right-0 w-24 h-24 bg-secondary opacity-10 rounded-full -mr-8 -mt-8 blur-2xl"></div>
                        <div class="absolute bottom-0 left-0 w-16 h-16 bg-tertiary opacity-10 rounded-full -ml-8 -mb-8 blur-xl"></div>
                    </div>
                </section>
            </main>
        </body>`,
        afterRender: async () => {
            toggleShell(true);
            setActiveNav('attendance');
            loading.show('Fetching Attendance...');
            try {
                const [res, profRes] = await Promise.all([
                    api.get('/attendance'),
                    api.get('/profile').catch(() => ({ data: {} }))
                ]);
                const attList = res.attendance || [];
                const overall = calcOverallAttendance(attList);
                const pct = overall.pct;

                setEl('att-overall', 'innerText', overall.text);
                setEl('att-semester-label', 'innerText', profRes.data?.semester || 'Semester');

                const color = pct >= 75 ? '#10b981' : pct >= 65 ? '#eab308' : '#ef4444';
                const overallEl = $('att-overall');
                if (overallEl) overallEl.style.color = color;

                setTimeout(() => {
                    const ring = $('att-ring');
                    if (ring) {
                        ring.style.background = `conic-gradient(${color} ${pct}%, transparent 0)`;
                        ring.style.borderRadius = '9999px';
                    }
                }, 150);

                // Insight
                const belowThreshold = attList.filter(s => s.percentage < 75);
                if (belowThreshold.length > 0) {
                    const names = belowThreshold.map(s => s.subject).join(', ');
                    setEl('att-insight', 'innerText', `You are below 75% in ${names}. Attend upcoming classes to avoid detainment.`);
                } else if (pct > 85) {
                    setEl('att-insight', 'innerText', `Excellent work! Your ${pct}% overall attendance reflects your dedication. Keep it up!`);
                }

                const grid = $('att-grid');
                if (!grid) return;
                if (attList.length === 0) {
                    grid.innerHTML = `<div class="col-span-2 text-center py-12 text-on-surface-variant font-semibold bg-surface-container-low rounded-xl">No attendance data available yet. Data syncs after login.</div>`;
                    return;
                }
                grid.innerHTML = '';
                attList.forEach(sub => {
                    const p = sub.percentage || 0;
                    const statusColor = p >= 75 ? '#10b981' : p >= 65 ? '#eab308' : '#ef4444';
                    const statusText = p >= 75 ? 'Excellent' : p >= 65 ? 'Warning' : 'Critical';
                    const card = document.createElement('div');
                    card.className = 'glass-card border border-white/40 p-4 rounded-2xl active-scale transition-all duration-300 shadow-sm';
                    card.innerHTML = `
                        <div class="flex justify-between items-start mb-2 gap-2">
                            <div class="flex-1 min-w-0">
                                <h4 class="font-bold text-sm text-on-surface truncate" style="font-family:'Plus Jakarta Sans',sans-serif" title="${sub.subject}">${sub.subject}</h4>
                            </div>
                            <span class="text-base font-extrabold flex-shrink-0" style="color:${statusColor}">${Math.round(p)}%</span>
                        </div>
                        <div class="w-full h-1.5 bg-surface-variant rounded-full overflow-hidden">
                            <div class="h-full rounded-full transition-all duration-1000" style="width:${p}%;background:${statusColor}"></div>
                        </div>
                        <div class="flex justify-between mt-2 text-[9px] font-bold uppercase tracking-wider text-on-surface-variant/60 gap-2">
                            <span class="truncate">${sub.present} / ${sub.total} Classes</span>
                            <span class="flex-shrink-0">${statusText}</span>
                        </div>`;
                    grid.appendChild(card);
                });
            } catch(e) { console.error('[Attendance] Error:', e); }
            finally { loading.hide(); }
        }
    },

    // ---- MARKS ----
    marks: {
        render: () => `<body class="bg-background text-on-background min-h-screen pb-32">
            <main class="pt-24 px-6 max-w-4xl mx-auto space-y-8">
                <section class="relative">
                    <div class="absolute -top-12 -right-8 w-48 h-48 bg-secondary-container/30 rounded-full blur-3xl -z-10"></div>
                    <div class="flex flex-col gap-4">
                        <div>
                            <p class="text-xs uppercase tracking-[0.2em] text-on-surface-variant mb-1 font-bold">Academic Standing</p>
                            <h1 class="text-4xl font-extrabold tracking-tight text-on-surface" style="font-family:'Plus Jakarta Sans',sans-serif">Marks &amp; Results</h1>
                        </div>
                        <div class="bg-surface-container-lowest p-5 rounded-xl shadow-[0_10px_40px_rgba(48,51,55,0.04)] flex items-center gap-5 border border-outline-variant/10 w-full max-w-sm">
                            <div class="relative flex items-center justify-center flex-shrink-0">
                                <svg class="w-16 h-16 transform -rotate-90">
                                    <circle class="text-surface-container-high" cx="32" cy="32" fill="transparent" r="28" stroke="currentColor" stroke-width="6"></circle>
                                    <circle class="text-secondary" cx="32" cy="32" fill="transparent" r="28" stroke="currentColor" stroke-dasharray="175.84" stroke-dashoffset="17.58" stroke-linecap="round" stroke-width="6" id="cgpa-ring-circle"></circle>
                                </svg>
                                <span class="absolute text-lg font-bold text-on-surface" id="marks-cgpa-ring">--</span>
                            </div>
                            <div class="space-y-0.5">
                                <p class="text-on-surface-variant font-medium text-xs">Cumulative GPA</p>
                                <p class="text-secondary font-bold text-base leading-tight" id="marks-cgpa-status">Loading...</p>
                            </div>
                        </div>
                    </div>
                </section>
                <!-- Subject Grid -->
                <section class="grid grid-cols-1 md:grid-cols-2 gap-4" id="marks-grid">
                    ${[1,2,3,4].map(() => `<div class="glass-card border border-white/20 p-5 rounded-2xl shimmer-loading h-28"></div>`).join('')}
                </section>
                <!-- Term Progression -->
                <section class="bg-surface-container-low p-6 rounded-xl">
                    <div class="flex items-center justify-between mb-6">
                        <h3 class="font-bold text-base" style="font-family:'Plus Jakarta Sans',sans-serif">Academic Performance</h3>
                        <div class="flex items-center gap-2">
                            <div class="w-2.5 h-2.5 rounded-full bg-secondary"></div>
                            <span class="text-[10px] font-bold text-on-surface-variant uppercase">Current Status</span>
                        </div>
                    </div>
                    <div class="flex items-end justify-between h-32 gap-3 px-2" id="marks-perf-bars">
                        <div class="text-center text-xs text-on-surface-variant">Loading...</div>
                    </div>
                </section>
            </main>
        </body>`,
        afterRender: async () => {
            toggleShell(true);
            setActiveNav('marks');
            loading.show('Fetching Results...');
            try {
                const res = await api.get('/marks');
                const data = res.data || {};
                const cgpa = parseFloat(data.cgpa) || 0;

                setEl('marks-cgpa-ring', 'innerText', data.cgpa || '--');
                setEl('marks-cgpa-status', 'innerText', cgpa >= 8.5 ? "Dean's List Status" : cgpa >= 7 ? 'Good Standing' : cgpa >= 5 ? 'Satisfactory' : 'Needs Improvement');

                // Update SVG ring
                const ring = $('cgpa-ring-circle');
                if (ring) {
                    const pct = Math.min(cgpa / 10, 1);
                    const circumference = 175.84;
                    ring.style.strokeDashoffset = circumference - pct * circumference;
                }

                const grid = $('marks-grid');
                if (!grid) return;
                const subjects = data.subjects || [];
                if (subjects.length === 0) {
                    grid.innerHTML = `<div class="col-span-2 text-center py-12 text-on-surface-variant">No marks data available.</div>`;
                } else {
                    const gradeColors = { 'S': 'text-secondary', 'A+': 'text-secondary', 'A': 'text-secondary', 'A-': 'text-secondary', 'B+': 'text-primary', 'B': 'text-primary', 'C': 'text-on-surface-variant', 'D': 'text-tertiary', 'E': 'text-error', 'F': 'text-error', 'BACKLOG': 'text-error' };
                    const typeBg = { 'Core': 'bg-secondary-container text-on-secondary-fixed-variant', 'Lab': 'bg-tertiary-container text-on-tertiary-fixed-variant' };
                    grid.innerHTML = subjects.map(s => {
                        const gc = gradeColors[s.grade] || 'text-on-surface';
                        const tb = typeBg[s.type] || 'bg-surface-container text-on-surface-variant';
                        const pct = s.percentage || 0;
                        return `<div class="glass-card border border-white/40 p-5 rounded-2xl space-y-3 active-scale transition-all duration-300 shadow-sm">
                            <div class="flex justify-between items-start gap-3">
                                <div class="flex-1 min-w-0">
                                    <span class="text-[10px] font-bold uppercase tracking-widest ${tb} px-2.5 py-0.5 rounded-full inline-block">${s.type || 'Core'}</span>
                                    <h3 class="text-base font-bold text-on-surface mt-2 truncate" style="font-family:'Plus Jakarta Sans',sans-serif" title="${s.name}">${s.name}</h3>
                                </div>
                                <div class="text-right flex-shrink-0">
                                    <p class="text-2xl font-black ${gc}">${s.grade}</p>
                                    <p class="text-[10px] text-on-surface-variant font-bold">${s.marks || '--'}</p>
                                </div>
                            </div>
                            <div class="space-y-1.5">
                                <div class="flex justify-between text-[10px] font-bold text-on-surface-variant uppercase tracking-tighter"><span>Mastery</span><span>${pct}%</span></div>
                                <div class="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                    <div class="h-full rounded-full transition-all duration-1000" style="width:${pct}%;background:#2563EB"></div>
                                </div>
                            </div>
                        </div>`;
                    }).join('');
                }

                // Performance bars
                const barsEl = $('marks-perf-bars');
                if (barsEl && subjects.length > 0) {
                    const gradeToNum = { 'S': 95, 'A+': 90, 'A': 85, 'A-': 80, 'B+': 75, 'B': 70, 'B-': 65, 'C+': 60, 'C': 55, 'D': 45, 'E': 35, 'F': 20, 'BACKLOG': 15 };
                    barsEl.innerHTML = subjects.slice(0, 6).map(s => {
                        const h = gradeToNum[s.grade] || 50;
                        return `<div class="w-full relative group flex flex-col items-center">
                            <div class="w-full bg-secondary-container/30 rounded-t-lg" style="height:${Math.round(h * 0.9 / 10)}rem">
                                <div class="absolute bottom-0 w-full bg-secondary rounded-t-lg transition-all duration-500 group-hover:opacity-80" style="height:${Math.round(h * 0.85 / 10)}rem"></div>
                            </div>
                            <span class="mt-2 text-[8px] font-bold text-on-surface-variant tracking-widest uppercase">${s.name.slice(0,4)}</span>
                        </div>`;
                    }).join('');
                }
            } catch(e) { console.error('[Marks] Error:', e); }
            finally { loading.hide(); }
        }
    },
    fees: {
        render: () => `<div class="bg-background text-on-surface min-h-screen pb-32">
            <main class="pt-24 px-4 sm:px-6 max-w-7xl mx-auto space-y-8">
                <!-- Hero Metrics -->
                <section class="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div class="lg:col-span-2 relative group overflow-hidden bg-gradient-to-tr from-[#1e3a8a] to-[#2563EB] rounded-2xl p-6 sm:p-10 flex flex-col justify-between min-h-[220px] sm:min-h-[280px] shadow-lg shadow-blue-900/10">
                        <div class="relative z-10">
                            <p class="font-label text-white/80 text-xs font-bold uppercase tracking-widest mb-1.5">Total Balance Due</p>
                            <h2 class="font-headline text-4xl sm:text-5xl font-extrabold tracking-tighter text-white" id="fee-due" style="font-family:'Inter',sans-serif">--</h2>
                            <p class="mt-2 text-white/70 max-w-md font-medium text-xs leading-relaxed" id="fee-hero-sub">Your semester fees are managed here. Clear dues early to avoid penalties.</p>
                        </div>
                        <div class="mt-6 flex gap-3 relative z-10">
                            <button id="pay-now-btn" class="bg-white text-[#2563EB] px-6 py-3.5 rounded-full font-extrabold text-xs shadow-md active-scale transition-transform flex items-center gap-2 hover:bg-slate-50">
                                Pay Now <span class="material-symbols-outlined text-sm font-black">arrow_forward</span>
                            </button>
                        </div>
                        <div class="absolute -right-20 -top-20 w-80 h-80 bg-white/10 rounded-full blur-[80px] pointer-events-none"></div>
                        <div class="absolute right-10 bottom-10 opacity-30"><div class="w-48 h-48 bg-gradient-to-br from-white to-blue-200 rounded-full blur-3xl"></div></div>
                    </div>
                    <div class="glass-card border border-white/45 rounded-2xl p-6 sm:p-10 flex flex-col justify-center items-center text-center shadow-[0_4px_30px_rgba(48,51,55,0.02)]">
                        <div class="relative w-36 h-36 mb-4 flex items-center justify-center">
                            <svg class="w-full h-full transform -rotate-90">
                                <circle class="text-slate-100" cx="72" cy="72" fill="transparent" r="64" stroke="currentColor" stroke-width="8"></circle>
                                <circle class="text-secondary" cx="72" cy="72" fill="transparent" r="64" stroke="currentColor" stroke-dasharray="402.12" stroke-dashoffset="402.12" stroke-width="8" style="stroke-linecap:round;transition:stroke-dashoffset 1s ease" id="fee-ring"></circle>
                            </svg>
                            <div class="absolute inset-0 flex flex-col items-center justify-center">
                                <span class="text-2xl font-black text-on-surface" style="font-family:'Plus Jakarta Sans',sans-serif" id="fee-pct">--%</span>
                                <span class="text-[9px] uppercase tracking-widest font-extrabold text-on-surface-variant/70">Paid to date</span>
                            </div>
                        </div>
                        <h3 class="font-bold text-sm text-on-surface mb-0.5" style="font-family:'Plus Jakarta Sans',sans-serif">Payment Progress</h3>
                        <p class="text-xs text-on-surface-variant/80" id="fee-progress-text">Checking ledger...</p>
                    </div>
                </section>
                <!-- Bento: Details -->
                <section class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div class="glass-card border border-white/40 p-6 sm:p-8 rounded-2xl flex flex-col gap-4 justify-between shadow-sm active-scale transition-all">
                        <div>
                            <div class="w-10 h-10 bg-rose-100 text-rose-700 rounded-2xl flex items-center justify-center mb-4">
                                <span class="material-symbols-outlined text-lg">upcoming</span>
                            </div>
                            <h4 class="font-extrabold text-base text-on-surface" style="font-family:'Plus Jakarta Sans',sans-serif">Total Fees</h4>
                            <p class="text-on-surface-variant/80 text-xs mt-1" id="fee-total-label">Academic Year</p>
                        </div>
                        <div class="text-2xl font-black text-rose-700" id="fee-total">--</div>
                    </div>
                    <div class="glass-card border border-white/40 p-6 sm:p-8 rounded-2xl flex flex-col gap-4 justify-between shadow-sm active-scale transition-all">
                        <div>
                            <div class="w-10 h-10 bg-emerald-100 text-emerald-700 rounded-2xl flex items-center justify-center mb-4">
                                <span class="material-symbols-outlined text-lg">verified</span>
                            </div>
                            <h4 class="font-extrabold text-base text-on-surface" style="font-family:'Plus Jakarta Sans',sans-serif">Amount Paid</h4>
                            <p class="text-on-surface-variant/80 text-xs mt-1">Cleared to date</p>
                        </div>
                        <div class="text-2xl font-black text-emerald-700" id="fee-paid">--</div>
                    </div>
                    <!-- Full-width transaction history -->
                    <div class="lg:col-span-3 glass-card border border-white/45 rounded-2xl p-6 sm:p-8 shadow-[0_4px_30px_rgba(48,51,55,0.02)]">
                        <div class="flex items-center justify-between mb-6">
                            <h4 class="font-extrabold text-lg text-on-surface" style="font-family:'Plus Jakarta Sans',sans-serif">Transaction History</h4>
                            <button class="text-secondary font-extrabold text-xs flex items-center gap-1 hover:underline active-scale transition-all">
                                Download All <span class="material-symbols-outlined text-sm">download</span>
                            </button>
                        </div>
                        <div class="space-y-3" id="txn-list">
                            <div class="glass-card border border-white/20 p-5 rounded-2xl shimmer-loading h-16"></div>
                        </div>
                    </div>
                </section>
            </main>

            <!-- ===== PAYMENT MODAL OVERLAY ===== -->
            <div id="payment-overlay" class="fixed inset-0 z-[100] bg-black/60 backdrop-blur-md flex items-center justify-center hidden opacity-0 transition-opacity duration-300">
                <div class="bg-white rounded-3xl p-8 max-w-md w-[90%] text-center shadow-2xl border border-white/20">
                    <div id="payment-loading-state" class="space-y-6">
                        <div class="relative w-16 h-16 mx-auto">
                            <div class="absolute inset-0 border-4 border-blue-500/20 rounded-full"></div>
                            <div class="absolute inset-0 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                        </div>
                        <div class="space-y-2">
                            <h3 class="text-lg font-black text-on-surface font-headline">Processing Payment</h3>
                            <p class="text-xs text-[#2563EB] font-extrabold uppercase tracking-widest" id="payment-step-text">Step 1: Authenticating...</p>
                            <p class="text-xs text-slate-400">Please do not close the app or press back.</p>
                        </div>
                    </div>
                    <div id="payment-error-state" class="hidden space-y-6">
                        <span class="material-symbols-outlined text-rose-500 text-5xl">error</span>
                        <div class="space-y-2">
                            <h3 class="text-lg font-black text-on-surface font-headline">Payment Failed</h3>
                            <p class="text-sm text-slate-500" id="payment-error-text">Unable to connect to the payment gateway.</p>
                        </div>
                        <div class="flex gap-3 justify-center">
                            <button id="payment-retry-btn" class="bg-[#2563EB] text-white px-6 py-2.5 rounded-full font-bold text-xs shadow-md active-scale transition-transform">Retry</button>
                            <button id="payment-close-btn" class="bg-slate-100 text-slate-600 px-6 py-2.5 rounded-full font-bold text-xs active-scale transition-transform">Cancel</button>
                        </div>
                    </div>
                    <div id="payment-success-state" class="hidden space-y-6">
                        <span class="material-symbols-outlined text-emerald-500 text-5xl animate-bounce">check_circle</span>
                        <div class="space-y-2">
                            <h3 class="text-lg font-black text-on-surface font-headline">Payment Success!</h3>
                            <p class="text-sm text-slate-500">Your fees have been successfully updated.</p>
                        </div>
                        <button id="payment-success-done-btn" class="bg-emerald-600 text-white px-8 py-2.5 rounded-full font-bold text-xs shadow-md active-scale transition-transform">Done</button>
                    </div>
                </div>
            </div>
        </div>`,
        afterRender: async () => {
            toggleShell(true);
            setActiveNav('fees');
            loading.show('Fetching Fees...');
            try {
                const [res, noticesRes] = await Promise.all([
                    api.get('/fees'),
                    api.get('/fee-notices').catch(() => ({ notices: [] }))
                ]);
                const d = res.data || {};
                const activeNotices = noticesRes.notices || [];
                const hasWarning = activeNotices.some(n => n.hallTicketBlockWarning === true);
                const dueAmount = d.dueAmount || d.totalDue || '₹0';
                setEl('fee-due', 'innerText', dueAmount);
                setEl('fee-pct', 'innerText', `${d.paidProgress || 0}%`);
                setEl('fee-total', 'innerText', d.totalAmount || '--');
                setEl('fee-paid', 'innerText', d.paidAmount || '--');
                setEl('fee-progress-text', 'innerText', `You've cleared ${d.paidAmount || '--'} of ${d.totalAmount || '--'} for the semester.`);
                setEl('fee-hero-sub', 'innerText', `Your semester fee status: ${dueAmount} due. Ensure timely payment to avoid penalties.`);
 
                // Ring animation (uses 402.12 radius calculations)
                setTimeout(() => {
                    const ring = $('fee-ring');
                    if (ring) {
                        const pct = d.paidProgress || 0;
                        ring.style.strokeDashoffset = 402.12 - (pct / 100) * 402.12;
                    }
                }, 200);

                const payBtn = $('pay-now-btn');
                if (payBtn) {
                    const overlay = $('payment-overlay');
                    const loadingState = $('payment-loading-state');
                    const errorState = $('payment-error-state');
                    const successState = $('payment-success-state');
                    const stepText = $('payment-step-text');
                    const errorText = $('payment-error-text');
                    const retryBtn = $('payment-retry-btn');
                    const closeBtn = $('payment-close-btn');
                    const doneBtn = $('payment-success-done-btn');
                    
                    state.paymentTimeout = null;
                    const oldDueAmount = dueAmount;
                    
                    const closeOverlay = () => {
                        if (state.paymentTimeout) clearTimeout(state.paymentTimeout);
                        overlay.classList.remove('opacity-100');
                        setTimeout(() => overlay.classList.add('hidden'), 300);
                    };
                    
                    const showPaymentError = (msg) => {
                        if (state.paymentTimeout) clearTimeout(state.paymentTimeout);
                        loadingState.classList.add('hidden');
                        successState.classList.add('hidden');
                        errorState.classList.remove('hidden');
                        errorText.innerText = msg;
                    };
                    
                    const checkPaymentResult = async () => {
                        try {
                            loading.show('Verifying payment status...');
                            const freshRes = await api.get('/fees', { bypassCache: true });
                            if (freshRes && freshRes.success) {
                                const newDue = freshRes.data?.dueAmount || freshRes.data?.totalDue || '₹0';
                                router.routes['/fees']?.afterRender?.();
                                
                                if (newDue !== oldDueAmount) {
                                    // Payment successful!
                                    loadingState.classList.add('hidden');
                                    errorState.classList.add('hidden');
                                    successState.classList.remove('hidden');
                                } else {
                                    // Amount unchanged (cancelled or failed)
                                    closeOverlay();
                                }
                            } else {
                                closeOverlay();
                            }
                        } catch (err) {
                            closeOverlay();
                        } finally {
                            loading.hide();
                        }
                    };
                    
                    const startPaymentFlow = async () => {
                        overlay.classList.remove('hidden');
                        setTimeout(() => overlay.classList.add('opacity-100'), 10);
                        loadingState.classList.remove('hidden');
                        errorState.classList.add('hidden');
                        successState.classList.add('hidden');
                        
                        stepText.innerText = 'Step 1: Authenticating...';
                        
                        // 30 second safety timeout
                        state.paymentTimeout = setTimeout(() => {
                            showPaymentError('The payment gateway connection timed out. Please check your network and try again.');
                        }, 30000);
                        
                        try {
                            // Step 1: Validate session (fetch profile)
                            const profileCheck = await api.get('/profile', { bypassCache: true });
                            if (!profileCheck || !profileCheck.success) {
                                throw new Error('Session expired. Please log in again.');
                            }
                            
                            stepText.innerText = 'Step 2: Opening Payment Portal...';
                            
                            // Step 2: Fetch latest fee balance
                            const feesCheck = await api.get('/fees', { bypassCache: true });
                            if (!feesCheck || !feesCheck.success) {
                                throw new Error('ERP system is currently unreachable.');
                            }
                            
                            stepText.innerText = 'Step 3: Redirecting to Payment Gateway...';
                            
                            const redirectUrl = `${API_BASE}/fees/payment-redirect?token=${encodeURIComponent(state.token)}`;
                            
                            if (state.paymentTimeout) clearTimeout(state.paymentTimeout);
                            
                            // Step 3: Open gateway
                            if (window.Capacitor?.Plugins?.Browser) {
                                await window.Capacitor.Plugins.Browser.open({ url: redirectUrl });
                                if (!state._browserListenerAdded) {
                                    state._browserListenerAdded = true;
                                    window.Capacitor.Plugins.Browser.addListener('browserFinished', () => {
                                        checkPaymentResult();
                                    });
                                }
                            } else {
                                window.open(redirectUrl, '_blank');
                                // Poll in background for web desktop
                                let pollCount = 0;
                                const pollInterval = setInterval(async () => {
                                    pollCount++;
                                    if (pollCount > 10 || !successState.classList.contains('hidden')) {
                                        clearInterval(pollInterval);
                                        return;
                                    }
                                    try {
                                        const r = await api.get('/fees', { bypassCache: true });
                                        if (r && r.success) {
                                            const nd = r.data?.dueAmount || r.data?.totalDue || '₹0';
                                            if (nd !== oldDueAmount) {
                                                clearInterval(pollInterval);
                                                router.routes['/fees']?.afterRender?.();
                                                loadingState.classList.add('hidden');
                                                errorState.classList.add('hidden');
                                                successState.classList.remove('hidden');
                                            }
                                        }
                                    } catch {}
                                }, 3000);
                            }
                        } catch (err) {
                            showPaymentError(err.message || 'Payment authentication failed.');
                        }
                    };
                    
                    payBtn.addEventListener('click', startPaymentFlow);
                    retryBtn.addEventListener('click', startPaymentFlow);
                    closeBtn.addEventListener('click', closeOverlay);
                    doneBtn.addEventListener('click', () => {
                        closeOverlay();
                        router.routes['/fees']?.afterRender?.();
                    });
                }
 
                const list = $('txn-list');
                if (!list) return;
                const txns = d.transactions || [];
                if (txns.length === 0) {
                    list.innerHTML = `<div class="text-center py-12 text-on-surface-variant font-bold">No transactions found.</div>`;
                    return;
                }
                const statusColors = {
                    'Paid': 'bg-secondary-container text-on-secondary-container',
                    'Completed': 'bg-secondary-container text-on-secondary-container',
                    'Due': 'bg-error-container/30 text-error',
                    'Partial': 'bg-tertiary-container/30 text-on-tertiary-container',
                    'Refunded': 'bg-error-container text-on-error-container'
                };
                list.innerHTML = txns.map(txn => {
                    const sc = statusColors[txn.status] || 'bg-surface-container text-on-surface-variant';
                    const isDue = txn.status === 'Due' || txn.status === 'Partial';
                    const warningHtml = (isDue && hasWarning) ? `
                        <div class="mt-2.5 p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs font-bold flex items-center gap-2 animate-reveal">
                            <span class="material-symbols-outlined text-sm font-bold">warning</span>
                            <span>⚠ Fee Due. Pay before Mid Examination. Hall Tickets may not be issued until dues are cleared.</span>
                        </div>
                    ` : '';
                    return `<div class="flex flex-col p-4 rounded-2xl bg-white/60 border border-white/20 hover:bg-slate-50/50 active-scale transition-all duration-200 group">
                        <div class="flex items-center justify-between gap-3">
                            <div class="flex items-center gap-4 min-w-0 flex-1">
                                <div class="w-11 h-11 rounded-xl bg-surface-container-high flex items-center justify-center group-hover:bg-white transition-colors flex-shrink-0">
                                    <span class="material-symbols-outlined text-on-surface-variant text-lg">\${txn.icon || 'receipt_long'}</span>
                                </div>
                                <div class="min-w-0 flex-1">
                                    <p class="font-bold text-on-surface text-sm leading-tight truncate" title="\${txn.title}">\${txn.title}</p>
                                </div>
                            </div>
                            <div class="text-right flex-shrink-0">
                                <p class="font-extrabold text-on-surface text-sm leading-tight">\${txn.amount}</p>
                                <span class="text-[9px] px-2 py-0.5 \${sc} rounded-full font-bold uppercase tracking-tighter mt-1 inline-block">\${txn.status}</span>
                            </div>
                        </div>
                        \${warningHtml}
                    </div>`;
                }).join('');
            } catch(e) { console.error('[Fees] Error:', e); }
            finally { loading.hide(); }
        }
    },

    // ---- PROFILE ----
    profile: {
        render: () => `<div class="min-h-screen pb-36 bg-[#F8FAFC]">
            <main class="pt-20 px-4 max-w-lg mx-auto">

                <!-- ════════════════════════════════════ -->
                <!-- DIGITAL STUDENT ID CARD             -->
                <!-- ════════════════════════════════════ -->
                <section class="mb-6">
                    <div class="id-card p-6 sm:p-8 relative overflow-hidden" id="id-card">
                        <!-- Card Header: Institution -->
                        <div class="relative z-10 flex items-center justify-between mb-6">
                            <div class="flex items-center gap-3">
                                <div class="w-10 h-10 bg-white/10 rounded-2xl flex items-center justify-center border border-white/20 backdrop-blur-md">
                                    <span class="material-symbols-outlined text-white" style="font-size:20px;font-variation-settings:'FILL' 1">school</span>
                                </div>
                                <div>
                                    <p class="text-white font-extrabold text-[12px] tracking-wider uppercase leading-none">SITAM</p>
                                    <p class="text-blue-300/80 text-[9px] font-black tracking-widest uppercase mt-1">Campus ID Card</p>
                                </div>
                            </div>
                            <!-- Holographic chip -->
                            <div class="id-chip"></div>
                        </div>

                        <!-- ID Card Body: Avatar & Core Info -->
                        <div class="relative z-10 flex flex-col items-center text-center mb-6">
                            <!-- Large Avatar Box with double borders and glow -->
                            <div class="relative mb-4 group">
                                <div class="absolute inset-0 bg-gradient-to-tr from-blue-500 to-indigo-500 rounded-[2.5rem] blur-md opacity-50 group-hover:opacity-75 transition-opacity"></div>
                                <div class="w-24 h-24 rounded-[2.2rem] bg-slate-900 border-2 border-white/25 flex items-center justify-center shadow-2xl relative overflow-hidden">
                                    <span class="material-symbols-outlined text-white/95" style="font-size:48px">person</span>
                                </div>
                            </div>

                            <h2 class="text-white text-xl font-black leading-tight tracking-tight mb-1" id="profile-name" style="font-family:'Inter',sans-serif">--</h2>
                            <p class="text-blue-200 font-bold font-mono tracking-widest text-xs" id="profile-roll">--</p>
                            
                            <!-- Dynamic Academic Badges Container -->
                            <div class="flex flex-wrap items-center justify-center gap-1.5 mt-3.5" id="profile-badges">
                                <span class="px-3 py-1 rounded-full bg-blue-500/20 border border-blue-400/30 text-blue-200 text-[10px] font-bold tracking-wide" id="profile-branch-badge">--</span>
                                <span class="px-3 py-1 rounded-full bg-indigo-500/20 border border-indigo-400/30 text-indigo-200 text-[10px] font-bold tracking-wide" id="profile-sem-badge">Sem --</span>
                                <span class="px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-400/30 text-emerald-200 text-[10px] font-bold tracking-wide hidden" id="scholar-badge">🏆 Elite Scholar</span>
                                <span class="px-3 py-1 rounded-full bg-amber-500/20 border border-amber-400/30 text-amber-200 text-[10px] font-bold tracking-wide hidden" id="att-champion-badge">⚡ Att Champion</span>
                            </div>
                            
                            <!-- Compatibility stubs -->
                            <span id="profile-branch" class="hidden"></span>
                            <span id="profile-year" class="hidden"></span>
                        </div>

                        <!-- Stats strip -->
                        <div class="relative z-10 grid grid-cols-3 gap-2 pt-4 border-t border-white/10">
                            <div class="text-center">
                                <p class="text-blue-300/70 text-[9px] font-bold uppercase tracking-widest mb-1">CGPA</p>
                                <p class="text-white text-lg font-black" id="profile-cgpa">--</p>
                            </div>
                            <div class="text-center border-x border-white/10">
                                <p class="text-blue-300/70 text-[9px] font-bold uppercase tracking-widest mb-1">Semester</p>
                                <p class="text-white text-lg font-black" id="profile-semester">--</p>
                            </div>
                            <div class="text-center">
                                <p class="text-blue-300/70 text-[9px] font-bold uppercase tracking-widest mb-1">Attendance</p>
                                <p class="text-white text-lg font-black" id="profile-att-pct">--%</p>
                            </div>
                        </div>
                    </div>
                </section>

                <!-- Detail Fields -->
                <section>
                    <p class="text-[11px] font-extrabold uppercase tracking-widest text-slate-400 mb-3">Personal Info</p>
                    <div class="space-y-2" id="profile-details"></div>
                </section>

                <!-- Actions -->
                <div class="mt-6 space-y-3">
                    <button class="w-full flex items-center justify-center gap-3 px-4 py-4 rounded-2xl bg-red-50 text-red-600 border border-red-100 hover:bg-red-600 hover:text-white transition-all duration-300 font-bold active-scale" onclick="api.logout()">
                        <span class="material-symbols-outlined">logout</span>
                        <span class="uppercase tracking-widest text-sm">Sign Out</span>
                    </button>
                    <div class="text-center text-[10px] font-bold text-slate-400/60 uppercase tracking-widest" id="about-app-version">
                        SITAM Campus ERP v1.0.0
                    </div>
                </div>
            </main>
        </div>`,
        afterRender: async () => {
            toggleShell(true);
            setActiveNav('profile');
            loading.show('Loading Profile...');
            try {
                const res = await api.get('/profile');
                const d = res.data || {};
                setEl('profile-name', 'innerText', d.name || '--');
                setEl('profile-roll', 'innerText', d.roll || d.userId || '--');
                setEl('profile-branch', 'innerText', d.branch || d.program || '--');
                setEl('profile-cgpa', 'innerText', d.cgpa || '--');
                setEl('profile-semester', 'innerText', (d.semester || '--').split(' ')[0] || '--');
                setEl('profile-year', 'innerText', d.year || '--');
                setEl('drawer-name', 'innerText', d.name || '');
                setEl('drawer-roll', 'innerText', d.roll || '');
                setEl('about-app-version', 'innerText', `SITAM Campus ERP v${window.APP_VERSION || '1.0.0'}`);

                // Badges logic
                const branchText = d.branch || d.program || '--';
                setEl('profile-branch-badge', 'innerText', branchText);
                setEl('profile-sem-badge', 'innerText', `Sem ${(d.semester || '--').split(' ')[0]}`);

                const cgpaVal = parseFloat(d.cgpa);
                if (!isNaN(cgpaVal) && cgpaVal >= 8.5) {
                    $('scholar-badge')?.classList.remove('hidden');
                }

                // Fetch attendance for the ID card stat
                api.get('/attendance').then(attRes => {
                    const attList = attRes.attendance || [];
                    const overall = calcOverallAttendance(attList);
                    setEl('profile-att-pct', 'innerText', overall.text || '--%');
                    
                    const attPct = parseFloat(overall.text);
                    if (!isNaN(attPct) && attPct >= 90) {
                        $('att-champion-badge')?.classList.remove('hidden');
                    }
                }).catch(() => {});

                const detailsEl = $('profile-details');
                if (!detailsEl) return;
                const fields = [
                    ['person', 'Gender', d.gender],
                    ['cake', 'Date of Birth', d.dob],
                    ['mail', 'Email', d.email],
                    ['phone', 'Mobile', d.phone],
                    ['supervisor_account', 'Father', d.fatherName],
                    ['supervisor_account', 'Mother', d.motherName],
                    ['home', 'Hostel', d.hostel ? `${d.hostel} - Room ${d.roomNo}` : 'N/A'],
                    ['location_on', 'Address', d.address]
                ].filter(([, , v]) => v && v !== 'N/A');

                detailsEl.innerHTML = fields.map(([icon, label, val]) => `
                    <div class="flex items-center gap-4 p-4 bg-white/60 backdrop-blur-xl rounded-2xl border border-white/50 shadow-sm active-scale transition-all hover:bg-white/80">
                        <div class="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0 border border-blue-100">
                            <span class="material-symbols-outlined text-blue-500 text-sm">${icon}</span>
                        </div>
                        <div class="min-w-0 flex-1">
                            <p class="text-[10px] font-bold uppercase tracking-widest text-slate-400">${label}</p>
                            <p class="text-sm font-semibold text-slate-800 mt-0.5 truncate">${val || '--'}</p>
                        </div>
                    </div>`).join('');
            } catch(e) { console.error('[Profile] Error:', e); }
            finally { loading.hide(); }
        }
    },

    // ---- ASSIGNMENTS ----
    assignments: {
        render: () => `<body class="bg-background min-h-screen pb-32">
            <main class="pt-20 px-6 max-w-2xl mx-auto">
                <section class="mb-6">
                    <p class="text-[9px] font-bold uppercase tracking-[0.2em] text-on-surface-variant mb-1">Pending Work</p>
                    <h2 class="text-3xl font-extrabold tracking-tight text-on-surface" style="font-family:'Plus Jakarta Sans',sans-serif">Assignments</h2>
                </section>
                <div class="space-y-3" id="asn-list">
                    <div class="h-20 bg-surface-container-low rounded-xl animate-pulse"></div>
                </div>
            </main>
        </body>`,
        afterRender: async () => {
            toggleShell(true);
            setActiveNav('assignments');
            loading.show('Loading Assignments...');
            try {
                const res = await api.get('/assignments');
                const list = $('asn-list');
                if (!list) return;
                const asns = res.data?.list || [];
                if (asns.length === 0) {
                    list.innerHTML = `<div class="text-center py-16 text-on-surface-variant">
                        <span class="material-symbols-outlined text-5xl mb-4 block">assignment_turned_in</span>
                        <p class="font-bold">No pending assignments!</p>
                    </div>`;
                    return;
                }
                list.innerHTML = asns.map(a => {
                    const isPending = a.status.toLowerCase() !== 'submitted';
                    const bg = isPending ? 'bg-surface-container-lowest border border-outline-variant/10' : 'bg-secondary-container/20';
                    const icon = a.icon || (isPending ? 'pending' : 'check_circle');
                    const iconColor = isPending ? 'text-tertiary' : 'text-secondary';
                    return `<div class="p-5 rounded-xl ${bg} flex items-center gap-4 justify-between">
                        <div class="flex items-center gap-4 min-w-0 flex-1">
                            <div class="w-12 h-12 rounded-full bg-surface-container-high flex items-center justify-center flex-shrink-0">
                                <span class="material-symbols-outlined ${iconColor}">${icon}</span>
                            </div>
                            <div class="min-w-0 flex-1">
                                <p class="font-bold text-on-surface text-sm truncate" title="${a.title}">${a.title}</p>
                                <p class="text-[11px] text-on-surface-variant mt-0.5 truncate">${a.subject} · Due ${a.date || '--'}</p>
                            </div>
                        </div>
                        <span class="text-[10px] px-2 py-1 rounded-full font-bold uppercase flex-shrink-0 ${isPending ? 'bg-tertiary-container/30 text-on-tertiary-container' : 'bg-secondary-container text-on-secondary-container'}">${a.status}</span>
                    </div>`;
                }).join('');
            } catch(e) { console.error('[Assignments] Error:', e); }
            finally { loading.hide(); }
        }
    },

    // ---- TIMETABLE ----
    timetable: {
        render: () => `<body class="bg-background min-h-screen pb-32">
            <main class="pt-20 px-4 sm:px-6 max-w-3xl mx-auto">
                <section class="mb-5">
                    <p class="text-[9px] font-bold uppercase tracking-[0.2em] text-on-surface-variant mb-0.5">Weekly Schedule</p>
                    <h2 class="text-3xl font-extrabold tracking-tight text-on-surface" style="font-family:'Plus Jakarta Sans',sans-serif">Timetable</h2>
                </section>
                <!-- Day Selector -->
                <div class="flex gap-2 overflow-x-auto pb-3 mb-5 -mx-4 px-4 momentum-scroll hide-scrollbar" id="day-tabs">
                    ${['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((d,i) => `
                        <button data-day="${d}" class="day-tab flex-shrink-0 px-5 py-2.5 rounded-full text-[11px] font-bold uppercase tracking-widest transition-all ${i===0?'bg-secondary text-on-secondary':'bg-slate-100 text-slate-500 hover:bg-slate-200'}">${d.slice(0,3)}</button>`).join('')}
                </div>
                <div class="space-y-3" id="tt-grid">
                    <div class="glass-card border border-white/20 p-5 rounded-2xl shimmer-loading h-24"></div>
                </div>
            </main>
        </body>`,
        afterRender: async () => {
            toggleShell(true);
            setActiveNav('timetable');
            loading.show('Loading Schedule...');

            let allSlots = [];
            try {
                const res = await api.get('/timetable');
                allSlots = Array.isArray(res) ? res : (res.data || []);
            } catch(e) { console.error('[Timetable] Fetch error:', e); }
            finally { loading.hide(); }

            const colors = ['bg-secondary-container text-secondary', 'bg-tertiary-container/40 text-on-tertiary-container', 'bg-surface-container-high text-on-surface-variant', 'bg-surface-container text-primary'];
            const icons = ['terminal','calculate','language','science','menu_book','code','psychology','biotech'];

            function renderDay(day) {
                const grid = $('tt-grid');
                if (!grid) return;
                const daySlots = allSlots.filter(s => s.day === day).sort((a, b) => (parseInt(a.period)||0) - (parseInt(b.period)||0));
                if (daySlots.length === 0) {
                    grid.innerHTML = `<div class="text-center py-16 text-on-surface-variant"><span class="material-symbols-outlined text-5xl mb-4 block">event_busy</span><p class="font-bold">No classes on ${day}</p></div>`;
                    return;
                }
                grid.innerHTML = daySlots.map((s, i) => {
                    // Strip stray quotes from time (stored as JSON string in some cases)
                    const timeVal = (s.time || '--').replace(/^"|"$/g, '').trim();
                    const periodVal = parseInt(s.period) || (i + 1);
                    const subjectDisplay = (s.subjectName && s.subjectName !== s.subjectCode)
                        ? s.subjectName
                        : (s.subjectCode || 'Class');
                    return `
                    <div class="glass-card border border-white/40 p-4 sm:p-5 rounded-2xl flex items-center gap-4 sm:gap-5 shadow-sm active-scale transition-all duration-200">
                        <div class="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${colors[i % colors.length]}">
                            <span class="material-symbols-outlined text-base sm:text-lg" style="font-variation-settings:'FILL' 1">${icons[i % icons.length]}</span>
                        </div>
                        <div class="flex-1 min-w-0">
                            <p class="text-[9px] font-extrabold text-on-surface-variant/70 tracking-wider uppercase">${s.subjectCode || '--'}</p>
                            <h4 class="font-extrabold text-sm text-on-surface truncate" style="font-family:'Plus Jakarta Sans',sans-serif">${subjectDisplay}</h4>
                            <div class="flex flex-wrap items-center gap-x-3.5 gap-y-0.5 mt-1">
                                <div class="flex items-center gap-1 text-[10px] text-on-surface-variant">
                                    <span class="material-symbols-outlined text-xs text-slate-400" style="font-size:12px">meeting_room</span> <span>${s.room || '--'}</span>
                                </div>
                                <div class="flex items-center gap-1 text-[10px] text-on-surface-variant">
                                    <span class="material-symbols-outlined text-xs text-slate-400" style="font-size:12px">person</span> <span class="truncate max-w-[120px]">${s.facultyName || '--'}</span>
                                </div>
                                <div class="flex items-center gap-1 text-[10px] text-secondary font-extrabold">
                                    <span class="material-symbols-outlined text-xs" style="font-size:12px">schedule</span> <span>${timeVal}</span>
                                </div>
                            </div>
                        </div>
                        <div class="text-right flex-shrink-0">
                            <p class="text-[9px] font-bold text-on-surface-variant/70 uppercase">Period</p>
                            <p class="text-lg font-black text-secondary" style="font-family:'Plus Jakarta Sans',sans-serif">${periodVal}</p>
                        </div>
                    </div>`;
                }).join('');
            }

            const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
            // getDay(): 0=Sun,1=Mon,...,5=Fri,6=Sat
            const todayIndex = new Date().getDay(); // 1-6 = Mon-Sat
            let activeDay = (todayIndex >= 1 && todayIndex <= 6) ? days[todayIndex - 1] : 'Monday';
            renderDay(activeDay);

            // Activate correct tab
            document.querySelectorAll('.day-tab').forEach(btn => {
                const isActive = btn.dataset.day === activeDay;
                btn.className = `day-tab flex-shrink-0 px-5 py-2.5 rounded-full text-[11px] font-bold uppercase tracking-widest transition-all ${isActive ? 'bg-secondary text-on-secondary' : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'}`;
                btn.addEventListener('click', () => {
                    document.querySelectorAll('.day-tab').forEach(t => {
                        t.className = 'day-tab flex-shrink-0 px-5 py-2.5 rounded-full text-[11px] font-bold uppercase tracking-widest transition-all bg-surface-container text-on-surface-variant hover:bg-surface-container-high';
                    });
                    btn.className = 'day-tab flex-shrink-0 px-5 py-2.5 rounded-full text-[11px] font-bold uppercase tracking-widest transition-all bg-secondary text-on-secondary';
                    renderDay(btn.dataset.day);
                });
            });
        }
    },

    // ---- SYLLABUS ----
    syllabus: {
        render: () => `<body class="bg-background min-h-screen pb-32">
            <main class="pt-20 px-6 max-w-3xl mx-auto">
                <section class="mb-6">
                    <p class="text-[9px] font-bold uppercase tracking-[0.2em] text-on-surface-variant mb-1">Curriculum</p>
                    <h2 class="text-3xl font-extrabold tracking-tight text-on-surface" style="font-family:'Plus Jakarta Sans',sans-serif">Syllabus &amp; Units</h2>
                </section>
                <div class="space-y-4" id="syllabus-list">
                    ${[1,2,3].map(() => `<div class="h-24 bg-surface-container-low rounded-xl animate-pulse"></div>`).join('')}
                </div>
            </main>
        </body>`,
        afterRender: async () => {
            toggleShell(true);
            setActiveNav('syllabus');
            loading.show('Loading Syllabus...');
            try {
                const res = await api.get('/syllabus');
                const subjects = Array.isArray(res) ? res : (res.data || []);
                const el = $('syllabus-list');
                if (!el) return;
                if (subjects.length === 0) {
                    el.innerHTML = `<div class="text-center py-16 text-on-surface-variant font-bold">No syllabus data available.</div>`;
                    return;
                }
                el.innerHTML = subjects.map((sub, si) => {
                    const units = sub.syllabus || [];
                    const done = units.filter(u => u.completed).length;
                    const pct = units.length > 0 ? Math.round((done / units.length) * 100) : 0;
                    return `<div class="bg-surface-container-lowest rounded-xl border border-outline-variant/10 overflow-hidden shadow-sm">
                        <button class="w-full flex items-center justify-between p-5 hover:bg-surface-container-low transition-colors" onclick="toggleSyllabus('sub-${si}', this)">
                            <div class="flex items-center gap-4 min-w-0 flex-1">
                                <div class="w-10 h-10 rounded-xl bg-secondary-container flex items-center justify-center flex-shrink-0">
                                    <span class="material-symbols-outlined text-secondary text-sm">auto_stories</span>
                                </div>
                                <div class="text-left min-w-0 flex-1">
                                    <h4 class="font-bold text-on-surface text-sm truncate" style="font-family:'Plus Jakarta Sans',sans-serif" title="${sub.code || sub.name}">${sub.code || sub.name}</h4>
                                    <p class="text-[10px] text-on-surface-variant mt-0.5">${done}/${units.length} Units • <span id="syllabus-pct-${si}">${pct}% Done</span></p>
                                </div>
                            </div>
                            <span class="material-symbols-outlined text-on-surface-variant transition-transform" id="syllabus-arrow-${si}">expand_more</span>
                        </button>
                        <!-- Progress bar -->
                        <div class="px-5 pb-2">
                            <div class="w-full h-1 bg-surface-container-high rounded-full overflow-hidden">
                                <div class="h-full bg-secondary rounded-full transition-all duration-500" style="width:${pct}%" id="syllabus-bar-${si}"></div>
                            </div>
                        </div>
                        <!-- Units accordion -->
                        <div class="hidden border-t border-outline-variant/10 divide-y divide-outline-variant/10" id="sub-${si}">
                            ${units.map(u => `
                                <div class="flex items-center gap-4 px-5 py-3 hover:bg-surface-container-low transition-colors">
                                    <button class="unit-toggle w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all duration-200 hover:scale-105 flex-shrink-0 ${u.completed ? 'bg-secondary border-secondary text-on-secondary' : 'border-outline-variant text-transparent'}"
                                        data-unit-id="${u.id}" data-sub-idx="${si}" data-unit-idx="${units.indexOf(u)}"
                                        onclick="toggleUnit('${u.id}', ${si}, ${units.indexOf(u)}, this)">
                                        <span class="material-symbols-outlined text-sm" style="font-size:14px">check</span>
                                    </button>
                                    <div class="min-w-0 flex-1">
                                        <p class="text-[11px] font-bold text-on-surface-variant uppercase tracking-widest">Unit ${u.unitNumber}</p>
                                        <p class="text-sm font-semibold text-on-surface break-words">${u.title}</p>
                                    </div>
                                </div>`).join('')}
                        </div>
                    </div>`;
                }).join('');
            } catch(e) { console.error('[Syllabus] Error:', e); }
            finally { loading.hide(); }
        }
    },

    // ---- NOTIFICATIONS ----
    notifications: {
        render: () => `<body class="bg-background min-h-screen pb-32">
            <main class="pt-20 px-6 max-w-2xl mx-auto">
                <section class="mb-6 flex justify-between items-end">
                    <div>
                        <p class="text-[9px] font-bold uppercase tracking-[0.2em] text-on-surface-variant mb-1">Stay Updated</p>
                        <h2 class="text-3xl font-extrabold tracking-tight text-on-surface" style="font-family:'Plus Jakarta Sans',sans-serif">Notifications</h2>
                    </div>
                    <button id="mark-all-read-btn" class="text-xs font-bold text-secondary uppercase hover:underline flex items-center gap-1 active-scale">
                        <span class="material-symbols-outlined text-sm" style="font-size:14px">done_all</span> Mark All Read
                    </button>
                </section>

                <!-- Search Bar -->
                <div class="mb-5 relative">
                    <span class="material-symbols-outlined absolute left-3.5 top-2.5 text-on-surface-variant text-sm" style="font-size:16px">search</span>
                    <input type="text" id="notif-search" placeholder="Search notifications..." class="w-full pl-10 pr-4 py-2 bg-surface-container-low rounded-xl border border-outline-variant/15 text-xs text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:border-secondary transition-all" />
                </div>

                <!-- Filter tabs -->
                <div class="flex gap-2 overflow-x-auto pb-4 mb-4 hide-scrollbar select-none" id="notif-filters">
                    <button class="px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider bg-secondary text-white transition-all whitespace-nowrap active-scale" data-filter="all">All</button>
                    <button class="px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider bg-surface-container-low text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-all whitespace-nowrap active-scale" data-filter="attendance">Attendance</button>
                    <button class="px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider bg-surface-container-low text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-all whitespace-nowrap active-scale" data-filter="marks">Marks</button>
                    <button class="px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider bg-surface-container-low text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-all whitespace-nowrap active-scale" data-filter="fees">Fees</button>
                    <button class="px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider bg-surface-container-low text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-all whitespace-nowrap active-scale" data-filter="assignments">Assignments</button>
                    <button class="px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider bg-surface-container-low text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-all whitespace-nowrap active-scale" data-filter="timetable">Schedule</button>
                </div>

                <!-- Notification List -->
                <div class="space-y-3" id="notif-list">
                    <div class="h-20 bg-surface-container-low rounded-xl animate-pulse"></div>
                </div>
            </main>
        </body>`,
        afterRender: async () => {
            toggleShell(true);
            setActiveNav('notifications');
            
            const list = $('notif-list');
            const searchInput = $('notif-search');
            const filterContainer = $('notif-filters');
            const markAllReadBtn = $('mark-all-read-btn');

            let allNotifications = [];
            let activeFilter = 'all';
            let searchQuery = '';

            const getNotifVisuals = (type, category) => {
                let icon = 'notifications';
                let bg = 'bg-slate-500/10';
                let text = 'text-slate-600';
                switch (type) {
                    case 'attendance':
                        icon = 'calendar_today';
                        bg = category === 'alert' ? 'bg-red-500/10' : 'bg-emerald-500/10';
                        text = category === 'alert' ? 'text-red-500' : 'text-emerald-600';
                        break;
                    case 'marks':
                        icon = 'analytics';
                        bg = 'bg-amber-500/10';
                        text = 'text-amber-600';
                        break;
                    case 'fees':
                        icon = 'account_balance_wallet';
                        bg = category === 'success' ? 'bg-emerald-500/10' : 'bg-red-500/10';
                        text = category === 'success' ? 'text-emerald-600' : 'text-red-600';
                        break;
                    case 'assignments':
                        icon = 'assignment_turned_in';
                        bg = 'bg-blue-500/10';
                        text = 'text-blue-600';
                        break;
                    case 'timetable':
                        icon = 'schedule';
                        bg = 'bg-indigo-500/10';
                        text = 'text-indigo-600';
                        break;
                }
                return { icon, bg, text };
            };

            const renderNotifications = () => {
                if (!list) return;
                
                let filtered = allNotifications;
                
                // 1. Filter by tab
                if (activeFilter !== 'all') {
                    filtered = filtered.filter(n => n.type === activeFilter);
                }
                
                // 2. Filter by search query
                if (searchQuery) {
                    const q = searchQuery.toLowerCase();
                    filtered = filtered.filter(n => 
                        (n.title && n.title.toLowerCase().includes(q)) || 
                        (n.message && n.message.toLowerCase().includes(q))
                    );
                }

                if (filtered.length === 0) {
                    list.innerHTML = `
                        <div class="text-center py-16 text-on-surface-variant animate-reveal">
                            <span class="material-symbols-outlined text-5xl mb-4 block">notifications_none</span>
                            <p class="font-bold">No notifications found</p>
                            <p class="text-xs text-on-surface-variant/70 mt-1">Try changing your filter or search query.</p>
                        </div>`;
                    return;
                }

                list.innerHTML = filtered.map(n => {
                    const visuals = getNotifVisuals(n.type, n.category);
                    const route = n.metadata ? (typeof n.metadata === 'string' ? JSON.parse(n.metadata).route : n.metadata.route) : null;
                    const isRead = n.isRead || false;
                    let parsedMetadata = null;
                    try {
                        parsedMetadata = typeof n.metadata === 'string' ? JSON.parse(n.metadata) : n.metadata;
                    } catch (_) {}
                    const isWarning = parsedMetadata?.hallTicketBlockWarning === true || parsedMetadata?.hallTicketBlockWarning === 'true';
                    const warningBox = isWarning ? `
                        <div class="mt-2.5 p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs font-bold flex items-center gap-2 animate-reveal">
                            <span class="material-symbols-outlined text-sm font-bold">warning</span>
                            <span>⚠ Fee Due. Pay before Mid Examination. Hall Tickets may not be issued until dues are cleared.</span>
                        </div>
                    ` : '';

                    return `<div class="p-5 rounded-xl bg-surface-container-lowest border border-outline-variant/10 shadow-sm hover:shadow-md transition-all flex gap-4 justify-between items-start animate-reveal relative group cursor-pointer" 
                             data-id="\${n.id}" data-route="\${route || ''}" data-read="\${isRead}">
                            <div class="flex gap-4 min-w-0 flex-1 notif-card-click-area">
                                <div class="w-10 h-10 rounded-full \${visuals.bg} flex items-center justify-center flex-shrink-0 mt-0.5">
                                    <span class="material-symbols-outlined \${visuals.text} text-sm">\${visuals.icon}</span>
                                </div>
                                <div class="min-w-0 flex-1">
                                    <div class="flex items-center gap-2">
                                        <p class="font-bold text-on-surface text-sm truncate" title="\${n.title}">\${n.title}</p>
                                        \${!isRead ? \`<span class="w-2 h-2 bg-secondary rounded-full flex-shrink-0" id="unread-dot-\${n.id}"></span>\` : ''}
                                    </div>
                                    <p class="text-xs text-on-surface-variant mt-1 leading-relaxed break-words">\${n.message}</p>
                                    \${warningBox}
                                    <p class="text-[10px] text-on-surface-variant/60 mt-2 font-bold">\${n.date || '--'}</p>
                                </div>
                            </div>
                            <button class="delete-notif-btn p-1 text-slate-400 hover:text-red-500 hover:bg-slate-100 rounded-full flex items-center justify-center transition-all active-scale" data-id="\${n.id}">
                                <span class="material-symbols-outlined text-base">delete</span>
                            </button>
                        </div>`;
                }).join('');

                // Click handler for body click (navigation & read status)
                list.querySelectorAll('.notif-card-click-area').forEach(el => {
                    el.addEventListener('click', async (e) => {
                        const card = e.currentTarget.closest('[data-id]');
                        const notifId = card.dataset.id;
                        const route = card.dataset.route;
                        const read = card.dataset.read === 'true';

                        if (!read) {
                            card.dataset.read = 'true';
                            const dot = $('unread-dot-' + notifId);
                            if (dot) dot.remove();
                            
                            api.post('/notifications/read', { notificationId: notifId }).catch(() => {});
                            
                            const localNotif = allNotifications.find(n => n.id === notifId);
                            if (localNotif) localNotif.isRead = true;
                            SITAMDb.set('erp_cache', '/notifications', { notifications: allNotifications }, 24 * 60 * 60 * 1000).catch(() => {});
                            
                            updateUnreadBadge();
                        }

                        if (route) {
                            router.navigate(route);
                        }
                    });
                });

                // Delete handlers
                list.querySelectorAll('.delete-notif-btn').forEach(btn => {
                    btn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        const notifId = e.currentTarget.dataset.id;
                        
                        const card = e.currentTarget.closest('[data-id]');
                        if (card) {
                            card.classList.add('scale-90', 'opacity-0');
                            setTimeout(() => card.remove(), 200);
                        }

                        api.delete(`/notifications/${notifId}`).catch(() => {});

                        allNotifications = allNotifications.filter(n => n.id !== notifId);
                        SITAMDb.set('erp_cache', '/notifications', { notifications: allNotifications }, 24 * 60 * 60 * 1000).catch(() => {});

                        updateUnreadBadge();
                    });
                });
            };

            // 1. Stale-While-Revalidate: load cache first
            try {
                const cached = await SITAMDb.get('erp_cache', '/notifications', 24 * 60 * 60 * 1000);
                if (cached && cached.notifications) {
                    allNotifications = cached.notifications;
                    renderNotifications();
                }
            } catch (err) {
                console.warn('[Notifications] Cache read error:', err);
            }

            // 2. Load from server
            try {
                const res = await api.get('/notifications');
                const data = res.data || {};
                const notifications = data.notifications || [];
                
                allNotifications = notifications;
                await SITAMDb.set('erp_cache', '/notifications', { notifications }, 24 * 60 * 60 * 1000);
                renderNotifications();
            } catch (err) {
                console.error('[Notifications] Network fetch error:', err);
                if (allNotifications.length === 0) {
                    list.innerHTML = `<div class="text-center py-16 text-on-surface-variant font-bold">Failed to load notifications. Connection error.</div>`;
                }
            }

            // 3. Bind search input
            if (searchInput) {
                searchInput.addEventListener('input', (e) => {
                    searchQuery = e.target.value;
                    renderNotifications();
                });
            }

            // 4. Bind filters
            if (filterContainer) {
                filterContainer.querySelectorAll('[data-filter]').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        filterContainer.querySelectorAll('[data-filter]').forEach(b => {
                            b.className = "px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider bg-surface-container-low text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-all whitespace-nowrap active-scale";
                        });
                        e.currentTarget.className = "px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider bg-secondary text-white transition-all whitespace-nowrap active-scale";
                        activeFilter = e.currentTarget.dataset.filter;
                        renderNotifications();
                    });
                });
            }

            // 5. Bind mark all read
            if (markAllReadBtn) {
                markAllReadBtn.addEventListener('click', async () => {
                    haptic();
                    allNotifications.forEach(n => n.isRead = true);
                    renderNotifications();

                    api.post('/notifications/read-all').catch(() => {});

                    SITAMDb.set('erp_cache', '/notifications', { notifications: allNotifications }, 24 * 60 * 60 * 1000).catch(() => {});

                    updateUnreadBadge();
                });
            }
        }
    },

    // ---- EXAMS ----
    exams: {
        render: () => `<body class="bg-background min-h-screen pb-32">
            <main class="pt-20 px-6 max-w-3xl mx-auto">
                <section class="mb-6">
                    <p class="text-[9px] font-bold uppercase tracking-[0.2em] text-on-surface-variant mb-1">Academic Controller</p>
                    <h2 class="text-3xl font-extrabold tracking-tight text-on-surface" style="font-family:'Plus Jakarta Sans',sans-serif">Exams Schedule</h2>
                </section>
                <div class="space-y-4" id="exams-container">
                    <div class="h-24 bg-surface-container-low rounded-xl animate-pulse"></div>
                </div>
            </main>
        </body>`,
        afterRender: async () => {
            toggleShell(true);
            setActiveNav('exams');
            loading.show('Loading Exams Timetable...');
            try {
                const res = await api.get('/exams');
                const container = $('exams-container');
                if (!container) return;
                
                const data = res.data || {};
                const schedules = data.schedules || [];
                
                if (schedules.length === 0) {
                    container.innerHTML = `<div class="text-center py-16 text-on-surface-variant font-bold">No exam schedules parsed.</div>`;
                    return;
                }
                
                container.innerHTML = `
                    <div class="bg-white/70 backdrop-blur-xl border border-white/60 p-5 rounded-2xl shadow-sm mb-6 flex items-center gap-4">
                        <div class="w-12 h-12 rounded-full bg-secondary-container flex items-center justify-center flex-shrink-0">
                            <span class="material-symbols-outlined text-secondary text-2xl">description</span>
                        </div>
                        <div class="min-w-0 flex-1">
                            <h4 class="font-extrabold text-on-surface text-sm truncate" title="${data.examName || 'University Examinations'}">${data.examName || 'University Examinations'}</h4>
                            <p class="text-[10px] text-on-surface-variant mt-0.5">Academic Session: ${data.academicYear || '2025-2026'}</p>
                        </div>
                    </div>
                    <div class="space-y-3">
                        ${schedules.map(sch => `
                            <div class="bg-surface-container-lowest border border-outline-variant/10 p-5 rounded-xl flex items-center gap-5 shadow-sm hover:shadow-md transition-all">
                                <div class="w-12 h-12 rounded-2xl bg-tertiary-container/30 text-tertiary flex items-center justify-center flex-shrink-0">
                                    <span class="material-symbols-outlined" style="font-variation-settings:'FILL' 1">feed</span>
                                </div>
                                <div class="flex-1 min-w-0">
                                    <p class="text-[10px] font-bold text-on-surface-variant tracking-wider uppercase">${sch.subjectCode} • ${sch.type}</p>
                                    <h4 class="font-bold text-on-surface truncate" style="font-family:'Plus Jakarta Sans',sans-serif">${sch.subjectName}</h4>
                                    <div class="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1">
                                        <div class="flex items-center gap-1 text-[11px] text-on-surface-variant">
                                            <span class="material-symbols-outlined text-xs">meeting_room</span> ${sch.hall}
                                        </div>
                                        <div class="flex items-center gap-1 text-[11px] text-on-surface-variant">
                                            <span class="material-symbols-outlined text-xs">chair</span> Seat: ${sch.seatNumber}
                                        </div>
                                        <div class="flex items-center gap-1 text-[11px] text-secondary font-bold">
                                            <span class="material-symbols-outlined text-xs">calendar_today</span> ${sch.date}
                                        </div>
                                    </div>
                                </div>
                            </div>`).join('')}
                    </div>`;
            } catch(e) { 
                console.error('[Exams] Error:', e); 
                $('exams-container').innerHTML = `<div class="text-center py-16 text-on-surface-variant font-bold">Failed to load exam schedules.</div>`;
            } finally { 
                loading.hide(); 
            }
        }
    },
    privacy: {
        render: () => `<body class="bg-background min-h-screen pb-32">
            <main class="pt-20 px-6 max-w-2xl mx-auto space-y-6">
                <section>
                    <p class="text-[9px] font-bold uppercase tracking-[0.2em] text-secondary mb-1">LEGAL DECLARATIONS</p>
                    <h2 class="text-3xl font-extrabold tracking-tight text-on-surface" style="font-family:'Plus Jakarta Sans',sans-serif">Privacy Policy</h2>
                </section>
                <div class="glass-card p-6 rounded-2xl border border-white/55 space-y-4 text-xs text-slate-600 leading-relaxed shadow-sm">
                    <p class="font-bold text-slate-800 text-sm">Last Updated: June 2026</p>
                    <p>SITAM College (“we,” “our,” or “us”) operates the SITAM Smart ERP student campus mobile application. We are committed to protecting the privacy of our students and securing their academic records.</p>
                    
                    <h3 class="font-bold text-slate-800 text-sm mt-4">1. Information We Collect</h3>
                    <p>The application retrieves and displays academic and administrative records from the university Satya ERP portal, including student profile data, attendance sheets, marks transcripts, fee ledgers, exam seat maps, and campus announcements.</p>
                    
                    <h3 class="font-bold text-slate-800 text-sm mt-4">2. Device Access & Permissions</h3>
                    <p>To deliver modern campus utility features, the application requests access to local storage for caching and network alerts, and registers notification tokens via Firebase Cloud Messaging (FCM) to deliver critical real-time announcements.</p>
                    
                    <h3 class="font-bold text-slate-800 text-sm mt-4">3. Data Integrity & Storage</h3>
                    <p>Authentication tokens and local student session credentials are encrypted locally on the device sandbox. Data is cached locally on the device using secure, encrypted preferences storage to allow seamless offline access.</p>
                    
                    <h3 class="font-bold text-slate-800 text-sm mt-4">4. Compliance & Contact</h3>
                    <p>For inquiries regarding data deletion or privacy disputes, please contact the SITAM University Academic Office at support@sitamecap.co.in.</p>
                </div>
            </main>
        </body>`,
        afterRender: () => {
            toggleShell(true);
            setActiveNav('privacy');
        }
    },
    terms: {
        render: () => `<body class="bg-background min-h-screen pb-32">
            <main class="pt-20 px-6 max-w-2xl mx-auto space-y-6">
                <section>
                    <p class="text-[9px] font-bold uppercase tracking-[0.2em] text-secondary mb-1">LEGAL DECLARATIONS</p>
                    <h2 class="text-3xl font-extrabold tracking-tight text-on-surface" style="font-family:'Plus Jakarta Sans',sans-serif">Terms of Service</h2>
                </section>
                <div class="glass-card p-6 rounded-2xl border border-white/55 space-y-4 text-xs text-slate-600 leading-relaxed shadow-sm">
                    <p class="font-bold text-slate-800 text-sm">Last Updated: June 2026</p>
                    <p>Welcome to the official SITAM Smart ERP platform. By accessing or using this application, you agree to comply with the terms set forth by the college administration.</p>
                    
                    <h3 class="font-bold text-slate-800 text-sm mt-4">1. Permitted Use</h3>
                    <p>This portal is intended solely for registered students of SITAM College. You may not sharing credentials, automate scraping via unauthorized tools, or attempt to compromise app security.</p>
                    
                    <h3 class="font-bold text-slate-800 text-sm mt-4">2. Account Responsibility</h3>
                    <p>Students are solely responsible for all sessions authenticated under their student ID credentials. Report any unauthorized access immediately to college administration.</p>
                    
                    <h3 class="font-bold text-slate-800 text-sm mt-4">3. Data Accuracy</h3>
                    <p>While the app syncs record values in real-time from the Satya ERP portal, the official university registrar ledger remains the final authority for grade sheets and due statement settlements.</p>
                </div>
            </main>
        </body>`,
        afterRender: () => {
            toggleShell(true);
            setActiveNav('terms');
        }
    }
};

// ============================================================
// GLOBAL SYLLABUS HELPERS
// ============================================================
function toggleSyllabus(id, btn) {
    const panel = $(id);
    const idx = id.split('-')[1];
    const arrow = $(`syllabus-arrow-${idx}`);
    if (!panel) return;
    const isHidden = panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !isHidden);
    if (arrow) arrow.style.transform = isHidden ? 'rotate(180deg)' : '';
}

async function toggleUnit(unitId, subIdx, unitIdx, btn) {
    const isNowCompleted = btn.classList.contains('border-outline-variant');
    btn.className = isNowCompleted
        ? 'unit-toggle w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all duration-200 hover:scale-105 flex-shrink-0 bg-secondary border-secondary text-on-secondary'
        : 'unit-toggle w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all duration-200 hover:scale-105 flex-shrink-0 border-outline-variant text-transparent';

    try {
        await api.post('/syllabus/unit', { unitId, completed: isNowCompleted });
        // Update progress bar
        const panel = document.getElementById(`sub-${subIdx}`);
        if (panel) {
            const allToggles = panel.querySelectorAll('.unit-toggle');
            const done = Array.from(allToggles).filter(t => t.classList.contains('bg-secondary')).length;
            const total = allToggles.length;
            const pct = total > 0 ? Math.round((done / total) * 100) : 0;
            const bar = $(`syllabus-bar-${subIdx}`);
            const pctEl = $(`syllabus-pct-${subIdx}`);
            if (bar) bar.style.width = `${pct}%`;
            if (pctEl) pctEl.innerText = `${pct}% Done`;
        }
        // Invalidate syllabus cache
        localStorage.removeItem(getCacheKey('/syllabus'));
    } catch(e) {
        // Rollback
        btn.className = isNowCompleted
            ? 'unit-toggle w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all duration-200 hover:scale-105 flex-shrink-0 border-outline-variant text-transparent'
            : 'unit-toggle w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all duration-200 hover:scale-105 flex-shrink-0 bg-secondary border-secondary text-on-secondary';
        console.error('Failed to update syllabus unit', e);
    }
}

// ============================================================
// ROUTER  — keepAlive DOM cache + LRU (max 5 pages) + GPU transitions
// ============================================================

// Pages that are kept alive in the DOM (never destroyed on navigation)
const KEEP_ALIVE_PAGES = new Set(['dashboard', 'attendance', 'marks', 'fees', 'timetable']);
const KEEP_ALIVE_MAX   = 5;  // LRU limit — evict oldest if exceeded

// LRU Map: preserves insertion order, oldest first
// Each entry: { node: HTMLElement, route: string, lastAccess: number }
const _pageCache = new Map();

function _evictLRUPage() {
    if (_pageCache.size <= KEEP_ALIVE_MAX) return;
    // Find the oldest accessed entry
    let oldestKey = null, oldestTime = Infinity;
    _pageCache.forEach((entry, key) => {
        if (entry.lastAccess < oldestTime) { oldestTime = entry.lastAccess; oldestKey = key; }
    });
    if (oldestKey) {
        const evicted = _pageCache.get(oldestKey);
        if (evicted?.node?.parentNode) evicted.node.parentNode.removeChild(evicted.node);
        _pageCache.delete(oldestKey);
        console.log(`[Router] LRU evicted: ${oldestKey}`);
    }
}

const router = {
    app: document.getElementById('app'),
    scrollPositions: {},
    currentRoute: null,
    _isBackNavigation: false,

    navigate(hash) { window.location.hash = hash; },

    // ── Unified goBack: single authority for all back actions ──────────────
    goBack() {
        haptic();
        // 1. Close drawer
        const drawer = $('nav-drawer');
        if (drawer && !drawer.classList.contains('-translate-x-full')) {
            closeDrawer(); return;
        }
        // 2. Close payment overlay
        const overlay = $('payment-overlay');
        if (overlay && !overlay.classList.contains('hidden')) {
            if (state.paymentTimeout) clearTimeout(state.paymentTimeout);
            overlay.classList.remove('opacity-100');
            setTimeout(() => overlay.classList.add('hidden'), 300);
            return;
        }
        // 3. Navigate history
        if (state.navHistory && state.navHistory.length > 1) {
            state.navHistory.pop();
            const prev = state.navHistory[state.navHistory.length - 1];
            this._isBackNavigation = true;
            this.navigate(prev);
            return;
        }
        // 4. Double-press to exit
        const now = Date.now();
        if (state._lastBackPress && (now - state._lastBackPress < 2000)) {
            window.Capacitor?.Plugins?.App?.exitApp();
        } else {
            state._lastBackPress = now;
            showToast('Press back again to exit', 'info', 2000);
        }
    },

    get routes() {
        return {
            '/login': pages.login,
            '/dashboard': pages.dashboard,
            '/attendance': pages.attendance,
            '/marks': pages.marks,
            '/fees': pages.fees,
            '/profile': pages.profile,
            '/syllabus': pages.syllabus,
            '/timetable': pages.timetable,
            '/assignments': pages.assignments,
            '/notifications': pages.notifications,
            '/exams': pages.exams,
            '/maintenance': pages.maintenance
        };
    },

    handle() {
        let hash = (window.location.hash || '').replace('#', '') || '/login';
        if (hash.includes('sitam://')) hash = hash.replace('sitam://', '');
        if (!hash.startsWith('/')) hash = '/' + hash;

        if (state.maintenance?.active && hash !== '/maintenance') {
            return this.navigate('/maintenance');
        }
        if (!state.token && hash !== '/login' && hash !== '/maintenance') return this.navigate('/login');
        if (state.token && hash === '/login') return this.navigate('/dashboard');

        // Save scroll position of the route being LEFT
        if (this.currentRoute) {
            this.scrollPositions[this.currentRoute] = window.scrollY;
        }

        // ── Navigation history ─────────────────────────────────────────────
        if (hash !== '/login' && !this._isBackNavigation) {
            if (!state.navHistory) state.navHistory = [];
            if (state.navHistory[state.navHistory.length - 1] !== hash) {
                state.navHistory.push(hash);
            }
        }
        const wasBack = this._isBackNavigation;
        this._isBackNavigation = false;

        this.currentRoute = hash;
        const route = hash.slice(1) || 'dashboard';
        const page  = pages[route] || pages.dashboard;
        closeDrawer();
        setActiveNav(route);

        // Native StatusBar
        if (window.Capacitor?.Plugins?.StatusBar) {
            const { StatusBar } = window.Capacitor.Plugins;
            StatusBar.setStyle({ style: 'LIGHT' }).catch(() => {});
            StatusBar.setBackgroundColor({ color: '#faf9fc' }).catch(() => {});
        }

        const isKeepAlive = KEEP_ALIVE_PAGES.has(route);

        if (isKeepAlive) {
            // ── keepAlive path: swap DOM nodes, no innerHTML destroy ──────────
            // Hide all cached pages
            _pageCache.forEach(entry => { if (entry.node) entry.node.style.display = 'none'; });

            if (_pageCache.has(route)) {
                // ── CACHE HIT: instant restore <5ms ──────────────────────────
                const cached = _pageCache.get(route);
                cached.lastAccess = Date.now();
                cached.node.style.display = '';

                // GPU animation: reveal from cache
                cached.node.classList.remove('page-enter-forward', 'page-enter-back', 'page-reveal');
                void cached.node.offsetWidth; // Force reflow before animating
                cached.node.classList.add('page-reveal');
                cached.node.addEventListener('animationend', () =>
                    cached.node.classList.remove('page-reveal'), { once: true });

                setActiveNav(route);

                // Restore scroll
                const savedPos = this.scrollPositions[hash] || 0;
                requestAnimationFrame(() => window.scrollTo(0, savedPos));

                // Silent background revalidation — data, not DOM
                page.revalidate?.();
            } else {
                // ── CACHE MISS: first render, create and cache DOM node ───────
                const node = document.createElement('div');
                node.className = 'sitam-page-node';
                node.innerHTML = page.render();
                this.app.appendChild(node);
                _pageCache.set(route, { node, lastAccess: Date.now() });

                // GPU transition
                const animClass = wasBack ? 'page-enter-back' : 'page-enter-forward';
                node.classList.add(animClass);
                node.addEventListener('animationend', () =>
                    node.classList.remove(animClass), { once: true });

                // Evict if over LRU limit
                _evictLRUPage();

                if (page.afterRender) page.afterRender();
                const savedPos = this.scrollPositions[hash] || 0;
                requestAnimationFrame(() => window.scrollTo(0, savedPos));
            }
        } else {
            // ── Non-cached pages: full re-render (login, profile, syllabus, etc.) ──
            // Clear any keepAlive nodes visibility
            _pageCache.forEach(entry => { if (entry.node) entry.node.style.display = 'none'; });

            // Create a fresh non-cached container that overlays the app
            let nonCachedNode = this.app.querySelector('.sitam-page-non-cached');
            if (!nonCachedNode) {
                nonCachedNode = document.createElement('div');
                nonCachedNode.className = 'sitam-page-non-cached';
                this.app.appendChild(nonCachedNode);
            }
            nonCachedNode.style.display = '';
            nonCachedNode.innerHTML = page.render();

            // GPU transition
            const animClass = wasBack ? 'page-enter-back' : 'page-enter-forward';
            nonCachedNode.classList.remove('page-enter-forward', 'page-enter-back');
            void nonCachedNode.offsetWidth;
            nonCachedNode.classList.add(animClass);
            nonCachedNode.addEventListener('animationend', () =>
                nonCachedNode.classList.remove(animClass), { once: true });

            if (page.afterRender) page.afterRender();
            const savedPos = this.scrollPositions[hash] || 0;
            requestAnimationFrame(() => window.scrollTo(0, savedPos));
        }
    }
};

// ============================================================
// SHELL EVENT WIRING
// ============================================================
document.addEventListener('DOMContentLoaded', () => {

    // ── Navigation links — with haptic feedback ─────────────────────────────
    document.querySelectorAll('[data-nav-link]').forEach(el => {
        el.addEventListener('click', e => {
            e.preventDefault();
            haptic();
            closeDrawer();
            router.navigate('/' + el.dataset.navLink);
        });
    });

    // Drawer controls
    $('menu-btn')?.addEventListener('click', openDrawer);
    $('drawer-overlay')?.addEventListener('click', closeDrawer);
    $('close-drawer-btn')?.addEventListener('click', closeDrawer);
    $('drawer-logout-btn')?.addEventListener('click', () => api.logout());

    // Sync button (manual force-refresh)
    $('sync-btn')?.addEventListener('click', async () => {
        if (!state.token) return;
        try {
            await api.request('/sync', { method: 'GET' });
            clearUserCache();
            // Evict all keepAlive page caches so they re-render with fresh data
            _pageCache.forEach(entry => {
                if (entry.node?.parentNode) entry.node.parentNode.removeChild(entry.node);
            });
            _pageCache.clear();
            router.handle();
        } catch(e) { console.error('Sync failed:', e); }
    });

    // Connectivity Status alert handlers
    const handleConnectivityChange = () => {
        const offlineBanner = $('offline-banner');
        if (!offlineBanner) return;
        if (navigator.onLine) {
            offlineBanner.classList.add('-translate-y-full');
        } else {
            offlineBanner.classList.remove('-translate-y-full');
        }
    };
    window.addEventListener('online', handleConnectivityChange);
    window.addEventListener('offline', handleConnectivityChange);
    handleConnectivityChange();

    // ── Pull-to-refresh gesture ─────────────────────────────────────────────
    (() => {
        let _ptrStartY = 0;
        let _ptrActive = false;
        const PTR_THRESHOLD = 72; // px drag before triggering refresh

        // Inject spinner element
        if (!$('ptr-spinner')) {
            const spinner = document.createElement('div');
            spinner.id = 'ptr-spinner';
            spinner.innerHTML = '<div class="ptr-ring"></div><span>Refreshing</span>';
            document.body.appendChild(spinner);
        }

        document.addEventListener('touchstart', (e) => {
            if (window.scrollY === 0) { _ptrStartY = e.touches[0].clientY; _ptrActive = true; }
        }, { passive: true });

        document.addEventListener('touchmove', (e) => {
            if (!_ptrActive) return;
            const delta = e.touches[0].clientY - _ptrStartY;
            if (delta > PTR_THRESHOLD) {
                const chip = $('ptr-spinner');
                if (chip) chip.classList.add('visible');
            }
        }, { passive: true });

        document.addEventListener('touchend', async () => {
            if (!_ptrActive) return;
            _ptrActive = false;
            const chip = $('ptr-spinner');
            if (chip && chip.classList.contains('visible')) {
                haptic();
                // Revalidate current page data
                const route = (router.currentRoute || '').slice(1) || 'dashboard';
                const page  = pages[route];
                if (page) {
                    // For keepAlive pages: just call revalidate if available, else afterRender
                    if (KEEP_ALIVE_PAGES.has(route)) {
                        page.revalidate ? page.revalidate() : page.afterRender?.();
                    } else {
                        page.afterRender?.();
                    }
                }
                // Refresh last-synced display after pulling
                setTimeout(() => {
                    chip.classList.remove('visible');
                    _updateLastSyncedChip();
                }, 1400);
            }
        });
    })();

    // ── Edge swipe back gesture (left-edge → router.goBack()) ──────────────
    (() => {
        let _swipeStartX = 0;
        let _swipeStartY = 0;
        document.addEventListener('touchstart', (e) => {
            if (e.touches[0].clientX < 32) {
                _swipeStartX = e.touches[0].clientX;
                _swipeStartY = e.touches[0].clientY;
            } else {
                _swipeStartX = 0;
            }
        }, { passive: true });
        document.addEventListener('touchend', (e) => {
            if (_swipeStartX === 0) return;
            const dx = e.changedTouches[0].clientX - _swipeStartX;
            const dy = Math.abs(e.changedTouches[0].clientY - _swipeStartY);
            if (dx > 60 && dy < 80) {
                // Horizontal swipe from left edge — treat as back
                router.goBack();
            }
            _swipeStartX = 0;
        }, { passive: true });
    })();

    // ── Capacitor Native Android Back Button & Deep Links ──────────────────
    if (window.Capacitor) {
        const { App } = window.Capacitor.Plugins;
        if (App) {
            App.addListener('appUrlOpen', (event) => {
                console.log('[Capacitor] Deep link received:', event.url);
                const url = event.url || '';
                let route = '';
                if (url.includes('sitam://'))         route = url.split('sitam://')[1];
                else if (url.includes('#sitam://'))   route = url.split('#sitam://')[1];
                else if (url.includes('/#'))           route = url.split('/#')[1];
                if (route) {
                    if (!route.startsWith('/')) route = '/' + route;
                    router.navigate(route);
                }
            });

            // ── UNIFIED backButton → router.goBack() ──────────────────────────
            App.addListener('backButton', () => router.goBack());
        }
    }

    // ── Last-synced chip refresh timer ──────────────────────────────────────
    setInterval(_updateLastSyncedChip, 30 * 1000);

    // ── SITAM Splash Controller & Session Bootstrapping ────────────────────
    const progressBar = $('splash-progress-bar');
    if (progressBar) {
        setTimeout(() => { progressBar.style.width = '40%'; }, 50);
    }

    secureStorage.bootstrap().then(() => {
        state.token = secureStorage.getItem('token') || null;
        if (progressBar) progressBar.style.width = '100%';

        setTimeout(() => {
            const splash = $('sitam-splash');
            if (splash) {
                splash.classList.add('opacity-0', 'pointer-events-none');
                setTimeout(() => splash.remove(), 700);
            }
            router.handle();
            checkSyncStatus();
            // Prefetch immediately if already logged in (returning user)
            if (state.token) {
                prefetchAll().catch(() => {});
            }
        }, 1000);
    }).catch(err => {
        console.error('[Boot] secureStorage bootstrap failed:', err);
        router.handle();
        checkSyncStatus();
    });

    window.addEventListener('hashchange', () => router.handle());
});
