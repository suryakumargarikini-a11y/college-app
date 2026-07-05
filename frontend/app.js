// ============================================================
// SITAM SMART CAMPUS ERP — Complete SPA
// Matches Stitch UI design exactly, all modules functional
// ============================================================

const PRODUCTION_API = 'https://college-app-bx6b.onrender.com/api';
const isMobileNative = window.Capacitor && window.Capacitor.platform !== 'web';
const API_BASE = isMobileNative ? PRODUCTION_API : (window.API_BASE_URL || PRODUCTION_API);

let _decryptedToken = null;

// Native Logcat Boot Logger Helper with Queue and Polling
const bootLogQueue = [];
function logBoot(msg) {
    console.log(msg);
    if (window.Capacitor?.Plugins?.SecureKeystore?.logBoot) {
        window.Capacitor.Plugins.SecureKeystore.logBoot({ message: msg }).catch(() => {});
    } else {
        bootLogQueue.push(msg);
    }
}

function flushBootLogs() {
    if (window.Capacitor?.Plugins?.SecureKeystore?.logBoot) {
        while (bootLogQueue.length > 0) {
            const msg = bootLogQueue.shift();
            window.Capacitor.Plugins.SecureKeystore.logBoot({ message: msg }).catch(() => {});
        }
    }
}

const bootLoggerInterval = setInterval(() => {
    if (window.Capacitor?.Plugins?.SecureKeystore?.logBoot) {
        clearInterval(bootLoggerInterval);
        flushBootLogs();
    }
}, 30);
setTimeout(() => clearInterval(bootLoggerInterval), 5000);

logBoot("BOOT 1 - Script loaded / initializing globals");

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
        console.log('[Boot - secureStorage] Starting bootstrap...');
        try {
            const scrambledKey = this._scramble('token');
            console.log('[Boot - secureStorage] Scrambled key:', scrambledKey);
            let rawData = localStorage.getItem(scrambledKey);
            console.log('[Boot - secureStorage] localStorage token value exists:', !!rawData);
            
            // Mirror check from Capacitor Preferences sandbox
            if (!rawData && window.Capacitor?.Plugins?.Preferences) {
                console.log('[Boot - secureStorage] Awaiting Preferences.get...');
                try {
                    const res = await window.Capacitor.Plugins.Preferences.get({ key: scrambledKey });
                    console.log('[Boot - secureStorage] Preferences.get finished successfully. Value exists:', !!res?.value);
                    if (res && res.value) {
                        rawData = res.value;
                    }
                } catch (prefErr) {
                    console.error('[Boot - secureStorage] Preferences.get failed:', prefErr);
                }
            }

            if (!rawData) {
                console.log('[Boot - secureStorage] No raw data found, boot as anonymous/empty session');
                _decryptedToken = null;
                return;
            }

            // Step 1: Unscramble the secondary obfuscation layer
            console.log('[Boot - secureStorage] Unscrambling payload...');
            const jsonStr = this._unscramble(rawData);
            if (!jsonStr) {
                console.log('[Boot - secureStorage] Unscrambling returned empty string');
                return;
            }
            const payload = JSON.parse(jsonStr);
            console.log('[Boot - secureStorage] Payload successfully parsed, ciphertext exists:', !!payload.ciphertext, 'data exists:', !!payload.data);

            // Step 2: Decrypt using primary hardware/software crypt layer
            if (window.Capacitor?.Plugins?.SecureKeystore && payload.ciphertext && payload.iv) {
                console.log('[Boot - secureStorage] SecureKeystore plugin detected. Awaiting decrypt...');
                try {
                    const decRes = await window.Capacitor.Plugins.SecureKeystore.decrypt({
                        ciphertext: payload.ciphertext,
                        iv: payload.iv
                    });
                    console.log('[Boot - secureStorage] SecureKeystore decryption succeeded');
                    _decryptedToken = decRes.value;
                } catch (keystoreErr) {
                    console.error('[Boot - secureStorage] KeyStore decrypt failed (key deleted/reinstall?) — clearing stale token:', keystoreErr.message);
                    localStorage.removeItem(scrambledKey);
                    if (window.Capacitor?.Plugins?.Preferences) {
                        console.log('[Boot - secureStorage] Awaiting Preferences.remove...');
                        await window.Capacitor.Plugins.Preferences.remove({ key: scrambledKey }).catch(() => {});
                        console.log('[Boot - secureStorage] Preferences.remove finished');
                    }
                    _decryptedToken = null;
                }
            } else if (payload.data && payload.iv) {
                console.log('[Boot - secureStorage] WebCrypto fallback data detected. Starting decryption...');
                // WebCrypto fallback for local/browser environments
                let keyRaw = localStorage.getItem('_secure_entropy');
                if (keyRaw && keyRaw.length !== 32) {
                    localStorage.removeItem('_secure_entropy');
                    keyRaw = null;
                }
                if (keyRaw) {
                    console.log('[Boot - secureStorage] Entropy key loaded. Importing WebCrypto key...');
                    const keyBuf = new TextEncoder().encode(keyRaw);
                    const cryptoKey = await crypto.subtle.importKey(
                        'raw', keyBuf, { name: 'AES-GCM', length: 256 }, false, ['decrypt']
                    );
                    console.log('[Boot - secureStorage] Key imported successfully. Decrypting...');
                    const iv = new Uint8Array(atob(payload.iv).split('').map(c => c.charCodeAt(0)));
                    const ciphertext = new Uint8Array(atob(payload.data).split('').map(c => c.charCodeAt(0)));
                    const decrypted = await crypto.subtle.decrypt(
                        { name: 'AES-GCM', iv }, cryptoKey, ciphertext
                    );
                    _decryptedToken = new TextDecoder().decode(decrypted);
                    console.log('[Boot - secureStorage] WebCrypto decryption succeeded');
                } else {
                    console.log('[Boot - secureStorage] No entropy key found for WebCrypto decryption');
                }
            } else {
                console.log('[Boot - secureStorage] Payload contains unscrambled raw value');
                _decryptedToken = jsonStr;
            }
        } catch (err) {
            console.error('[secureStorage] Bootstrap failed with exception:', err);
            _decryptedToken = null;
        } finally {
            console.log('[Boot - secureStorage] Bootstrap completed');
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
    _lastBackPress: 0,
    isOnline: true
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

// --- Prefetch Engine: sequential priority-grouped warm-up after login --------
//
// WHY sequential groups instead of Promise.allSettled(all):
//   Firing 8 requests simultaneously from a mobile device on a shared NAT can
//   consume the IP rate-limit bucket instantly and 429-block all peers.
//   Sequential groups with a 150ms gap between them spread load over ~600ms
//   while still completing the full warm-up in under 2 seconds.
//
// Priority order (highest → lowest):
//   Group 1 — profile      (needed for greeting, drawer, WebSocket userId)
//   Group 2 — attendance, marks, fees  (dashboard hero metrics)
//   Group 3 — timetable, assignments, notifications  (secondary dashboard)
//   Group 4 — exams        (tertiary, rarely visible on dashboard)
//
// Deduplication: a singleton _prefetchInFlight promise prevents the boot
// re-prefetch (state.token already set) from doubling up with the post-login
// prefetch that fires within milliseconds of each other.

let _prefetchInFlight = null;

async function prefetchAll() {
    // Return the existing in-flight promise so callers share a single warm-up
    if (_prefetchInFlight) return _prefetchInFlight;

    const _doFetch = async (ep) => {
        try {
            // Use _inflight dedup so dashboard api.get() calls that fire
            // concurrently share the same network request.
            if (_inflight[ep]) return await _inflight[ep];
            // Route through RequestQueue with dynamic priority matching
            const promise = RequestQueue.enqueue(
                () => api.request(ep),
                ep
            ).then(data => {
                // Persist with the correct per-endpoint TTL (not a flat 10 min)
                SITAMDb.set('erp_cache', ep, data, getTTL(ep)).catch(() => {});
                return data;
            }).catch(() => {}).finally(() => { delete _inflight[ep]; });
            _inflight[ep] = promise;
            return await promise;
        } catch { /* silent — offline or stale is acceptable */ }
    };

    _prefetchInFlight = (async () => {
        console.log('[Prefetch] Starting sequential warm-up (4 priority groups)...');

        // Group 1 — profile: needed immediately for greeting + WebSocket
        await _doFetch('/profile');

        await new Promise(r => setTimeout(r, 150));

        // Group 2 — dashboard hero metrics
        for (const ep of ['/attendance', '/marks', '/fees']) {
            await _doFetch(ep);
            await new Promise(r => setTimeout(r, 80));
        }

        await new Promise(r => setTimeout(r, 150));

        // Group 3 — secondary dashboard widgets
        for (const ep of ['/timetable', '/assignments', '/notifications']) {
            await _doFetch(ep);
            await new Promise(r => setTimeout(r, 80));
        }

        await new Promise(r => setTimeout(r, 150));

        // Group 4 — tertiary
        await _doFetch('/exams');

        // Record prefetch timestamp → feeds 'last synced' chip
        SITAMDb.set('session', 'last_synced', Date.now(), 7 * 24 * 60 * 60 * 1000).catch(() => {});
        _updateLastSyncedChip();
        console.log('[Prefetch] Sequential warm-up complete.');
    })();

    // Clear the singleton once done so the next explicit refresh works
    _prefetchInFlight.finally(() => { _prefetchInFlight = null; });

    return _prefetchInFlight;
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

// ─── Per-Endpoint Cache TTL Map ─────────────────────────────────────────────
// Controls how long each endpoint's response is considered fresh in IndexedDB.
// Longer TTLs reduce network traffic for rarely-changing data (timetable);
// shorter TTLs ensure time-sensitive data (notifications, exit passes) stays current.
const EP_TTL = {
    '/profile':          5 * 60 * 1000,   //  5 min  — name/branch/year rarely change
    '/attendance':       5 * 60 * 1000,   //  5 min  — updates after faculty marks
    '/marks':           10 * 60 * 1000,   // 10 min  — updated per exam cycle
    '/fees':            10 * 60 * 1000,   // 10 min  — updated after payment
    '/timetable':       30 * 60 * 1000,   // 30 min  — changes only with schedule edits
    '/notifications':    1 * 60 * 1000,   //  1 min  — near-realtime; backed by WebSocket
    '/placements':       5 * 60 * 1000,   //  5 min  — new drives are infrequent
    '/exit-passes/my':  30 * 1000,        // 30 sec  — status changes quickly after approval
    '/surveys':          5 * 60 * 1000,   //  5 min
    '/assignments':      5 * 60 * 1000,   //  5 min
    '/exams':           10 * 60 * 1000,   // 10 min
    '/syllabus':        30 * 60 * 1000,   // 30 min
    '/lost-found':       5 * 60 * 1000,   //  5 min
};
// Default TTL for any endpoint not listed above
const DEFAULT_TTL = 5 * 60 * 1000;
function getTTL(ep) { return EP_TTL[ep] ?? DEFAULT_TTL; }

// ─── Request Queue Priority Levels ───────────────────────────────────────────
const EP_PRIORITY = {
    '/profile':          3, // High: core identification
    '/attendance':       3, // High: status display
    '/fees':            3, // High: outstanding dues / alerts
    '/marks':           2, // Medium: grades
    '/timetable':       2, // Medium: calendar
    '/assignments':     2, // Medium: homework
    '/notifications':    1, // Low: unread items
    '/placements':       1, // Low
    '/surveys':          1, // Low
    '/lost-found':       1, // Low
    '/exit-passes/my':   1  // Low
};
function getPriority(ep) {
    if (!ep) return 1;
    const baseEp = ep.split('?')[0];
    return EP_PRIORITY[baseEp] ?? 1;
}

// ─── Request Queue — Adaptive Concurrency & Priority Limiter ────────────────
// Caps concurrent outgoing network requests based on connection speed:
//  • Fast Wi-Fi / Ethernet / Downlink >= 5 Mbps: MAX = 4
//  • 4G / Downlink >= 1.5 Mbps: MAX = 3
//  • Poor network / 2G / 3G / Data Saver: MAX = 2
// Automatically re-sorts queued requests by priority (High -> Medium -> Low)
// with a stable FIFO fallback index to ensure users see critical data first.
const RequestQueue = (() => {
    let _active = 0;
    const _queue = [];
    let _nextId = 0;

    function getLimit() {
        const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        if (!conn) return 3; // Default fallback
        if (conn.saveData) return 2;
        const type = conn.effectiveType;
        if (type === '2g' || type === '3g') return 2;
        if (conn.downlink >= 5 || conn.type === 'wifi' || conn.type === 'ethernet') return 4;
        if (conn.downlink >= 1.5) return 3;
        return 2;
    }

    function _drain() {
        const limit = getLimit();
        while (_active < limit && _queue.length > 0) {
            const { fn, resolve, reject } = _queue.shift();
            _active++;
            fn()
                .then(resolve)
                .catch(reject)
                .finally(() => { _active--; _drain(); });
        }
    }

    /**
     * Enqueue a network call with priority sorting.
     * @param {() => Promise<*>} fn  Zero-argument async factory
     * @param {string} endpoint The endpoint string to look up priority
     */
    function enqueue(fn, endpoint = '') {
        const priority = getPriority(endpoint);
        const id = _nextId++;
        return new Promise((resolve, reject) => {
            _queue.push({ fn, resolve, reject, priority, id });
            // Sort queue: highest priority first. If same priority, preserve insertion order (FIFO)
            _queue.sort((a, b) => {
                if (b.priority !== a.priority) {
                    return b.priority - a.priority;
                }
                return a.id - b.id;
            });
            _drain();
        });
    }

    function cancelLowPriority() {
        // Cancel and reject all low/medium priority requests still waiting in the queue
        for (let i = _queue.length - 1; i >= 0; i--) {
            const item = _queue[i];
            if (item.priority < 3) {
                _queue.splice(i, 1);
                item.reject(new DOMException('Aborted due to route change', 'AbortError'));
            }
        }
    }

    return { enqueue, cancelLowPriority };
})();

// --- In-flight Request Deduplication ---
const _inflight = {};

// --- AbortController tracker per active GET endpoint ---
const _abortControllers = {};

// --- Core API Service ---
const api = {
    // ── Route Change Request Cancellation ────────────────────────────────────
    abortLowPriorityRequests() {
        for (const endpoint in _abortControllers) {
            const priority = getPriority(endpoint);
            if (priority < 3) {
                try {
                    _abortControllers[endpoint].abort();
                    console.log(`[API] Route change: Aborted in-flight GET request: ${endpoint}`);
                } catch (_) {}
                delete _abortControllers[endpoint];
            }
        }
    },
    // ── Internal fetch with 429 exponential-backoff retry ────────────────────
    // Retries up to MAX_RETRIES times on HTTP 429 with increasing delay.
    // All other errors are re-thrown immediately.
    async request(endpoint, options = {}) {
        // Critical request exemption (login, sync, and health checks bypass local offline check)
        const isCritical = endpoint.includes('/auth') || endpoint.includes('/health') || endpoint.includes('/sync');
        if (!state.isOnline && !isCritical) {
            console.warn(`[API Request] Offline check failed for: ${endpoint} — throwing OFFLINE`);
            throw new Error('OFFLINE');
        }

        const headers = { 'Content-Type': 'application/json' };
        if (state.token) headers['Authorization'] = `Bearer ${state.token}`;

        const MAX_RETRIES = 2;
        const attempt = options._retryAttempt || 0;

        const isGet = !options.method || options.method.toUpperCase() === 'GET';
        let controller = null;

        if (isGet) {
            // Abort previous in-flight request for the exact same endpoint
            if (_abortControllers[endpoint]) {
                try {
                    _abortControllers[endpoint].abort();
                    console.log(`[API] Aborted previous in-flight GET request: ${endpoint}`);
                } catch (_) {}
            }
            controller = new AbortController();
            _abortControllers[endpoint] = controller;
            options.signal = controller.signal;
        }

        const startTime = Date.now();
        const fullUrl = API_BASE + endpoint;
        const method = options.method || 'GET';
        const mergedHeaders = { ...headers, ...(options.headers || {}) };

        try {
            const isFeesOrNotices = endpoint && (endpoint.includes('fees') || endpoint.includes('fee-notices'));
            if (isFeesOrNotices) {
                console.log(`[FEES-FLOW] [Frontend Request] URL: ${fullUrl}`);
                console.log(`[FEES-FLOW] [Frontend Request] Method: ${method}`);
                console.log(`[FEES-FLOW] [Frontend Request] Authorization header: ${mergedHeaders.Authorization || 'NONE'}`);
                console.log(`[FEES-FLOW] [Frontend Request] Token prefix: ${(mergedHeaders.Authorization || '').substring(0, 15)}`);
            }

            console.log(`\n--- NETWORK REQUEST START ---`);
            console.log(`METHOD: ${method}`);
            console.log(`Full URL: ${fullUrl}`);
            console.log(`Headers: ${JSON.stringify(mergedHeaders)}`);
            console.log(`-----------------------------\n`);

            const resp = await RequestQueue.enqueue(
                () => fetch(fullUrl, { ...options, headers: mergedHeaders }),
                endpoint
            );

            const duration = Date.now() - startTime;
            console.log(`\n--- NETWORK RESPONSE RECEIVED ---`);
            console.log(`METHOD: ${method}`);
            console.log(`Full URL: ${fullUrl}`);
            console.log(`Response Status: ${resp.status}`);
            console.log(`Response Time: ${duration} ms`);
            console.log(`---------------------------------\n`);

            const text = await resp.text();

            if (isFeesOrNotices) {
                console.log(`[FEES-FLOW] [Frontend Response] Status: ${resp.status}`);
                console.log(`[FEES-FLOW] [Frontend Response] Time: ${duration} ms`);
                console.log(`[FEES-FLOW] [Frontend Response] Body: ${text.slice(0, 1000)}`);
            }


            // ── 429 Too Many Requests — exponential backoff retry ───────────
            if (resp.status === 429 && attempt < MAX_RETRIES) {
                const retryAfterSec = parseInt(resp.headers.get('Retry-After') || '0', 10);
                const backoffMs = retryAfterSec > 0
                    ? retryAfterSec * 1000
                    : Math.pow(2, attempt + 1) * 500; // 1s, 2s
                console.warn(`[API] 429 on ${endpoint} — retrying in ${backoffMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
                await new Promise(r => setTimeout(r, backoffMs));
                return this.request(endpoint, { ...options, _retryAttempt: attempt + 1 });
            }

            // Detect if the response is HTML and contains login page elements (ERP session expired)
            // Only perform logout/refresh if it is actually the ERP login page (redirect due to session expiry)
            // Generic HTML error responses (e.g. 502/504 Bad Gateway from hosting provider) should not trigger logout
            const isHtml = text.trim().startsWith('<');
            const isErpLogin = text.includes('Default.aspx') || text.includes('imgBtn2') || text.includes('txtId2');
            if (isHtml && isErpLogin) {
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
                const _tokenExpiry  = secureStorage.getItem('tokenExpiry');
                const _nowMs        = Date.now();
                console.error(
                    '[LOGOUT-TRIGGER] Reason: ERP login page detected (HTML redirect)\n' +
                    `  Endpoint:     ${endpoint}\n` +
                    `  Token expiry: ${_tokenExpiry ? new Date(Number(_tokenExpiry)).toISOString() : 'unknown'}\n` +
                    `  Current time: ${new Date(_nowMs).toISOString()}\n` +
                    `  Expired:      ${_tokenExpiry ? (_nowMs > Number(_tokenExpiry) ? 'YES' : 'NO') : 'unknown'}\n` +
                    `  Stack: ${new Error().stack}`
                );
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
                if (resp.status === 401) {
                    const _tokenExpiry  = secureStorage.getItem('tokenExpiry');
                    const _nowMs        = Date.now();
                    console.error(
                        '[LOGOUT-TRIGGER] Reason: HTTP 401 Unauthorized\n' +
                        `  Endpoint:     ${endpoint}\n` +
                        `  Method:       ${method}\n` +
                        `  Token expiry: ${_tokenExpiry ? new Date(Number(_tokenExpiry)).toISOString() : 'unknown'}\n` +
                        `  Current time: ${new Date(_nowMs).toISOString()}\n` +
                        `  Expired:      ${_tokenExpiry ? (_nowMs > Number(_tokenExpiry) ? 'YES' : 'NO') : 'unknown'}\n` +
                        `  Response body: ${text.slice(0, 300)}\n` +
                        `  Stack: ${new Error().stack}`
                    );
                    api.logout();
                }
                throw new Error(data.error || data.message || `HTTP ${resp.status}`);
            }
            return data;
        } catch (err) {
            const duration = Date.now() - startTime;
            console.error(`\n--- NETWORK REQUEST FAILED ---`);
            console.error(`METHOD: ${method}`);
            console.error(`Full URL: ${fullUrl}`);
            console.error(`Response Time: ${duration} ms`);
            console.error(`Error: ${err.message || err}`);
            console.error(`------------------------------\n`);

            if (err.name === 'AbortError') {
                console.warn(`[API] Request to ${endpoint} was aborted.`);
                throw err;
            }
            if (err.message === 'Failed to fetch' || err.name === 'TypeError') {
                console.warn(`[API Request] TypeError/Failed to fetch on ${fullUrl} - forcing OFFLINE error`);
                throw new Error('OFFLINE');
            }
            throw err;
        } finally {
            if (isGet && _abortControllers[endpoint] === controller) {
                delete _abortControllers[endpoint];
            }
        }
    },

    post(ep, body) {
        return this.request(ep, { method: 'POST', body: JSON.stringify(body) });
    },

    // SWR: returns IndexedDB cache immediately, revalidates from network in background
    async get(ep, { bypassCache = false, onRevalidate } = {}) {
        const ttl = getTTL(ep);

        // 1. Check IndexedDB first (per-endpoint TTL)
        if (!bypassCache) {
            const idbCached = await SITAMDb.get('erp_cache', ep, ttl);
            if (idbCached) {
                // Trigger silent background revalidation ONLY if cache is getting stale.
                // Guard: skip bg fetch if the cache was written < half the endpoint TTL ago.
                // This prevents a request storm where dashboard's api.get() calls each
                // spawn a background request seconds after prefetchAll() already fetched them.
                const cacheAge = Date.now() - (await SITAMDb.getTimestamp('erp_cache', ep).catch(() => 0) || 0);
                const halfTTL  = ttl / 2;
                if (state.isOnline && !_inflight[ep] && cacheAge > halfTTL) {
                    const bgPromise = this.request(ep).then(fresh => {
                        SITAMDb.set('erp_cache', ep, fresh, ttl).catch(() => {});
                        try { localStorage.setItem(getCacheKey(ep), JSON.stringify(fresh)); } catch {}
                        if (onRevalidate) onRevalidate(fresh);
                    }).catch(() => {}).finally(() => { delete _inflight[ep]; });
                    _inflight[ep] = bgPromise;
                }
                return idbCached;
            }
        }

        // 2. Offline fallback: return stale IndexedDB data or localStorage data
        if (!state.isOnline) {
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

        // 4. Network fetch + cache write (using per-endpoint TTL)
        const promise = this.request(ep).then(fresh => {
            // Write with the endpoint-specific TTL so e.g. timetable stays cached 30 min
            SITAMDb.set('erp_cache', ep, fresh, ttl).catch(() => {});
            try {
                localStorage.setItem(getCacheKey(ep), JSON.stringify(fresh));
                localStorage.setItem(getCacheKey(ep) + '_ts', Date.now().toString());
            } catch {}
            if (onRevalidate) onRevalidate(fresh);
            return fresh;
        }).catch(async err => {
            if (err.name === 'AbortError') {
                throw err;
            }
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
            secureStorage.removeItem('tokenExpiry');
            secureStorage.removeItem('studentName');
            state.token = null;
            state.profile = null;
            if (state._syncPollTimer) clearInterval(state._syncPollTimer);
            // Clear the entire page cache so nothing from the previous session leaks
            _pageCache.forEach(entry => { if (entry.node?.parentNode) entry.node.parentNode.removeChild(entry.node); });
            _pageCache.clear();
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
    // NOTE: Do NOT use bypassCache:true here.
    // The profile is already being fetched by prefetchAll() Group 1 and cached in
    // IndexedDB. bypassCache:true would issue a duplicate network request within
    // milliseconds of prefetchAll, doubling the post-login request count and
    // contributing to 429 bursts. Reading from cache is sufficient for the
    // drawer label and WebSocket userId — both are non-critical for first render.
    api.get('/profile').then(res => {
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
                        // Store token + expiry (7 days) so session survives app restarts
                        const SESSION_7_DAYS = 7 * 24 * 60 * 60 * 1000;
                        await secureStorage.setItem('token', res.token);
                        await secureStorage.setItem('tokenExpiry', String(Date.now() + SESSION_7_DAYS));
                        await secureStorage.setItem('studentName', res.studentName || '');
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
                    <!-- Exit Gate -->
                    <div class="bg-emerald-50/70 p-4 sm:p-5 rounded-3xl flex flex-col justify-between h-32 sm:h-36 cursor-pointer hover:scale-[1.02] active-scale transition-all border border-emerald-100" onclick="haptic(); router.navigate('/exit-pass')">
                        <div class="flex justify-between items-start">
                            <span class="material-symbols-outlined text-emerald-500" style="font-variation-settings:'FILL' 1">badge</span>
                            <span class="text-[11px] font-black text-emerald-600" id="dash-ep-status">--</span>
                        </div>
                        <div>
                            <h4 class="text-sm font-bold text-emerald-900">Exit Gate</h4>
                            <p class="text-[9px] text-emerald-500/80">Campus pass</p>
                        </div>
                    </div>
                    <!-- Career -->
                    <div class="bg-violet-50/70 p-4 sm:p-5 rounded-3xl flex flex-col justify-between h-32 sm:h-36 cursor-pointer hover:scale-[1.02] active-scale transition-all border border-violet-100" onclick="haptic(); router.navigate('/career')">
                        <div class="flex justify-between items-start">
                            <span class="material-symbols-outlined text-violet-500" style="font-variation-settings:'FILL' 1">work</span>
                            <span class="text-[11px] font-black text-violet-600" id="dash-placements-count">--</span>
                        </div>
                        <div>
                            <h4 class="text-sm font-bold text-violet-900">Career</h4>
                            <p class="text-[9px] text-violet-500/80">Placements</p>
                        </div>
                    </div>
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
            const hours = new Date().getHours();
            const greeting = hours < 12 ? 'Good Morning' : hours < 17 ? 'Good Afternoon' : 'Good Evening';
            const greetEmoji = hours < 12 ? '🌅' : hours < 17 ? '☀️' : '🌙';
            
            const indicator = $('live-indicator');
            if (indicator) {
                indicator.classList.remove('scale-0', 'opacity-0');
                indicator.classList.add('scale-100', 'opacity-100');
            }

            api.get('/profile').then(res => {
                const d = res.data || {};
                setEl('dash-greeting', 'innerText', `${greetEmoji} ${d.name || 'Student'}`);
                setEl('hero-sub', 'innerText', `Department of ${d.branch || d.program || 'CSE'}`);
                state.profile = d;
            }).catch(e => {
                console.error('[Dashboard] Profile fail:', e);
                setEl('dash-greeting', 'innerText', `${greetEmoji} Student`);
                setEl('hero-sub', 'innerText', 'Ready for a productive day?');
            });

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

            api.get('/attendance').then(attRes => {
                const attList = attRes.attendance || [];
                const overall = calcOverallAttendance(attList);
                setEl('dash-att-val', 'innerText', overall.text);
                setEl('hero-att', 'innerText', overall.text);
                setTimeout(() => {
                    setEl('dash-att-bar', 'style.width', overall.text);
                }, 200);
            }).catch(() => {});

            api.get('/marks').then(marksRes => {
                const cgpa = marksRes.data?.cgpa || '--';
                setEl('dash-gpa-val', 'innerText', cgpa);
                animateCount('hero-cgpa', cgpa);
            }).catch(() => {});

            api.get('/fees').then(feesRes => {
                const due = feesRes.data?.dueAmount || feesRes.data?.totalDue;
                if (due) {
                    setEl('dash-fee-text', 'innerText', due);
                } else {
                    setEl('dash-fee-text', 'innerText', 'Cleared');
                }
            }).catch(() => {});

            api.get('/placements').then(res => {
                const list = res.placements || [];
                setEl('dash-placements-count', 'innerText', `${list.length} Drives`);
            }).catch(() => {});

            api.get('/exit-passes/my').then(res => {
                const passes = res.data || res.passes || [];
                const active = passes[0];
                if (active) {
                    setEl('dash-ep-status', 'innerText', active.status);
                } else {
                    setEl('dash-ep-status', 'innerText', 'Apply');
                }
            }).catch(() => {});

            api.get('/surveys').then(res => {
                const list = res.surveys || [];
                setEl('dash-surveys-count', 'innerText', `${list.length} Survey${list.length !== 1 ? 's' : ''}`);
                if (list.length > 0) {
                    $('dash-surveys-alert')?.classList.remove('hidden');
                } else {
                    $('dash-surveys-alert')?.classList.add('hidden');
                }
            }).catch(() => {});

            api.get('/lost-found').then(res => {
                const list = res.items || [];
                setEl('dash-lf-count', 'innerText', `${list.length} Item${list.length !== 1 ? 's' : ''}`);
            }).catch(() => {});

            api.get('/timetable').then(ttRes => {
                const slots = Array.isArray(ttRes) ? ttRes : (ttRes.data || []);
                const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
                let day = days[new Date().getDay()];
                if (day === 'Sunday') day = 'Monday';
                
                const todaySlots = slots.filter(s => s.day === day).sort((a, b) => (parseInt(a.period)||0) - (parseInt(b.period)||0));
                const widget = $('dash-live-schedule-widget');
                
                if (widget) {
                    if (todaySlots.length === 0) {
                        widget.innerHTML = `
                            <div class="glass-card p-4 border border-white/40 flex items-center justify-between bg-white/40 text-center py-6 text-slate-400 text-xs font-bold">
                                No classes scheduled today
                            </div>
                        `;
                    } else {
                        const nextClass = todaySlots[0]; 
                        widget.innerHTML = `
                            <div class="glass-panel p-4 flex items-center justify-between bg-white border border-slate-200/50 hover:shadow-md transition-all cursor-pointer" onclick="router.navigate('/timetable')">
                                <div class="flex items-center gap-3">
                                    <div class="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center">
                                        <span class="material-symbols-outlined text-base">school</span>
                                    </div>
                                    <div>
                                        <h4 class="text-xs font-black text-slate-800">${nextClass.subjectName || nextClass.subjectCode}</h4>
                                        <p class="text-[10px] text-slate-400 font-bold mt-0.5">Room ${nextClass.room || 'C-204'} · ${nextClass.time || ''}</p>
                                    </div>
                                </div>
                                <span class="px-2.5 py-1 bg-blue-50 text-blue-600 border border-blue-100 rounded-lg text-[9px] font-black uppercase tracking-wide">Next Class</span>
                            </div>
                        `;
                    }
                }
            }).catch(() => {});

            api.get('/announcements').then(res => {
                const list = res.announcements || [];
                const preview = list.slice(0, 2);
                const container = $('dash-ann-list');
                if (container) {
                    if (preview.length === 0) {
                        container.innerHTML = `<div class="p-4 bg-slate-50 text-center text-slate-400 text-xs font-bold uppercase rounded-xl border border-slate-100">No notices posted</div>`;
                    } else {
                        container.innerHTML = preview.map(a => `
                            <div class="p-3.5 bg-white/60 border border-slate-200/50 rounded-xl flex items-center gap-3 active-scale transition-colors cursor-pointer" onclick="router.navigate('/announcements')">
                                <span class="material-symbols-outlined text-slate-400 text-base">campaign</span>
                                <div class="min-w-0 flex-1">
                                    <h4 class="text-xs font-extrabold text-slate-700 truncate">${a.title}</h4>
                                    <p class="text-[10px] text-slate-400 line-clamp-1 mt-0.5">${a.description}</p>
                                </div>
                            </div>
                        `).join('');
                    }
                }
            }).catch(e => {
                console.error('[Dashboard] Announcements fetch failed:', e);
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
                                    <p class="font-bold text-on-surface text-sm leading-tight truncate" title="${txn.title}">${txn.title}</p>
                                </div>
                            </div>
                            <div class="text-right flex-shrink-0">
                                <p class="font-extrabold text-on-surface text-sm leading-tight">${txn.amount}</p>
                                <span class="text-[9px] px-2 py-0.5 ${sc} rounded-full font-bold uppercase tracking-tighter mt-1 inline-block">${txn.status}</span>
                            </div>
                        </div>
                        ${warningHtml}
                    </div>`;
                }).join('');
            } catch(e) { console.error('[Fees] Error:', e); }
            finally { loading.hide(); }
        }
    },

    // ---- PROFILE ----
    profile: {
        render: () => `<div class="min-h-screen pb-36 bg-[#F8FAFC]">
            <main class="pt-20 px-4 max-w-lg mx-auto space-y-6">

                <!-- ════════════════════════════════════ -->
                <!-- DIGITAL STUDENT ID CARD             -->
                <!-- ════════════════════════════════════ -->
                <section>
                    <div class="id-card p-6 sm:p-7 relative overflow-hidden cursor-pointer active-scale" id="id-card-element">
                        <div class="relative z-10 flex items-center justify-between mb-4">
                            <div class="flex items-center gap-2">
                                <span class="material-symbols-outlined text-white" style="font-size:22px">school</span>
                                <div>
                                    <p class="text-white font-black text-xs uppercase leading-none tracking-wide">SITAM ERP</p>
                                    <p class="text-blue-300 text-[8px] font-black uppercase mt-0.5 tracking-widest">Digital Campus ID</p>
                                </div>
                            </div>
                            <div class="id-chip"></div>
                        </div>

                        <!-- ID Grid Content -->
                        <div class="relative z-10 flex items-center gap-4 mb-4">
                            <div class="w-20 h-20 bg-slate-900 border border-white/20 rounded-2xl flex items-center justify-center shadow-md">
                                <span class="material-symbols-outlined text-white/95 text-4xl">person</span>
                            </div>
                            <div class="text-left text-white">
                                <h3 class="text-base font-black tracking-tight" id="id-name">---</h3>
                                <p class="text-xs font-bold text-blue-200 mt-0.5" id="id-roll">---</p>
                                <p class="text-[10px] text-slate-300 mt-1" id="id-dept">Dept: CSE</p>
                                <p class="text-[10px] text-slate-300" id="id-year">Semester: 3rd Semester</p>
                            </div>
                        </div>

                        <div class="relative z-10 flex justify-between items-center pt-3 border-t border-white/10 text-[9px] text-slate-400 font-bold uppercase tracking-widest">
                            <span id="id-validity">Validity: May 2027</span>
                            <span class="text-blue-400 font-black">Tap to Expand</span>
                        </div>
                    </div>
                </section>

                <!-- Academic Progress stats -->
                <section class="space-y-2">
                    <h3 class="text-xs font-bold uppercase tracking-wider text-slate-400">Academic Standing</h3>
                    <div class="grid grid-cols-2 gap-3">
                        <div class="p-4 bg-white border border-slate-200/50 rounded-2xl shadow-sm">
                            <p class="text-[9px] uppercase font-bold text-slate-400 leading-none">Attendance</p>
                            <p class="text-xl font-black text-emerald-600 mt-1.5" id="prof-att-val">--%</p>
                        </div>
                        <div class="p-4 bg-white border border-slate-200/50 rounded-2xl shadow-sm">
                            <p class="text-[9px] uppercase font-bold text-slate-400 leading-none">CGPA</p>
                            <p class="text-xl font-black text-primary mt-1.5" id="prof-gpa-val">--</p>
                        </div>
                    </div>
                </section>

                <!-- Detailed Personal & Academic Fields -->
                <section class="space-y-3">
                    <h3 class="text-xs font-bold uppercase tracking-wider text-slate-400">Student Details</h3>
                    <div class="space-y-2" id="profile-fields-container">
                        <div class="h-16 bg-slate-100 rounded-xl animate-pulse"></div>
                    </div>
                </section>

                <!-- Actions -->
                <button class="w-full py-4 bg-rose-50 text-rose-600 border border-rose-100 rounded-2xl font-bold active-scale transition-colors hover:bg-rose-600 hover:text-white mt-4 flex items-center justify-center gap-2" onclick="api.logout()">
                    <span class="material-symbols-outlined">logout</span> Log Out
                </button>
            </main>

            <!-- Fullscreen expanded Digital ID Overlay -->
            <div id="fullscreen-id-overlay" class="fixed inset-0 bg-[#0f172a] z-[150] hidden flex-col items-center justify-center p-6" onclick="closeFullscreenID()">
                <div class="bg-gradient-to-tr from-[#0f172a] to-[#1e3a8a] border border-white/10 rounded-3xl p-6 w-full max-w-sm text-center relative overflow-hidden shadow-2xl flex flex-col justify-between min-h-[420px]" onclick="event.stopPropagation()">
                    <div class="flex justify-between items-start">
                        <span class="material-symbols-outlined text-white text-3xl">school</span>
                        <div class="text-right text-white">
                            <h3 class="text-lg font-black tracking-tight leading-none uppercase">SITAM ERP</h3>
                            <p class="text-[9px] text-blue-300 font-extrabold uppercase mt-0.5 tracking-widest">Digital Student Passport</p>
                        </div>
                    </div>

                    <div class="flex flex-col items-center my-6 space-y-3 text-white">
                        <div class="w-24 h-24 bg-slate-900 border-2 border-white/20 rounded-3xl flex items-center justify-center shadow-lg relative overflow-hidden">
                            <span class="material-symbols-outlined text-white/95 text-5xl">person</span>
                        </div>
                        <div>
                            <h2 class="text-xl font-black tracking-tight" id="fs-name">---</h2>
                            <p class="text-sm font-mono text-blue-200 mt-0.5" id="fs-roll">---</p>
                        </div>
                        
                        <div class="flex flex-col gap-1 text-[11px] text-slate-300 pt-1 text-center font-medium">
                            <p id="fs-dept">Department: Computer Science</p>
                            <p id="fs-batch">Batch: 2024 - 2028</p>
                            <p id="fs-adm">Admission No: ADM-2024-0098</p>
                            <p id="fs-blood">Blood Group: B+</p>
                            <p id="fs-emergency">Emergency: +91-9988776655</p>
                        </div>
                    </div>

                    <div class="flex justify-center my-2">
                        <div class="p-2.5 bg-white rounded-xl flex items-center justify-center shadow-md">
                            <span class="material-symbols-outlined text-slate-800 text-5xl font-light">qr_code_2</span>
                        </div>
                    </div>

                    <div class="flex justify-between pt-3 border-t border-white/10 text-[9px] text-slate-400 font-bold uppercase tracking-widest mt-2">
                        <span id="fs-validity">Valid Till: May 2027</span>
                        <span>SITAM Registrar</span>
                    </div>
                </div>
            </div>
        </div>`,
        afterRender: async () => {
            toggleShell(true);
            setActiveNav('profile');
            loading.show('Loading Profile details...');
            try {
                const res = await api.get('/profile');
                const d = res.data || {};

                // ── EVIDENCE LOG: print every field we received from /api/profile ──
                // This is the authoritative diagnostic for N/A fields.
                // Compare against the ERP scraper label table in Render logs.
                console.log('[Profile] Raw /api/profile response:', JSON.stringify(d, null, 2));

                state.profile = d;

                // ── EVIDENCE LOG: Frontend profile object BEFORE rendering ──
                // Stage 5 of 5: ERP → Scraper → DB → API → [Frontend]
                // If a field is blank here but present in [Profile] Raw /api/profile,
                // the loss is in the frontend data-binding. If blank in both,
                // the loss is upstream (scraper, DB, or API serialization).
                console.log('[PROFILE-UI] Object used to render profile page:', JSON.stringify({
                    name:            d.name,
                    roll:            d.roll,
                    userId:          d.userId,
                    branch:          d.branch,
                    program:         d.program,
                    semester:        d.semester,
                    year:            d.year,
                    dob:             d.dob,
                    email:           d.email,
                    phone:           d.phone,
                    fatherName:      d.fatherName,
                    motherName:      d.motherName,
                    hostel:          d.hostel,
                    address:         d.address,
                    bloodGroup:      d.bloodGroup,
                    emergencyContact:d.emergencyContact
                }, null, 2));

                setEl('id-name', 'innerText', d.name || 'Student');
                setEl('id-roll', 'innerText', d.roll || d.userId || '---');
                setEl('id-dept', 'innerText', `Dept: ${d.branch || d.program || 'CSE'}`);
                // Semester: use exact ERP value — no hardcoded fallback ever.
                // Prefer semester field directly; chain through known aliases before giving up.
                const _displaySemester = d.semester ?? d.currentSemester ?? d.erpSemester ?? '';
                setEl('id-year', 'innerText', _displaySemester ? `Semester: ${_displaySemester}` : 'Semester: —');
                
                setEl('fs-name', 'innerText', d.name || 'Student');
                setEl('fs-roll', 'innerText', d.roll || d.userId || '---');
                setEl('fs-dept', 'innerText', `Department: ${d.branch || d.program || 'CSE'}`);
                setEl('fs-batch', 'innerText', `Batch: ${d.batch || '2023 - 2027'}`);
                setEl('fs-adm', 'innerText', `Admission No: ${d.admissionNo || 'ADM-2023-0098'}`);
                setEl('fs-blood', 'innerText', `Blood Group: ${d.bloodGroup || 'B+'}`);
                setEl('fs-emergency', 'innerText', `Emergency: ${d.emergencyContact || '+91-9988776655'}`);

                $('id-card-element')?.addEventListener('click', () => {
                    haptic();
                    $('fullscreen-id-overlay')?.classList.remove('hidden');
                });

                window.closeFullscreenID = () => {
                    $('fullscreen-id-overlay')?.classList.add('hidden');
                };

                api.get('/attendance').then(attRes => {
                    const attList = attRes.attendance || [];
                    const overall = calcOverallAttendance(attList);
                    setEl('prof-att-val', 'innerText', overall.text);
                }).catch(() => {});

                api.get('/marks').then(marksRes => {
                    setEl('prof-gpa-val', 'innerText', marksRes.data?.cgpa || '--');
                }).catch(() => {});

                const list = $('profile-fields-container');
                if (!list) return;

                const fields = [
                    ['cake', 'Date of Birth', d.dob],
                    ['mail', 'Email Address', d.email],
                    ['phone', 'Mobile Number', d.phone],
                    ['supervisor_account', 'Father Name', d.fatherName],
                    ['supervisor_account', 'Mother Name', d.motherName],
                    ['home', 'Hostel Assigned', d.hostel ? `${d.hostel} · Room ${d.roomNo}` : 'Day Scholar'],
                    ['location_on', 'Home Address', d.address]
                ];

                list.innerHTML = fields.map(([icon, label, val]) => `
                    <div class="flex items-center gap-4 p-4 bg-white border border-slate-200/50 rounded-2xl shadow-sm">
                        <div class="w-10 h-10 rounded-xl bg-blue-50 text-blue-500 border border-blue-100 flex items-center justify-center flex-shrink-0">
                            <span class="material-symbols-outlined text-sm">${icon}</span>
                        </div>
                        <div class="min-w-0 flex-1">
                            <p class="text-[9px] uppercase font-bold text-slate-400 leading-none">${label}</p>
                            <p class="text-sm font-semibold text-slate-800 mt-1.5 truncate">${val || 'N/A'}</p>
                        </div>
                    </div>
                `).join('');
            } catch (err) {
                console.error('[Profile] load failed:', err);
            } finally {
                loading.hide();
            }
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
        render: () => `<div class="min-h-screen pb-32 bg-[#F8FAFC]">
            <main class="pt-20 px-4 max-w-lg mx-auto space-y-6">
                <section class="flex justify-between items-center">
                    <div>
                        <p class="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-1">Stay Updated</p>
                        <h2 class="text-3xl font-extrabold tracking-tight text-slate-800" style="font-family:'Plus Jakarta Sans',sans-serif">Notifications</h2>
                    </div>
                    <button id="mark-all-read-btn" class="text-xs font-bold text-primary uppercase hover:underline flex items-center gap-1 active-scale">
                        <span class="material-symbols-outlined text-sm">done_all</span> Mark All Read
                    </button>
                </section>

                <!-- Search & Filters -->
                <div class="space-y-3 select-none">
                    <div class="relative">
                        <span class="material-symbols-outlined absolute left-3.5 top-3.5 text-slate-400 text-sm" style="font-size:16px">search</span>
                        <input type="text" id="notif-search" placeholder="Search alerts..." class="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-primary transition-all" />
                    </div>

                    <div class="flex gap-2 overflow-x-auto pb-1 hide-scrollbar momentum-scroll" id="notif-filters">
                        <button class="px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider bg-primary text-white whitespace-nowrap active-scale" data-filter="all">All</button>
                        <button class="px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider bg-slate-100 text-slate-500 whitespace-nowrap active-scale" data-filter="academic">Academic</button>
                        <button class="px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider bg-slate-100 text-slate-500 whitespace-nowrap active-scale" data-filter="placement">Placements</button>
                        <button class="px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider bg-slate-100 text-slate-500 whitespace-nowrap active-scale" data-filter="event">Events</button>
                        <button class="px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider bg-slate-100 text-slate-500 whitespace-nowrap active-scale" data-filter="survey">Surveys</button>
                        <button class="px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider bg-slate-100 text-slate-500 whitespace-nowrap active-scale" data-filter="exit-pass">Exit Pass</button>
                    </div>
                </div>

                <!-- Notifications Grouped Container -->
                <div class="space-y-6" id="notif-list-container">
                    <div class="h-20 bg-slate-100 rounded-xl animate-pulse"></div>
                </div>
            </main>
        </div>`,
        afterRender: async () => {
            toggleShell(true);
            setActiveNav('notifications');
            
            const listContainer = $('notif-list-container');
            const searchInput = $('notif-search');
            const filterContainer = $('notif-filters');
            const markAllReadBtn = $('mark-all-read-btn');

            let allNotifications = [];
            let activeFilter = 'all';
            let searchQuery = '';

            const getVisuals = (type) => {
                const normType = (type || 'general').toLowerCase();
                if (normType.includes('academic') || normType.includes('attendance') || normType.includes('marks') || normType.includes('assignment')) {
                    return { icon: 'school', bg: 'bg-blue-50 border-blue-100', text: 'text-blue-600' };
                }
                if (normType.includes('placement') || normType.includes('career')) {
                    return { icon: 'work', bg: 'bg-indigo-50 border-indigo-100', text: 'text-indigo-600' };
                }
                if (normType.includes('event')) {
                    return { icon: 'festival', bg: 'bg-purple-50 border-purple-100', text: 'text-purple-600' };
                }
                if (normType.includes('survey')) {
                    return { icon: 'poll', bg: 'bg-emerald-50 border-emerald-100', text: 'text-emerald-600' };
                }
                if (normType.includes('exit-pass') || normType.includes('gate-pass')) {
                    return { icon: 'badge', bg: 'bg-amber-50 border-amber-100', text: 'text-amber-600' };
                }
                if (normType.includes('help-desk') || normType.includes('ticket')) {
                    return { icon: 'support_agent', bg: 'bg-rose-50 border-rose-100', text: 'text-rose-600' };
                }
                return { icon: 'notifications', bg: 'bg-slate-50 border-slate-100', text: 'text-slate-600' };
            };

            const renderNotifications = () => {
                if (!listContainer) return;
                
                let filtered = allNotifications;
                
                // 1. Filter by category
                if (activeFilter !== 'all') {
                    filtered = filtered.filter(n => {
                        const nt = (n.type || 'general').toLowerCase();
                        if (activeFilter === 'academic') return nt.includes('academic') || nt.includes('attendance') || nt.includes('marks') || nt.includes('assignment');
                        if (activeFilter === 'placement') return nt.includes('placement') || nt.includes('career');
                        if (activeFilter === 'event') return nt.includes('event');
                        if (activeFilter === 'survey') return nt.includes('survey');
                        if (activeFilter === 'exit-pass') return nt.includes('exit-pass') || nt.includes('gate-pass');
                        if (activeFilter === 'help-desk') return nt.includes('help-desk') || nt.includes('ticket');
                        return false;
                    });
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
                    listContainer.innerHTML = `
                        <div class="text-center py-16 text-slate-400 animate-reveal">
                            <span class="material-symbols-outlined text-5xl mb-3 block">notifications_off</span>
                            <p class="font-bold text-xs uppercase tracking-wider">No notifications found</p>
                        </div>`;
                    return;
                }

                // Group by date categorizations
                const now = new Date();
                const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

                const groups = {
                    Unread: [],
                    Today: [],
                    Yesterday: [],
                    Earlier: []
                };

                filtered.forEach(n => {
                    if (!n.isRead) {
                        groups.Unread.push(n);
                        return;
                    }
                    const nDate = new Date(n.createdAt || Date.now());
                    const nd = new Date(nDate.getFullYear(), nDate.getMonth(), nDate.getDate());
                    if (nd.getTime() === today.getTime()) {
                        groups.Today.push(n);
                    } else if (nd.getTime() === yesterday.getTime()) {
                        groups.Yesterday.push(n);
                    } else {
                        groups.Earlier.push(n);
                    }
                });

                let html = '';
                Object.keys(groups).forEach(key => {
                    const groupList = groups[key];
                    if (groupList.length === 0) return;

                    html += `
                        <div class="space-y-2.5 animate-reveal">
                            <h3 class="text-[10px] font-black uppercase tracking-widest text-slate-400 px-1">${key} Alerts</h3>
                            <div class="space-y-2">
                                ${groupList.map(n => {
                                    const visuals = getVisuals(n.type);
                                    const isRead = n.isRead || false;
                                    const route = n.metadata ? (typeof n.metadata === 'string' ? JSON.parse(n.metadata).route : n.metadata.route) : null;
                                    
                                    return `
                                        <div class="p-4 rounded-2xl bg-white border border-slate-200/50 flex gap-4 justify-between items-start active-scale relative cursor-pointer hover:shadow-sm transition-all"
                                             data-id="${n.id}" data-route="${route || ''}" data-read="${isRead}">
                                            <div class="flex gap-3 min-w-0 flex-1 notif-card-click-area">
                                                <div class="w-10 h-10 rounded-xl ${visuals.bg} flex items-center justify-center flex-shrink-0 border mt-0.5">
                                                    <span class="material-symbols-outlined ${visuals.text} text-sm">${visuals.icon}</span>
                                                </div>
                                                <div class="min-w-0 flex-1">
                                                    <div class="flex items-center gap-1.5">
                                                        <h4 class="font-extrabold text-slate-800 text-sm truncate leading-tight">${n.title}</h4>
                                                        ${!isRead ? `<span class="w-1.5 h-1.5 bg-primary rounded-full flex-shrink-0" id="unread-dot-${n.id}"></span>` : ''}
                                                    </div>
                                                    <p class="text-xs text-slate-500 mt-1.5 leading-normal break-words">${n.message}</p>
                                                    <p class="text-[9px] text-slate-400 font-bold mt-2 font-mono">${new Date(n.createdAt).toLocaleTimeString()}</p>
                                                </div>
                                            </div>
                                            <button class="delete-notif-btn p-2 text-slate-400 hover:text-red-500 active-scale rounded-full flex items-center justify-center flex-shrink-0" data-id="${n.id}">
                                                <span class="material-symbols-outlined text-sm">delete</span>
                                            </button>
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                        </div>
                    `;
                });

                listContainer.innerHTML = html;

                // Click handler for body click (navigation & read status)
                listContainer.querySelectorAll('.notif-card-click-area').forEach(el => {
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
                listContainer.querySelectorAll('.delete-notif-btn').forEach(btn => {
                    btn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        haptic();
                        const notifId = e.currentTarget.dataset.id;
                        
                        const card = e.currentTarget.closest('[data-id]');
                        if (card) {
                            card.classList.add('scale-90', 'opacity-0');
                            setTimeout(() => {
                                card.remove();
                                renderNotifications();
                            }, 200);
                        }

                        api.delete(`/notifications/${notifId}`).catch(() => {});

                        allNotifications = allNotifications.filter(n => n.id !== notifId);
                        SITAMDb.set('erp_cache', '/notifications', { notifications: allNotifications }, 24 * 60 * 60 * 1000).catch(() => {});

                        updateUnreadBadge();
                    });
                });
            };

            // Load from cache first
            try {
                const cached = await SITAMDb.get('erp_cache', '/notifications', 24 * 60 * 60 * 1000);
                if (cached && cached.notifications) {
                    allNotifications = cached.notifications;
                    renderNotifications();
                }
            } catch (_) {}

            // Load from server
            try {
                const res = await api.get('/notifications');
                const data = res.data || {};
                const notifications = data.notifications || [];
                
                allNotifications = notifications;
                await SITAMDb.set('erp_cache', '/notifications', { notifications }, 24 * 60 * 60 * 1000);
                renderNotifications();
            } catch (err) {
                console.error('[Notifications] Network fetch error:', err);
            }

            if (searchInput) {
                searchInput.addEventListener('input', (e) => {
                    searchQuery = e.target.value;
                    renderNotifications();
                });
            }

            if (filterContainer) {
                filterContainer.querySelectorAll('[data-filter]').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        filterContainer.querySelectorAll('[data-filter]').forEach(b => {
                            b.className = "px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider bg-slate-100 text-slate-500 whitespace-nowrap active-scale";
                        });
                        e.currentTarget.className = "px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider bg-primary text-white whitespace-nowrap active-scale";
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
    },
    
    // ---- ACADEMICS HUB ----
    academics: {
        render: () => `
            <div class="min-h-screen pb-32 bg-[#F8FAFC]">
                <main class="pt-20 px-4 max-w-lg mx-auto">
                    <!-- Tab Selector -->
                    <div class="flex gap-2 overflow-x-auto pb-3 mb-5 hide-scrollbar momentum-scroll select-none" id="academic-tabs">
                        <button class="academic-tab-btn flex-shrink-0 px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wider bg-primary text-white" data-tab="attendance">Attendance</button>
                        <button class="academic-tab-btn flex-shrink-0 px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wider bg-slate-100 text-slate-500" data-tab="marks">Results</button>
                        <button class="academic-tab-btn flex-shrink-0 px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wider bg-slate-100 text-slate-500" data-tab="timetable">Timetable</button>
                        <button class="academic-tab-btn flex-shrink-0 px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wider bg-slate-100 text-slate-500" data-tab="assignments">Assignments</button>
                        <button class="academic-tab-btn flex-shrink-0 px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wider bg-slate-100 text-slate-500" data-tab="fees">Fees</button>
                    </div>
                    <!-- Tab Content Container -->
                    <div id="academic-tab-content" class="space-y-4"></div>
                </main>
            </div>
        `,
        afterRender: () => {
            toggleShell(true);
            setActiveNav('academics');
            
            const tabButtons = document.querySelectorAll('.academic-tab-btn');
            const contentContainer = $('academic-tab-content');
            
            const loadTab = async (tabName) => {
                tabButtons.forEach(btn => {
                    if (btn.dataset.tab === tabName) {
                        btn.className = 'academic-tab-btn flex-shrink-0 px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wider bg-primary text-white';
                    } else {
                        btn.className = 'academic-tab-btn flex-shrink-0 px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wider bg-slate-100 text-slate-500';
                    }
                });
                
                const page = pages[tabName];
                if (page) {
                    const htmlStr = page.render();
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(htmlStr, 'text/html');
                    const mainContent = doc.querySelector('main')?.innerHTML || htmlStr;
                    if (contentContainer) {
                        contentContainer.innerHTML = mainContent;
                    }
                    await page.afterRender?.();
                }
            };
            
            tabButtons.forEach(btn => {
                btn.addEventListener('click', () => {
                    haptic();
                    loadTab(btn.dataset.tab);
                });
            });
            
            loadTab('attendance');
        }
    },

    // ---- CAREER ----
    career: {
        render: () => `
            <div class="min-h-screen pb-32 bg-[#F8FAFC]">
                <main class="pt-20 px-4 max-w-lg mx-auto">
                    <section class="mb-5 flex justify-between items-end">
                        <div>
                            <p class="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-1 font-headline">Opportunities</p>
                            <h2 class="text-3xl font-extrabold tracking-tight text-slate-800" style="font-family:'Plus Jakarta Sans',sans-serif">Career Portal</h2>
                        </div>
                    </section>
                    <!-- Sub-tabs -->
                    <div class="flex gap-2 overflow-x-auto pb-3 mb-5 hide-scrollbar momentum-scroll select-none" id="career-tabs">
                        <button class="career-tab-btn flex-shrink-0 px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wider bg-primary text-white" data-tab="PLACEMENT">Placements</button>
                        <button class="career-tab-btn flex-shrink-0 px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wider bg-slate-100 text-slate-500" data-tab="INTERNSHIP">Internships</button>
                        <button class="career-tab-btn flex-shrink-0 px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wider bg-slate-100 text-slate-500" data-tab="EVENT">Events</button>
                        <button class="career-tab-btn flex-shrink-0 px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wider bg-slate-100 text-slate-500" data-tab="SAVED">Saved</button>
                    </div>
                    <div class="space-y-4" id="career-list">
                        <div class="h-24 bg-slate-100 rounded-xl animate-pulse"></div>
                    </div>
                </main>
            </div>
        `,
        afterRender: async () => {
            toggleShell(true);
            setActiveNav('career');
            const list = $('career-list');
            const tabs = document.querySelectorAll('.career-tab-btn');
            let activeTab = 'PLACEMENT';
            let allItems = [];

            const renderItems = () => {
                if (!list) return;
                const filtered = activeTab === 'SAVED'
                    ? allItems.filter(item => item.isSaved)
                    : allItems.filter(item => (item.type || 'PLACEMENT') === activeTab);

                if (filtered.length === 0) {
                    list.innerHTML = `<div class="text-center py-16 text-slate-400 font-bold">No opportunities found in this category.</div>`;
                    return;
                }

                list.innerHTML = filtered.map((item, idx) => {
                    const savedIcon = item.isSaved ? 'bookmark' : 'bookmark_border';
                    const savedClass = item.isSaved ? 'text-primary font-fill' : 'text-slate-400';
                    const logoLetter = (item.companyName || 'C').charAt(0);
                    const gradientColors = ['from-blue-500 to-indigo-500', 'from-purple-500 to-pink-500', 'from-emerald-500 to-teal-500', 'from-amber-500 to-orange-500'];
                    const logoBg = gradientColors[idx % gradientColors.length];
                    const logoHtml = item.companyLogoUrl 
                        ? `<img src="${item.companyLogoUrl}" class="w-12 h-12 rounded-xl object-cover" />`
                        : `<div class="w-12 h-12 rounded-xl bg-gradient-to-tr ${logoBg} flex items-center justify-center text-white font-black text-lg">${logoLetter}</div>`;
                    const location = item.location || 'Campus / Off-campus';
                    const lastDate = item.lastDate || 'N/A';

                    return `
                        <div class="glass-panel p-5 space-y-4 active-scale transition-all duration-300 shadow-sm relative group hover:shadow-md border border-slate-200/50">
                            ${item.companyArrivedToday ? `
                            <div class="absolute top-4 right-4 flex items-center gap-1 bg-rose-50 border border-rose-100 text-rose-600 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wide animate-pulse">
                                <span class="w-1.5 h-1.5 bg-rose-600 rounded-full"></span> Hiring Today
                            </div>` : ''}
                            <div class="flex items-center gap-4">
                                ${logoHtml}
                                <div class="min-w-0 flex-1">
                                    <h4 class="font-extrabold text-slate-800 text-base leading-tight truncate">${item.jobRole}</h4>
                                    <p class="text-sm font-bold text-slate-500 mt-1">${item.companyName}</p>
                                    <p class="text-xs text-slate-400 mt-1 flex items-center gap-1 font-mono">
                                        <span class="material-symbols-outlined text-xs" style="font-size:12px">location_on</span> ${location}
                                        <span class="mx-1.5 text-slate-300">•</span>
                                        <span class="material-symbols-outlined text-xs" style="font-size:12px">calendar_today</span> Last Date: ${lastDate}
                                    </p>
                                </div>
                            </div>
                            <div class="flex justify-between items-center py-2 border-y border-slate-100 text-xs">
                                <div>
                                    <p class="text-[10px] uppercase font-bold text-slate-400">Package</p>
                                    <p class="font-black text-slate-800 text-sm mt-0.5 font-mono">₹${item.packageLpa} LPA</p>
                                </div>
                                <div>
                                    <p class="text-[10px] uppercase font-bold text-slate-400">Eligibility</p>
                                    <p class="font-black text-slate-800 mt-0.5">${item.eligibility}</p>
                                </div>
                            </div>
                            <div class="flex gap-2">
                                <button class="save-job-btn flex items-center justify-center p-3.5 rounded-xl border border-slate-200 bg-white/60 active-scale hover:bg-slate-50 transition-colors" data-id="${item.id}">
                                    <span class="material-symbols-outlined text-lg ${savedClass}">${savedIcon}</span>
                                </button>
                                <button class="share-job-btn flex items-center justify-center p-3.5 rounded-xl border border-slate-200 bg-white/60 active-scale hover:bg-slate-50 transition-colors" data-role="${item.jobRole}" data-company="${item.companyName}">
                                    <span class="material-symbols-outlined text-lg text-slate-500">share</span>
                                </button>
                                <button class="register-job-btn flex-1 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold py-3.5 rounded-xl shadow-md active-scale transition-transform flex items-center justify-center gap-1.5" data-link="${item.registrationLink}">
                                    Register <span class="material-symbols-outlined text-sm">arrow_forward</span>
                                </button>
                            </div>
                        </div>
                    `;
                }).join('');

                list.querySelectorAll('.save-job-btn').forEach(btn => {
                    btn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        haptic();
                        const id = btn.dataset.id;
                        const item = allItems.find(x => x.id === id);
                        if (item) {
                            item.isSaved = !item.isSaved;
                            renderItems();
                            try {
                                await api.post(`/placements/${id}/save`);
                                showToast(item.isSaved ? 'Placement saved!' : 'Placement unsaved', 'info', 2000);
                            } catch (_) {
                                item.isSaved = !item.isSaved;
                                renderItems();
                            }
                        }
                    });
                });

                list.querySelectorAll('.share-job-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        haptic();
                        const role = btn.dataset.role;
                        const company = btn.dataset.company;
                        const shareText = `Check out this career opportunity at SITAM ERP: ${role} at ${company}!`;
                        if (navigator.share) {
                            navigator.share({
                                title: `${role} at ${company}`,
                                text: shareText,
                                url: window.location.href
                            }).catch(() => {});
                        } else {
                            navigator.clipboard.writeText(shareText);
                            showToast('Opportunity details copied to clipboard!', 'info', 2000);
                        }
                    });
                });

                list.querySelectorAll('.register-job-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        haptic();
                        const link = btn.dataset.link;
                        if (window.Capacitor?.Plugins?.Browser) {
                            window.Capacitor.Plugins.Browser.open({ url: link }).catch(() => {});
                        } else {
                            window.open(link, '_blank');
                        }
                    });
                });
            };

            const loadTab = (tab) => {
                activeTab = tab;
                tabs.forEach(btn => {
                    if (btn.dataset.tab === tab) {
                        btn.className = 'career-tab-btn flex-shrink-0 px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wider bg-primary text-white';
                    } else {
                        btn.className = 'career-tab-btn flex-shrink-0 px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wider bg-slate-100 text-slate-500';
                    }
                });
                renderItems();
            };

            tabs.forEach(btn => {
                btn.addEventListener('click', () => {
                    haptic();
                    loadTab(btn.dataset.tab);
                });
            });

            loading.show('Loading Placements...');
            try {
                const res = await api.get('/placements');
                allItems = res.placements || [];
                renderItems();
            } catch (err) {
                console.error('[Career] placements fetch failed:', err);
                if (list) list.innerHTML = `<div class="text-center py-16 text-slate-400 font-bold">Failed to load placements.</div>`;
            } finally {
                loading.hide();
            }
        }
    },

    // ---- SERVICES HUB ----
    services: {
        render: () => `
            <div class="min-h-screen pb-32 bg-[#F8FAFC]">
                <main class="pt-20 px-4 max-w-lg mx-auto">
                    <section class="mb-6">
                        <p class="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-1 font-headline">Utility Hub</p>
                        <h2 class="text-3xl font-extrabold tracking-tight text-slate-800" style="font-family:'Plus Jakarta Sans',sans-serif">Campus Services</h2>
                    </section>
                    
                    <div class="grid grid-cols-2 gap-4">
                        <div class="service-card glass-panel p-5 flex flex-col justify-between h-40 cursor-pointer active-scale transition-all hover:shadow-md border border-slate-200/50" onclick="haptic(); router.navigate('/exit-pass')">
                            <div class="w-12 h-12 rounded-2xl bg-gradient-to-tr from-blue-500 to-indigo-500 flex items-center justify-center text-white shadow-md shadow-blue-500/20">
                                <span class="material-symbols-outlined text-2xl font-bold">badge</span>
                            </div>
                            <div>
                                <h4 class="font-extrabold text-slate-800 text-sm tracking-wide">Exit Pass</h4>
                                <p class="text-[10px] text-slate-400 mt-1 leading-snug">Request gate passes &amp; get verification OTPs</p>
                            </div>
                        </div>

                        <div class="service-card glass-panel p-5 flex flex-col justify-between h-40 cursor-pointer active-scale transition-all hover:shadow-md border border-slate-200/50" onclick="haptic(); router.navigate('/survey')">
                            <div class="w-12 h-12 rounded-2xl bg-gradient-to-tr from-purple-500 to-pink-500 flex items-center justify-center text-white shadow-md shadow-purple-500/20">
                                <span class="material-symbols-outlined text-2xl font-bold">poll</span>
                            </div>
                            <div>
                                <h4 class="font-extrabold text-slate-800 text-sm tracking-wide">Surveys</h4>
                                <p class="text-[10px] text-slate-400 mt-1 leading-snug">Voice your feedback anonymously</p>
                            </div>
                        </div>

                        <div class="service-card glass-panel p-5 flex flex-col justify-between h-40 cursor-pointer active-scale transition-all hover:shadow-md border border-slate-200/50" onclick="haptic(); router.navigate('/announcements')">
                            <div class="w-12 h-12 rounded-2xl bg-gradient-to-tr from-amber-500 to-orange-500 flex items-center justify-center text-white shadow-md shadow-amber-500/20">
                                <span class="material-symbols-outlined text-2xl font-bold">campaign</span>
                            </div>
                            <div>
                                <h4 class="font-extrabold text-slate-800 text-sm tracking-wide">Announcements</h4>
                                <p class="text-[10px] text-slate-400 mt-1 leading-snug">Official college notices &amp; news boards</p>
                            </div>
                        </div>

                        <div class="service-card glass-panel p-5 flex flex-col justify-between h-40 cursor-pointer active-scale transition-all hover:shadow-md border border-slate-200/50" onclick="haptic(); router.navigate('/notifications')">
                            <div class="w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-500 flex items-center justify-center text-white shadow-md shadow-emerald-500/20">
                                <span class="material-symbols-outlined text-2xl font-bold">notifications</span>
                            </div>
                            <div>
                                <h4 class="font-extrabold text-slate-800 text-sm tracking-wide">Notifications</h4>
                                <p class="text-[10px] text-slate-400 mt-1 leading-snug">System alerts &amp; real-time updates</p>
                            </div>
                        </div>

                        <div class="service-card glass-panel p-5 flex flex-col justify-between h-40 cursor-pointer active-scale transition-all hover:shadow-md border border-slate-200/50" onclick="haptic(); router.navigate('/lost-found')">
                            <div class="w-12 h-12 rounded-2xl bg-gradient-to-tr from-red-500 to-rose-500 flex items-center justify-center text-white shadow-md shadow-red-500/20">
                                <span class="material-symbols-outlined text-2xl font-bold">search</span>
                            </div>
                            <div>
                                <h4 class="font-extrabold text-slate-800 text-sm tracking-wide">Lost &amp; Found</h4>
                                <p class="text-[10px] text-slate-400 mt-1 leading-snug">Report items &amp; manage return claims</p>
                            </div>
                        </div>

                        <div class="service-card glass-panel p-5 flex flex-col justify-between h-40 cursor-pointer active-scale transition-all hover:shadow-md border border-slate-200/50" onclick="haptic(); router.navigate('/help')">
                            <div class="w-12 h-12 rounded-2xl bg-gradient-to-tr from-slate-600 to-blue-900 flex items-center justify-center text-white shadow-md shadow-slate-600/20">
                                <span class="material-symbols-outlined text-2xl font-bold">support_agent</span>
                            </div>
                            <div>
                                <h4 class="font-extrabold text-slate-800 text-sm tracking-wide">Help Desk</h4>
                                <p class="text-[10px] text-slate-400 mt-1 leading-snug">Open support tickets for issues</p>
                            </div>
                        </div>
                    </div>
                </main>
            </div>
        `,
        afterRender: () => {
            toggleShell(true);
            setActiveNav('services');
        }
    },

    // ---- EXIT PASS ----
    'exit-pass': {
        render: () => `
            <div class="min-h-screen pb-32 bg-[#F8FAFC]">
                <main class="pt-20 px-4 max-w-lg mx-auto space-y-6">
                    <section class="flex justify-between items-center">
                        <div>
                            <p class="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-1">Gate Pass</p>
                            <h2 class="text-3xl font-extrabold tracking-tight text-slate-800" style="font-family:'Plus Jakarta Sans',sans-serif">Exit Passes</h2>
                        </div>
                        <button id="apply-ep-btn" class="bg-primary text-white font-bold text-xs uppercase tracking-wider px-5 py-2.5 rounded-full shadow-md active-scale transition-all">Apply</button>
                    </section>

                    <div id="active-ep-container" class="space-y-4">
                        <div class="h-24 bg-slate-100 rounded-xl animate-pulse"></div>
                    </div>

                    <section class="space-y-3">
                        <h3 class="text-sm font-bold uppercase tracking-wider text-slate-400">History</h3>
                        <div class="space-y-3" id="ep-history-list"></div>
                    </section>
                </main>

                <div id="ep-sheet-backdrop" class="bottom-sheet-backdrop hidden opacity-0"></div>
                <div id="ep-sheet" class="bottom-sheet">
                    <div class="px-6 py-4 flex items-center justify-between border-b border-slate-100">
                        <h3 class="font-extrabold text-slate-800 text-lg">Apply for Exit Pass</h3>
                        <button id="close-ep-sheet" class="p-2 hover:bg-slate-100 rounded-full transition-colors"><span class="material-symbols-outlined text-slate-500">close</span></button>
                    </div>
                    <form id="ep-form" class="p-6 pb-8 space-y-4 overflow-y-auto">
                        <div class="space-y-1">
                            <label class="text-xs font-bold text-slate-500 uppercase tracking-wide">Destination</label>
                            <input type="text" id="ep-destination" required placeholder="e.g. Home, Hospital, Bank" class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-primary transition-all" />
                        </div>
                        <div class="space-y-1">
                            <label class="text-xs font-bold text-slate-500 uppercase tracking-wide">Reason</label>
                            <textarea id="ep-reason" required placeholder="Describe the reason for exit..." class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-primary transition-all h-24 resize-none"></textarea>
                        </div>
                        <div class="space-y-1">
                            <label class="text-xs font-bold text-slate-500 uppercase tracking-wide">Requested Exit Date</label>
                            <input type="date" id="ep-date" required class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-primary transition-all font-mono" />
                        </div>
                        <button type="submit" class="w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold py-3.5 rounded-xl shadow-md active-scale transition-transform">Submit Request</button>
                    </form>
                </div>
            </div>
        `,
        afterRender: async () => {
            toggleShell(true);
            setActiveNav('services');
            
            const activeContainer = $('active-ep-container');
            const historyList = $('ep-history-list');
            const sheet = $('ep-sheet');
            const backdrop = $('ep-sheet-backdrop');
            const applyBtn = $('apply-ep-btn');
            const closeBtn = $('close-ep-sheet');
            const form = $('ep-form');

            const openSheet = () => {
                haptic();

                // ── Compute bottom clearance above the floating dock ──────────────────
                // Measure the dock's actual position so we handle all Android nav modes
                // (gesture navigation, 3-button bar) and safe-area insets correctly.
                const dock = document.getElementById('bottom-dock');
                if (dock) {
                    const dockRect = dock.getBoundingClientRect();
                    // Distance from the dock's top edge to the viewport bottom
                    const dockClearance = window.innerHeight - dockRect.top;
                    // Add 16px breathing room between the sheet and the dock
                    const sheetBottom = Math.max(dockClearance + 16, 80);
                    document.documentElement.style.setProperty(
                        '--bottom-sheet-bottom', `${sheetBottom}px`
                    );
                }

                backdrop.classList.remove('hidden');
                sheet.classList.remove('hidden');
                setTimeout(() => {
                    backdrop.classList.add('opacity-100');
                    sheet.classList.add('open');
                }, 10);
            };

            const closeSheet = () => {
                backdrop.classList.remove('opacity-100');
                sheet.classList.remove('open');
                setTimeout(() => {
                    backdrop.classList.add('hidden');
                }, 300);
            };

            applyBtn?.addEventListener('click', openSheet);
            backdrop?.addEventListener('click', closeSheet);
            closeBtn?.addEventListener('click', closeSheet);

            const renderPasses = (passes) => {
                if (!activeContainer || !historyList) return;
                
                const active = passes[0];
                const history = passes.slice(1);

                if (!active) {
                    activeContainer.innerHTML = `<div class="p-6 rounded-2xl bg-white/60 border border-slate-200/50 text-center text-slate-400 font-bold text-xs uppercase tracking-wider">No active exit passes.</div>`;
                } else {
                    const statusColors = {
                        PENDING: 'bg-amber-100 text-amber-800 border-amber-200',
                        APPROVED: 'bg-emerald-100 text-emerald-800 border-emerald-200',
                        VERIFIED: 'bg-indigo-100 text-indigo-800 border-indigo-200',
                        COMPLETED: 'bg-slate-100 text-slate-800 border-slate-200',
                        REJECTED: 'bg-rose-100 text-rose-800 border-rose-200'
                    };

                    const sc = statusColors[active.status] || 'bg-slate-100 text-slate-600';
                    const isApproved = active.status === 'APPROVED';
                    const isPending = active.status === 'PENDING';
                    const isVerified = active.status === 'VERIFIED';
                    const isCompleted = active.status === 'COMPLETED';

                    const steps = [
                        { label: 'Applied', active: true, completed: true },
                        { label: 'Faculty Review', active: isApproved || isVerified || isCompleted, completed: isApproved || isVerified || isCompleted },
                        { label: 'Admin Approval', active: isApproved || isVerified || isCompleted, completed: isApproved || isVerified || isCompleted },
                        { label: 'Security Verification', active: isVerified || isCompleted, completed: isVerified || isCompleted },
                        { label: 'Completed', active: isCompleted, completed: isCompleted }
                    ];

                    const timelineHtml = `
                        <div class="mt-4 p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-3">
                            <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-none">Workflow Timeline</p>
                            <div class="flex flex-col gap-3">
                                ${steps.map(step => `
                                    <div class="timeline-step ${step.active ? 'active' : ''} ${step.completed ? 'completed' : ''}">
                                        <div class="timeline-dot"></div>
                                        <p class="text-xs font-bold text-slate-800 leading-none">${step.label}</p>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    `;

                    activeContainer.innerHTML = `
                        <div class="glass-panel p-5 space-y-4 border border-slate-200/50 relative overflow-hidden">
                            <div class="flex justify-between items-start">
                                <div>
                                    <span class="px-2.5 py-0.5 rounded-full border text-[10px] font-extrabold uppercase tracking-wide ${sc}">${active.status}</span>
                                    <h3 class="font-extrabold text-slate-800 text-base mt-2">${active.destination}</h3>
                                    <p class="text-xs text-slate-500 mt-0.5">${active.reason}</p>
                                </div>
                                <div class="text-right">
                                    <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-none">Exit Date</p>
                                    <p class="font-black text-slate-800 text-xs mt-0.5 font-mono">${active.requestDate || ''}</p>
                                </div>
                            </div>
                            
                            ${isApproved ? `
                            <div class="p-4 bg-emerald-50 rounded-2xl border border-emerald-100 flex flex-col items-center gap-3">
                                <div class="w-32 h-32 bg-white rounded-xl border border-emerald-200 flex items-center justify-center">
                                    <span class="material-symbols-outlined text-emerald-600 text-5xl font-light">qr_code_2</span>
                                </div>
                                <div class="text-center">
                                    <p class="text-[10px] font-bold text-emerald-700 uppercase tracking-widest leading-none">Security Gate Pass OTP</p>
                                    <p class="text-2xl font-black text-emerald-800 tracking-wider mt-1 font-mono">${active.otp || '------'}</p>
                                </div>
                            </div>` : ''}

                            ${timelineHtml}
                        </div>
                    `;
                }

                if (history.length === 0) {
                    historyList.innerHTML = `<div class="text-center py-6 text-slate-400 text-xs font-bold uppercase">No history records</div>`;
                } else {
                    historyList.innerHTML = history.map(h => `
                        <div class="p-4 bg-white/60 border border-slate-200/40 rounded-2xl flex justify-between items-center">
                            <div>
                                <h4 class="text-sm font-extrabold text-slate-700 leading-tight">${h.destination}</h4>
                                <p class="text-xs text-slate-400 mt-0.5 font-mono">${h.requestDate}</p>
                            </div>
                            <span class="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 bg-slate-100 text-slate-500 rounded-full border border-slate-200">${h.status}</span>
                        </div>
                    `).join('');
                }
            };

            const loadPasses = async () => {
                loading.show('Loading Exit Passes...');
                try {
                    const res = await api.get('/exit-passes/my');
                    const passes = res.data || res.passes || [];
                    renderPasses(passes);
                } catch (err) {
                    console.error('[ExitPass] Load failed:', err);
                } finally {
                    loading.hide();
                }
            };

            form?.addEventListener('submit', async (e) => {
                e.preventDefault();
                haptic();
                const destination = $('ep-destination').value.trim();
                const reason = $('ep-reason').value.trim();
                const requestDate = $('ep-date').value;

                if (!destination || !reason || !requestDate) return;

                loading.show('Submitting exit pass request...');
                try {
                    const res = await api.post('/exit-passes', { destination, reason, requestDate });
                    if (res.success) {
                        showToast('Gate pass request submitted!', 'success', 2000);
                        closeSheet();
                        form.reset();
                        loadPasses();
                    } else {
                        showToast(res.message || 'Submission failed', 'error', 3000);
                    }
                } catch (err) {
                    console.error('[ExitPass] submission error:', err);
                    showToast('Submission failed. Server error.', 'error', 3000);
                } finally {
                    loading.hide();
                }
            });

            loadPasses();
        }
    },

    // ---- SURVEYS ----
    survey: {
        render: () => `
            <div class="min-h-screen pb-32 bg-[#F8FAFC]">
                <main class="pt-20 px-4 max-w-lg mx-auto space-y-6" id="survey-main-container">
                    <section>
                        <p class="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-1">Feedback</p>
                        <h2 class="text-3xl font-extrabold tracking-tight text-slate-800" style="font-family:'Plus Jakarta Sans',sans-serif">Campus Surveys</h2>
                    </section>

                    <section class="space-y-4">
                        <h3 class="text-sm font-bold uppercase tracking-wider text-slate-400">Active Surveys</h3>
                        <div class="space-y-3" id="active-surveys-list">
                            <div class="h-24 bg-slate-100 rounded-xl animate-pulse"></div>
                        </div>
                    </section>

                    <section class="space-y-3 pt-4">
                        <h3 class="text-sm font-bold uppercase tracking-wider text-slate-400">Completed Surveys</h3>
                        <div class="space-y-3" id="completed-surveys-list">
                            <div class="h-16 bg-slate-100 rounded-xl animate-pulse"></div>
                        </div>
                    </section>
                </main>
                
                <div id="survey-wizard-panel" class="fixed inset-0 bg-[#F8FAFC] z-[125] hidden flex-col">
                    <div class="px-6 py-4 flex items-center justify-between border-b border-slate-200/80 bg-white shadow-sm">
                        <div>
                            <h3 class="font-extrabold text-slate-800 text-sm" id="wizard-survey-title">---</h3>
                            <div id="anonymous-badge" class="mt-0.5 inline-flex items-center gap-1 bg-purple-50 text-purple-700 px-2 py-0.5 border border-purple-100 rounded text-[9px] font-black uppercase tracking-wide hidden">
                                <span class="material-symbols-outlined text-[10px]" style="font-size:10px">visibility_off</span> Anonymous
                            </div>
                        </div>
                        <button onclick="closeSurveyWizard()" class="p-2 hover:bg-slate-100 rounded-full transition-colors active:scale-95 duration-200">
                            <span class="material-symbols-outlined text-slate-500">close</span>
                        </button>
                    </div>
                    <div class="flex-1 overflow-y-auto px-6 py-8 flex flex-col justify-between max-w-md mx-auto w-full">
                        <div class="space-y-6 w-full">
                            <div class="space-y-1.5">
                                <div class="flex justify-between text-[9px] font-bold uppercase tracking-widest text-slate-400">
                                    <span id="wizard-progress-text">Question 1 of 5</span>
                                    <span id="wizard-progress-pct">20% Completed</span>
                                </div>
                                <div class="w-full h-2 bg-slate-200 rounded-full overflow-hidden border border-white">
                                    <div class="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full transition-all duration-300" style="width: 20%;" id="wizard-progress-bar"></div>
                                </div>
                            </div>
                            
                            <div class="space-y-4">
                                <p class="text-[11px] font-bold text-primary uppercase tracking-widest" id="wizard-question-label">Question</p>
                                <h4 class="text-xl font-black text-slate-800 leading-snug" id="wizard-question-text">---</h4>
                            </div>
                            
                            <div id="wizard-answer-control" class="pt-4"></div>
                        </div>

                        <div class="flex gap-4 pt-8 w-full">
                            <button id="wizard-prev-btn" class="flex-1 bg-slate-100 text-slate-600 font-bold py-3.5 rounded-xl active-scale transition-transform flex items-center justify-center gap-1.5 border border-slate-200">
                                <span class="material-symbols-outlined text-sm">arrow_back</span> Back
                            </button>
                            <button id="wizard-next-btn" class="flex-1 bg-primary text-white font-bold py-3.5 rounded-xl shadow-md active-scale transition-transform flex items-center justify-center gap-1.5">
                                Next <span class="material-symbols-outlined text-sm">arrow_forward</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `,
        afterRender: async () => {
            toggleShell(true);
            setActiveNav('services');
            
            const activeList = $('active-surveys-list');
            const completedList = $('completed-surveys-list');
            let activeSurveys = [];
            let completedResponses = [];
            
            let currentSurvey = null;
            let currentQuestions = [];
            let currentQuestionIndex = 0;
            let currentAnswers = {};

            const renderSurveyList = () => {
                if (!activeList || !completedList) return;
                
                if (activeSurveys.length === 0) {
                    activeList.innerHTML = `<div class="p-6 rounded-2xl bg-white/60 border border-slate-200/50 text-center text-slate-400 font-bold text-xs uppercase tracking-wider">No active surveys.</div>`;
                } else {
                    activeList.innerHTML = activeSurveys.map(s => `
                        <div class="glass-panel p-5 space-y-3 border border-slate-200/50 active-scale transition-all duration-300 relative group" onclick="startSurvey('${s.id}')">
                            <div class="flex justify-between items-start">
                                <div>
                                    <h4 class="font-extrabold text-slate-800 text-sm leading-tight">${s.title}</h4>
                                    <p class="text-xs text-slate-500 mt-1 leading-normal line-clamp-2">${s.description}</p>
                                </div>
                                <span class="material-symbols-outlined text-slate-400">chevron_right</span>
                            </div>
                            <div class="flex justify-between items-center pt-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                <span>${s.questions?.length || 0} Questions</span>
                                ${s.isAnonymous ? `<span class="text-purple-600">Anonymous</span>` : '<span>Identified</span>'}
                            </div>
                        </div>
                    `).join('');
                }

                if (completedResponses.length === 0) {
                    completedList.innerHTML = `<div class="p-4 rounded-xl border border-slate-200/30 text-center text-slate-400 font-bold text-xs">No completed surveys.</div>`;
                } else {
                    completedList.innerHTML = completedResponses.map(r => `
                        <div class="p-4 bg-slate-50 border border-slate-200 rounded-2xl flex justify-between items-center active-scale transition-all duration-200 cursor-pointer" onclick="viewCompletedSurvey('${r.id}')">
                            <div>
                                <h4 class="text-xs font-bold text-slate-700 leading-tight">${r.survey?.title}</h4>
                                <p class="text-[10px] text-slate-400 mt-1 font-bold">Submitted on ${new Date(r.submittedAt).toLocaleDateString()}</p>
                            </div>
                            <span class="material-symbols-outlined text-slate-400 text-base">check_circle</span>
                        </div>
                    `).join('');
                }
            };

            const loadSurveys = async () => {
                loading.show('Loading Surveys...');
                try {
                    const [actRes, compRes] = await Promise.all([
                        api.get('/surveys'),
                        api.get('/surveys/submitted')
                    ]);
                    activeSurveys = actRes.surveys || [];
                    completedResponses = compRes.responses || [];
                    renderSurveyList();
                } catch (err) {
                    console.error('[Survey] Load failed:', err);
                } finally {
                    loading.hide();
                }
            };

            window.startSurvey = (surveyId) => {
                const s = activeSurveys.find(x => x.id === surveyId);
                if (!s) return;
                currentSurvey = s;
                currentQuestions = s.questions || [];
                currentQuestionIndex = 0;
                currentAnswers = {};
                
                setEl('wizard-survey-title', 'innerText', s.title);
                if (s.isAnonymous) {
                    $('anonymous-badge')?.classList.remove('hidden');
                } else {
                    $('anonymous-badge')?.classList.add('hidden');
                }

                const panel = $('survey-wizard-panel');
                if (panel) {
                    panel.classList.remove('hidden');
                }
                renderQuestion();
            };

            window.closeSurveyWizard = () => {
                const panel = $('survey-wizard-panel');
                if (panel) panel.classList.add('hidden');
                currentSurvey = null;
                currentQuestions = [];
                currentQuestionIndex = 0;
                currentAnswers = {};
            };

            const renderQuestion = () => {
                const q = currentQuestions[currentQuestionIndex];
                if (!q) return;

                const total = currentQuestions.length;
                const idx = currentQuestionIndex + 1;
                const pct = Math.round((idx / total) * 100);
                setEl('wizard-progress-text', 'innerText', `Question ${idx} of ${total}`);
                setEl('wizard-progress-pct', 'innerText', `${pct}% Completed`);
                
                const bar = $('wizard-progress-bar');
                if (bar) bar.style.width = `${pct}%`;

                setEl('wizard-question-label', 'innerText', `Question ${idx} — ${q.type}`);
                setEl('wizard-question-text', 'innerText', q.text);

                const prevBtn = $('wizard-prev-btn');
                if (prevBtn) {
                    if (currentQuestionIndex === 0) {
                        prevBtn.classList.add('opacity-50', 'pointer-events-none');
                    } else {
                        prevBtn.classList.remove('opacity-50', 'pointer-events-none');
                    }
                }

                const nextBtn = $('wizard-next-btn');
                if (nextBtn) {
                    if (currentQuestionIndex === total - 1) {
                        nextBtn.innerHTML = `Submit <span class="material-symbols-outlined text-sm">done</span>`;
                    } else {
                        nextBtn.innerHTML = `Next <span class="material-symbols-outlined text-sm">arrow_forward</span>`;
                    }
                }

                const container = $('wizard-answer-control');
                if (!container) return;
                
                const savedAns = currentAnswers[q.id] || '';

                if (q.type === 'MCQ') {
                    let choices = [];
                    try { choices = JSON.parse(q.options) || []; } catch(_) {}
                    container.innerHTML = `<div class="space-y-2.5">${choices.map(choice => {
                        const isSelected = savedAns === choice;
                        const borderClass = isSelected ? 'border-primary bg-blue-50/40 text-primary' : 'border-slate-200 hover:bg-slate-50 text-slate-800';
                        return `
                            <div class="mcq-option p-4 border rounded-xl cursor-pointer font-bold text-sm transition-all duration-200 active-scale ${borderClass}" 
                                 onclick="selectOption('${q.id}', '${choice.replace(/'/g, "\\'")}')">
                                ${choice}
                            </div>
                        `;
                    }).join('')}</div>`;
                } else if (q.type === 'RATING') {
                    const stars = [1,2,3,4,5];
                    const selectedVal = parseInt(savedAns) || 0;
                    container.innerHTML = `
                        <div class="flex justify-center gap-4 star-rating select-none">
                            ${stars.map(star => {
                                const filledClass = star <= selectedVal ? 'filled' : '';
                                return `
                                    <button class="star p-1 active-scale text-4xl ${filledClass}" onclick="selectRating('${q.id}', ${star})">
                                        ★
                                    </button>
                                `;
                            }).join('')}
                        </div>
                    `;
                } else {
                    container.innerHTML = `
                        <textarea id="text-ans" placeholder="Type your response here..." class="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-primary transition-all h-36 resize-none bg-slate-50">${savedAns}</textarea>
                    `;
                    const textarea = $('text-ans');
                    textarea?.addEventListener('input', (e) => {
                        currentAnswers[q.id] = e.target.value;
                    });
                }
            };

            window.selectOption = (qid, choice) => {
                haptic();
                currentAnswers[qid] = choice;
                renderQuestion();
            };

            window.selectRating = (qid, stars) => {
                haptic();
                currentAnswers[qid] = stars.toString();
                renderQuestion();
            };

            $('wizard-prev-btn')?.addEventListener('click', () => {
                if (currentQuestionIndex > 0) {
                    haptic();
                    currentQuestionIndex--;
                    renderQuestion();
                }
            });

            $('wizard-next-btn')?.addEventListener('click', async () => {
                const q = currentQuestions[currentQuestionIndex];
                if (!q) return;

                const ans = currentAnswers[q.id] || '';
                if (q.type !== 'TEXT' && (!ans || ans.trim() === '')) {
                    showToast('Please select an option before proceeding.', 'error', 2000);
                    return;
                }

                const total = currentQuestions.length;
                if (currentQuestionIndex < total - 1) {
                    haptic();
                    currentQuestionIndex++;
                    renderQuestion();
                } else {
                    haptic();
                    const submissionAnswers = Object.keys(currentAnswers).map(qid => ({
                        questionId: qid,
                        answer: currentAnswers[qid]
                    }));

                    loading.show('Submitting survey feedback...');
                    try {
                        const res = await api.post(`/surveys/${currentSurvey.id}/submit`, { answers: submissionAnswers });
                        if (res.success) {
                            showToast('Thank you! Survey submitted.', 'success', 2000);
                            closeSurveyWizard();
                            loadSurveys();
                        } else {
                            showToast(res.message || 'Failed to submit survey', 'error', 3000);
                        }
                    } catch (err) {
                        console.error('[Survey] submission error:', err);
                        showToast('Submission failed.', 'error', 3000);
                    } finally {
                        loading.hide();
                    }
                }
            });

            loadSurveys();
        }
    },

    // ---- ANNOUNCEMENTS ----
    announcements: {
        render: () => `
            <div class="min-h-screen pb-32 bg-[#F8FAFC]">
                <main class="pt-20 px-4 max-w-lg mx-auto space-y-5">
                    <section>
                        <p class="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-1">Campus Board</p>
                        <h2 class="text-3xl font-extrabold tracking-tight text-slate-800" style="font-family:'Plus Jakarta Sans',sans-serif">Announcements</h2>
                    </section>
                    
                    <div class="flex gap-2 overflow-x-auto pb-2 hide-scrollbar momentum-scroll select-none" id="ann-category-filters">
                        <button class="px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider bg-primary text-white" data-category="ALL">All</button>
                        <button class="px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider bg-slate-100 text-slate-500" data-category="EXAM">Exams</button>
                        <button class="px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider bg-slate-100 text-slate-500" data-category="PLACEMENT">Placements</button>
                        <button class="px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider bg-slate-100 text-slate-500" data-category="EVENTS">Events</button>
                        <button class="px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider bg-slate-100 text-slate-500" data-category="ACADEMIC">Academic</button>
                        <button class="px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider bg-slate-100 text-slate-500" data-category="HOLIDAY">Holidays</button>
                        <button class="px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider bg-slate-100 text-slate-500" data-category="GENERAL">General</button>
                    </div>

                    <div class="space-y-4" id="announcements-list-container">
                        <div class="h-24 bg-slate-100 rounded-xl animate-pulse"></div>
                    </div>
                </main>
            </div>
        `,
        afterRender: async () => {
            toggleShell(true);
            setActiveNav('services');
            
            const list = $('announcements-list-container');
            const categoryFilters = document.querySelectorAll('#ann-category-filters button');
            let activeCategory = 'ALL';
            let allAnnouncements = [];

            const renderAnnouncements = () => {
                if (!list) return;
                const filtered = activeCategory === 'ALL'
                    ? allAnnouncements
                    : allAnnouncements.filter(a => (a.category || 'GENERAL').toUpperCase() === activeCategory);

                if (filtered.length === 0) {
                    list.innerHTML = `<div class="text-center py-16 text-slate-400 font-bold">No announcements found.</div>`;
                    return;
                }

                list.innerHTML = filtered.map(a => {
                    const isUrgent = (a.priority || '').toUpperCase() === 'URGENT';
                    const isHigh = (a.priority || '').toUpperCase() === 'HIGH';
                    const borderLeftColor = isUrgent ? 'border-l-rose-500' : isHigh ? 'border-l-amber-500' : 'border-l-slate-200';
                    const badgeBg = isUrgent ? 'bg-rose-50 text-rose-600 border border-rose-100' : isHigh ? 'bg-amber-50 text-amber-600 border border-amber-100' : 'bg-slate-50 text-slate-500 border border-slate-100';
                    const catBadge = a.category || 'GENERAL';
                    const dateStr = new Date(a.createdAt).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });

                    return `
                        <div class="glass-panel p-5 space-y-3 border-l-4 ${borderLeftColor} border-r border-t border-b border-slate-200/50 hover:shadow-md transition-all duration-300">
                            <div class="flex justify-between items-start">
                                <span class="px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${badgeBg}">${catBadge}</span>
                                <div class="flex items-center gap-1 text-[10px] font-bold text-slate-400">
                                    <span class="material-symbols-outlined text-[12px]" style="font-size:12px">calendar_today</span> ${dateStr}
                                </div>
                            </div>
                            <div>
                                <h4 class="font-extrabold text-slate-800 text-sm leading-tight">${a.title}</h4>
                                <p class="text-xs text-slate-500 mt-2 leading-relaxed break-words">${a.description}</p>
                            </div>
                            ${a.link ? `
                            <button class="open-link-btn inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 text-blue-600 border border-blue-100 text-[10px] font-bold tracking-wider uppercase active-scale" data-link="${a.link}">
                                View Document <span class="material-symbols-outlined text-xs">open_in_new</span>
                            </button>` : ''}
                        </div>
                    `;
                }).join('');

                list.querySelectorAll('.open-link-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        haptic();
                        const link = btn.dataset.link;
                        if (window.Capacitor?.Plugins?.Browser) {
                            window.Capacitor.Plugins.Browser.open({ url: link }).catch(() => {});
                        } else {
                            window.open(link, '_blank');
                        }
                    });
                });
            };

            const loadAnnouncements = async () => {
                loading.show('Loading Announcements...');
                try {
                    const res = await api.get('/announcements');
                    allAnnouncements = res.announcements || [];
                    renderAnnouncements();
                } catch (err) {
                    console.error('[Announcements] load failed:', err);
                } finally {
                    loading.hide();
                }
            };

            categoryFilters.forEach(btn => {
                btn.addEventListener('click', () => {
                    haptic();
                    activeCategory = btn.dataset.category;
                    categoryFilters.forEach(b => {
                        if (b.dataset.category === activeCategory) {
                            b.className = 'px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider bg-primary text-white';
                        } else {
                            b.className = 'px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider bg-slate-100 text-slate-500';
                        }
                    });
                    renderAnnouncements();
                });
            });

            loadAnnouncements();
        }
    },

    // ---- LOST & FOUND ----
    'lost-found': {
        render: () => `
            <div class="min-h-screen pb-32 bg-[#F8FAFC]">
                <main class="pt-20 px-4 max-w-lg mx-auto space-y-6">
                    <section class="flex justify-between items-center">
                        <div>
                            <p class="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-1">Campus Board</p>
                            <h2 class="text-3xl font-extrabold tracking-tight text-slate-800" style="font-family:'Plus Jakarta Sans',sans-serif">Lost &amp; Found</h2>
                        </div>
                        <button id="report-lf-btn" class="bg-primary text-white font-bold text-xs uppercase tracking-wider px-5 py-2.5 rounded-full shadow-md active-scale transition-all">Report</button>
                    </section>

                    <div class="flex gap-2">
                        <button class="flex-1 lf-filter-btn py-2.5 rounded-xl border border-slate-200/80 bg-primary text-white text-xs font-bold uppercase tracking-wider shadow-sm transition-all" data-type="ALL">All Items</button>
                        <button class="flex-1 lf-filter-btn py-2.5 rounded-xl border border-slate-200/80 bg-white text-slate-600 text-xs font-bold uppercase tracking-wider transition-all" data-type="LOST">🔴 Lost</button>
                        <button class="flex-1 lf-filter-btn py-2.5 rounded-xl border border-slate-200/80 bg-white text-slate-600 text-xs font-bold uppercase tracking-wider transition-all" data-type="FOUND">🟢 Found</button>
                    </div>

                    <div class="space-y-4" id="lf-items-list">
                        <div class="h-24 bg-slate-100 rounded-xl animate-pulse"></div>
                    </div>
                </main>

                <div id="lf-sheet-backdrop" class="bottom-sheet-backdrop hidden opacity-0"></div>
                <div id="lf-sheet" class="bottom-sheet">
                    <div class="px-6 py-4 flex items-center justify-between border-b border-slate-100">
                        <h3 class="font-extrabold text-slate-800 text-lg">Report Item</h3>
                        <button id="close-lf-sheet" class="p-2 hover:bg-slate-100 rounded-full transition-colors"><span class="material-symbols-outlined text-slate-500">close</span></button>
                    </div>
                    <form id="lf-form" class="p-6 space-y-4 overflow-y-auto">
                        <div class="flex gap-2 select-none">
                            <button type="button" id="lf-type-lost-btn" class="flex-1 py-3 bg-red-50 border-2 border-red-500 text-red-700 rounded-xl text-xs font-extrabold uppercase tracking-wide transition-all">Lost</button>
                            <button type="button" id="lf-type-found-btn" class="flex-1 py-3 bg-slate-50 border border-slate-200 text-slate-500 rounded-xl text-xs font-extrabold uppercase tracking-wide transition-all">Found</button>
                        </div>
                        <div class="space-y-1">
                            <label class="text-xs font-bold text-slate-500 uppercase tracking-wide">Item Name</label>
                            <input type="text" id="lf-title" required placeholder="e.g. Water Bottle, Keys, Wallet" class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-primary transition-all" />
                        </div>
                        <div class="space-y-1">
                            <label class="text-xs font-bold text-slate-500 uppercase tracking-wide">Description &amp; Key Details</label>
                            <textarea id="lf-description" required placeholder="Describe details (color, brand, scratches...)" class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-primary transition-all h-20 resize-none"></textarea>
                        </div>
                        <div class="space-y-1">
                            <label class="text-xs font-bold text-slate-500 uppercase tracking-wide">Location</label>
                            <input type="text" id="lf-location" required placeholder="e.g. Library 2nd floor, Room B-101" class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-primary transition-all" />
                        </div>
                        <div class="space-y-1">
                            <label class="text-xs font-bold text-slate-500 uppercase tracking-wide">Image URLs (Up to 3, comma separated)</label>
                            <input type="text" id="lf-images" placeholder="URL 1, URL 2..." class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-primary transition-all" />
                        </div>
                        <button type="submit" class="w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold py-3.5 rounded-xl shadow-md active-scale transition-transform">Post Report</button>
                    </form>
                </div>

                <div id="lf-claim-backdrop" class="bottom-sheet-backdrop hidden opacity-0"></div>
                <div id="lf-claim-sheet" class="bottom-sheet">
                    <div class="px-6 py-4 flex items-center justify-between border-b border-slate-100">
                        <h3 class="font-extrabold text-slate-800 text-lg">Submit Claim Request</h3>
                        <button id="close-lf-claim-sheet" class="p-2 hover:bg-slate-100 rounded-full transition-colors"><span class="material-symbols-outlined text-slate-500">close</span></button>
                    </div>
                    <form id="lf-claim-form" class="p-6 space-y-4">
                        <div class="space-y-1">
                            <label class="text-xs font-bold text-slate-500 uppercase tracking-wide">Claim Verification Description</label>
                            <textarea id="lf-claim-message" required placeholder="Please describe identifying marks or contents of the item to confirm you are the owner..." class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-primary transition-all h-28 resize-none"></textarea>
                        </div>
                        <button type="submit" class="w-full bg-primary text-white font-bold py-3.5 rounded-xl shadow-md active-scale transition-transform">Submit Claim</button>
                    </form>
                </div>
            </div>
        `,
        afterRender: async () => {
            toggleShell(true);
            setActiveNav('services');
            
            const list = $('lf-items-list');
            const sheet = $('lf-sheet');
            const backdrop = $('lf-sheet-backdrop');
            const applyBtn = $('report-lf-btn');
            const closeBtn = $('close-lf-sheet');
            const form = $('lf-form');
            
            const claimSheet = $('lf-claim-sheet');
            const claimBackdrop = $('lf-claim-backdrop');
            const closeClaimBtn = $('close-lf-claim-sheet');
            const claimForm = $('lf-claim-form');

            const filterBtns = document.querySelectorAll('.lf-filter-btn');
            let activeFilter = 'ALL';
            let allItems = [];
            let currentClaimItemId = null;
            let reportType = 'LOST';

            const setFormType = (type) => {
                reportType = type;
                const lostBtn = $('lf-type-lost-btn');
                const foundBtn = $('lf-type-found-btn');
                if (type === 'LOST') {
                    lostBtn.className = 'flex-1 py-3 bg-red-50 border-2 border-red-500 text-red-700 rounded-xl text-xs font-extrabold uppercase tracking-wide transition-all';
                    foundBtn.className = 'flex-1 py-3 bg-slate-50 border border-slate-200 text-slate-500 rounded-xl text-xs font-extrabold uppercase tracking-wide transition-all';
                } else {
                    lostBtn.className = 'flex-1 py-3 bg-slate-50 border border-slate-200 text-slate-500 rounded-xl text-xs font-extrabold uppercase tracking-wide transition-all';
                    foundBtn.className = 'flex-1 py-3 bg-emerald-50 border-2 border-emerald-500 text-emerald-700 rounded-xl text-xs font-extrabold uppercase tracking-wide transition-all';
                }
            };

            $('lf-type-lost-btn')?.addEventListener('click', () => setFormType('LOST'));
            $('lf-type-found-btn')?.addEventListener('click', () => setFormType('FOUND'));

            const openSheet = () => {
                haptic();
                backdrop.classList.remove('hidden');
                sheet.classList.remove('hidden');
                setTimeout(() => {
                    backdrop.classList.add('opacity-100');
                    sheet.classList.add('open');
                }, 10);
            };

            const closeSheet = () => {
                backdrop.classList.remove('opacity-100');
                sheet.classList.remove('open');
                setTimeout(() => {
                    backdrop.classList.add('hidden');
                }, 300);
            };

            applyBtn?.addEventListener('click', openSheet);
            backdrop?.addEventListener('click', closeSheet);
            closeBtn?.addEventListener('click', closeSheet);

            const openClaimSheet = (itemId) => {
                haptic();
                currentClaimItemId = itemId;
                claimBackdrop.classList.remove('hidden');
                claimSheet.classList.remove('hidden');
                setTimeout(() => {
                    claimBackdrop.classList.add('opacity-100');
                    claimSheet.classList.add('open');
                }, 10);
            };

            const closeClaimSheet = () => {
                claimBackdrop.classList.remove('opacity-100');
                claimSheet.classList.remove('open');
                setTimeout(() => {
                    claimBackdrop.classList.add('hidden');
                    currentClaimItemId = null;
                }, 300);
            };

            claimBackdrop?.addEventListener('click', closeClaimSheet);
            closeClaimBtn?.addEventListener('click', closeClaimSheet);

            const renderItems = () => {
                if (!list) return;
                const filtered = activeFilter === 'ALL'
                    ? allItems
                    : allItems.filter(item => item.type === activeFilter);

                if (filtered.length === 0) {
                    list.innerHTML = `<div class="text-center py-16 text-slate-400 font-bold">No lost or found reports.</div>`;
                    return;
                }

                list.innerHTML = filtered.map(item => {
                    const isOwner = item.studentId === state.profile?.id;
                    const badgeClass = item.type === 'LOST' ? 'bg-rose-50 text-rose-600 border-rose-100' : 'bg-emerald-50 text-emerald-600 border-emerald-100';
                    const statusClass = item.status === 'CLAIMED' ? 'bg-slate-100 text-slate-600' : item.status === 'CLAIM_REQUESTED' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700';
                    
                    let imgs = [];
                    try { imgs = JSON.parse(item.imageUrls) || []; } catch(_) {}
                    const imagesHtml = imgs.length > 0 ? `
                        <div class="flex gap-2 overflow-x-auto pb-1 mt-2 hide-scrollbar">
                            ${imgs.map(url => `<img src="${url}" class="w-20 h-20 rounded-lg object-cover border border-slate-200 flex-shrink-0" />`).join('')}
                        </div>
                    ` : '';

                    let actionsHtml = '';
                    if (item.status === 'ACTIVE' && !isOwner) {
                        actionsHtml = `
                            <button class="claim-item-btn w-full mt-3 bg-blue-50 text-blue-600 font-extrabold text-xs uppercase tracking-wider py-2.5 rounded-xl border border-blue-100 active-scale" data-id="${item.id}">
                                Claim Item
                            </button>
                        `;
                    } else if (item.status === 'CLAIM_REQUESTED') {
                        const verifiedClaim = item.claims?.find(c => c.status === 'VERIFIED');
                        if (isOwner && verifiedClaim) {
                            actionsHtml = `
                                <div class="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-2">
                                    <p class="text-xs font-bold text-amber-800">Claim Verified by Admin: "${verifiedClaim.message || ''}"</p>
                                    <button class="confirm-claim-btn w-full bg-emerald-600 text-white font-extrabold text-xs uppercase tracking-wider py-2.5 rounded-xl active-scale" data-id="${item.id}" data-claim-id="${verifiedClaim.id}">
                                        Confirm Return
                                    </button>
                                </div>
                            `;
                        } else {
                            actionsHtml = `
                                <div class="mt-3 p-2 bg-amber-50 border border-amber-100 text-amber-700 rounded-xl text-center text-[10px] font-bold uppercase tracking-wider">
                                    Awaiting Claim Verification
                                </div>
                            `;
                        }
                    } else if (item.status === 'CLAIMED') {
                        actionsHtml = `
                            <div class="mt-3 p-2 bg-slate-100 border border-slate-200 text-slate-500 rounded-xl text-center text-[10px] font-bold uppercase tracking-wider">
                                ✓ Returned &amp; Closed
                            </div>
                        `;
                    }

                    return `
                        <div class="glass-panel p-5 space-y-3 border border-slate-200/50 active-scale transition-all duration-300">
                            <div class="flex justify-between items-start">
                                <div class="flex items-center gap-2">
                                    <span class="px-2.5 py-0.5 rounded-full border text-[9px] font-black uppercase tracking-wider ${badgeClass}">${item.type}</span>
                                    <span class="px-2.5 py-0.5 rounded-full border text-[9px] font-black uppercase tracking-wider ${statusClass}">${item.status}</span>
                                </div>
                                <span class="text-[10px] font-bold text-slate-400 font-mono">${new Date(item.createdAt).toLocaleDateString()}</span>
                            </div>
                            <div>
                                <h4 class="font-extrabold text-slate-800 text-sm">${item.title}</h4>
                                <p class="text-xs text-slate-500 mt-1 leading-normal break-words">${item.description}</p>
                                <p class="text-[10px] text-slate-400 font-bold mt-2 flex items-center gap-1">
                                    <span class="material-symbols-outlined text-xs" style="font-size:12px">location_on</span> ${item.location}
                                </p>
                                ${imagesHtml}
                            </div>
                            ${actionsHtml}
                        </div>
                    `;
                }).join('');

                list.querySelectorAll('.claim-item-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        openClaimSheet(btn.dataset.id);
                    });
                });

                list.querySelectorAll('.confirm-claim-btn').forEach(btn => {
                    btn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        haptic();
                        const id = btn.dataset.id;
                        const claimId = btn.dataset.claimId;
                        loading.show('Confirming claim...');
                        try {
                            const res = await api.post(`/lost-found/${id}/confirm-claim`, { claimId });
                            if (res.success) {
                                showToast('Claim confirmed! Marked as returned.', 'success', 2000);
                                loadItems();
                            } else {
                                showToast(res.message || 'Confirmation failed', 'error', 3000);
                            }
                        } catch (_) {
                            showToast('Confirmation failed.', 'error', 3000);
                        } finally {
                            loading.hide();
                        }
                    });
                });
            };

            const loadItems = async () => {
                loading.show('Loading Items...');
                try {
                    const res = await api.get('/lost-found');
                    allItems = res.items || [];
                    renderItems();
                } catch (err) {
                    console.error('[LostFound] load failed:', err);
                } finally {
                    loading.hide();
                }
            };

            filterBtns.forEach(btn => {
                btn.addEventListener('click', () => {
                    haptic();
                    activeFilter = btn.dataset.type;
                    filterBtns.forEach(b => {
                        if (b.dataset.type === activeFilter) {
                            b.className = 'flex-1 lf-filter-btn py-2.5 rounded-xl border border-slate-200/80 bg-primary text-white text-xs font-bold uppercase tracking-wider shadow-sm transition-all';
                        } else {
                            b.className = 'flex-1 lf-filter-btn py-2.5 rounded-xl border border-slate-200/80 bg-white text-slate-600 text-xs font-bold uppercase tracking-wider transition-all';
                        }
                    });
                    renderItems();
                });
            });

            form?.addEventListener('submit', async (e) => {
                e.preventDefault();
                haptic();
                const title = $('lf-title').value.trim();
                const description = $('lf-description').value.trim();
                const location = $('lf-location').value.trim();
                const imagesStr = $('lf-images').value.trim();
                
                let imageUrls = [];
                if (imagesStr) {
                    imageUrls = imagesStr.split(',').map(s => s.trim()).filter(Boolean).slice(0, 3);
                }

                if (!title || !description || !location) return;

                loading.show('Posting report...');
                try {
                    const res = await api.post('/lost-found', { title, description, location, type: reportType, imageUrls });
                    if (res.success) {
                        showToast('Report posted successfully!', 'success', 2000);
                        closeSheet();
                        form.reset();
                        loadItems();
                    }
                } catch (_) {
                    showToast('Failed to post report.', 'error', 3000);
                } finally {
                    loading.hide();
                }
            });

            claimForm?.addEventListener('submit', async (e) => {
                e.preventDefault();
                haptic();
                const message = $('lf-claim-message').value.trim();
                if (!message || !currentClaimItemId) return;

                loading.show('Submitting claim...');
                try {
                    const res = await api.post(`/lost-found/${currentClaimItemId}/claim`, { message });
                    if (res.success) {
                        showToast('Claim submitted! Awaiting Admin verification.', 'success', 2500);
                        closeClaimSheet();
                        claimForm.reset();
                        loadItems();
                    }
                } catch (_) {
                    showToast('Failed to submit claim.', 'error', 3000);
                } finally {
                    loading.hide();
                }
            });

            if (!state.profile) {
                api.get('/profile').then(p => { state.profile = p.data; }).catch(() => {});
            }

            loadItems();
        }
    },

    // ---- HELP DESK ----
    help: {
        render: () => `
            <div class="min-h-screen pb-32 bg-[#F8FAFC]">
                <main class="pt-20 px-4 max-w-lg mx-auto space-y-6" id="help-main-container">
                    <section class="flex justify-between items-center">
                        <div>
                            <p class="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-1">Support</p>
                            <h2 class="text-3xl font-extrabold tracking-tight text-slate-800" style="font-family:'Plus Jakarta Sans',sans-serif">Help Desk</h2>
                        </div>
                        <button id="raise-ticket-btn" class="bg-primary text-white font-bold text-xs uppercase tracking-wider px-5 py-2.5 rounded-full shadow-md active-scale transition-all">Raise Ticket</button>
                    </section>

                    <div class="space-y-4" id="tickets-list-container">
                        <div class="h-24 bg-slate-100 rounded-xl animate-pulse"></div>
                    </div>
                </main>

                <div id="ticket-chat-panel" class="fixed inset-0 bg-[#F8FAFC] z-[125] hidden flex-col">
                    <div class="px-6 py-4 flex items-center justify-between border-b border-slate-200/80 bg-white shadow-sm">
                        <div>
                            <h3 class="font-extrabold text-slate-800 text-sm font-mono" id="chat-ticket-no">#HD-2026-000000</h3>
                            <p class="text-[10px] text-slate-500 font-bold uppercase tracking-wider" id="chat-ticket-subject">---</p>
                        </div>
                        <button onclick="closeTicketChat()" class="p-2 hover:bg-slate-100 rounded-full transition-colors active:scale-95 duration-200">
                            <span class="material-symbols-outlined text-slate-500">close</span>
                        </button>
                    </div>
                    <div class="flex-1 overflow-y-auto px-4 py-6 space-y-4 flex flex-col" id="chat-bubbles-container"></div>
                    <div class="px-4 py-3 bg-white border-t border-slate-200/80 flex items-center gap-3">
                        <input type="text" id="chat-reply-input" placeholder="Type support reply..." class="flex-1 text-sm text-slate-800 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-primary transition-all" />
                        <button id="chat-send-btn" class="p-3 bg-primary text-white rounded-xl active-scale transition-transform flex items-center justify-center shadow-md">
                            <span class="material-symbols-outlined text-base">send</span>
                        </button>
                    </div>
                </div>

                <div id="ticket-sheet-backdrop" class="bottom-sheet-backdrop hidden opacity-0"></div>
                <div id="ticket-sheet" class="bottom-sheet">
                    <div class="px-6 py-4 flex items-center justify-between border-b border-slate-100">
                        <h3 class="font-extrabold text-slate-800 text-lg">Raise Support Ticket</h3>
                        <button id="close-ticket-sheet" class="p-2 hover:bg-slate-100 rounded-full transition-colors"><span class="material-symbols-outlined text-slate-500">close</span></button>
                    </div>
                    <form id="ticket-form" class="p-6 space-y-4 overflow-y-auto">
                        <div class="space-y-1">
                            <label class="text-xs font-bold text-slate-500 uppercase tracking-wide">Category</label>
                            <select id="ticket-category" required class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-primary transition-all">
                                <option value="Academic">Academic (ETA: 24 Hours)</option>
                                <option value="Technical">Technical (ETA: 6 Hours)</option>
                                <option value="Fees">Fees (ETA: 48 Hours)</option>
                                <option value="Hostel">Hostel (ETA: 24 Hours)</option>
                                <option value="General">General (ETA: 48 Hours)</option>
                            </select>
                        </div>
                        <div class="space-y-1">
                            <label class="text-xs font-bold text-slate-500 uppercase tracking-wide">Priority</label>
                            <div class="flex gap-2 select-none">
                                <button type="button" data-priority="LOW" class="flex-1 py-2 rounded-lg border border-slate-200 bg-slate-50 text-slate-600 text-xs font-bold uppercase ticket-priority-btn">Low</button>
                                <button type="button" data-priority="NORMAL" class="flex-1 py-2 rounded-lg border-2 border-primary bg-blue-50/50 text-primary text-xs font-bold uppercase ticket-priority-btn">Normal</button>
                                <button type="button" data-priority="HIGH" class="flex-1 py-2 rounded-lg border border-slate-200 bg-slate-50 text-slate-600 text-xs font-bold uppercase ticket-priority-btn">High</button>
                            </div>
                        </div>
                        <div class="space-y-1">
                            <label class="text-xs font-bold text-slate-500 uppercase tracking-wide">Subject</label>
                            <input type="text" id="ticket-subject" required placeholder="Brief summary of the issue..." class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-primary transition-all" />
                        </div>
                        <div class="space-y-1">
                            <label class="text-xs font-bold text-slate-500 uppercase tracking-wide">Detailed Description</label>
                            <textarea id="ticket-description" required placeholder="Describe the issue in detail (min 20 characters)..." class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-primary transition-all h-24 resize-none"></textarea>
                        </div>
                        <button type="submit" class="w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold py-3.5 rounded-xl shadow-md active-scale transition-transform">Submit Ticket</button>
                    </form>
                </div>
            </div>
        `,
        afterRender: async () => {
            toggleShell(true);
            setActiveNav('services');
            
            const list = $('tickets-list-container');
            const sheet = $('ticket-sheet');
            const backdrop = $('ticket-sheet-backdrop');
            const applyBtn = $('raise-ticket-btn');
            const closeBtn = $('close-ticket-sheet');
            const form = $('ticket-form');
            const chatPanel = $('ticket-chat-panel');
            const chatBubbles = $('chat-bubbles-container');
            const replyInput = $('chat-reply-input');
            const sendBtn = $('chat-send-btn');
            const priorityBtns = document.querySelectorAll('.ticket-priority-btn');

            let allTickets = [];
            let currentTicketId = null;
            let ticketPriority = 'NORMAL';

            priorityBtns.forEach(btn => {
                btn.addEventListener('click', () => {
                    haptic();
                    ticketPriority = btn.dataset.priority;
                    priorityBtns.forEach(b => {
                        if (b.dataset.priority === ticketPriority) {
                            b.className = 'flex-1 py-2 rounded-lg border-2 border-primary bg-blue-50/50 text-primary text-xs font-bold uppercase ticket-priority-btn';
                        } else {
                            b.className = 'flex-1 py-2 rounded-lg border border-slate-200 bg-slate-50 text-slate-600 text-xs font-bold uppercase ticket-priority-btn';
                        }
                    });
                });
            });

            const openSheet = () => {
                haptic();
                backdrop.classList.remove('hidden');
                sheet.classList.remove('hidden');
                setTimeout(() => {
                    backdrop.classList.add('opacity-100');
                    sheet.classList.add('open');
                }, 10);
            };

            const closeSheet = () => {
                backdrop.classList.remove('opacity-100');
                sheet.classList.remove('open');
                setTimeout(() => {
                    backdrop.classList.add('hidden');
                }, 300);
            };

            applyBtn?.addEventListener('click', openSheet);
            backdrop?.addEventListener('click', closeSheet);
            closeBtn?.addEventListener('click', closeSheet);

            const renderTickets = () => {
                if (!list) return;

                if (allTickets.length === 0) {
                    list.innerHTML = `<div class="p-6 rounded-2xl bg-white/60 border border-slate-200/50 text-center text-slate-400 font-bold text-xs uppercase tracking-wider">No tickets raised.</div>`;
                    return;
                }

                list.innerHTML = allTickets.map(t => {
                    let sc = 'status-open';
                    if (t.status === 'IN_PROGRESS') sc = 'status-in-progress';
                    else if (t.status === 'RESOLVED') sc = 'status-resolved';
                    else if (t.status === 'CLOSED') sc = 'status-closed';

                    let prColor = 'bg-slate-100 text-slate-600';
                    if (t.priority === 'HIGH') prColor = 'bg-amber-100 text-amber-800';
                    else if (t.priority === 'URGENT') prColor = 'bg-rose-100 text-rose-800';

                    return `
                        <div class="glass-panel p-5 space-y-3 border border-slate-200/50 active-scale transition-all duration-300 cursor-pointer" onclick="openTicketChat('${t.id}')">
                            <div class="flex justify-between items-center">
                                <div class="flex items-center gap-1.5">
                                    <span class="px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider bg-blue-50 text-blue-600 border border-blue-100">${t.category}</span>
                                    <span class="px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider ${prColor}">${t.priority}</span>
                                </div>
                                <span class="status-chip ${sc}">${t.status}</span>
                            </div>
                            <div>
                                <h4 class="font-extrabold text-slate-800 text-sm leading-tight font-mono">${t.ticketNumber}</h4>
                                <p class="text-xs font-bold text-slate-500 mt-1 leading-snug">${t.subject}</p>
                                <p class="text-[10px] text-slate-400 font-bold mt-2">⏱ Est. Response: ${t.estimatedResponseTime || '24 hours'}</p>
                            </div>
                        </div>
                    `;
                }).join('');
            };

            const loadTickets = async () => {
                loading.show('Loading Support Tickets...');
                try {
                    const res = await api.get('/help-desk');
                    allTickets = res.tickets || [];
                    renderTickets();
                } catch (err) {
                    console.error('[HelpDesk] Load failed:', err);
                } finally {
                    loading.hide();
                }
            };

            window.openTicketChat = async (ticketId) => {
                haptic();
                currentTicketId = ticketId;
                const ticket = allTickets.find(t => t.id === ticketId);
                if (!ticket) return;

                setEl('chat-ticket-no', 'innerText', ticket.ticketNumber);
                setEl('chat-ticket-subject', 'innerText', ticket.subject);

                if (chatPanel) {
                    chatPanel.classList.remove('hidden');
                }
                loadChatMessages();
            };

            window.closeTicketChat = () => {
                if (chatPanel) chatPanel.classList.add('hidden');
                currentTicketId = null;
                if (replyInput) replyInput.value = '';
            };

            const loadChatMessages = async () => {
                if (!currentTicketId || !chatBubbles) return;
                
                chatBubbles.innerHTML = `<div class="text-center py-12 text-slate-400 text-xs font-bold">Loading conversation...</div>`;
                
                try {
                    const res = await api.get(`/help-desk/${currentTicketId}`);
                    const ticket = res.ticket || {};
                    const replies = ticket.replies || [];

                    let html = `
                        <div class="chat-bubble-admin px-4 py-3 rounded-2xl max-w-[85%] text-sm leading-relaxed shadow-sm">
                            <p class="font-black text-[10px] text-slate-400 uppercase tracking-widest mb-1">Issue Description</p>
                            <p>${ticket.description}</p>
                            <span class="text-[9px] font-bold text-slate-400 block text-right mt-1 font-mono">${new Date(ticket.createdAt).toLocaleTimeString()}</span>
                        </div>
                    `;

                    replies.forEach(reply => {
                        const isStudent = reply.senderType === 'STUDENT';
                        const bubbleClass = isStudent ? 'chat-bubble-student' : 'chat-bubble-admin';
                        const labelName = isStudent ? 'You' : reply.senderName || 'Support Admin';
                        const labelColor = isStudent ? 'text-blue-200' : 'text-slate-400';
                        
                        html += `
                            <div class="${bubbleClass} px-4 py-3 rounded-2xl max-w-[85%] text-sm leading-relaxed shadow-sm">
                                <p class="font-black text-[10px] ${labelColor} uppercase tracking-widest mb-1">${labelName}</p>
                                <p>${reply.message}</p>
                                <span class="text-[9px] font-bold ${isStudent ? 'text-blue-100/75' : 'text-slate-400'} block text-right mt-1 font-mono">${new Date(reply.createdAt).toLocaleTimeString()}</span>
                            </div>
                        `;
                    });

                    chatBubbles.innerHTML = html;
                    
                    setTimeout(() => {
                        chatBubbles.scrollTop = chatBubbles.scrollHeight;
                    }, 50);
                } catch (err) {
                    console.error('[HelpDesk] Load chat failed:', err);
                }
            };

            const sendReply = async () => {
                const message = replyInput.value.trim();
                if (!message || !currentTicketId) return;

                haptic();
                replyInput.value = '';
                try {
                    const res = await api.post(`/help-desk/${currentTicketId}/reply`, { message });
                    if (res.success) {
                        loadChatMessages();
                    }
                } catch (err) {
                    console.error('[HelpDesk] send reply failed:', err);
                }
            };

            sendBtn?.addEventListener('click', sendReply);
            replyInput?.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') sendReply();
            });

            form?.addEventListener('submit', async (e) => {
                e.preventDefault();
                haptic();
                const category = $('ticket-category').value;
                const subject = $('ticket-subject').value.trim();
                const description = $('ticket-description').value.trim();

                if (!subject || !description || description.length < 20) {
                    showToast('Description must be at least 20 characters long.', 'error', 3000);
                    return;
                }

                loading.show('Raising ticket...');
                try {
                    const res = await api.post('/help-desk', { subject, description, category, priority: ticketPriority });
                    if (res.success) {
                        showToast(`Ticket Raised! ETA: ${res.ticket?.estimatedResponseTime}`, 'success', 4000);
                        closeSheet();
                        form.reset();
                        loadTickets();
                    }
                } catch (_) {
                    showToast('Failed to raise support ticket.', 'error', 3000);
                } finally {
                    loading.hide();
                }
            });

            loadTickets();
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
            '/maintenance': pages.maintenance,
            '/academics': pages.academics,
            '/career': pages.career,
            '/services': pages.services,
            '/exit-pass': pages['exit-pass'],
            '/survey': pages.survey,
            '/announcements': pages.announcements,
            '/lost-found': pages['lost-found'],
            '/help': pages.help
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

        // Cancel all pending/in-flight low/medium priority requests on route change
        RequestQueue.cancelLowPriority();
        api.abortLowPriorityRequests();

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
            // Hide ALL other nodes — including the non-cached login/profile node
            // This is critical: the login page must NEVER remain visible after navigation to dashboard
            _pageCache.forEach(entry => { if (entry.node) entry.node.style.display = 'none'; });
            const _nonCached = this.app.querySelector('.sitam-page-non-cached');
            if (_nonCached) _nonCached.style.display = 'none';

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
            // Clear all keepAlive nodes — hide them all
            _pageCache.forEach(entry => { if (entry.node) entry.node.style.display = 'none'; });

            // Destroy and recreate the non-cached container on every non-cached navigation.
            // This ensures the login DOM is COMPLETELY REMOVED from memory on any navigation away from it.
            const existingNonCached = this.app.querySelector('.sitam-page-non-cached');
            if (existingNonCached) {
                existingNonCached.remove();
            }
            const nonCachedNode = document.createElement('div');
            nonCachedNode.className = 'sitam-page-non-cached';
            this.app.appendChild(nonCachedNode);
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
    logBoot("BOOT 2 - DOMContentLoaded fired");
    logBoot("BOOT 3 - DOM elements resolved / mock React mounted");

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
    const handleConnectivityChange = (connected) => {
        if (typeof connected === 'boolean') {
            state.isOnline = connected;
        } else {
            state.isOnline = navigator.onLine;
        }
        
        const offlineBanner = $('offline-banner');
        if (!offlineBanner) return;
        
        if (state.isOnline) {
            offlineBanner.classList.add('-translate-y-full');
        } else {
            offlineBanner.classList.remove('-translate-y-full');
        }
    };
    window.addEventListener('online', () => handleConnectivityChange(true));
    window.addEventListener('offline', () => handleConnectivityChange(false));

    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Network) {
        const { Network } = window.Capacitor.Plugins;
        Network.getStatus().then(status => {
            console.log('[Network] Initial status:', status);
            handleConnectivityChange(status.connected);
        }).catch(err => {
            console.error('[Network] Failed to get status:', err);
            handleConnectivityChange(navigator.onLine);
        });
        Network.addListener('networkStatusChange', status => {
            console.log('[Network] Status changed:', status);
            handleConnectivityChange(status.connected);
        });
    } else {
        handleConnectivityChange(navigator.onLine);
    }

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

    const _splashDismiss = () => {
        const splash = $('sitam-splash');
        if (splash && !splash.classList.contains('opacity-0')) {
            splash.classList.add('opacity-0', 'pointer-events-none');
            setTimeout(() => { if (splash.parentNode) splash.remove(); }, 700);
        }
    };

    // Refactored async initialization with timeout, try/catch, and finally
    async function initializeApplication() {
        logBoot("\n====================================");
        logBoot("BOOT START");
        logBoot(`Platform: ${window.Capacitor ? 'Capacitor native' : 'Web Browser'}`);
        logBoot(`Resolved API_BASE: ${API_BASE}`);
        logBoot(`Capacitor Platform: ${window.Capacitor?.platform || 'N/A'}`);
        logBoot(`window.API_BASE_URL: ${window.API_BASE_URL || 'undefined'}`);
        logBoot(`navigator.onLine: ${navigator.onLine}`);
        logBoot("====================================\n");
        let timeoutTriggered = false;
        let isDone = false;

        const bootTimeout = setTimeout(() => {
            if (isDone) return;
            timeoutTriggered = true;
            console.error('[Boot] Startup initialization exceeded 4s timeout failsafe! STAGE: Timeout triggered before bootstrap finished');
            // Safe fallback
            _splashDismiss();
            logBoot("BOOT 10 - Navigate to login (Timeout fallback)");
            router.handle();
            checkSyncStatus();
        }, 4000);

        try {
            console.log('[Boot] Running secure storage bootstrap...');
            try {
                await secureStorage.bootstrap();
                logBoot("BOOT 5 - Secure Storage initialized");
            } catch (storageErr) {
                console.error('[Boot] secureStorage.bootstrap() threw an error:', storageErr);
            }

            if (timeoutTriggered) {
                console.warn('[Boot] secureStorage.bootstrap() finished but timeout had already triggered');
                return;
            }

            logBoot("BOOT 6 - Config loaded");
            state.token = secureStorage.getItem('token') || null;
            // Validate token expiry — invalidate if older than 7 days
            if (state.token) {
                const expiryRaw = secureStorage.getItem('tokenExpiry');
                const expiry = expiryRaw ? parseInt(expiryRaw, 10) : 0;
                if (expiry > 0 && Date.now() > expiry) {
                    console.warn('[Boot] Stored token has expired — clearing session');
                    state.token = null;
                    await secureStorage.removeItem('token');
                    await secureStorage.removeItem('tokenExpiry');
                } else if (expiry === 0) {
                    // Legacy token with no expiry — stamp it with 7-day window from now
                    const SESSION_7_DAYS = 7 * 24 * 60 * 60 * 1000;
                    await secureStorage.setItem('tokenExpiry', String(Date.now() + SESSION_7_DAYS));
                }
            }
            console.log("[Boot] Token verified, state.token is present:", !!state.token);
            if (progressBar) progressBar.style.width = '100%';

            // Smooth delay for progress bar completion
            console.log('[Boot] Awaiting progress bar animation delay...');
            try {
                await new Promise(resolve => setTimeout(resolve, 800));
                console.log('[Boot] Progress bar animation delay complete');
            } catch (delayErr) {
                console.error('[Boot] Animation delay failed:', delayErr);
            }

            logBoot("BOOT 8 - API health request starting");
            try {
                // Fetch backend liveness status with 3s timeout
                const controller = new AbortController();
                const id = setTimeout(() => controller.abort(), 3000);
                console.log('[Boot] Fetching liveness from endpoint:', API_BASE + '/health/liveness');
                const res = await fetch(API_BASE + '/health/liveness', { signal: controller.signal });
                clearTimeout(id);
                const text = await res.text();
                logBoot("BOOT 9 - API response received. Status: " + res.status + " Body: " + text);
            } catch (healthErr) {
                logBoot("BOOT 9 - API response failed / connection error: " + (healthErr.message || healthErr));
            }

        } catch (err) {
            console.error('[Boot] secureStorage bootstrap failed with outer exception:', err);
        } finally {
            isDone = true;
            clearTimeout(bootTimeout);
            
            if (!timeoutTriggered) {
                _splashDismiss();
                logBoot("BOOT 7 - Router initialized");
                logBoot("BOOT 10 - Navigate to login");
                try {
                    router.handle();
                    console.log('[Boot] router.handle() complete');
                } catch (routerErr) {
                    console.error('[Boot] router.handle() crashed:', routerErr);
                }
                try {
                    checkSyncStatus();
                    console.log('[Boot] checkSyncStatus() complete');
                } catch (syncErr) {
                    console.error('[Boot] checkSyncStatus() crashed:', syncErr);
                }
                
                // Warm cache for returning users (token already set from a previous session).
                // _prefetchInFlight deduplication in prefetchAll() ensures that if the
                // post-login path already triggered prefetchAll (e.g. fresh login), this
                // call joins that same promise instead of spawning a second request storm.
                if (state.token) {
                    try {
                        console.log('[Boot] Warming cache for returning session via prefetchAll()...');
                        prefetchAll().catch(e => console.error('[Boot] prefetchAll background error:', e));
                    } catch (prefetchErr) {
                        console.error('[Boot] prefetchAll trigger error:', prefetchErr);
                    }
                }
            }
        }
    }

    // Trigger startup audit and initialization
    initializeApplication();

    window.toggleSearchOverlay = (show) => {
        const overlay = $('search-overlay');
        const input = $('global-search-input');
        if (!overlay) return;
        if (show) {
            overlay.classList.remove('hidden');
            setTimeout(() => {
                overlay.classList.remove('opacity-0');
                input?.focus();
            }, 10);
        } else {
            overlay.classList.add('opacity-0');
            setTimeout(() => {
                overlay.classList.add('hidden');
                if (input) input.value = '';
                const container = $('search-results-container');
                if (container) container.innerHTML = `<div class="text-center py-16 text-slate-400 text-xs font-bold uppercase tracking-wider">Type to start searching...</div>`;
            }, 300);
        }
    };

    const searchInput = $('global-search-input');
    const resultsContainer = $('search-results-container');
    if (searchInput && resultsContainer) {
        searchInput.addEventListener('input', async (e) => {
            const query = e.target.value.toLowerCase().trim();
            if (query.length < 2) {
                resultsContainer.innerHTML = `<div class="text-center py-16 text-slate-400 text-xs font-bold uppercase tracking-wider">Type at least 2 characters to search...</div>`;
                return;
            }

            const [assignments, announcements, placements, surveys, helpTickets, lostFound] = await Promise.all([
                api.get('/assignments').then(c => c?.data?.list || []).catch(() => []),
                api.get('/announcements').then(c => c?.announcements || []).catch(() => []),
                api.get('/placements').then(c => c?.placements || []).catch(() => []),
                api.get('/surveys').then(c => c?.surveys || []).catch(() => []),
                api.get('/help-desk').then(c => c?.tickets || []).catch(() => []),
                api.get('/lost-found').then(c => c?.items || []).catch(() => [])
            ]);

            const matches = [];

            assignments.forEach(a => {
                if (a.title.toLowerCase().includes(query) || a.subject.toLowerCase().includes(query)) {
                    matches.push({ type: 'Assignment', title: a.title, subtitle: `${a.subject} · Due ${a.date}`, route: '/assignments' });
                }
            });

            announcements.forEach(a => {
                if (a.title.toLowerCase().includes(query) || a.description.toLowerCase().includes(query)) {
                    matches.push({ type: 'Notice', title: a.title, subtitle: a.description, route: '/announcements' });
                }
            });

            placements.forEach(p => {
                if (p.companyName.toLowerCase().includes(query) || p.jobRole.toLowerCase().includes(query)) {
                    matches.push({ type: 'Placement', title: p.companyName, subtitle: `${p.jobRole} · ₹${p.packageLpa} LPA`, route: '/career' });
                }
            });

            surveys.forEach(s => {
                if (s.title.toLowerCase().includes(query) || s.description.toLowerCase().includes(query)) {
                    matches.push({ type: 'Survey', title: s.title, subtitle: s.description, route: '/survey' });
                }
            });

            helpTickets.forEach(t => {
                if (t.subject.toLowerCase().includes(query) || t.ticketNumber.toLowerCase().includes(query) || t.description.toLowerCase().includes(query)) {
                    matches.push({ type: 'Support Ticket', title: t.ticketNumber, subtitle: `${t.subject} (${t.status})`, route: '/help' });
                }
            });

            lostFound.forEach(lf => {
                if (lf.title.toLowerCase().includes(query) || lf.description.toLowerCase().includes(query) || lf.location.toLowerCase().includes(query)) {
                    matches.push({ type: `Lost & Found (${lf.type})`, title: lf.title, subtitle: `${lf.description} · Found at ${lf.location}`, route: '/lost-found' });
                }
            });

            if (matches.length === 0) {
                resultsContainer.innerHTML = `<div class="text-center py-16 text-slate-400 text-xs font-bold uppercase tracking-wider">No matching results found.</div>`;
                return;
            }

            resultsContainer.innerHTML = matches.map(m => `
                <div class="p-4 bg-white/60 rounded-2xl border border-slate-200/50 flex justify-between items-center hover:bg-slate-100 transition-colors active-scale cursor-pointer" onclick="toggleSearchOverlay(false); router.navigate('${m.route}')">
                    <div>
                        <span class="px-2 py-0.5 rounded bg-blue-100 text-blue-800 text-[9px] font-black uppercase tracking-wide inline-block mb-1">${m.type}</span>
                        <h4 class="text-sm font-bold text-slate-800 truncate">${m.title}</h4>
                        <p class="text-xs text-slate-500 mt-0.5 line-clamp-1">${m.subtitle}</p>
                    </div>
                    <span class="material-symbols-outlined text-slate-400 text-base">chevron_right</span>
                </div>
            `).join('');
        });
    }

    // Expose globals for remote DevTools / testing automation
    window.api = api;
    window.router = router;
    window.state = state;
    window.secureStorage = secureStorage;

    window.addEventListener('hashchange', () => router.handle());
});
