// ============================================================
// SITAM SMART CAMPUS ERP — Complete SPA
// Matches Stitch UI design exactly, all modules functional
// ============================================================

const PRODUCTION_API = 'https://web-production-259f33.up.railway.app/api';
const isMobileNative = window.Capacitor && window.Capacitor.platform !== 'web';
const API_BASE = isMobileNative ? PRODUCTION_API : (window.API_BASE_URL || '/api');

let _decryptedToken = null;

// Native Logcat Boot Logger Helper with Queue and Polling
const bootLogQueue = [];
function logBoot(msg) {
    console.log(msg);
    if (window.Capacitor?.Plugins?.SecureKeystore?.logBoot) {
        window.Capacitor.Plugins.SecureKeystore.logBoot({ message: msg }).catch(() => { });
    } else {
        bootLogQueue.push(msg);
    }
}

function flushBootLogs() {
    if (window.Capacitor?.Plugins?.SecureKeystore?.logBoot) {
        while (bootLogQueue.length > 0) {
            const msg = bootLogQueue.shift();
            window.Capacitor.Plugins.SecureKeystore.logBoot({ message: msg }).catch(() => { });
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

    async bootstrap() {
        const t0 = Date.now();
        const step = (name) => {
            const elapsed = Date.now() - t0;
            console.log(`[BOOT][secureStorage] ${name} (${elapsed}ms)`);
            if (elapsed > 2000) console.warn(`[BOOT][secureStorage] ⚠️ SLOW STEP: ${name} took ${elapsed}ms total`);
        };

        step('START');
        try {
            const scrambledKey = this._scramble('token');
            step('Scrambled key computed');
            let rawData = localStorage.getItem(scrambledKey);
            step(`localStorage check — token exists: ${!!rawData}`);

            // Mirror check from Capacitor Preferences (2s hard timeout)
            if (!rawData && window.Capacitor?.Plugins?.Preferences) {
                step('Calling Preferences.get (2s timeout)...');
                try {
                    const res = await Promise.race([
                        window.Capacitor.Plugins.Preferences.get({ key: scrambledKey }),
                        new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT')), 2000))
                    ]);
                    rawData = res?.value || null;
                    step(`Preferences.get done — value exists: ${!!rawData}`);
                } catch (e) {
                    step(`Preferences.get FAILED: ${e.message} — continuing as anonymous`);
                }
            }

            if (!rawData) {
                step('No stored token — anonymous session');
                _decryptedToken = null;
                return;
            }

            step('Unscrambling payload...');
            const jsonStr = this._unscramble(rawData);
            if (!jsonStr) { step('Unscramble returned empty'); return; }
            const payload = JSON.parse(jsonStr);
            step(`Payload parsed — has ciphertext: ${!!payload.ciphertext}, has data: ${!!payload.data}`);

            if (window.Capacitor?.Plugins?.SecureKeystore && payload.ciphertext && payload.iv) {
                step('Calling SecureKeystore.decrypt (2s timeout)...');
                try {
                    const decRes = await Promise.race([
                        window.Capacitor.Plugins.SecureKeystore.decrypt({ ciphertext: payload.ciphertext, iv: payload.iv }),
                        new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT')), 2000))
                    ]);
                    _decryptedToken = decRes.value;
                    step('SecureKeystore.decrypt succeeded');
                } catch (e) {
                    step(`SecureKeystore.decrypt FAILED: ${e.message} — clearing stale token`);
                    localStorage.removeItem(scrambledKey);
                    if (window.Capacitor?.Plugins?.Preferences) {
                        await Promise.race([
                            window.Capacitor.Plugins.Preferences.remove({ key: scrambledKey }).catch(() => { }),
                            new Promise(r => setTimeout(r, 1000))
                        ]);
                    }
                    _decryptedToken = null;
                }
            } else if (payload.data && payload.iv) {
                step('WebCrypto fallback decryption...');
                let keyRaw = localStorage.getItem('_secure_entropy');
                if (keyRaw && keyRaw.length !== 32) { localStorage.removeItem('_secure_entropy'); keyRaw = null; }
                if (keyRaw) {
                    const keyBuf = new TextEncoder().encode(keyRaw);
                    const cryptoKey = await crypto.subtle.importKey('raw', keyBuf, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
                    const iv = new Uint8Array(atob(payload.iv).split('').map(c => c.charCodeAt(0)));
                    const ct = new Uint8Array(atob(payload.data).split('').map(c => c.charCodeAt(0)));
                    const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, ct);
                    _decryptedToken = new TextDecoder().decode(dec);
                    step('WebCrypto decryption succeeded');
                } else {
                    step('No entropy key — cannot decrypt');
                }
            } else {
                step('Using raw unscrambled value');
                _decryptedToken = jsonStr;
            }
        } catch (err) {
            console.error('[BOOT][secureStorage] Bootstrap EXCEPTION:', err);
            _decryptedToken = null;
        } finally {
            console.log(`[BOOT][secureStorage] COMPLETE in ${Date.now() - t0}ms`);
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
                    }).catch(() => { });
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
            }).catch(() => { });
        }
    },

    async removeItem(key) {
        if (key === 'token') {
            _decryptedToken = null;
        }
        const scrambledKey = this._scramble(key);
        localStorage.removeItem(scrambledKey);
        if (window.Capacitor?.Plugins?.Preferences) {
            await window.Capacitor.Plugins.Preferences.remove({ key: scrambledKey }).catch(() => { });
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
            console.log('[Push] Native initialization started');
            const PushNotifications = window.Capacitor.Plugins.PushNotifications;
            let permStatus = await PushNotifications.checkPermissions();

            if (permStatus.receive === 'prompt') {
                permStatus = await PushNotifications.requestPermissions();
            }

            console.log(`[Push] Permission status: ${permStatus.receive}`);

            if (permStatus.receive !== 'granted') {
                console.warn('[Push] Native permission denied');
                return;
            }

            // Attach listeners BEFORE calling register() to prevent missing synchronous token event
            if (!window._pushListenersRegistered) {
                window._pushListenersRegistered = true;
                PushNotifications.addListener('registration', async (token) => {
                    console.log('[Push] Registration event received');
                    console.log('[Push] Sending device registration to backend');
                    try {
                        const res = await api.post('/auth/fcm-token', { token: token.value, deviceType: 'android' });
                        if (res.status >= 200 && res.status < 300) {
                            console.log('[Push] Backend registration successful');
                        } else {
                            console.warn(`[Push] Backend registration failed: HTTP ${res.status}`);
                        }
                    } catch (err) {
                        const status = err.response?.status || 'network_error';
                        console.error(`[Push] Backend registration failed: HTTP ${status}`);
                    }
                });

                PushNotifications.addListener('registrationError', (error) => {
                    console.error('[Push] Native token registration error:', error);
                });

                PushNotifications.addListener('pushNotificationReceived', async (notification) => {
                    console.log('[LocalNotification] Foreground FCM received');
                    const title = notification.title || 'SITAM Smart ERP';
                    const body = notification.body || '';
                    const route = notification.data?.sitam_route || notification.data?.route || '/notifications';

                    // 1. In-app updates
                    showPushBanner(title, body, route);
                    try { removeCachedData('/notifications'); } catch (_) {}
                    try { removeCachedData('/notifications/unread'); } catch (_) {}
                    try { removeCachedData('/exit-passes/my'); } catch (_) {}
                    updateUnreadBadge().catch(() => { });

                    // Trigger exit pass real-time refresh hooks
                    if (Array.isArray(window._epNotifHandlers)) {
                        window._epNotifHandlers.forEach(fn => { try { fn(notification); } catch (_) {} });
                    }

                    if (route && route === router.currentRoute) {
                        router.routes[route]?.afterRender?.();
                    }

                    // 2. Present Android status bar notification using LocalNotifications API (Immediate Delivery)
                    if (window.Capacitor?.Plugins?.LocalNotifications) {
                        try {
                            console.log('[LocalNotification] Scheduling Android notification');
                            const notifId = (Date.now() % 2147483647) + 1;
                            await window.Capacitor.Plugins.LocalNotifications.schedule({
                                notifications: [
                                    {
                                        title,
                                        body,
                                        id: notifId,
                                        sound: 'default',
                                        channelId: 'sitam_academic_alerts_v2',
                                        extra: { route }
                                    }
                                ]
                            });
                            console.log('[LocalNotification] Schedule success');
                        } catch (localErr) {
                            console.error(`[LocalNotification] Schedule failed: ${localErr.message || localErr}`);
                        }
                    }
                });

                PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
                    console.log('[Push] Native push action performed');
                    const route = action.notification.data?.sitam_route || action.notification.data?.route || '/notifications';
                    if (route) {
                        router.navigate(route);
                    }
                });
            }

            // Setup LocalNotifications permission, channel & tap listener
            if (window.Capacitor?.Plugins?.LocalNotifications) {
                const LocalNotifications = window.Capacitor.Plugins.LocalNotifications;
                try {
                    let localPerm = await LocalNotifications.checkPermissions();
                    if (localPerm.display === 'prompt') {
                        localPerm = await LocalNotifications.requestPermissions();
                    }
                    console.log(`[LocalNotification] Permission: ${localPerm.display}`);
                } catch (permErr) {
                    console.warn(`[LocalNotification] Permission check error: ${permErr.message || permErr}`);
                }

                try {
                    // Preserve existing background FCM channel
                    await LocalNotifications.createChannel({
                        id: 'sitam_academic_alerts',
                        name: 'SITAM Academic Alerts',
                        description: 'Important notifications, marks, fees, and academic alerts',
                        importance: 5,
                        visibility: 1,
                        sound: 'default',
                        vibration: true
                    });
                    // Create new high-priority foreground channel
                    await LocalNotifications.createChannel({
                        id: 'sitam_academic_alerts_v2',
                        name: 'SITAM Academic Alerts (Foreground)',
                        description: 'High-priority foreground notifications and alerts',
                        importance: 5,
                        visibility: 1,
                        sound: 'default',
                        vibration: true
                    });
                    console.log('[LocalNotification] Channel ready: sitam_academic_alerts_v2');
                } catch (chanErr) {
                    console.warn(`[LocalNotification] Channel creation error: ${chanErr.message || chanErr}`);
                }

                if (!window._localPushListenersRegistered) {
                    window._localPushListenersRegistered = true;
                    LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
                        console.log('[Push] Local notification tapped');
                        const route = action.notification.extra?.route || '/notifications';
                        if (route) {
                            router.navigate(route);
                        }
                    });
                }
            }

            // Diagnostic helper for testing isolated local notification without FCM trigger
            window.testLocalNotification = async function () {
                console.log('[LocalNotification] Isolated test trigger initiated');
                if (!window.Capacitor?.Plugins?.LocalNotifications) {
                    console.error('[LocalNotification] Plugin not available on window.Capacitor.Plugins.LocalNotifications');
                    return false;
                }
                const LocalNotifications = window.Capacitor.Plugins.LocalNotifications;
                try {
                    let localPerm = await LocalNotifications.checkPermissions();
                    if (localPerm.display === 'prompt') {
                        localPerm = await LocalNotifications.requestPermissions();
                    }
                    console.log(`[LocalNotification] Permission: ${localPerm.display}`);
                    if (localPerm.display !== 'granted') {
                        console.error('[LocalNotification] Permission not granted for local notification test');
                        return false;
                    }
                    const notifId = (Date.now() % 2147483647) + 1;
                    console.log('[LocalNotification] Scheduling Android notification');
                    await LocalNotifications.schedule({
                        notifications: [
                            {
                                title: 'SITAM ERP Test Alert',
                                body: 'Isolated foreground local notification verification successful.',
                                id: notifId,
                                sound: 'default',
                                channelId: 'sitam_academic_alerts_v2',
                                extra: { route: '/notifications' }
                            }
                        ]
                    });
                    console.log('[LocalNotification] Schedule success');
                    return true;
                } catch (err) {
                    console.error(`[LocalNotification] Schedule failed: ${err.message || err}`);
                    return false;
                }
            };

            // Register with FCM
            await PushNotifications.register();
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
            console.log('[Push] Acquired FCM token via ServiceWorker');
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
    get token() {
        return secureStorage.getItem('token') || null;
    },
    set token(val) {
        if (val === null) {
            secureStorage.removeItem('token').catch(() => { });
        } else {
            secureStorage.setItem('token', val).catch(() => { });
        }
    },
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
        const count = res.data?.data?.count ?? res.data?.count ?? 0;
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
                updateUnreadBadge().catch(() => { });
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
                updateUnreadBadge().catch(() => { });
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
                updateUnreadBadge().catch(() => { });
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
            updateUnreadBadge().catch(() => { });
        }

        else if (event === 'timetable_update') {
            showToast(data.message || 'Live Timetable updated!', 'schedule');
            updateUnreadBadge().catch(() => { });
        }

        else if (event === 'notification_refresh' || event === 'new_notification') {
            try { removeCachedData('/notifications'); } catch (_) {}
            try { removeCachedData('/notifications/unread'); } catch (_) {}
            updateUnreadBadge().catch(() => { });
            if (data?.title || data?.message) {
                showPushBanner(data.title || 'SITAM Notification', data.message || '', '/notifications');
            }
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
    SITAMDb.set('erp_cache', ep, data, 10 * 60 * 1000).catch(() => { });
    try {
        localStorage.setItem(getCacheKey(ep), JSON.stringify(data));
        localStorage.setItem(getCacheKey(ep) + '_ts', Date.now().toString());
    } catch { }
}
function isCacheFresh(ep, maxAgeMs = 5 * 60 * 1000) {
    const ts = parseInt(localStorage.getItem(getCacheKey(ep) + '_ts') || '0', 10);
    return ts > 0 && (Date.now() - ts) < maxAgeMs;
}
function clearUserCache() {
    // Wipe IndexedDB entries for this user
    SITAMDb.clearUser().catch(() => { });
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
                SITAMDb.set('erp_cache', ep, data, getTTL(ep)).catch(() => { });
                return data;
            }).catch(() => { }).finally(() => { delete _inflight[ep]; });
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
        SITAMDb.set('session', 'last_synced', Date.now(), 7 * 24 * 60 * 60 * 1000).catch(() => { });
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
    }).catch(() => { });
}

// --- Haptic helper (10ms micro-vibration on nav taps) ---
const haptic = () => { try { navigator.vibrate?.(10); } catch { } };

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
    '/profile': 5 * 60 * 1000,   //  5 min  — name/branch/year rarely change
    '/attendance': 5 * 60 * 1000,   //  5 min  — updates after faculty marks
    '/marks': 10 * 60 * 1000,   // 10 min  — updated per exam cycle
    '/fees': 10 * 60 * 1000,   // 10 min  — updated after payment
    '/timetable': 30 * 60 * 1000,   // 30 min  — changes only with schedule edits
    '/notifications': 1 * 60 * 1000,   //  1 min  — near-realtime; backed by WebSocket
    '/placements': 5 * 60 * 1000,   //  5 min  — new drives are infrequent
    '/exit-passes/my': 30 * 1000,        // 30 sec  — status changes quickly after approval
    '/surveys': 5 * 60 * 1000,   //  5 min
    '/assignments': 5 * 60 * 1000,   //  5 min
    '/exams': 10 * 60 * 1000,   // 10 min
    '/syllabus': 30 * 60 * 1000,   // 30 min
    '/lost-found': 5 * 60 * 1000,   //  5 min
};
// Default TTL for any endpoint not listed above
const DEFAULT_TTL = 5 * 60 * 1000;
function getTTL(ep) { return EP_TTL[ep] ?? DEFAULT_TTL; }

// ─── Request Queue Priority Levels ───────────────────────────────────────────
const EP_PRIORITY = {
    '/profile': 3, // High: core identification
    '/attendance': 3, // High: status display
    '/fees': 3, // High: outstanding dues / alerts
    '/marks': 2, // Medium: grades
    '/timetable': 2, // Medium: calendar
    '/assignments': 2, // Medium: homework
    '/notifications': 1, // Low: unread items
    '/placements': 1, // Low
    '/surveys': 1, // Low
    '/lost-found': 1, // Low
    '/exit-passes/my': 1  // Low
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
                } catch (_) { }
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
                } catch (_) { }
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

            if (endpoint.includes('/auth/login')) {
                console.log('[AUDIT-LOG] LOGIN REQUEST START');
            }

            const resp = await RequestQueue.enqueue(
                () => {
                    if (endpoint.includes('/auth/login')) {
                        console.log('[AUDIT-LOG] LOGIN REQUEST START (INNER)');
                    }
                    const p = fetch(fullUrl, { ...options, headers: mergedHeaders });
                    if (endpoint.includes('/auth/login')) {
                        console.log('[AUDIT-LOG] LOGIN REQUEST SENT');
                    }
                    return p;
                },
                endpoint
            );

            if (endpoint.includes('/auth/login')) {
                console.log('[AUDIT-LOG] LOGIN RESPONSE RECEIVED');
            }

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
            // ASP.NET pages (like the ERP portal) uniquely contain __VIEWSTATE or __EVENTVALIDATION.
            // Our SPA index.html contains imgBtn2/txtId2, so we must avoid matching them.
            const isHtml = text.trim().startsWith('<');
            const isErpLogin = isHtml && (text.includes('__VIEWSTATE') || text.includes('__EVENTVALIDATION'));
            if (isErpLogin) {
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
                const _tokenExpiry = secureStorage.getItem('tokenExpiry');
                const _nowMs = Date.now();
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
                    const _tokenExpiry = secureStorage.getItem('tokenExpiry');
                    const _nowMs = Date.now();
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
                const halfTTL = ttl / 2;
                if (state.isOnline && !_inflight[ep] && cacheAge > halfTTL) {
                    const bgPromise = this.request(ep).then(fresh => {
                        SITAMDb.set('erp_cache', ep, fresh, ttl).catch(() => { });
                        try { localStorage.setItem(getCacheKey(ep), JSON.stringify(fresh)); } catch { }
                        if (onRevalidate) onRevalidate(fresh);
                    }).catch(() => { }).finally(() => { delete _inflight[ep]; });
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
            SITAMDb.set('erp_cache', ep, fresh, ttl).catch(() => { });
            try {
                localStorage.setItem(getCacheKey(ep), JSON.stringify(fresh));
                localStorage.setItem(getCacheKey(ep) + '_ts', Date.now().toString());
            } catch { }
            if (onRevalidate) onRevalidate(fresh);
            return fresh;
        }).catch(async err => {
            if (err.name === 'AbortError') {
                throw err;
            }
            const idbFallback = await SITAMDb.get('erp_cache', ep, 7 * 24 * 60 * 60 * 1000);
            const lsFallback = getCachedData(ep);
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

        // ── Server-side session invalidation ──────────────────────────────────
        // MUST call backend logout BEFORE clearing local token so auth header is still present.
        // Fire-and-forget: if the request fails, local logout proceeds regardless.
        // This prevents 7-day token reuse after logout (security fix).
        const serverLogout = () => api.request('/auth/logout', { method: 'POST' }).catch(() => { });

        if (messaging) {
            messaging.getToken().then(async (currentToken) => {
                if (currentToken) {
                    await api.request('/auth/fcm-token', {
                        method: 'DELETE',
                        body: JSON.stringify({ token: currentToken })
                    }).catch(() => { });
                }
                // Invalidate server session AFTER FCM cleanup but BEFORE local cleanup
                await serverLogout();
            }).catch(() => { }).finally(performLogout);
        } else {
            // No FCM — just invalidate server session then clear local state
            serverLogout().finally(performLogout);
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
            registerPush().catch(() => { });
            updateUnreadBadge().catch(() => { });
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
    }).catch(() => { });
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
        appEl.addEventListener('animationend', () => {
            appEl.classList.remove('page-enter');
        }, { once: true });
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
    // ---- LOGIN ----
    login: {
        render: () => {
            console.log('[NAV] Login render started');
            const html = `<div class="min-h-screen w-full flex flex-col items-center justify-center relative bg-[#F8FAFC] overflow-hidden">
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
        </div>`;
            console.log('[NAV] Login render completed');
            return html;
        },
        afterRender: () => {
            console.log('[NAV] Login afterRender started');
            toggleShell(false);
            const form = $('login-form');
            console.log('[DOM] Login container found, form exists:', !!form);
            if (!form) return;
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                const uid = $('login-userid')?.value?.trim();
                const pwd = $('login-password')?.value?.trim();
                const errEl = $('login-error');
                const btnText = $('login-btn-text');
                if (!uid || !pwd) { if (errEl) { errEl.textContent = 'Please fill all fields.'; errEl.classList.remove('hidden'); } return; }
                if (errEl) errEl.classList.add('hidden');
                if (btnText) btnText.textContent = 'Signing in...';

                // --- TEMPORARY LOGIN AUDIT LOGGING ---
                console.log('[AUDIT-LOG] API Base URL:', API_BASE);
                console.log('[AUDIT-LOG] Full request URL:', API_BASE + '/auth/login');
                console.log('[AUDIT-LOG] HTTP Method: POST');
                console.log('[AUDIT-LOG] Payload (masked):', JSON.stringify({ userId: uid, password: '[MASKED]' }));

                try {
                    const res = await api.post('/auth/login', { userId: uid, password: pwd });
                    console.log('[AUDIT-LOG] Response received status: SUCCESS');
                    console.log('[AUDIT-LOG] Response body (masked):', JSON.stringify({ success: res.success, hasToken: !!res.token, studentName: res.studentName }));

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
                            registerPush().catch(() => { }),
                            prefetchAll().catch(() => { })
                        ]).catch(() => { });
                    } else {
                        if (errEl) {
                            errEl.textContent = res.error || 'Login failed.';
                            errEl.classList.remove('hidden');
                        }
                    }
                } catch (err) {
                    console.error('[AUDIT-LOG] Login execution failed!');
                    console.error('[AUDIT-LOG] Complete error object:', err);
                    console.error('[AUDIT-LOG] Error message:', err.message);
                    console.error('[AUDIT-LOG] Error stack:', err.stack);
                    if (err.response) {
                        console.error('[AUDIT-LOG] response.status:', err.response.status);
                        console.error('[AUDIT-LOG] response.data:', JSON.stringify(err.response.data));
                    }
                    if (err.code) {
                        console.error('[AUDIT-LOG] Axios/Error code:', err.code);
                    }

                    if (errEl) {
                        errEl.textContent = 'Network error. Please try again.';
                        errEl.classList.remove('hidden');
                    }
                } finally {
                    if (btnText) btnText.textContent = 'Sign In';
                }
            });
        }
    },
    dashboard: {
        render: () => `<div class="min-h-screen pb-32 bg-[#F8FAFC]">
            <main class="pt-20 px-4 sm:px-6 max-w-xl mx-auto space-y-6">
                <!-- Welcome Section -->
                <section class="flex justify-between items-start">
                    <div>
                        <h2 class="text-2xl font-black text-slate-800 tracking-tight" id="dash-greeting">👋 Greetings</h2>
                        <p class="text-xs text-slate-400 mt-1" id="hero-sub">Welcome back to SITAM Smart ERP</p>
                    </div>
                    <div class="w-10 h-10 bg-blue-50 text-blue-600 border border-blue-100 rounded-2xl flex items-center justify-center flex-shrink-0 animate-reveal">
                        <span class="material-symbols-outlined" style="font-variation-settings:'FILL' 1">school</span>
                    </div>
                </section>

                <!-- 1. ATTENDANCE & CGPA ROW (Grid of 2) -->
                <section class="grid grid-cols-2 gap-4">
                    <!-- Attendance Ring Card -->
                    <div class="glass-card p-5 rounded-3xl flex flex-col justify-between h-40 border-l-4 border-l-primary cursor-pointer hover:scale-[1.02] active-scale transition-all" onclick="router.navigate('/attendance')">
                        <div class="flex justify-between items-center">
                            <div>
                                <h4 class="text-sm font-bold text-on-surface">Attendance</h4>
                                <p class="text-[10px] text-slate-400">Overall Ratio</p>
                            </div>
                            <!-- Ring -->
                            <div class="relative w-16 h-16 flex items-center justify-center flex-shrink-0">
                                <svg class="w-full h-full transform -rotate-90">
                                    <circle cx="32" cy="32" r="26" stroke="#f1f5f9" stroke-width="4" fill="transparent"/>
                                    <circle cx="32" cy="32" r="26" stroke="#2563eb" stroke-width="5" fill="transparent" stroke-dasharray="163.36" stroke-dashoffset="163.36" id="dash-att-ring" class="transition-all duration-1000"/>
                                </svg>
                                <span class="absolute text-[11px] font-black text-slate-800" id="dash-att-val">--%</span>
                            </div>
                        </div>
                        <div class="flex justify-between items-center text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                            <span>Status:</span>
                            <span id="dash-att-status-text" class="font-black">--</span>
                        </div>
                    </div>

                    <!-- CGPA Card -->
                    <div class="glass-card p-5 rounded-3xl flex flex-col justify-between h-40 border-l-4 border-l-amber-500 cursor-pointer hover:scale-[1.02] active-scale transition-all" onclick="router.navigate('/marks')">
                        <div class="flex justify-between items-start">
                            <div>
                                <h4 class="text-sm font-bold text-on-surface">Academic GPA</h4>
                                <p class="text-[10px] text-slate-400">Cumulative (CGPA)</p>
                            </div>
                            <span class="material-symbols-outlined text-amber-500 text-2xl" style="font-variation-settings:'FILL' 1">stars</span>
                        </div>
                        <div class="flex justify-between items-end">
                            <p class="text-3xl font-black text-slate-800 leading-none" id="dash-gpa-val">--</p>
                            <div class="text-right text-[9px] font-extrabold uppercase tracking-wide bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full">
                                SGPA: <span id="dash-sgpa-val">--</span>
                            </div>
                        </div>
                    </div>
                </section>

                <!-- 2. TODAY'S CLASSES SECTION -->
                <section class="space-y-3">
                    <div class="flex justify-between items-end">
                        <h3 class="text-[11px] font-extrabold uppercase tracking-widest text-slate-400">Today's Classes</h3>
                        <a href="#" onclick="router.navigate('/timetable');return false;" class="text-[10px] font-bold text-primary hover:underline uppercase tracking-wider">VIEW FULL</a>
                    </div>
                    
                    <!-- Next Class Widget -->
                    <div id="dash-upcoming-class-container">
                        <div class="glass-card p-4 rounded-2xl border border-white/40 shadow-sm text-center bg-white/40 text-slate-400 text-[10px] font-bold">
                            Loading schedule...
                        </div>
                    </div>

                    <!-- Horizontally scrolling timetable classes -->
                    <div class="flex gap-4 pb-2 -mx-4 px-4 overflow-x-auto hide-scrollbar momentum-scroll" id="dash-timetable">
                        <div class="min-w-[170px] h-24 bg-white/40 border border-white/20 rounded-2xl shimmer-loading"></div>
                    </div>
                </section>

                <!-- 3. WORKSPACE: Deliverables, Fees, LMS, Notice -->
                <section class="grid grid-cols-2 gap-4">
                    <!-- Pending Deliverables (Assignments) -->
                    <div class="glass-card p-5 flex flex-col justify-between h-36 cursor-pointer hover:scale-[1.02] active-scale transition-all" onclick="router.navigate('/assignments')">
                        <div class="flex justify-between items-start">
                            <span class="material-symbols-outlined text-slate-400 text-2xl">assignment</span>
                            <span class="px-2 py-0.5 bg-slate-100 text-slate-600 text-[9px] font-extrabold rounded-full border border-slate-200" id="dash-asn-count">--</span>
                        </div>
                        <div>
                            <h4 class="text-sm font-bold text-on-surface">Assignments</h4>
                            <p class="text-[9px] text-slate-400">Pending deliverables</p>
                        </div>
                    </div>

                    <!-- Fee Status -->
                    <div class="glass-card p-5 flex flex-col justify-between h-36 cursor-pointer hover:scale-[1.02] active-scale transition-all" onclick="router.navigate('/fees')">
                        <div class="flex justify-between items-start">
                            <span class="material-symbols-outlined text-slate-400 text-2xl">account_balance_wallet</span>
                            <span class="px-2 py-0.5 bg-rose-50 text-rose-600 text-[9px] font-extrabold rounded-full border border-rose-200/50 hidden" id="dash-fee-alert">DUE</span>
                        </div>
                        <div>
                            <h4 class="text-sm font-bold text-on-surface">Fee Status</h4>
                            <p class="text-[9px] text-slate-400 truncate" id="dash-fee-text">Dues &amp; History</p>
                        </div>
                    </div>

                    <!-- LMS Shortcut -->
                    <div class="bg-indigo-50/70 p-5 rounded-3xl flex flex-col justify-between h-36 border border-indigo-100 cursor-pointer hover:scale-[1.02] active-scale transition-all" onclick="haptic(); router.navigate('/lms')">
                        <div class="flex justify-between items-start">
                            <span class="material-symbols-outlined text-indigo-500 text-2xl" style="font-variation-settings:'FILL' 1">menu_book</span>
                            <span class="px-2 py-0.5 bg-white text-indigo-600 text-[9px] font-extrabold rounded-full border border-indigo-200">LMS</span>
                        </div>
                        <div>
                            <h4 class="text-sm font-bold text-indigo-900">LMS Portal</h4>
                            <p class="text-[9px] text-indigo-500/80">Courses & LMS</p>
                        </div>
                    </div>

                    <!-- Exit Gate Shortcut -->
                    <div class="bg-emerald-50/70 p-5 rounded-3xl flex flex-col justify-between h-36 border border-emerald-100 cursor-pointer hover:scale-[1.02] active-scale transition-all" onclick="haptic(); router.navigate('/exit-pass')">
                        <div class="flex justify-between items-start">
                            <span class="material-symbols-outlined text-emerald-500 text-2xl" style="font-variation-settings:'FILL' 1">badge</span>
                            <span class="text-[10px] font-black text-emerald-600" id="dash-ep-status">--</span>
                        </div>
                        <div>
                            <h4 class="text-sm font-bold text-emerald-900">Exit Gate</h4>
                            <p class="text-[9px] text-emerald-500/80">Campus pass</p>
                        </div>
                    </div>
                </section>

                <!-- 4. RECENT NOTIFICATIONS -->
                <section class="space-y-3">
                    <div class="flex justify-between items-end">
                        <h3 class="text-[11px] font-extrabold uppercase tracking-widest text-slate-400">Recent Notices</h3>
                        <a href="#" onclick="router.navigate('/announcements');return false;" class="text-[10px] font-bold text-primary hover:underline uppercase tracking-wider">VIEW ALL</a>
                    </div>
                    <div class="space-y-2.5" id="dash-ann-list">
                        <div class="h-20 bg-slate-100 rounded-xl animate-pulse"></div>
                    </div>
                </section>

                <!-- Notice Banner -->
                <section id="notice-banner-section" class="pt-1">
                    <div class="w-full bg-blue-50/50 text-blue-900 p-4 rounded-2xl flex items-center gap-3 relative overflow-hidden border border-blue-100/80 shadow-sm" id="notice-banner">
                        <div class="absolute right-0 top-0 w-16 h-full bg-gradient-to-l from-blue-100/10 to-transparent"></div>
                        <div class="w-8 h-8 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center flex-shrink-0 border border-blue-200/30">
                            <span class="material-symbols-outlined text-base" style="font-variation-settings:'FILL' 1">campaign</span>
                        </div>
                        <div class="min-w-0 flex-1">
                            <p class="text-[11px] font-bold tracking-tight leading-snug text-blue-800 break-words" id="notice-text">ERP sync active. Your data is being synchronized.</p>
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

            const hours = new Date().getHours();
            const greeting = hours < 12 ? 'Good Morning' : hours < 17 ? 'Good Afternoon' : 'Good Evening';
            const greetEmoji = hours < 12 ? '🌅' : hours < 17 ? '☀️' : '🌙';

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

            api.get('/attendance').then(attRes => {
                const attList = attRes.attendance || [];
                const overall = calcOverallAttendance(attList);
                setEl('dash-att-val', 'innerText', overall.text);
                const pct = parseFloat(overall.text) || 0;

                const statusEl = $('dash-att-status-text');
                if (statusEl) {
                    statusEl.innerText = pct >= 75 ? 'Safe' : 'Critical';
                    statusEl.className = pct >= 75
                        ? 'px-2.5 py-0.5 rounded-full text-[9px] font-extrabold uppercase border bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'px-2.5 py-0.5 rounded-full text-[9px] font-extrabold uppercase border bg-rose-50 text-rose-700 border-rose-200';
                }

                const ring = $('dash-att-ring');
                if (ring) {
                    ring.style.strokeDashoffset = 163.36 - (pct / 100) * 163.36;
                }
            }).catch(() => { });

            api.get('/marks').then(marksRes => {
                const cgpa = marksRes.data?.cgpa || '--';
                const sgpa = marksRes.data?.sgpa || '--';
                setEl('dash-gpa-val', 'innerText', cgpa);
                setEl('dash-sgpa-val', 'innerText', sgpa);
            }).catch(() => { });

            api.get('/fees').then(feesRes => {
                const due = feesRes.data?.dueAmount || feesRes.data?.totalDue;
                const rawDue = parseFloat((due || '').replace(/[₹,]/g, '')) || 0;
                if (rawDue > 0) {
                    setEl('dash-fee-text', 'innerText', due + ' Due');
                    $('dash-fee-alert')?.classList.remove('hidden');
                } else {
                    setEl('dash-fee-text', 'innerText', 'Cleared');
                    $('dash-fee-alert')?.classList.add('hidden');
                }
            }).catch(() => { });

            api.get('/assignments').then(res => {
                const list = res.data?.list || [];
                const pending = list.filter(a => a.status.toLowerCase() !== 'submitted');
                setEl('dash-asn-count', 'innerText', pending.length);
            }).catch(() => { });

            api.get('/exit-passes/my').then(res => {
                const passes = res.data || res.passes || [];
                const active = passes[0];
                if (active) {
                    setEl('dash-ep-status', 'innerText', active.status);
                } else {
                    setEl('dash-ep-status', 'innerText', 'Apply');
                }
            }).catch(() => { });

            api.get('/timetable').then(ttRes => {
                const slots = Array.isArray(ttRes) ? ttRes : (ttRes.data || []);
                const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                let day = days[new Date().getDay()];
                if (day === 'Sunday') day = 'Monday';

                const todaySlots = slots.filter(s => s.day === day).sort((a, b) => (parseInt(a.period) || 0) - (parseInt(b.period) || 0));

                const widget = $('dash-upcoming-class-container');
                if (widget) {
                    if (todaySlots.length === 0) {
                        widget.innerHTML = `
                            <div class="glass-card p-3 rounded-2xl border border-white/40 shadow-sm bg-white/40 flex flex-col justify-center items-center h-20">
                                <span class="text-[9px] font-black text-slate-400 uppercase tracking-widest">No classes today</span>
                            </div>
                        `;
                    } else {
                        const nextClass = todaySlots[0];
                        widget.innerHTML = `
                            <div class="glass-card p-3 rounded-2xl border border-white/40 shadow-sm bg-white/45 flex flex-col justify-between h-20 active-scale transition-transform cursor-pointer" onclick="router.navigate('/timetable')">
                                <div class="flex items-center justify-between">
                                    <span class="text-[8px] font-black text-[#2563EB] uppercase tracking-wider">Next Class</span>
                                    <span class="text-[8px] font-black text-slate-400 uppercase tracking-widest">${(nextClass.time || '').replace(/^"|"$/g, '').trim()}</span>
                                </div>
                                <h4 class="text-xs font-bold text-slate-800 truncate mt-1">${nextClass.subjectName || nextClass.subjectCode}</h4>
                                <p class="text-[9px] text-slate-400 mt-1">📍 Room ${nextClass.room || '--'}</p>
                            </div>
                        `;
                    }
                }

                const timetableContainer = $('dash-timetable');
                if (timetableContainer) {
                    if (todaySlots.length === 0) {
                        timetableContainer.innerHTML = `<div class="text-center py-6 w-full text-slate-400 text-xs font-bold uppercase tracking-wider">No classes today</div>`;
                    } else {
                        const colors = ['border-l-secondary', 'border-l-emerald-500', 'border-l-amber-500', 'border-l-rose-500', 'border-l-violet-500', 'border-l-indigo-500'];
                        timetableContainer.innerHTML = todaySlots.map((s, i) => {
                            const timeVal = (s.time || '--').replace(/^"|"$/g, '').trim();
                            const subjectDisplay = (s.subjectName && s.subjectName !== s.subjectCode)
                                ? s.subjectName
                                : (s.subjectCode || 'Class');
                            return `
                                <div class="min-w-[190px] max-w-[190px] flex-shrink-0 p-3.5 bg-white/60 border border-white/20 border-l-4 ${colors[i % colors.length]} rounded-2xl flex flex-col justify-between h-24 active-scale transition-transform cursor-pointer" onclick="router.navigate('/timetable')">
                                    <div class="min-w-0">
                                        <div class="flex justify-between items-center mb-1">
                                            <span class="text-[9px] font-black text-slate-400 uppercase tracking-wider">${s.subjectCode || '--'}</span>
                                            <span class="text-[9px] font-black text-secondary uppercase bg-blue-50/50 px-1.5 py-0.5 rounded-md">P${s.period}</span>
                                        </div>
                                        <h4 class="text-xs font-bold text-slate-800 truncate">${subjectDisplay}</h4>
                                    </div>
                                    <div class="flex justify-between items-center mt-2.5 text-[8px] font-bold text-slate-500">
                                        <span class="truncate max-w-[90px]">👤 ${s.facultyName || '--'}</span>
                                        <span>📍 ${s.room || '--'}</span>
                                    </div>
                                </div>
                            `;
                        }).join('');
                    }
                }
            }).catch(() => { });

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
                        ${[1, 2, 3, 4].map(() => `<div class="glass-card border border-white/20 p-4 rounded-2xl shimmer-loading h-24"></div>`).join('')}
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
                    const statusText = p >= 75 ? 'Safe' : p >= 65 ? 'Warning' : 'Critical';
                    const statusBadge = p >= 75 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : p >= 65 ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-rose-50 text-rose-700 border-rose-200';

                    const needed = 3 * (sub.total || 0) - 4 * (sub.present || 0);
                    const reqClasses = needed > 0 ? Math.ceil(needed) : 0;

                    const card = document.createElement('div');
                    card.className = 'glass-card border border-white/40 p-4 rounded-2xl active-scale transition-all duration-300 shadow-sm';
                    card.innerHTML = `
                        <div class="flex justify-between items-start mb-2.5 gap-2">
                            <div class="flex-1 min-w-0">
                                <h4 class="font-bold text-sm text-slate-800 truncate" style="font-family:'Plus Jakarta Sans',sans-serif" title="${sub.subject}">${sub.subject}</h4>
                                <p class="text-[9px] text-slate-400 font-bold mt-0.5">${sub.subjectCode || 'ACAD'}</p>
                            </div>
                            <span class="text-base font-extrabold flex-shrink-0" style="color:${statusColor}">${Math.round(p)}%</span>
                        </div>
                        <div class="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div class="h-full rounded-full transition-all duration-1000" style="width:${p}%;background:${statusColor}"></div>
                        </div>
                        <div class="flex justify-between items-center mt-3 pt-2.5 border-t border-slate-100">
                            <span class="px-2 py-0.5 rounded-full text-[9px] font-extrabold border ${statusBadge}">${statusText}</span>
                            <span class="text-[9px] text-slate-400">Classes to 75%: <span class="font-extrabold text-slate-700">${reqClasses}</span></span>
                        </div>`;
                    grid.appendChild(card);
                });
            } catch (e) {
                console.error('[Attendance] Error:', e);
                const grid = $('att-grid');
                if (grid) {
                    grid.innerHTML = `
                        <div class="col-span-1 md:col-span-2 p-6 bg-white border border-slate-200/50 rounded-2xl shadow-sm text-center space-y-4">
                            <div class="w-12 h-12 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto">
                                <span class="material-symbols-outlined text-xl">cloud_off</span>
                            </div>
                            <div>
                                <h4 class="text-sm font-bold text-slate-800">Connection Error</h4>
                                <p class="text-xs text-slate-400 mt-1">Unable to retrieve attendance data. Please try again.</p>
                            </div>
                            <button onclick="router.routes['/attendance']?.afterRender?.()" class="px-5 py-2 bg-primary text-white font-extrabold text-xs rounded-full active-scale transition-transform">
                                Retry
                            </button>
                        </div>
                    `;
                }
            }
            finally { loading.hide(); }
        }
    },

    // ---- MARKS ----
    marks: {
        render: () => `<body class="bg-background text-on-background min-h-screen pb-32 overflow-x-hidden">
            <main class="pt-24 px-6 max-w-4xl mx-auto space-y-8">
                <section class="relative overflow-hidden">
                    <div class="absolute -top-12 -right-8 w-48 h-48 bg-secondary-container/30 rounded-full blur-3xl -z-10"></div>
                    <div class="flex flex-col gap-4">
                        <div>
                            <p class="text-xs uppercase tracking-[0.2em] text-on-surface-variant mb-1 font-bold">Academic Standing</p>
                            <h1 class="text-4xl font-extrabold tracking-tight text-on-surface" style="font-family:'Plus Jakarta Sans',sans-serif">Marks &amp; Results</h1>
                        </div>
                        <div class="grid grid-cols-2 gap-4 w-full max-w-md">
                            <div class="bg-surface-container-lowest p-4 rounded-xl shadow-[0_10px_40px_rgba(48,51,55,0.04)] flex items-center gap-4 border border-outline-variant/10">
                                <div class="relative flex items-center justify-center flex-shrink-0">
                                    <svg class="w-12 h-12 transform -rotate-90">
                                        <circle class="text-slate-100" cx="24" cy="24" fill="transparent" r="20" stroke="currentColor" stroke-width="4"></circle>
                                        <circle class="text-secondary" cx="24" cy="24" fill="transparent" r="20" stroke="currentColor" stroke-dasharray="125.66" stroke-dashoffset="125.66" stroke-linecap="round" stroke-width="4" id="cgpa-ring-circle"></circle>
                                    </svg>
                                    <span class="absolute text-sm font-bold text-slate-800" id="marks-cgpa-ring">--</span>
                                </div>
                                <div class="space-y-0.5 min-w-0">
                                    <p class="text-slate-400 font-bold text-[9px] uppercase tracking-wider">CGPA</p>
                                    <p class="text-slate-800 font-extrabold text-xs truncate" id="marks-cgpa-status">Loading...</p>
                                </div>
                            </div>
                            
                            <div class="bg-surface-container-lowest p-4 rounded-xl shadow-[0_10px_40px_rgba(48,51,55,0.04)] flex items-center gap-4 border border-outline-variant/10">
                                <div class="relative flex items-center justify-center flex-shrink-0">
                                    <svg class="w-12 h-12 transform -rotate-90">
                                        <circle class="text-slate-100" cx="24" cy="24" fill="transparent" r="20" stroke="currentColor" stroke-width="4"></circle>
                                        <circle class="text-blue-500" cx="24" cy="24" fill="transparent" r="20" stroke="currentColor" stroke-dasharray="125.66" stroke-dashoffset="125.66" stroke-linecap="round" stroke-width="4" id="sgpa-ring-circle"></circle>
                                    </svg>
                                    <span class="absolute text-sm font-bold text-slate-800" id="marks-sgpa-ring">--</span>
                                </div>
                                <div class="space-y-0.5 min-w-0">
                                    <p class="text-slate-400 font-bold text-[9px] uppercase tracking-wider">SGPA</p>
                                    <p class="text-slate-800 font-extrabold text-xs truncate">Current Sem</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>
                <!-- Subject Grid -->
                <section class="grid grid-cols-1 md:grid-cols-2 gap-4" id="marks-grid">
                    ${[1, 2, 3, 4].map(() => `<div class="glass-card border border-white/20 p-5 rounded-2xl shimmer-loading h-28"></div>`).join('')}
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
                const sgpa = parseFloat(data.sgpa) || 0;

                setEl('marks-cgpa-ring', 'innerText', data.cgpa || '--');
                setEl('marks-sgpa-ring', 'innerText', data.sgpa || '--');
                setEl('marks-cgpa-status', 'innerText', cgpa >= 8.5 ? "Dean's List" : cgpa >= 7 ? 'Good Standing' : cgpa >= 5 ? 'Satisfactory' : 'Needs Improve');

                // Update SVG rings
                const cgpaRing = $('cgpa-ring-circle');
                if (cgpaRing) {
                    const pct = Math.min(cgpa / 10, 1);
                    const circumference = 125.66;
                    cgpaRing.style.strokeDashoffset = circumference - pct * circumference;
                }
                const sgpaRing = $('sgpa-ring-circle');
                if (sgpaRing) {
                    const pct = Math.min(sgpa / 10, 1);
                    const circumference = 125.66;
                    sgpaRing.style.strokeDashoffset = circumference - pct * circumference;
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
                            <span class="mt-2 text-[8px] font-bold text-on-surface-variant tracking-widest uppercase">${s.name.slice(0, 4)}</span>
                        </div>`;
                    }).join('');
                }
            } catch (e) {
                console.error('[Marks] Error:', e);
                const grid = $('marks-grid');
                if (grid) {
                    grid.innerHTML = `
                        <div class="col-span-1 md:col-span-2 p-6 bg-white border border-slate-200/50 rounded-2xl shadow-sm text-center space-y-4">
                            <div class="w-12 h-12 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto">
                                <span class="material-symbols-outlined text-xl">cloud_off</span>
                            </div>
                            <div>
                                <h4 class="text-sm font-bold text-slate-800">Connection Error</h4>
                                <p class="text-xs text-slate-400 mt-1">Unable to retrieve academic records. Please try again.</p>
                            </div>
                            <button onclick="router.routes['/marks']?.afterRender?.()" class="px-5 py-2 bg-primary text-white font-extrabold text-xs rounded-full active-scale transition-transform">
                                Retry
                            </button>
                        </div>
                    `;
                }
            }
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
                    <div class="glass-card border border-white/40 p-6 sm:p-8 rounded-2xl flex flex-col gap-4 justify-between shadow-sm active-scale transition-all">
                        <div>
                            <div class="w-10 h-10 bg-amber-100 text-amber-700 rounded-2xl flex items-center justify-center mb-4">
                                <span class="material-symbols-outlined text-lg">pending_actions</span>
                            </div>
                            <h4 class="font-extrabold text-base text-on-surface" style="font-family:'Plus Jakarta Sans',sans-serif">Remaining Dues</h4>
                            <p class="text-on-surface-variant/80 text-xs mt-1">Outstanding Balance</p>
                        </div>
                        <div class="text-2xl font-black text-amber-700" id="fee-due-card">--</div>
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

            <!-- ===== TRANSACTION RECEIPT MODAL ===== -->
            <div id="receipt-overlay" class="fixed inset-0 z-[110] hidden items-center justify-center bg-slate-950/50 backdrop-blur-sm p-4" role="dialog" aria-modal="true" aria-labelledby="receipt-heading">
                <section class="w-full max-w-sm max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-3xl bg-white shadow-2xl border border-white/30" role="document">
                    <div class="flex items-center justify-between px-6 py-5 border-b border-slate-100">
                        <div>
                            <p class="text-[10px] font-black uppercase tracking-[0.18em] text-blue-600">SITAM Smart ERP</p>
                            <h3 id="receipt-heading" class="mt-1 text-lg font-black text-slate-800">Fee Receipt</h3>
                        </div>
                        <button id="receipt-close-btn" type="button" class="p-2 rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600 active-scale" aria-label="Close receipt">
                            <span class="material-symbols-outlined">close</span>
                        </button>
                    </div>
                    <div class="space-y-5 p-6">
                        <div class="rounded-2xl bg-blue-50 border border-blue-100 p-4">
                            <p id="receipt-title" class="text-base font-extrabold text-slate-800 break-words">Fee payment</p>
                            <p id="receipt-student" class="mt-1 text-xs font-semibold text-slate-500">Student</p>
                        </div>
                        <div class="space-y-3 text-sm">
                            <div class="flex items-center justify-between gap-4"><span class="text-slate-500">Reference</span><span id="receipt-ref" class="font-mono text-xs font-bold text-slate-800 break-all text-right">—</span></div>
                            <div class="flex items-center justify-between gap-4"><span class="text-slate-500">Date</span><span id="receipt-date" class="font-semibold text-slate-800 text-right">—</span></div>
                            <div class="flex items-center justify-between gap-4"><span class="text-slate-500">Status</span><span id="receipt-status" class="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-slate-600">—</span></div>
                        </div>
                        <div class="border-t border-dashed border-slate-200 pt-4 flex items-end justify-between gap-4">
                            <span class="text-xs font-bold uppercase tracking-wider text-slate-400">Amount</span>
                            <span id="receipt-amount" class="text-2xl font-black text-slate-800">₹0</span>
                        </div>
                        <p class="text-center text-[10px] leading-relaxed text-slate-400">This is a digital transaction receipt from the student portal.</p>
                    </div>
                </section>
            </div>
        </div>`,
        afterRender: async () => {
            toggleShell(true);
            setActiveNav('fees');
            loading.show('Fetching Fees...');
            try {
                const [res, noticesRes] = await Promise.all([
                    api.get('/fees'),
                    api.get('/fee-notices/active').catch(() => ({ notices: [] }))
                ]);
                const d = res.data || {};
                const activeNotices = noticesRes.notices || [];
                const hasWarning = activeNotices.some(n => n.hallTicketBlockWarning === true);

                const formatRupees = (val) => {
                    if (!val) return '₹0';
                    let clean = String(val).replace(/[₹\s,]/g, '').trim();
                    if (clean.startsWith('Rs.')) {
                        clean = clean.replace('Rs.', '').trim();
                    }
                    const num = parseFloat(clean);
                    return isNaN(num) ? val : '₹' + num.toLocaleString('en-IN');
                };

                const dueAmount = formatRupees(d.dueAmount || d.totalDue);
                const totalAmount = formatRupees(d.totalAmount);
                const paidAmount = formatRupees(d.paidAmount);

                setEl('fee-due', 'innerText', dueAmount);
                setEl('fee-pct', 'innerText', `${d.paidProgress || 0}%`);
                setEl('fee-total', 'innerText', totalAmount);
                setEl('fee-paid', 'innerText', paidAmount);
                setEl('fee-due-card', 'innerText', dueAmount);
                setEl('fee-progress-text', 'innerText', `You've cleared ${paidAmount} of ${totalAmount} for the semester.`);
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
                                    } catch { }
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
                const receiptOverlay = $('receipt-overlay');
                const closeReceipt = () => receiptOverlay?.classList.add('hidden');
                const openReceipt = (txn) => {
                    if (!receiptOverlay || !txn) return;
                    const status = txn.status || 'Recorded';
                    const receiptStatus = $('receipt-status');
                    const receiptStatusClass = status === 'Paid' || status === 'Completed'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                        : status === 'Due' || status === 'Partial'
                            ? 'bg-amber-50 text-amber-700 border-amber-100'
                            : 'bg-slate-100 text-slate-600 border-slate-200';

                    setEl('receipt-title', 'innerText', txn.title || 'Fee payment');
                    setEl('receipt-student', 'innerText', state.profile?.name || 'Student');
                    setEl('receipt-ref', 'innerText', txn.ref || 'N/A');
                    setEl('receipt-date', 'innerText', txn.date || '—');
                    setEl('receipt-amount', 'innerText', formatRupees(txn.amount));
                    if (receiptStatus) {
                        receiptStatus.innerText = status;
                        receiptStatus.className = `rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${receiptStatusClass}`;
                    }
                    haptic();
                    receiptOverlay.classList.remove('hidden');
                };

                $('receipt-close-btn')?.addEventListener('click', closeReceipt);
                receiptOverlay?.addEventListener('click', (event) => {
                    if (event.target === receiptOverlay) closeReceipt();
                });

                list.innerHTML = txns.map((txn, index) => {
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
                                    <span class="material-symbols-outlined text-on-surface-variant text-lg">${txn.icon || 'receipt_long'}</span>
                                </div>
                                <div class="min-w-0 flex-1 mr-2">
                                    <p class="font-bold text-on-surface text-sm leading-tight truncate" title="${txn.title}">${txn.title}</p>
                                    <p class="text-[10px] text-slate-400 mt-1 flex items-center gap-1.5">
                                        <span class="bg-slate-100 px-1.5 py-0.5 rounded font-mono font-bold">${txn.ref || 'N/A'}</span>
                                        <span>•</span>
                                        <span>${txn.date || '—'}</span>
                                    </p>
                                </div>
                            </div>
                            <div class="text-right flex-shrink-0 flex flex-col items-end justify-center">
                                <p class="font-extrabold text-on-surface text-sm leading-tight">${formatRupees(txn.amount)}</p>
                                <span class="text-[9px] px-2 py-0.5 ${sc} rounded-full font-bold uppercase tracking-tighter mt-1.5 inline-block">${txn.status}</span>
                            </div>
                        </div>
                        <button type="button" class="receipt-btn mt-3 self-start inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-extrabold text-primary hover:bg-blue-50 active-scale" data-receipt-index="${index}">
                            <span class="material-symbols-outlined text-sm">receipt_long</span> View receipt
                        </button>
                        ${warningHtml}
                    </div>`;
                }).join('');
                list.querySelectorAll('.receipt-btn').forEach((button) => {
                    button.addEventListener('click', () => openReceipt(txns[Number(button.dataset.receiptIndex)]));
                });
            } catch (e) { console.error('[Fees] Error:', e); }
            finally { loading.hide(); }
        }
    },

    profile: {
        render: () => `<div class="min-h-screen pb-36 bg-[#F8FAFC]">
            <main class="pt-20 px-4 max-w-xl mx-auto space-y-5">

                <!-- ═══ HERO: Digital ID Card ═══ -->
                <section>
                    <div class="id-card p-6 sm:p-7 relative overflow-hidden cursor-pointer active-scale" id="id-card-element">
                        <div class="holographic-foil"></div>
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
                        <div class="relative z-10 flex items-center gap-4 mb-4">
                            <div id="id-avatar-container" class="w-20 h-20 bg-slate-900 border border-white/20 rounded-2xl flex items-center justify-center shadow-md overflow-hidden flex-shrink-0">
                                <span class="material-symbols-outlined text-white/95 text-4xl">person</span>
                            </div>
                            <div class="text-left text-white">
                                <h3 class="text-base font-black tracking-tight" id="id-name">---</h3>
                                <p class="text-xs font-bold text-blue-200 mt-0.5" id="id-roll">---</p>
                                <p class="text-[10px] text-slate-300 mt-1" id="id-dept">Dept: —</p>
                                <p class="text-[10px] text-slate-300" id="id-semester">Semester: —</p>
                            </div>
                        </div>
                        <div class="relative z-10 flex justify-between items-center pt-3 border-t border-white/10 text-[9px] text-slate-400 font-bold uppercase tracking-widest">
                            <span id="id-acyr">Academic Year: —</span>
                            <span class="text-blue-400 font-black">Tap to Expand</span>
                        </div>
                    </div>
                </section>

                <!-- ═══ ACADEMIC STANDING ═══ -->
                <section class="space-y-2">
                    <h3 class="text-xs font-bold uppercase tracking-wider text-slate-400">Academic Standing</h3>
                    <div class="grid grid-cols-3 gap-3">
                        <div class="p-4 bg-white border border-slate-200/50 rounded-2xl shadow-sm">
                            <p class="text-[9px] uppercase font-bold text-slate-400 leading-none">CGPA</p>
                            <p class="text-xl font-black text-primary mt-1.5" id="prof-cgpa-val">--</p>
                        </div>
                        <div class="p-4 bg-white border border-slate-200/50 rounded-2xl shadow-sm">
                            <p class="text-[9px] uppercase font-bold text-slate-400 leading-none">SGPA</p>
                            <p class="text-xl font-black text-indigo-600 mt-1.5" id="prof-sgpa-val">--</p>
                        </div>
                        <div class="p-4 bg-white border border-slate-200/50 rounded-2xl shadow-sm">
                            <p class="text-[9px] uppercase font-bold text-slate-400 leading-none">Attendance</p>
                            <p class="text-xl font-black text-emerald-600 mt-1.5" id="prof-att-val">--%</p>
                        </div>
                    </div>
                </section>

                <!-- ═══ PROFILE SECTIONS ═══ -->
                <section class="space-y-4" id="profile-sections-container">
                    <div class="col-span-1 sm:col-span-2 h-40 bg-slate-100 rounded-3xl animate-pulse"></div>
                </section>

                <!-- Log Out -->
                <button class="w-full py-4 bg-rose-50 text-rose-600 border border-rose-100 rounded-2xl font-bold active-scale transition-colors hover:bg-rose-600 hover:text-white mt-2 flex items-center justify-center gap-2" onclick="api.logout()">
                    <span class="material-symbols-outlined">logout</span> Log Out
                </button>
            </main>

            <!-- Fullscreen ID Overlay -->
            <div id="fullscreen-id-overlay" class="fixed inset-0 bg-[#0f172a] z-[150] hidden flex-col items-center justify-center p-6" onclick="closeFullscreenID()">
                <div class="bg-gradient-to-tr from-[#0f172a] to-[#1e3a8a] border border-white/10 rounded-3xl p-6 w-full max-w-sm text-center relative overflow-hidden shadow-2xl flex flex-col justify-between min-h-[440px]" onclick="event.stopPropagation()">
                    <div class="flex justify-between items-start">
                        <span class="material-symbols-outlined text-white text-3xl">school</span>
                        <div class="text-right text-white">
                            <h3 class="text-lg font-black tracking-tight leading-none uppercase">SITAM ERP</h3>
                            <p class="text-[9px] text-blue-300 font-extrabold uppercase mt-0.5 tracking-widest">Digital Student Passport</p>
                        </div>
                    </div>
                    <div class="flex flex-col items-center my-4 space-y-3 text-white">
                        <div id="fs-avatar-container" class="w-24 h-24 bg-slate-900 border-2 border-white/20 rounded-3xl flex items-center justify-center shadow-lg overflow-hidden flex-shrink-0">
                            <span class="material-symbols-outlined text-white/95 text-5xl">person</span>
                        </div>
                        <div>
                            <h2 class="text-xl font-black tracking-tight" id="fs-name">---</h2>
                            <p class="text-sm font-mono text-blue-200 mt-0.5" id="fs-roll">---</p>
                        </div>
                        <div class="flex flex-col gap-1 text-[11px] text-slate-300 pt-1 text-center font-medium">
                            <p id="fs-dept">Department: —</p>
                            <p id="fs-batch">Year: —</p>
                            <p id="fs-acyr">Academic Year: —</p>
                            <p id="fs-adm">Admission No: —</p>
                            <p id="fs-blood">Blood Group: —</p>
                        </div>
                    </div>
                    <div class="flex justify-center my-2">
                        <div class="p-2.5 bg-white rounded-xl flex items-center justify-center shadow-md">
                            <span class="material-symbols-outlined text-slate-800 text-5xl font-light">qr_code_2</span>
                        </div>
                    </div>
                    <div class="flex justify-between pt-3 border-t border-white/10 text-[9px] text-slate-400 font-bold uppercase tracking-widest mt-2">
                        <span id="fs-validity">Academic Year: —</span>
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
                state.profile = d;

                const na = (v) => (v && String(v).trim() !== '' && v !== '--') ? v : 'Not Available';

                // ─── ID Card ────────────────────────────────────────────────
                setEl('id-name', 'innerText', d.name || 'Student');
                setEl('id-roll', 'innerText', d.roll || d.userId || '---');
                setEl('id-dept', 'innerText', `Dept: ${d.department || d.branch || d.program || '—'}`);
                setEl('id-semester', 'innerText', d.semester ? `Semester: ${d.semester}` : 'Semester: —');
                setEl('id-acyr', 'innerText', d.academicYear ? `Academic Year: ${d.academicYear}` : 'Academic Year: —');

                setEl('fs-name', 'innerText', d.name || 'Student');
                setEl('fs-roll', 'innerText', d.roll || d.userId || '---');
                setEl('fs-dept', 'innerText', `Department: ${d.department || d.branch || '—'}`);
                setEl('fs-batch', 'innerText', `Year: ${d.year || '—'}`);
                setEl('fs-acyr', 'innerText', `Academic Year: ${d.academicYear || '—'}`);
                setEl('fs-adm', 'innerText', `Admission No: ${d.admissionNo || '—'}`);
                setEl('fs-blood', 'innerText', `Blood Group: ${d.bloodGroup || '—'}`);
                setEl('fs-validity', 'innerText', d.academicYear ? `AY: ${d.academicYear}` : 'Academic Year: —');

                // ─── Avatar ──────────────────────────────────────────────────
                const getInitials = (name) => {
                    if (!name) return 'ST';
                    return name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
                };
                const initials = getInitials(d.name);
                const initialsAvatar = `<div class="w-full h-full bg-gradient-to-tr from-[#2563EB] to-[#6366F1] flex items-center justify-center text-white font-extrabold text-2xl">${initials}</div>`;

                if (d.profilePhotoUrl) {
                    const imgTag = (cls) => `<img src="${d.profilePhotoUrl}" class="${cls}" alt="Photo" onerror="this.parentElement.innerHTML='${initialsAvatar.replace(/'/g, "\\'")}'" >`;
                    setEl('id-avatar-container', 'innerHTML', imgTag('w-full h-full object-cover rounded-2xl'));
                    setEl('fs-avatar-container', 'innerHTML', imgTag('w-full h-full object-cover rounded-3xl'));
                } else {
                    setEl('id-avatar-container', 'innerHTML', initialsAvatar);
                    setEl('fs-avatar-container', 'innerHTML', initialsAvatar);
                }

                // ─── ID Card click → fullscreen ──────────────────────────────
                $('id-card-element')?.addEventListener('click', () => {
                    haptic();
                    $('fullscreen-id-overlay')?.classList.remove('hidden');
                    $('fullscreen-id-overlay')?.classList.add('flex');
                });
                window.closeFullscreenID = () => {
                    $('fullscreen-id-overlay')?.classList.add('hidden');
                    $('fullscreen-id-overlay')?.classList.remove('flex');
                };

                // ─── Attendance & Marks stats ────────────────────────────────
                setEl('prof-cgpa-val', 'innerText', d.cgpa || '--');
                setEl('prof-sgpa-val', 'innerText', d.sgpa || '--');
                api.get('/attendance').then(attRes => {
                    const attList = attRes.attendance || [];
                    const overall = calcOverallAttendance(attList);
                    setEl('prof-att-val', 'innerText', overall.text);
                }).catch(() => { });

                // ─── Section panels ──────────────────────────────────────────
                const list = $('profile-sections-container');
                if (!list) return;

                const renderRow = (icon, label, val, sensitive = false) => {
                    const displayVal = na(val);
                    const lockIcon = sensitive && val ? `<span class="material-symbols-outlined text-amber-500 text-[12px] ml-1" title="Masked for security">lock</span>` : '';
                    return `
                        <div class="flex items-center gap-3.5 py-3 border-b border-slate-100 last:border-0">
                            <div class="w-8 h-8 rounded-lg bg-blue-50 text-blue-500 border border-blue-100/50 flex items-center justify-center flex-shrink-0">
                                <span class="material-symbols-outlined text-[16px]">${icon}</span>
                            </div>
                            <div class="min-w-0 flex-1">
                                <p class="text-[9px] uppercase font-bold text-slate-400 leading-none">${label}</p>
                                <div class="flex items-center mt-1">
                                    <p class="text-xs font-semibold text-slate-800 truncate">${displayVal}</p>
                                    ${lockIcon}
                                </div>
                            </div>
                        </div>`;
                };

                const renderPanel = (title, icon, rowsHtml, colorClass = 'text-blue-600') => `
                    <div class="bg-white/80 backdrop-blur-sm border border-slate-200/60 rounded-2xl shadow-sm overflow-hidden">
                        <div class="flex items-center gap-2 px-5 py-3.5 border-b border-slate-100 bg-slate-50/50">
                            <span class="material-symbols-outlined ${colorClass} text-lg" style="font-variation-settings:'FILL' 1">${icon}</span>
                            <h4 class="text-xs font-black text-slate-800 uppercase tracking-widest">${title}</h4>
                        </div>
                        <div class="px-5 flex flex-col">${rowsHtml}</div>
                    </div>`;

                const sect1 = [
                    renderRow('cake', 'Date of Birth', d.dob),
                    renderRow('face', 'Gender', d.gender),
                    renderRow('water_drop', 'Blood Group', d.bloodGroup),
                    renderRow('language', 'Nationality', d.nationality),
                    renderRow('diversity_3', 'Religion', d.religion),
                    renderRow('groups', 'Category / Caste', d.caste),
                    renderRow('fingerprint', 'Aadhaar Number', d.aadhar, true),
                    renderRow('badge_2', 'APAAR / ABC ID', d.apaarId, true),
                ].join('');

                const sect2 = [
                    renderRow('badge', 'Student ID / Roll', d.roll || d.userId),
                    renderRow('assignment_ind', 'Admission Number', d.admissionNo),
                    renderRow('school', 'Program', d.program),
                    renderRow('account_tree', 'Branch / Department', d.department || d.branch),
                    renderRow('event_seat', 'Current Semester', d.semester),
                    renderRow('import_contacts', 'Section', d.section),
                    renderRow('calendar_today', 'Academic Year', d.academicYear),
                    renderRow('calendar_month', 'Year of Study', d.year),
                    renderRow('login', 'Date of Joining', d.joiningDate),
                    renderRow('history_edu', 'Last Institution', d.lastStudied),
                    renderRow('military_tech', 'Entrance Type', d.entranceType),
                    renderRow('grade', 'Entrance Rank', d.entranceRank),
                    renderRow('school', 'SSC Marks', d.sscMarks),
                    renderRow('school', 'Intermediate Marks', d.interMarks),
                ].join('');

                const sect3 = [
                    renderRow('mail', 'Email Address', d.email),
                    renderRow('phone', 'Mobile Number', d.phone),
                    renderRow('location_on', 'Permanent Address', d.address),
                    renderRow('location_city', 'Correspondence Address', d.correspondenceAddress),
                    renderRow('emergency', 'Emergency Contact', d.emergencyContact),
                ].join('');

                const sect4 = [
                    renderRow('supervisor_account', 'Father Name', d.fatherName),
                    renderRow('contact_phone', 'Father Mobile', d.fatherMobile),
                    renderRow('mail', 'Father Email', d.fatherEmail),
                    renderRow('work', 'Father Occupation', d.fatherOccupation),
                    renderRow('supervisor_account', 'Mother Name', d.motherName),
                    renderRow('contact_phone', 'Mother Mobile', d.motherMobile),
                    renderRow('mail', 'Mother Email', d.motherEmail),
                    renderRow('work', 'Mother Occupation', d.motherOccupation),
                    renderRow('currency_rupee', 'Annual Income', d.annualIncome),
                    renderRow('shield_with_heart', 'Guardian Name', d.guardianName),
                    renderRow('phone_in_talk', 'Guardian Contact', d.guardianPhone),
                    renderRow('pin_drop', 'Guardian Address', d.guardianAddress),
                ].join('');

                const sect5 = [
                    renderRow('home', 'Accommodation', d.hostel || 'Day Scholar'),
                    renderRow('meeting_room', 'Room Number', d.hostel ? d.roomNo : 'N/A'),
                    renderRow('chair', 'Seat Category', d.seatType),
                    renderRow('payments', 'Scholarship', d.scholarship),
                ].join('');

                // Sync info
                const syncDate = d.lastSync ? new Date(d.lastSync).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'Never';
                const syncBadgeColor = d.syncStatus === 'synced' ? 'bg-emerald-100 text-emerald-700' : d.syncStatus === 'syncing' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500';
                const syncPanel = `
                    <div class="bg-white/80 border border-slate-200/60 rounded-2xl shadow-sm overflow-hidden">
                        <div class="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 bg-slate-50/50">
                            <div class="flex items-center gap-2">
                                <span class="material-symbols-outlined text-slate-500 text-lg" style="font-variation-settings:'FILL' 1">sync</span>
                                <h4 class="text-xs font-black text-slate-800 uppercase tracking-widest">Sync Information</h4>
                            </div>
                            <span class="text-[10px] font-bold px-2.5 py-1 rounded-full ${syncBadgeColor}">${(d.syncStatus || 'pending').toUpperCase()}</span>
                        </div>
                        <div class="px-5 py-3 flex items-center gap-3">
                            <span class="material-symbols-outlined text-slate-400 text-[16px]">schedule</span>
                            <div>
                                <p class="text-[9px] uppercase font-bold text-slate-400 leading-none">Last Synced</p>
                                <p class="text-xs font-semibold text-slate-800 mt-1">${syncDate}</p>
                            </div>
                        </div>
                    </div>`;

                list.innerHTML = [
                    renderPanel('Personal Information', 'person', sect1, 'text-violet-600'),
                    renderPanel('Academic Information', 'school', sect2, 'text-blue-600'),
                    renderPanel('Contact Information', 'contact_phone', sect3, 'text-emerald-600'),
                    renderPanel('Parent & Guardian', 'supervisor_account', sect4, 'text-rose-500'),
                    renderPanel('Accommodation & Admission', 'home', sect5, 'text-amber-600'),
                    syncPanel
                ].join('');

            } catch (err) {
                console.error('[Profile] load failed:', err);
            } finally {
                loading.hide();
            }
        }
    },
    // ---- E-LIBRARY ----
    library: {
        render: () => `<body class="bg-background min-h-screen pb-32">
            <main class="pt-20 px-6 max-w-2xl mx-auto">
                <section class="mb-6 flex justify-between items-end">
                    <div>
                        <p class="text-[9px] font-bold uppercase tracking-[0.2em] text-on-surface-variant mb-1">Academic Resources</p>
                        <h2 class="text-3xl font-extrabold tracking-tight text-on-surface" style="font-family:'Plus Jakarta Sans',sans-serif">E-Library</h2>
                    </div>
                </section>
                
                <!-- Search & Filters -->
                <div class="space-y-4 mb-6">
                    <div class="relative">
                        <span class="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-[20px]">search</span>
                        <input type="text" id="lib-search" placeholder="Search by title, subject..." class="w-full pl-11 pr-4 py-3 bg-surface-container-low border border-outline-variant/10 rounded-2xl text-sm focus:outline-none focus:border-primary text-on-surface" />
                    </div>
                    
                    <div class="flex gap-2 overflow-x-auto pb-2 hide-scrollbar momentum-scroll select-none" id="lib-category-filters">
                        <button class="lib-cat-btn flex-shrink-0 px-4 py-1.5 rounded-full text-xs font-bold bg-primary text-white" data-category="ALL">All</button>
                        <button class="lib-cat-btn flex-shrink-0 px-4 py-1.5 rounded-full text-xs font-bold bg-surface-container-high text-on-surface-variant" data-category="NOTES">Notes</button>
                        <button class="lib-cat-btn flex-shrink-0 px-4 py-1.5 rounded-full text-xs font-bold bg-surface-container-high text-on-surface-variant" data-category="ASSIGNMENT">Assignments</button>
                        <button class="lib-cat-btn flex-shrink-0 px-4 py-1.5 rounded-full text-xs font-bold bg-surface-container-high text-on-surface-variant" data-category="REFERENCE">References</button>
                        <button class="lib-cat-btn flex-shrink-0 px-4 py-1.5 rounded-full text-xs font-bold bg-surface-container-high text-on-surface-variant" data-category="GENERAL">General</button>
                    </div>

                    <div class="flex gap-3">
                        <select id="lib-subject-filter" class="w-full py-2.5 px-3 bg-surface-container-low border border-outline-variant/10 rounded-2xl text-xs font-semibold focus:outline-none focus:border-primary text-on-surface">
                            <option value="">All Subjects</option>
                        </select>
                    </div>
                </div>

                <div class="space-y-3" id="lib-list">
                    <div class="h-20 bg-surface-container-low rounded-xl animate-pulse"></div>
                </div>
            </main>
        </body>`,
        afterRender: async () => {
            toggleShell(true);
            setActiveNav('services');
            loading.show('Loading E-Library...');
            try {
                const res = await api.get('/library/materials');
                const list = $('lib-list');
                const searchInput = $('lib-search');
                const catFilters = document.querySelectorAll('.lib-cat-btn');
                const subFilter = $('lib-subject-filter');
                if (!list) return;

                const materials = res.data || [];

                // Populate unique subjects
                const uniqueSubs = Array.from(new Set(materials.map(m => m.subject).filter(Boolean))).sort();
                if (subFilter) {
                    subFilter.innerHTML = '<option value="">All Subjects</option>' + uniqueSubs.map(s => `<option value="${s}">${s}</option>`).join('');
                }

                let currentSearch = '';
                let currentCategory = 'ALL';
                let currentSubject = '';

                const renderFiltered = () => {
                    const filtered = materials.filter(m => {
                        const matchesSearch = !currentSearch ||
                            [m.title, m.subject, m.category].some(x => x?.toLowerCase().includes(currentSearch.toLowerCase()));
                        const matchesCat = currentCategory === 'ALL' || m.category === currentCategory;
                        const matchesSub = !currentSubject || m.subject === currentSubject;
                        return matchesSearch && matchesCat && matchesSub;
                    });

                    if (filtered.length === 0) {
                        list.innerHTML = `<div class="text-center py-16 text-on-surface-variant">
                            <span class="material-symbols-outlined text-5xl mb-4 block">local_library</span>
                            <p class="font-bold">No study materials found</p>
                            <p class="text-xs text-slate-400 mt-1">There are no files shared with your targeting rules.</p>
                        </div>`;
                        return;
                    }

                    list.innerHTML = filtered.map(m => {
                        const dateStr = new Date(m.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                        const sizeStr = (m.fileSize / 1024 / 1024).toFixed(1) + ' MB';

                        return `<div class="p-5 rounded-2xl bg-surface-container-lowest border border-outline-variant/10 flex flex-col gap-4 animate-reveal">
                            <div class="flex items-start justify-between gap-4">
                                <div class="min-w-0 flex-1">
                                    <div class="flex items-center gap-2 flex-wrap mb-1">
                                        <span class="px-2 py-0.5 rounded text-[9px] font-extrabold uppercase tracking-wider bg-[#e0e7ff] text-[#4338ca] border border-[#c7d2fe]/40">${m.category}</span>
                                        ${m.subject ? `<span class="px-2 py-0.5 rounded text-[9px] font-extrabold uppercase tracking-wider bg-[#f1f5f9] text-[#475569] border border-[#cbd5e1]/40">${m.subject}</span>` : ''}
                                    </div>
                                    <h4 class="font-extrabold text-on-surface text-sm leading-snug">${m.title}</h4>
                                    ${m.description ? `<p class="text-xs text-on-surface-variant mt-1.5 leading-normal">${m.description}</p>` : ''}
                                </div>
                                <div class="w-10 h-10 rounded-xl bg-surface-container-high flex items-center justify-center flex-shrink-0">
                                    <span class="material-symbols-outlined text-primary text-[20px]">${m.fileType === 'PDF' ? 'picture_as_pdf' : 'description'}</span>
                                </div>
                            </div>

                            <div class="flex items-center justify-between border-t border-outline-variant/5 pt-3.5">
                                <div class="text-[10px] text-on-surface-variant font-medium">
                                    <p>Uploaded by: <span class="font-bold text-slate-700">${m.uploadedBy}</span></p>
                                    <p class="mt-0.5">${dateStr} · ${m.fileType} · ${sizeStr}</p>
                                </div>
                                <div class="flex gap-2">
                                    <button class="lib-preview-btn px-3 py-1.5 bg-[#eff6ff] text-[#1d4ed8] border border-[#bfdbfe]/50 hover:bg-[#dbeafe] rounded-xl text-xs font-bold transition-all flex items-center gap-1 active-scale" data-id="${m.id}" data-type="${m.mimeType}">
                                        <span class="material-symbols-outlined text-[15px]">visibility</span> Preview
                                    </button>
                                    <button class="lib-download-btn px-3 py-1.5 bg-primary text-white hover:bg-primary/95 rounded-xl text-xs font-bold transition-all flex items-center gap-1 active-scale" data-id="${m.id}" data-name="${m.originalFileName}">
                                        <span class="material-symbols-outlined text-[15px]">download</span> Get
                                    </button>
                                </div>
                            </div>
                        </div>`;
                    }).join('');

                    // Add event listeners for preview/download
                    list.querySelectorAll('.lib-preview-btn').forEach(btn => {
                        btn.addEventListener('click', async (e) => {
                            haptic();
                            const id = e.currentTarget.dataset.id;
                            const type = e.currentTarget.dataset.type;
                            try {
                                showToast('Opening preview...', 'info', 2000);
                                const res = await api.get(`/library/materials/${id}/content`, { responseType: 'blob' });
                                const blob = new Blob([res.data], { type });
                                const url = window.URL.createObjectURL(blob);
                                window.open(url, '_blank');
                            } catch (err) {
                                showToast('Failed to load file preview', 'error', 3000);
                            }
                        });
                    });

                    list.querySelectorAll('.lib-download-btn').forEach(btn => {
                        btn.addEventListener('click', async (e) => {
                            haptic();
                            const id = e.currentTarget.dataset.id;
                            const name = e.currentTarget.dataset.name;
                            try {
                                showToast('Downloading file...', 'info', 2000);
                                const res = await api.get(`/library/materials/${id}/content?download=true`, { responseType: 'blob' });
                                const url = window.URL.createObjectURL(new Blob([res.data]));
                                const link = document.createElement('a');
                                link.href = url;
                                link.setAttribute('download', name);
                                document.body.appendChild(link);
                                link.click();
                                link.remove();
                            } catch (err) {
                                showToast('Download failed', 'error', 3000);
                            }
                        });
                    });
                };

                // Listeners
                searchInput?.addEventListener('input', (e) => {
                    currentSearch = e.target.value;
                    renderFiltered();
                });

                catFilters.forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        haptic();
                        catFilters.forEach(b => b.className = 'lib-cat-btn flex-shrink-0 px-4 py-1.5 rounded-full text-xs font-bold bg-surface-container-high text-on-surface-variant');
                        e.currentTarget.className = 'lib-cat-btn flex-shrink-0 px-4 py-1.5 rounded-full text-xs font-bold bg-primary text-white';
                        currentCategory = e.currentTarget.dataset.category;
                        renderFiltered();
                    });
                });

                subFilter?.addEventListener('change', (e) => {
                    currentSubject = e.target.value;
                    renderFiltered();
                });

                renderFiltered();
            } catch (e) {
                console.error('[Library] Load Error:', e);
                const list = $('lib-list');
                if (list) {
                    list.innerHTML = `<div class="text-center py-16 text-on-surface-variant">
                        <span class="material-symbols-outlined text-5xl text-rose-500 mb-4 block">warning</span>
                        <p class="font-bold">Failed to load E-Library</p>
                        <p class="text-xs text-slate-400 mt-1">Please try again later.</p>
                    </div>`;
                }
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

                    let deadlineWarning = '';
                    if (isPending && a.date) {
                        try {
                            const due = new Date(a.date);
                            const now = new Date();
                            const timeDiff = due.getTime() - now.getTime();
                            const daysDiff = Math.ceil(timeDiff / (1000 * 3600 * 24));
                            if (daysDiff >= 0 && daysDiff <= 2) {
                                deadlineWarning = `<span class="ml-2 bg-rose-100 text-rose-700 text-[8px] font-extrabold uppercase px-1.5 py-0.5 rounded border border-rose-200">Due Soon</span>`;
                            }
                        } catch (_) { }
                    }

                    return `<div class="p-5 rounded-xl ${bg} flex items-center gap-4 justify-between">
                        <div class="flex items-center gap-4 min-w-0 flex-1">
                            <div class="w-12 h-12 rounded-full bg-surface-container-high flex items-center justify-center flex-shrink-0">
                                <span class="material-symbols-outlined ${iconColor}">${icon}</span>
                            </div>
                            <div class="min-w-0 flex-1">
                                <p class="font-bold text-on-surface text-sm truncate" title="${a.title}">${a.title}</p>
                                <p class="text-[11px] text-on-surface-variant mt-0.5 truncate">${a.subject} · Due ${a.date || '--'}${deadlineWarning}</p>
                            </div>
                        </div>
                        <span class="text-[10px] px-2 py-1 rounded-full font-bold uppercase flex-shrink-0 ${isPending ? 'bg-tertiary-container/30 text-on-tertiary-container' : 'bg-secondary-container text-on-secondary-container'}">${a.status}</span>
                    </div>`;
                }).join('');
            } catch (e) {
                console.error('[Assignments] Error:', e);
                const list = $('asn-list');
                if (list) {
                    list.innerHTML = `
                        <div class="p-6 bg-white border border-slate-200/50 rounded-2xl shadow-sm text-center space-y-4">
                            <div class="w-12 h-12 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto">
                                <span class="material-symbols-outlined text-xl">cloud_off</span>
                            </div>
                            <div>
                                <h4 class="text-sm font-bold text-slate-800">Connection Error</h4>
                                <p class="text-xs text-slate-400 mt-1">Unable to retrieve assignments list. Please try again.</p>
                            </div>
                            <button onclick="router.routes['/assignments']?.afterRender?.()" class="px-5 py-2 bg-primary text-white font-extrabold text-xs rounded-full active-scale transition-transform">
                                Retry
                            </button>
                        </div>
                    `;
                }
            }
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
                    ${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => `
                        <button data-day="${d}" class="day-tab flex-shrink-0 px-5 py-2.5 rounded-full text-[11px] font-bold uppercase tracking-widest transition-all ${i === 0 ? 'bg-secondary text-on-secondary' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}">${d.slice(0, 3)}</button>`).join('')}
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
            } catch (e) {
                console.error('[Timetable] Fetch error:', e);
                const grid = $('tt-grid');
                if (grid) {
                    grid.innerHTML = `
                        <div class="p-6 bg-white border border-slate-200/50 rounded-2xl shadow-sm text-center space-y-4">
                            <div class="w-12 h-12 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto">
                                <span class="material-symbols-outlined text-xl">cloud_off</span>
                            </div>
                            <div>
                                <h4 class="text-sm font-bold text-slate-800">Connection Error</h4>
                                <p class="text-xs text-slate-400 mt-1">Unable to retrieve schedule. Please try again.</p>
                            </div>
                            <button onclick="router.routes['/timetable']?.afterRender?.()" class="px-5 py-2 bg-primary text-white font-extrabold text-xs rounded-full active-scale transition-transform">
                                Retry
                            </button>
                        </div>
                    `;
                }
                loading.hide();
                return;
            }
            loading.hide();

            const colors = ['bg-secondary-container text-secondary', 'bg-tertiary-container/40 text-on-tertiary-container', 'bg-surface-container-high text-on-surface-variant', 'bg-surface-container text-primary'];
            const icons = ['terminal', 'calculate', 'language', 'science', 'menu_book', 'code', 'psychology', 'biotech'];

            function parseTime(timeStr) {
                if (!timeStr) return null;
                const clean = timeStr.replace(/^"|"$/g, '').trim();
                const parts = clean.split('-');
                const startStr = parts[0].trim(); // e.g. "09:00 AM"

                const match = startStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
                if (!match) return null;

                let hours = parseInt(match[1]);
                const minutes = parseInt(match[2]);
                const ampm = match[3].toUpperCase();

                if (ampm === 'PM' && hours < 12) hours += 12;
                if (ampm === 'AM' && hours === 12) hours = 0;

                const d = new Date();
                d.setHours(hours, minutes, 0, 0);
                return d;
            }

            function renderDay(day) {
                const grid = $('tt-grid');
                if (!grid) return;
                const daySlots = allSlots.filter(s => s.day === day).sort((a, b) => (parseInt(a.period) || 0) - (parseInt(b.period) || 0));
                if (daySlots.length === 0) {
                    grid.innerHTML = `<div class="text-center py-16 text-on-surface-variant"><span class="material-symbols-outlined text-5xl mb-4 block">event_busy</span><p class="font-bold">No classes on ${day}</p></div>`;
                    return;
                }

                // Determine active/next class if today matches selected tab
                const now = new Date();
                const systemDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                const systemToday = systemDays[now.getDay()];
                const isSystemToday = (day === systemToday);

                let highlightedIndex = -1;
                let highlightLabel = '';

                if (isSystemToday && daySlots.length > 0) {
                    const parsedSlots = daySlots.map(s => {
                        const start = parseTime(s.time);
                        return { slot: s, start };
                    });

                    // Class active check (within 50 minutes of start)
                    const activeIndex = parsedSlots.findIndex(item => {
                        if (!item.start) return false;
                        const diffMs = now.getTime() - item.start.getTime();
                        return diffMs >= 0 && diffMs < 50 * 60 * 1000;
                    });

                    if (activeIndex !== -1) {
                        highlightedIndex = activeIndex;
                        highlightLabel = 'Now';
                    } else {
                        // Class next check (first starting after now)
                        const nextIndex = parsedSlots.findIndex(item => {
                            if (!item.start) return false;
                            return item.start.getTime() > now.getTime();
                        });
                        if (nextIndex !== -1) {
                            highlightedIndex = nextIndex;
                            highlightLabel = 'Next';
                        }
                    }
                }

                grid.innerHTML = daySlots.map((s, i) => {
                    const timeVal = (s.time || '--').replace(/^"|"$/g, '').trim();
                    const periodVal = parseInt(s.period) || (i + 1);
                    const subjectDisplay = (s.subjectName && s.subjectName !== s.subjectCode)
                        ? s.subjectName
                        : (s.subjectCode || 'Class');

                    const isHighlighted = (i === highlightedIndex);
                    const borderClass = isHighlighted
                        ? 'border-2 border-primary bg-gradient-to-tr from-white to-blue-50/20 shadow-md relative'
                        : 'glass-card border border-white/40 shadow-sm relative';

                    const badgeHtml = isHighlighted
                        ? `<span class="absolute top-2.5 right-2.5 px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-wider ${highlightLabel === 'Now' ? 'bg-emerald-500 text-white animate-pulse' : 'bg-blue-600 text-white'}">${highlightLabel === 'Now' ? 'Live Now' : 'Next Up'}</span>`
                        : '';

                    return `
                    <div class="${borderClass} p-4 sm:p-5 rounded-2xl flex items-center gap-4 sm:gap-5 active-scale transition-all duration-200">
                        ${badgeHtml}
                        <div class="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${colors[i % colors.length]}">
                            <span class="material-symbols-outlined text-base sm:text-lg" style="font-variation-settings:'FILL' 1">${icons[i % icons.length]}</span>
                        </div>
                        <div class="flex-1 min-w-0 pr-12">
                            <p class="text-[9px] font-extrabold text-on-surface-variant/70 tracking-wider uppercase">${s.subjectCode || '--'}</p>
                            <h4 class="font-extrabold text-sm text-on-surface truncate" style="font-family:'Plus Jakarta Sans',sans-serif">${subjectDisplay}</h4>
                            <div class="flex flex-wrap items-center gap-x-3.5 gap-y-0.5 mt-1">
                                <div class="flex items-center gap-1 text-[10px] text-on-surface-variant">
                                    <span class="material-symbols-outlined text-xs text-slate-400" style="font-size:12px">meeting_room</span> <span class="truncate max-w-[80px]">${s.room || '--'}</span>
                                </div>
                                <div class="flex items-center gap-1 text-[10px] text-on-surface-variant">
                                    <span class="material-symbols-outlined text-xs text-slate-400" style="font-size:12px">person</span> <span class="truncate max-w-[100px]">${s.facultyName || '--'}</span>
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

            const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            const todayIndex = new Date().getDay();
            let activeDay = (todayIndex >= 1 && todayIndex <= 6) ? days[todayIndex - 1] : 'Monday';
            renderDay(activeDay);

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
                    ${[1, 2, 3].map(() => `<div class="h-24 bg-surface-container-low rounded-xl animate-pulse"></div>`).join('')}
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
            } catch (e) { console.error('[Syllabus] Error:', e); }
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
            const formatRelativeTime = (dateInput) => {
                if (!dateInput) return '—';
                const date = new Date(dateInput);
                if (isNaN(date.getTime())) return '—';

                const now = new Date();
                const diffMs = now.getTime() - date.getTime();
                const diffSec = Math.floor(diffMs / 1000);
                const diffMin = Math.floor(diffSec / 60);
                const diffHour = Math.floor(diffMin / 60);
                const diffDay = Math.floor(diffHour / 24);

                if (diffSec < 60) return 'Just now';
                if (diffMin < 60) return `${diffMin}m ago`;
                if (diffHour < 24) return `${diffHour}h ago`;
                if (diffDay === 1) return 'Yesterday';
                if (diffDay < 7) return `${diffDay}d ago`;

                return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
            };

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
                                                    <div class="flex items-center gap-1.5 flex-wrap">
                                                        <h4 class="font-extrabold text-slate-800 text-sm truncate leading-tight">${n.title}</h4>
                                                        ${!isRead ? `<span class="w-1.5 h-1.5 bg-primary rounded-full flex-shrink-0" id="unread-dot-${n.id}"></span>` : ''}
                                                        ${n.category === 'alert' ? `<span class="px-1.5 py-0.5 rounded bg-rose-50 border border-rose-200 text-rose-600 text-[8px] font-black uppercase tracking-wider flex-shrink-0">High</span>` : ''}
                                                    </div>
                                                    <p class="text-xs text-slate-500 mt-1.5 leading-normal break-words">${n.message}</p>
                                                    <p class="text-[9px] text-slate-400 font-bold mt-2 font-mono">${formatRelativeTime(n.createdAt)}</p>
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

                            api.post('/notifications/read', { notificationId: notifId }).catch(() => { });

                            const localNotif = allNotifications.find(n => n.id === notifId);
                            if (localNotif) localNotif.isRead = true;
                            SITAMDb.set('erp_cache', '/notifications', { notifications: allNotifications }, 24 * 60 * 60 * 1000).catch(() => { });

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

                        api.delete(`/notifications/${notifId}`).catch(() => { });

                        allNotifications = allNotifications.filter(n => n.id !== notifId);
                        SITAMDb.set('erp_cache', '/notifications', { notifications: allNotifications }, 24 * 60 * 60 * 1000).catch(() => { });

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
            } catch (_) { }

            // Load from server
            try {
                const res = await api.get('/notifications');
                const body = res.data || {};
                const notifications = body.data?.notifications || body.notifications || [];

                allNotifications = notifications;
                await SITAMDb.set('erp_cache', '/notifications', { notifications }, 24 * 60 * 60 * 1000);
                renderNotifications();
            } catch (err) {
                console.error('[Notifications] Network fetch error:', err);
                const list = $('notif-list-container');
                if (list && allNotifications.length === 0) {
                    list.innerHTML = `
                        <div class="p-6 bg-white border border-slate-200/50 rounded-2xl shadow-sm text-center space-y-4">
                            <div class="w-12 h-12 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto">
                                <span class="material-symbols-outlined text-xl">cloud_off</span>
                            </div>
                            <div>
                                <h4 class="text-sm font-bold text-slate-800">Connection Error</h4>
                                <p class="text-xs text-slate-400 mt-1">Unable to retrieve notifications. Please try again.</p>
                            </div>
                            <button onclick="router.routes['/notifications']?.afterRender?.()" class="px-5 py-2 bg-primary text-white font-extrabold text-xs rounded-full active-scale transition-transform">
                                Retry
                            </button>
                        </div>
                    `;
                }
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

                    api.post('/notifications/read-all').catch(() => { });

                    SITAMDb.set('erp_cache', '/notifications', { notifications: allNotifications }, 24 * 60 * 60 * 1000).catch(() => { });

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
                        ${schedules.map(sch => {
                    const parseExamDate = (dateStr) => {
                        if (!dateStr) return { month: 'EXAM', day: '—' };
                        const parts = dateStr.split('/');
                        if (parts.length === 3) {
                            const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
                            const mIdx = parseInt(parts[1]) - 1;
                            return { month: months[mIdx] || 'EXAM', day: parts[0] };
                        }
                        return { month: 'DATE', day: dateStr };
                    };
                    const dInfo = parseExamDate(sch.date);
                    return `
                            <div class="bg-surface-container-lowest border border-outline-variant/10 p-5 rounded-xl flex items-center gap-5 shadow-sm hover:shadow-md transition-all">
                                <div class="w-12 h-14 bg-rose-50 text-rose-700 rounded-xl flex flex-col items-center justify-center border border-rose-100 flex-shrink-0">
                                    <span class="text-[9px] font-black uppercase tracking-wider leading-none mt-1">${dInfo.month}</span>
                                    <span class="text-lg font-black leading-none mt-1 mb-1">${dInfo.day}</span>
                                </div>
                                <div class="flex-1 min-w-0">
                                    <p class="text-[10px] font-bold text-on-surface-variant tracking-wider uppercase">${sch.subjectCode} • ${sch.type}</p>
                                    <h4 class="font-bold text-on-surface truncate" style="font-family:'Plus Jakarta Sans',sans-serif">${sch.subjectName}</h4>
                                    <div class="flex flex-wrap items-center gap-x-3.5 gap-y-1 mt-2">
                                        <span class="px-2 py-0.5 bg-slate-100 text-slate-700 rounded-full text-[9px] font-bold border border-slate-200/50 flex items-center gap-0.5"><span class="material-symbols-outlined text-[10px]" style="font-size:10px">meeting_room</span> Hall ${sch.hall}</span>
                                        <span class="px-2 py-0.5 bg-slate-100 text-slate-700 rounded-full text-[9px] font-bold border border-slate-200/50 flex items-center gap-0.5"><span class="material-symbols-outlined text-[10px]" style="font-size:10px">chair</span> Seat: ${sch.seatNumber}</span>
                                        <span class="px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full text-[9px] font-bold border border-blue-200/50 flex items-center gap-0.5"><span class="material-symbols-outlined text-[10px]" style="font-size:10px">calendar_today</span> ${sch.date}</span>
                                    </div>
                                </div>
                            </div>`;
                }).join('')}
                    </div>`;
            } catch (e) {
                console.error('[Exams] Error:', e);
                const container = $('exams-container');
                if (container) {
                    container.innerHTML = `<div class="text-center py-16 text-on-surface-variant font-bold">Failed to load exam schedules.</div>`;
                }
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
                            }).catch(() => { });
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
                            window.Capacitor.Plugins.Browser.open({ url: link }).catch(() => { });
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
                        <div class="service-card glass-panel p-5 flex flex-col justify-between h-40 cursor-pointer active-scale transition-all hover:shadow-md border border-slate-200/50" onclick="haptic(); router.navigate('/library')">
                            <div class="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center text-white shadow-md shadow-indigo-500/20">
                                <span class="material-symbols-outlined text-2xl font-bold">local_library</span>
                            </div>
                            <div>
                                <h4 class="font-extrabold text-slate-800 text-sm tracking-wide">E-Library</h4>
                                <p class="text-[10px] text-slate-400 mt-1 leading-snug">Access targeted notes, textbooks &amp; slides</p>
                            </div>
                        </div>

                        <div class="service-card glass-panel p-5 flex flex-col justify-between h-40 cursor-pointer active-scale transition-all hover:shadow-md border border-slate-200/50" onclick="haptic(); router.navigate('/exit-pass')">
                            <div class="w-12 h-12 rounded-2xl bg-gradient-to-tr from-blue-500 to-indigo-500 flex items-center justify-center text-white shadow-md shadow-blue-500/20">
                                <span class="material-symbols-outlined text-2xl font-bold">badge</span>
                            </div>
                            <div>
                                <h4 class="font-extrabold text-slate-800 text-sm tracking-wide">Exit Pass</h4>
                                <p class="text-[10px] text-slate-400 mt-1 leading-snug">Request gate passes &amp; QR-verified campus exits</p>
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

                    <!-- Quota Status Card -->
                    <div id="ep-quota-card" class="p-4 bg-white border border-slate-200/50 rounded-2xl flex justify-between items-center shadow-sm animate-reveal hidden">
                        <div>
                            <p class="text-[9px] font-bold uppercase tracking-[0.1em] text-slate-400">Current Semester Quota</p>
                            <p class="text-xs font-bold text-slate-700 mt-0.5" id="quota-text-summary">Loading remaining passes...</p>
                        </div>
                        <span id="quota-badge" class="px-2.5 py-1 text-[10px] font-extrabold uppercase rounded-full bg-slate-100 text-slate-500"></span>
                    </div>

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

                    <!-- Type Selector Tabs -->
                    <div class="px-6 pt-4">
                        <div class="flex bg-slate-100 p-1 rounded-xl">
                          <button id="type-indiv-btn" type="button" class="flex-1 py-2 text-xs font-bold text-slate-800 bg-white rounded-lg shadow-sm transition-all">Individual</button>
                          <button id="type-group-btn" type="button" class="flex-1 py-2 text-xs font-bold text-slate-400 hover:text-slate-600 transition-all">Group Request</button>
                        </div>
                    </div>

                    <form id="ep-form" class="p-6 pb-8 space-y-4 overflow-y-auto max-h-[70vh]">
                        <!-- Group Name Field (hidden by default) -->
                        <div id="group-name-field" class="space-y-1 hidden">
                            <label class="text-xs font-bold text-slate-500 uppercase tracking-wide">Group Name *</label>
                            <input type="text" id="ep-group-name" placeholder="e.g. Sports Team, Project Batch" class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-primary transition-all" />
                        </div>

                        <div class="space-y-1">
                            <label class="text-xs font-bold text-slate-500 uppercase tracking-wide">Destination *</label>
                            <input type="text" id="ep-destination" required placeholder="e.g. Home, Hospital, Bank" class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-primary transition-all" />
                        </div>
                        <div class="space-y-1">
                            <label class="text-xs font-bold text-slate-500 uppercase tracking-wide">Reason *</label>
                            <textarea id="ep-reason" required placeholder="Describe the reason for exit..." class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-primary transition-all h-20 resize-none"></textarea>
                        </div>
                        <div class="space-y-1">
                            <label class="text-xs font-bold text-slate-500 uppercase tracking-wide">Exit Time *</label>
                            <input type="datetime-local" id="ep-exit-time" required class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-primary transition-all font-mono" />
                        </div>

                        <!-- Group Members Field (hidden by default) -->
                        <div id="group-members-field" class="space-y-1 hidden">
                            <label class="text-xs font-bold text-slate-500 uppercase tracking-wide font-semibold text-slate-700">Group Members Roll Numbers *</label>
                            <p class="text-[10px] text-slate-400 mb-1">Enter Roll numbers of other members, separated by commas (excluding yours)</p>
                            <textarea id="ep-group-members" placeholder="E.g. 25B61A0501, 25B61A0502" class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-primary transition-all h-20 resize-none"></textarea>
                        </div>

                        <!-- Individual Emergency Contact Field -->
                        <div id="emergency-contact-field" class="space-y-1">
                            <label class="text-xs font-bold text-slate-500 uppercase tracking-wide">Emergency Contact Number *</label>
                            <input type="tel" id="ep-emergency-contact" placeholder="10-digit phone number" pattern="[0-9]{10}" class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-primary transition-all" />
                        </div>
                        
                        <div class="space-y-1">
                            <label class="text-xs font-bold text-slate-500 uppercase tracking-wide">Remarks (Optional)</label>
                            <textarea id="ep-remarks" placeholder="Any additional notes..." class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-primary transition-all h-16 resize-none"></textarea>
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

            // Sheet tabs logic
            let selectedType = 'INDIVIDUAL';
            const indivBtn = $('type-indiv-btn');
            const groupBtn = $('type-group-btn');
            const groupNameField = $('group-name-field');
            const groupMembersField = $('group-members-field');
            const emergencyField = $('emergency-contact-field');
            const emergencyInput = $('ep-emergency-contact');

            indivBtn?.addEventListener('click', () => {
                selectedType = 'INDIVIDUAL';
                indivBtn.className = 'flex-1 py-2 text-xs font-bold text-slate-800 bg-white rounded-lg shadow-sm transition-all';
                groupBtn.className = 'flex-1 py-2 text-xs font-bold text-slate-400 hover:text-slate-600 transition-all';
                groupNameField.classList.add('hidden');
                groupMembersField.classList.add('hidden');
                emergencyField.classList.remove('hidden');
                emergencyInput.setAttribute('required', 'true');
            });

            groupBtn?.addEventListener('click', () => {
                selectedType = 'GROUP';
                groupBtn.className = 'flex-1 py-2 text-xs font-bold text-slate-800 bg-white rounded-lg shadow-sm transition-all';
                indivBtn.className = 'flex-1 py-2 text-xs font-bold text-slate-400 hover:text-slate-600 transition-all';
                groupNameField.classList.remove('hidden');
                groupMembersField.classList.remove('hidden');
                emergencyField.classList.add('hidden');
                emergencyInput.removeAttribute('required');
            });

            const openSheet = () => {
                haptic();
                const dock = document.getElementById('bottom-dock');
                if (dock) {
                    const dockRect = dock.getBoundingClientRect();
                    const dockClearance = window.innerHeight - dockRect.top;
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

            const formatDateTime = (dtStr) => {
                if (!dtStr) return '—';
                return new Date(dtStr).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
            };

            // ---- RENDER PASSES ----
            const renderPasses = (passes) => {
                if (!activeContainer || !historyList) return;

                // Show the most recent active (non-terminal) pass, or the most recent pass overall
                const ACTIVE_STATUSES = ['PENDING', 'APPROVED', 'UNDER_REVIEW'];
                let active = passes.find(p => ACTIVE_STATUSES.includes(p.status)) || passes[0] || null;
                const history = active ? passes.filter(p => p !== active) : [];

                if (!active) {
                    activeContainer.innerHTML = `<div class="p-6 rounded-2xl bg-white/60 border border-slate-200/50 text-center text-slate-400 font-bold text-xs uppercase tracking-wider animate-reveal">No exit passes found. Tap Apply to get started.</div>`;
                } else {
                    const STATUS_CONFIG = {
                        PENDING:      { badge: 'bg-amber-100 text-amber-800 border-amber-200',  label: 'Pending Approval',  icon: 'hourglass_top' },
                        APPROVED:     { badge: 'bg-emerald-100 text-emerald-800 border-emerald-200', label: 'Approved',         icon: 'check_circle' },
                        REJECTED:     { badge: 'bg-rose-100 text-rose-800 border-rose-200',      label: 'Rejected',          icon: 'cancel' },
                        CANCELLED:    { badge: 'bg-slate-100 text-slate-500 border-slate-200',   label: 'Cancelled',         icon: 'do_not_disturb' },
                        EXPIRED:      { badge: 'bg-slate-100 text-slate-600 border-slate-200',   label: 'Expired',           icon: 'timer_off' },
                        UNDER_REVIEW: { badge: 'bg-orange-100 text-orange-800 border-orange-200', label: 'Under Review',      icon: 'manage_search' },
                        EXITED:       { badge: 'bg-blue-100 text-blue-800 border-blue-200',      label: 'Exit Verified',     icon: 'how_to_reg' },
                    };
                    const cfg = STATUS_CONFIG[active.status] || { badge: 'bg-slate-100 text-slate-600', label: active.status, icon: 'info' };

                    const isPending     = active.status === 'PENDING';
                    const isApproved    = active.status === 'APPROVED';
                    const isRejected    = active.status === 'REJECTED';
                    const isCancelled   = active.status === 'CANCELLED';
                    const isExpired     = active.status === 'EXPIRED';
                    const isUnderReview = active.status === 'UNDER_REVIEW';
                    const isExited      = active.status === 'EXITED';
                    const isTerminal    = isRejected || isCancelled;

                    // --- STATUS MESSAGE ---
                    const STATUS_MESSAGES = {
                        PENDING:      { headline: 'Waiting for Approval', body: 'Your exit pass request has been submitted. You will be notified once Admin reviews it.', color: 'bg-amber-50 border-amber-200 text-amber-800' },
                        APPROVED:     { headline: 'Exit Pass Approved', body: 'Show the QR code below to Security at the gate to complete your exit.', color: 'bg-emerald-50 border-emerald-200 text-emerald-800' },
                        REJECTED:     { headline: 'Exit Pass Rejected', body: active.adminRemark ? `Reason: ${active.adminRemark}` : 'Your request was not approved.', color: 'bg-rose-50 border-rose-200 text-rose-800' },
                        CANCELLED:    { headline: 'Request Cancelled', body: 'This exit pass request was cancelled.', color: 'bg-slate-50 border-slate-200 text-slate-600' },
                        EXPIRED:      { headline: 'Pass Expired', body: 'This exit pass is no longer valid.', color: 'bg-slate-50 border-slate-200 text-slate-600' },
                        UNDER_REVIEW: { headline: 'Under Security Review', body: 'Your exit pass has been flagged for review. Please contact Security or Admin.', color: 'bg-orange-50 border-orange-200 text-orange-800' },
                        EXITED:       { headline: 'Exit Verified ✓', body: `Your campus exit was confirmed by Security.${active.exitConfirmedAt ? ' At: ' + new Date(active.exitConfirmedAt).toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : ''}`, color: 'bg-blue-50 border-blue-200 text-blue-800' },
                    };
                    const msg = STATUS_MESSAGES[active.status];

                    // --- TIMELINE STEPS ---
                    let steps;
                    if (isTerminal) {
                        steps = [
                            { label: 'Applied', done: true, current: false, failed: false },
                            { label: isRejected ? 'Rejected' : 'Cancelled', done: false, current: false, failed: true }
                        ];
                    } else if (isExpired) {
                        steps = [
                            { label: 'Applied', done: true, current: false, failed: false },
                            { label: 'Approved', done: true, current: false, failed: false },
                            { label: 'Expired', done: false, current: false, failed: true },
                            { label: 'Security', done: false, current: false, failed: false }
                        ];
                    } else if (isUnderReview) {
                        steps = [
                            { label: 'Applied', done: true, current: false, failed: false },
                            { label: 'Approved', done: true, current: false, failed: false },
                            { label: 'Under Review', done: false, current: true, failed: false },
                            { label: 'Security', done: false, current: false, failed: false }
                        ];
                    } else if (isExited) {
                        steps = [
                            { label: 'Applied', done: true, current: false, failed: false },
                            { label: 'Approved', done: true, current: false, failed: false },
                            { label: 'Security Verified', done: true, current: false, failed: false },
                            { label: 'Exit Confirmed', done: true, current: false, failed: false }
                        ];
                    } else if (isApproved) {
                        steps = [
                            { label: 'Applied', done: true, current: false, failed: false },
                            { label: 'Approved', done: true, current: false, failed: false },
                            { label: 'Gate Scan', done: false, current: true, failed: false },
                            { label: 'Exit Confirmed', done: false, current: false, failed: false }
                        ];
                    } else { // PENDING
                        steps = [
                            { label: 'Applied', done: true, current: false, failed: false },
                            { label: 'Awaiting Approval', done: false, current: true, failed: false },
                            { label: 'Gate Scan', done: false, current: false, failed: false },
                            { label: 'Exit Confirmed', done: false, current: false, failed: false }
                        ];
                    }

                    const timelineHtml = `
                        <div class="mt-4 p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-3">
                            <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-none">Workflow Progress</p>
                            <div class="flex flex-col gap-2.5">
                                ${steps.map(step => `
                                    <div class="flex items-center gap-2.5">
                                        <div class="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-[11px] font-black
                                            ${step.done ? 'bg-emerald-500 text-white' :
                                              step.failed ? 'bg-rose-500 text-white' :
                                              step.current ? 'bg-primary text-white ring-4 ring-primary/20' :
                                              'bg-slate-200 text-slate-400'}
                                        ">${step.done ? '✓' : step.failed ? '✕' : step.current ? '●' : '○'}</div>
                                        <p class="text-xs font-bold ${step.current ? 'text-primary' : step.done ? 'text-slate-700' : step.failed ? 'text-rose-600' : 'text-slate-400'}">${step.label}</p>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    `;

                    // --- QR SECTION (only for APPROVED, unconsumed) ---
                    const qrSectionHtml = isApproved ? `
                        <div id="ep-qr-section" class="p-4 bg-emerald-50 rounded-2xl border border-emerald-200 flex flex-col items-center gap-3 animate-reveal">
                            <div class="text-center mb-1">
                                <p class="text-xs font-black text-emerald-800 uppercase tracking-widest">Security Gate QR Code</p>
                                <p class="text-[10px] text-emerald-600 mt-0.5">Show this to Security at the gate</p>
                            </div>
                            <div id="ep-qr-wrapper" class="w-40 h-40 bg-white rounded-xl border border-emerald-200 flex items-center justify-center p-2 overflow-hidden shadow-inner">
                                <div id="ep-qr-loading" class="flex flex-col items-center gap-2">
                                    <div class="w-6 h-6 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin"></div>
                                    <p class="text-[9px] text-slate-400">Loading QR...</p>
                                </div>
                                <canvas id="exit-pass-qr-canvas" class="w-full h-full object-contain hidden"></canvas>
                            </div>
                            <div id="ep-qr-error" class="hidden text-center space-y-2 p-2">
                                <p class="text-[11px] text-rose-600 font-bold">QR unavailable. Please refresh or contact administration.</p>
                                <button id="ep-qr-retry" class="text-[10px] font-bold text-primary border border-primary/30 px-3 py-1 rounded-full active-scale">Retry</button>
                            </div>
                            <div class="text-center text-[10px] text-slate-400 leading-relaxed max-w-xs">
                                <span class="font-bold text-amber-700">⚠ Your exit has not been recorded yet.</span><br>Security must scan this QR to confirm your exit.
                            </div>
                        </div>
                    ` : '';

                    const cancelBtnHtml = isPending ? `
                        <button id="cancel-pass-btn" class="w-full mt-3 py-2.5 border border-rose-200 text-rose-600 bg-rose-50/50 hover:bg-rose-50 text-xs font-bold rounded-xl active-scale transition-colors flex items-center justify-center gap-1.5" data-id="${active.id}">
                            <span class="material-symbols-outlined text-[15px]">cancel</span> Cancel Request
                        </button>
                    ` : '';

                    const exitStr = active.exitTime ? formatDateTime(active.exitTime) : (active.requestedDate || active.requestDate || '—');

                    activeContainer.innerHTML = `
                        <div class="glass-panel p-5 space-y-4 border border-slate-200/50 relative overflow-hidden animate-reveal">
                            <div class="flex justify-between items-start">
                                <div>
                                    <span class="px-2.5 py-0.5 rounded-full border text-[10px] font-extrabold uppercase tracking-wide ${cfg.badge}">
                                        <span class="material-symbols-outlined align-middle" style="font-size:11px">${cfg.icon}</span>
                                        ${cfg.label}
                                    </span>
                                    <h3 class="font-extrabold text-slate-800 text-base mt-2">${active.destination}</h3>
                                    <p class="text-xs text-slate-500 mt-0.5">${active.reason}</p>
                                </div>
                                <div class="text-right">
                                    <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-none">Exit Time</p>
                                    <p class="font-black text-slate-800 text-xs mt-0.5 font-mono">${exitStr}</p>
                                </div>
                            </div>

                            ${msg ? `
                                <div class="text-xs border rounded-xl p-3 leading-relaxed ${msg.color}">
                                    <p class="font-black mb-0.5">${msg.headline}</p>
                                    <p>${msg.body}</p>
                                </div>
                            ` : ''}

                            ${qrSectionHtml}
                            ${timelineHtml}
                            ${cancelBtnHtml}
                        </div>
                    `;

                    // Load QR if approved
                    if (isApproved) {
                        const loadQr = async () => {
                            const canvas = document.getElementById('exit-pass-qr-canvas');
                            const loadingEl = document.getElementById('ep-qr-loading');
                            const errEl = document.getElementById('ep-qr-error');
                            const retryBtn = document.getElementById('ep-qr-retry');

                            console.log(`[ExitPass QR] Starting QR load: ${active.id}`);
                            console.log(`[ExitPass QR] Requesting QR token`);

                            try {
                                const tokRes = await api.get(`/exit-passes/${active.id}/qr-token`);
                                console.log(`[ExitPass QR] QR API status: 200 OK`);

                                // Robust token unwrapping supporting all possible response wrapper formats
                                const token = tokRes?.qrToken || tokRes?.token || tokRes?.data?.qrToken || tokRes?.data?.token;
                                console.log(`[ExitPass QR] Token received: ${token ? 'YES' : 'NO'}`);

                                const isQriousAvailable = typeof window.QRious !== 'undefined' || typeof QRious !== 'undefined';
                                console.log(`[ExitPass QR] QRious available: ${isQriousAvailable ? 'YES' : 'NO'}`);
                                console.log(`[ExitPass QR] Canvas found: ${canvas ? 'YES' : 'NO'}`);

                                if (token) {
                                    if (canvas && loadingEl) {
                                        const QRConstructor = window.QRious || (typeof QRious !== 'undefined' ? QRious : null);
                                        if (typeof QRConstructor === 'function') {
                                            new QRConstructor({ element: canvas, value: token, size: 150 });
                                            canvas.classList.remove('hidden');
                                            loadingEl.classList.add('hidden');
                                            if (errEl) errEl.classList.add('hidden');
                                            console.log(`[ExitPass QR] Render success`);
                                        } else {
                                            console.error('[ExitPass QR] Render failed: QRious constructor unavailable');
                                            if (loadingEl) loadingEl.classList.add('hidden');
                                            if (errEl) errEl.classList.remove('hidden');
                                        }
                                    }
                                } else {
                                    console.error('[ExitPass QR] Render failed: Token missing in API response');
                                    if (loadingEl) loadingEl.classList.add('hidden');
                                    if (errEl) errEl.classList.remove('hidden');
                                }
                            } catch (err) {
                                const errMsg = err.message || err.response?.data?.error || '';
                                console.log(`[ExitPass QR] Render failed: ${errMsg}`);

                                if (errMsg.includes('scanned by Security') || errMsg.includes('already been confirmed') || errMsg.includes('scanned')) {
                                    // QR consumed by Security — show consumed state
                                    const qrSection = document.getElementById('ep-qr-section');
                                    if (qrSection) {
                                        qrSection.innerHTML = `
                                            <div class="text-center py-3 space-y-1">
                                                <span class="material-symbols-outlined text-blue-500 text-3xl">verified_user</span>
                                                <p class="text-xs font-bold text-blue-800">QR Scanned by Security</p>
                                                <p class="text-[10px] text-slate-500">Your exit is being confirmed. Refresh for latest status.</p>
                                            </div>
                                        `;
                                    }
                                } else {
                                    if (loadingEl) loadingEl.classList.add('hidden');
                                    if (errEl) errEl.classList.remove('hidden');
                                    if (retryBtn) {
                                        retryBtn.onclick = () => {
                                            if (errEl) errEl.classList.add('hidden');
                                            if (loadingEl) loadingEl.classList.remove('hidden');
                                            loadQr();
                                        };
                                    }
                                }
                            }
                        };
                        setTimeout(loadQr, 50);
                    }
                }

                // History section
                if (history.length === 0) {
                    historyList.innerHTML = `<div class="text-center py-6 text-slate-400 text-xs font-bold uppercase animate-reveal">No history records</div>`;
                } else {
                    historyList.innerHTML = history.map(h => {
                        const dateFormatted = h.exitTime ? new Date(h.exitTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : (h.requestedDate || h.requestDate);
                        const hCfg = { PENDING: 'bg-amber-100 text-amber-700', APPROVED: 'bg-emerald-100 text-emerald-700', REJECTED: 'bg-rose-100 text-rose-700', CANCELLED: 'bg-slate-100 text-slate-500', EXPIRED: 'bg-slate-100 text-slate-500', EXITED: 'bg-blue-100 text-blue-700', UNDER_REVIEW: 'bg-orange-100 text-orange-700' };
                        return `
                        <div class="p-4 bg-white/60 border border-slate-200/40 rounded-2xl flex justify-between items-center animate-reveal">
                            <div>
                                <h4 class="text-sm font-extrabold text-slate-700 leading-tight">${h.destination}</h4>
                                <p class="text-[10px] text-slate-400 mt-0.5 font-mono">${dateFormatted}</p>
                                ${h.reason ? `<p class="text-[10px] text-slate-400 mt-0.5 truncate max-w-[180px]">${h.reason}</p>` : ''}
                            </div>
                            <span class="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border border-transparent ${hCfg[h.status] || 'bg-slate-100 text-slate-500'}">${h.status}</span>
                        </div>
                    `;
                    }).join('');
                }

                // Cancel button handler
                const cancelBtn = $('cancel-pass-btn');
                if (cancelBtn) {
                    cancelBtn.addEventListener('click', async (e) => {
                        haptic();
                        const passId = e.currentTarget.dataset.id;
                        if (!window.confirm('Are you sure you want to cancel this exit pass request?')) return;

                        loading.show('Cancelling pass request...');
                        try {
                            const res = await api.post(`/exit-passes/${passId}/cancel`);
                            if (res.data?.success || res.success) {
                                showToast('Exit pass cancelled successfully', 'success');
                                loadPasses();
                            } else {
                                showToast(res.data?.error || 'Cancellation failed', 'error');
                            }
                        } catch (err) {
                            showToast(err.response?.data?.error || 'Cancellation failed', 'error');
                        } finally {
                            loading.hide();
                        }
                    });
                }
            };

            const loadQuota = async () => {
                try {
                    const res = await api.get('/exit-passes/quota');
                    const quota = res.data;
                    const card = $('ep-quota-card');
                    const summary = $('quota-text-summary');
                    const badge = $('quota-badge');

                    if (card && quota) {
                        card.classList.remove('hidden');
                        summary.innerText = `${quota.remaining} of ${quota.maxQuota} remaining this semester`;
                        badge.innerText = `${quota.count} Used`;
                        if (quota.remaining <= 0) {
                            badge.className = 'px-2.5 py-1 text-[10px] font-extrabold uppercase rounded-full bg-red-100 text-red-600 border border-red-200';
                        } else {
                            badge.className = 'px-2.5 py-1 text-[10px] font-extrabold uppercase rounded-full bg-blue-100 text-blue-600 border border-blue-200';
                        }
                    }
                } catch (err) {
                    console.error('[ExitPass] Failed to load quota:', err);
                }
            };

            const loadPasses = async () => {
                loading.show('Loading Exit Passes...');
                try {
                    await loadQuota();
                    try { removeCachedData('/exit-passes/my'); } catch (_) {}
                    const res = await api.get('/exit-passes/my');
                    const passes = Array.isArray(res) ? res : (res.data || res.passes || []);
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
                const exitTime = $('ep-exit-time').value;
                const remarks = $('ep-remarks').value.trim();

                if (!destination || !reason || !exitTime) return;

                const exitDate = new Date(exitTime);
                if (exitDate <= new Date()) {
                    showToast('Exit time must be in the future', 'error', 3000);
                    return;
                }

                loading.show('Submitting exit pass request...');
                try {
                    let res;
                    if (selectedType === 'GROUP') {
                        const groupName = $('ep-group-name').value.trim();
                        const membersStr = $('ep-group-members').value;
                        const members = membersStr.split(',').map(m => m.trim()).filter(Boolean);

                        if (!groupName) {
                            showToast('Group Name is required', 'error');
                            loading.hide();
                            return;
                        }

                        res = await api.post('/exit-passes/group', {
                            groupName,
                            destination,
                            reason,
                            exitTime,
                            members
                        });
                    } else {
                        const emergencyContact = $('ep-emergency-contact').value.trim();
                        if (!emergencyContact) {
                            showToast('Emergency contact is required', 'error');
                            loading.hide();
                            return;
                        }

                        res = await api.post('/exit-passes', {
                            destination,
                            reason,
                            exitTime,
                            emergencyContact,
                            remarks
                        });
                    }

                    if (res.data?.success || res.success) {
                        showToast('Gate pass request submitted!', 'success', 2000);
                        closeSheet();
                        form.reset();
                        loadPasses();
                    } else {
                        showToast(res.data?.error || res.message || 'Submission failed', 'error', 3000);
                    }
                } catch (err) {
                    console.error('[ExitPass] submission error:', err);
                    showToast(err.response?.data?.error || 'Submission failed. Server error.', 'error', 3000);
                } finally {
                    loading.hide();
                }
            });

            loadPasses();

            // Real-time status refresh: reload when exit-pass notification arrives
            const epNotifHandler = (notification) => {
                const type = notification?.type || notification?.data?.type || notification?.data?.sitam_type || '';
                const title = notification?.title || notification?.data?.title || '';
                if (type.toLowerCase().includes('exit') || title.toLowerCase().includes('exit pass')) {
                    try { removeCachedData('/exit-passes/my'); } catch (_) {}
                    setTimeout(() => loadPasses(), 300);
                }
            };
            if (window._epNotifHandlers === undefined) window._epNotifHandlers = [];
            window._epNotifHandlers.push(epNotifHandler);

            // Refresh when app comes back to foreground on this screen
            const epVisibilityHandler = () => {
                if (!document.hidden && window.location && window.location.hash && window.location.hash.includes('exit-pass')) {
                    try { removeCachedData('/exit-passes/my'); } catch (_) {}
                    loadPasses();
                }
            };
            document.addEventListener('visibilitychange', epVisibilityHandler);
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
                    try { choices = JSON.parse(q.options) || []; } catch (_) { }
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
                    const stars = [1, 2, 3, 4, 5];
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
                            window.Capacitor.Plugins.Browser.open({ url: link }).catch(() => { });
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
                    if (list) {
                        list.innerHTML = `
                            <div class="p-6 bg-white border border-slate-200/50 rounded-2xl shadow-sm text-center space-y-4">
                                <div class="w-12 h-12 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto">
                                    <span class="material-symbols-outlined text-xl">cloud_off</span>
                                </div>
                                <div>
                                    <h4 class="text-sm font-bold text-slate-800">Connection Error</h4>
                                    <p class="text-xs text-slate-400 mt-1">Unable to retrieve announcements. Please try again.</p>
                                </div>
                                <button onclick="router.routes['/announcements']?.afterRender?.()" class="px-5 py-2 bg-primary text-white font-extrabold text-xs rounded-full active-scale transition-transform">
                                    Retry
                                </button>
                            </div>
                        `;
                    }
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
                const dock = document.getElementById('bottom-dock');
                if (dock) {
                    const dockRect = dock.getBoundingClientRect();
                    const dockClearance = window.innerHeight - dockRect.top;
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

            const openClaimSheet = (itemId) => {
                haptic();
                currentClaimItemId = itemId;
                const dock = document.getElementById('bottom-dock');
                if (dock) {
                    const dockRect = dock.getBoundingClientRect();
                    const dockClearance = window.innerHeight - dockRect.top;
                    const sheetBottom = Math.max(dockClearance + 16, 80);
                    document.documentElement.style.setProperty(
                        '--bottom-sheet-bottom', `${sheetBottom}px`
                    );
                }
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
                    try { imgs = JSON.parse(item.imageUrls) || []; } catch (_) { }
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
                    if (list) {
                        list.innerHTML = `
                            <div class="p-6 bg-white border border-slate-200/50 rounded-2xl shadow-sm text-center space-y-4">
                                <div class="w-12 h-12 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto">
                                    <span class="material-symbols-outlined text-xl">cloud_off</span>
                                </div>
                                <div>
                                    <h4 class="text-sm font-bold text-slate-800">Connection Error</h4>
                                    <p class="text-xs text-slate-400 mt-1">Unable to retrieve Lost & Found items. Please try again.</p>
                                </div>
                                <button onclick="router.routes['/lost-found']?.afterRender?.()" class="px-5 py-2 bg-primary text-white font-extrabold text-xs rounded-full active-scale transition-transform">
                                    Retry
                                </button>
                            </div>
                        `;
                    }
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
                api.get('/profile').then(p => { state.profile = p.data; }).catch(() => { });
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
                const dock = document.getElementById('bottom-dock');
                if (dock) {
                    const dockRect = dock.getBoundingClientRect();
                    const dockClearance = window.innerHeight - dockRect.top;
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
    },

    lms: {
        render: () => `
            <div class="min-h-screen pb-32 bg-[#F8FAFC]">
                <main class="pt-20 px-4 max-w-lg mx-auto space-y-6">
                    <section class="flex justify-between items-center mb-2">
                        <div>
                            <p class="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-1">Academic Portal</p>
                            <h2 class="text-3xl font-extrabold tracking-tight text-slate-800" style="font-family:'Plus Jakarta Sans',sans-serif">LMS Portal</h2>
                        </div>
                    </section>

                    <div class="flex gap-2 p-1 bg-slate-100 rounded-2xl">
                        <button class="flex-1 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all bg-white text-slate-800 shadow-sm" id="lms-tab-courses">My Courses</button>
                        <button class="flex-1 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all text-slate-500 hover:text-slate-700" id="lms-tab-certs">Certificates</button>
                    </div>

                    <!-- Courses Tab Content -->
                    <div id="lms-courses-content" class="space-y-4">
                        <div class="h-32 bg-slate-100 rounded-xl animate-pulse"></div>
                    </div>

                    <!-- Certificates Tab Content -->
                    <div id="lms-certs-content" class="space-y-4 hidden">
                        <div class="h-32 bg-slate-100 rounded-xl animate-pulse"></div>
                    </div>
                </main>
            </div>
        `,
        afterRender: async () => {
            toggleShell(true);
            setActiveNav('lms');

            const coursesContent = $('lms-courses-content');
            const certsContent = $('lms-certs-content');
            const tabCoursesBtn = $('lms-tab-courses');
            const tabCertsBtn = $('lms-tab-certs');

            if (!coursesContent || !certsContent || !tabCoursesBtn || !tabCertsBtn) return;

            // Switch tabs
            tabCoursesBtn.addEventListener('click', () => {
                haptic();
                tabCoursesBtn.className = "flex-1 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all bg-white text-slate-800 shadow-sm";
                tabCertsBtn.className = "flex-1 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all text-slate-500 hover:text-slate-700";
                coursesContent.classList.remove('hidden');
                certsContent.classList.add('hidden');
            });

            tabCertsBtn.addEventListener('click', () => {
                haptic();
                tabCertsBtn.className = "flex-1 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all bg-white text-slate-800 shadow-sm";
                tabCoursesBtn.className = "flex-1 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all text-slate-500 hover:text-slate-700";
                certsContent.classList.remove('hidden');
                coursesContent.classList.add('hidden');
            });

            loading.show('Loading LMS Data...');
            try {
                let data = {};
                try {
                    const res = await api.get('/lms');
                    data = res.data || {};
                } catch (e) {
                    console.warn('[LMS] Backend fetch failed, using fallback empty arrays:', e);
                    data = { courses: [], certificates: [] };
                }
                const courses = data.courses || [];
                const certificates = data.certificates || [];

                // Render Courses
                if (courses.length === 0) {
                    coursesContent.innerHTML = `<div class="text-center py-12 text-slate-400 font-bold uppercase text-xs">No enrolled courses.</div>`;
                } else {
                    coursesContent.innerHTML = courses.map(c => {
                        const progress = c.progress?.progressPct || 0;
                        const assignments = c.assignments || [];
                        const quizzes = c.quizzes || [];

                        const initialLetters = c.name ? c.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() : 'CO';
                        const gradients = [
                            'from-indigo-500 to-blue-500',
                            'from-emerald-500 to-teal-500',
                            'from-rose-500 to-orange-500',
                            'from-amber-500 to-yellow-500',
                            'from-purple-500 to-pink-500',
                            'from-blue-500 to-cyan-500'
                        ];
                        const grad = gradients[c.code.charCodeAt(c.code.length - 1) % gradients.length] || gradients[0];
                        const thumbnailHtml = `
                            <div class="w-10 h-10 rounded-xl bg-gradient-to-br ${grad} flex items-center justify-center text-white font-extrabold text-sm border border-white/20 shadow-sm flex-shrink-0">
                                ${initialLetters}
                            </div>
                        `;

                        return `
                            <div class="glass-card p-5 border border-white/40 rounded-3xl bg-white shadow-sm hover:shadow-md transition-all duration-300 space-y-4">
                                <div class="flex justify-between items-start">
                                    <div class="flex gap-3 min-w-0 flex-1">
                                        ${thumbnailHtml}
                                        <div class="min-w-0 flex-1">
                                            <p class="text-[9px] font-bold text-slate-400 uppercase tracking-widest leading-none">${c.code}</p>
                                            <h3 class="font-extrabold text-slate-800 text-sm mt-1 truncate" title="${c.name}">${c.name}</h3>
                                            <div class="flex items-center gap-2 mt-1">
                                                <span class="text-[9px] text-slate-400 font-bold">👤 ${c.faculty?.name || 'Faculty'}</span>
                                                <span class="w-1 h-1 bg-slate-300 rounded-full"></span>
                                                <span class="text-[9px] text-slate-400 font-bold">${c.credits || 0} Credits</span>
                                            </div>
                                        </div>
                                    </div>
                                    <span class="text-xs font-extrabold text-primary bg-blue-50 px-2 py-0.5 rounded border border-blue-100 ml-2 flex-shrink-0">${progress}%</span>
                                </div>

                                <!-- Progress Bar -->
                                <div class="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden border border-white">
                                    <div class="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full transition-all duration-500" style="width:${progress}%"></div>
                                </div>

                                <!-- Accordions -->
                                <div class="space-y-2 pt-2">
                                    <!-- Assignments Accordion -->
                                    <div class="border border-slate-100 rounded-xl overflow-hidden bg-slate-50/50">
                                        <button class="w-full px-4 py-3 flex items-center justify-between text-xs font-bold text-slate-600 uppercase tracking-wider hover:bg-slate-50 active-scale transition-all" onclick="const p = this.nextElementSibling; p.classList.toggle('hidden'); const icon = this.querySelector('.arrow-icon'); icon.textContent = p.classList.contains('hidden') ? 'keyboard_arrow_down' : 'keyboard_arrow_up';">
                                            <span>Assignments (${assignments.length})</span>
                                            <span class="material-symbols-outlined text-sm font-bold arrow-icon">keyboard_arrow_down</span>
                                        </button>
                                        <div class="hidden border-t border-slate-100 p-3 space-y-2">
                                            ${assignments.length === 0 ? `<p class="text-[9px] text-slate-400 text-center font-bold">No assignments available</p>` : assignments.map(a => {
                            const sub = a.submission;
                            const score = sub ? (sub.points !== null ? `${sub.points}/${a.maxPoints}` : 'Submitted') : 'Pending';
                            const statusColor = sub ? 'text-emerald-600 bg-emerald-50 border-emerald-100' : 'text-amber-600 bg-amber-50 border-amber-100';
                            return `
                                                    <div class="flex justify-between items-center p-2.5 rounded-lg bg-white border border-slate-100 text-[10px]">
                                                        <div class="min-w-0 flex-1 mr-3">
                                                            <p class="font-extrabold text-slate-700 truncate">${a.title}</p>
                                                            <p class="text-[8px] text-slate-400 font-bold mt-0.5">Due: ${new Date(a.dueDate).toLocaleDateString()}</p>
                                                        </div>
                                                        <span class="px-2 py-0.5 rounded border text-[8px] font-black uppercase tracking-wide flex-shrink-0 ${statusColor}">${score}</span>
                                                    </div>`;
                        }).join('')}
                                        </div>
                                    </div>

                                    <!-- Quizzes Accordion -->
                                    <div class="border border-slate-100 rounded-xl overflow-hidden bg-slate-50/50">
                                        <button class="w-full px-4 py-3 flex items-center justify-between text-xs font-bold text-slate-600 uppercase tracking-wider hover:bg-slate-50 active-scale transition-all" onclick="const p = this.nextElementSibling; p.classList.toggle('hidden'); const icon = this.querySelector('.arrow-icon'); icon.textContent = p.classList.contains('hidden') ? 'keyboard_arrow_down' : 'keyboard_arrow_up';">
                                            <span>Quizzes (${quizzes.length})</span>
                                            <span class="material-symbols-outlined text-sm font-bold arrow-icon">keyboard_arrow_down</span>
                                        </button>
                                        <div class="hidden border-t border-slate-100 p-3 space-y-2">
                                            ${quizzes.length === 0 ? `<p class="text-[9px] text-slate-400 text-center font-bold">No quizzes available</p>` : quizzes.map(q => {
                            const res = q.result;
                            const score = res ? `${res.score}/${q.maxPoints}` : 'Pending';
                            const statusColor = res ? 'text-emerald-600 bg-emerald-50 border-emerald-100' : 'text-amber-600 bg-amber-50 border-amber-100';
                            return `
                                                    <div class="flex justify-between items-center p-2.5 rounded-lg bg-white border border-slate-100 text-[10px]">
                                                        <div class="min-w-0 flex-1 mr-3">
                                                            <p class="font-extrabold text-slate-700 truncate">${q.title}</p>
                                                        </div>
                                                        <span class="px-2 py-0.5 rounded border text-[8px] font-black uppercase tracking-wide flex-shrink-0 ${statusColor}">${score}</span>
                                                    </div>`;
                        }).join('')}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        `;
                    }).join('');
                }

                // Render Certificates
                if (certificates.length === 0) {
                    certsContent.innerHTML = `
                        <div class="text-center py-12 text-slate-400 font-bold uppercase text-xs">
                            <span class="material-symbols-outlined text-4xl mb-2 text-slate-300">workspace_premium</span>
                            <p>No certificates earned yet.</p>
                        </div>`;
                } else {
                    certsContent.innerHTML = certificates.map(cert => {
                        const dateStr = new Date(cert.issuedAt).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
                        return `
                            <div class="glass-card p-5 border border-white/40 rounded-3xl bg-white shadow-sm hover:shadow-md transition-all duration-300 relative overflow-hidden flex items-start gap-4">
                                <div class="w-12 h-12 bg-amber-50 border border-amber-200 text-amber-600 rounded-xl flex items-center justify-center flex-shrink-0">
                                    <span class="material-symbols-outlined text-2xl font-light">workspace_premium</span>
                                </div>
                                <div class="flex-1 min-w-0">
                                    <h4 class="font-extrabold text-slate-800 text-sm leading-tight truncate" title="${cert.courseName}">${cert.courseName}</h4>
                                    <p class="text-[9px] text-slate-400 font-bold mt-1 uppercase tracking-wide">${cert.courseCode}</p>
                                    <p class="text-[9px] text-slate-500 font-bold mt-1">Issued: ${dateStr}</p>
                                    <div class="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-[9px] text-slate-400">
                                        <span>Cert ID: <span class="font-mono font-extrabold text-slate-700 uppercase">${cert.certNumber}</span></span>
                                        <span class="text-emerald-600 font-bold flex items-center gap-0.5"><span class="material-symbols-outlined text-[10px]" style="font-size:10px">verified</span> Verified</span>
                                    </div>
                                </div>
                                <div class="absolute -right-6 -top-6 w-16 h-16 bg-amber-500/5 rounded-full blur-xl pointer-events-none"></div>
                            </div>
                        `;
                    }).join('');
                }
            } catch (err) {
                console.error('[LMS] load failed:', err);
                coursesContent.innerHTML = `<div class="text-center py-12 text-rose-500 font-bold uppercase text-xs">Failed to load LMS data.</div>`;
            } finally {
                loading.hide();
            }
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
    } catch (e) {
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
const KEEP_ALIVE_MAX = 5;  // LRU limit — evict oldest if exceeded

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
            '/library': pages.library,
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
            '/help': pages.help,
            '/lms': pages.lms
        };
    },

    handle() {
        let hash = (window.location.hash || '').replace('#', '') || '/login';
        if (hash.includes('sitam://')) hash = hash.replace('sitam://', '');
        if (!hash.startsWith('/')) hash = '/' + hash;
        console.log(`[NAV] router.handle() started for hash: "${hash}"`);

        if (state.maintenance?.active && hash !== '/maintenance') {
            console.log('[NAV] redirecting to /maintenance');
            return this.navigate('/maintenance');
        }
        if (!state.token && hash !== '/login' && hash !== '/maintenance') {
            console.log('[NAV] redirecting to /login');
            return this.navigate('/login');
        }
        if (state.token && hash === '/login') {
            console.log('[NAV] redirecting to /dashboard');
            return this.navigate('/dashboard');
        }

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
        const page = pages[route] || pages.dashboard;
        console.log(`[NAV] Resolved route: "${route}", page exists: ${!!page}`);
        closeDrawer();
        setActiveNav(route);

        // Native StatusBar
        if (window.Capacitor?.Plugins?.StatusBar) {
            const { StatusBar } = window.Capacitor.Plugins;
            StatusBar.setStyle({ style: 'LIGHT' }).catch(() => { });
            StatusBar.setBackgroundColor({ color: '#faf9fc' }).catch(() => { });
        }

        const isKeepAlive = KEEP_ALIVE_PAGES.has(route);
        console.log(`[NAV] Page isKeepAlive: ${isKeepAlive}`);

        if (isKeepAlive) {
            // ── keepAlive path: swap DOM nodes, no innerHTML destroy ──────────
            // Hide ALL other nodes — including the non-cached login/profile node
            // This is critical: the login page must NEVER remain visible after navigation to dashboard
            _pageCache.forEach(entry => { if (entry.node) entry.node.style.display = 'none'; });
            const _nonCached = this.app.querySelector('.sitam-page-non-cached');
            if (_nonCached) _nonCached.style.display = 'none';

            if (_pageCache.has(route)) {
                // ── CACHE HIT: instant restore <5ms ──────────────────────────
                console.log(`[NAV] KeepAlive cache HIT for: ${route}`);
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
                console.log(`[NAV] KeepAlive cache MISS for: ${route}. Creating element...`);
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

                if (page.afterRender) {
                    console.log(`[NAV] Calling page.afterRender() for ${route}`);
                    page.afterRender();
                }
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
                console.log(`[NAV] Evicting existing non-cached page node`);
                existingNonCached.remove();
            }
            console.log(`[NAV] Rendering non-cached page: ${route}`);
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

            if (page.afterRender) {
                console.log(`[NAV] Calling page.afterRender() for non-cached page: ${route}`);
                page.afterRender();
            }
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
        } catch (e) { console.error('Sync failed:', e); }
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
                const page = pages[route];
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
                if (url.includes('sitam://')) route = url.split('sitam://')[1];
                else if (url.includes('#sitam://')) route = url.split('#sitam://')[1];
                else if (url.includes('/#')) route = url.split('/#')[1];
                if (route) {
                    if (!route.startsWith('/')) route = '/' + route;
                    router.navigate(route);
                }
            });

            // ── UNIFIED backButton → router.goBack() ──────────────────────────
            App.addListener('backButton', () => router.goBack());
        }
    }

    // ── SITAM Splash Controller & Session Bootstrapping ────────────────────
    const progressBar = $('splash-progress-bar');
    if (progressBar) {
        setTimeout(() => { progressBar.style.width = '40%'; }, 50);
    }

    // Guaranteed splash dismiss — called from finally, always runs
    const _splashDismiss = () => {
        try {
            // Dismiss native Capacitor SplashScreen if present
            if (window.Capacitor?.Plugins?.SplashScreen) {
                console.log('[BOOT] Hiding native Capacitor SplashScreen...');
                window.Capacitor.Plugins.SplashScreen.hide().catch(err => {
                    console.warn('[BOOT] Native SplashScreen hide failed:', err);
                });
            }

            const splash = $('sitam-splash');
            if (splash) {
                splash.style.opacity = '0';
                splash.style.pointerEvents = 'none';
                splash.classList.remove('opacity-100');
                setTimeout(() => {
                    if (splash.parentNode) {
                        splash.parentNode.removeChild(splash);
                    } else {
                        splash.style.display = 'none';
                    }
                }, 750);
            }
            console.log('[BOOT] _splashDismiss called — splash hidden');
        } catch (e) {
            console.error('[BOOT] _splashDismiss error:', e);
        }
    };

    async function initializeApplication() {
        const t0 = Date.now();
        const step = (n) => console.log(`[BOOT] Step ${n} (+${Date.now() - t0}ms)`);

        console.log('[BOOT] ============ BOOT START ============');
        console.log(`[BOOT] Platform: ${window.Capacitor ? 'Capacitor' : 'Web'}`);
        console.log(`[BOOT] API_BASE: ${API_BASE}`);
        console.log(`[BOOT] navigator.onLine: ${navigator.onLine}`);

        try {
            // ── Step 1: Secure storage bootstrap ────────────────────────────
            step('1 — secureStorage.bootstrap START');
            try {
                await secureStorage.bootstrap();
            } catch (e) {
                console.error('[BOOT] Step 1 EXCEPTION:', e);
            }
            step('1 — secureStorage.bootstrap DONE');

            // ── Step 2: Read token from decrypted store ──────────────────────
            step('2 — reading token');
            state.token = secureStorage.getItem('token') || null;
            console.log(`[BOOT] Step 2 — token present: ${!!state.token}`);

            // ── Step 3: Token expiry check ───────────────────────────────────
            if (state.token) {
                step('3 — token expiry check');
                const expiryRaw = secureStorage.getItem('tokenExpiry');
                const expiry = expiryRaw ? parseInt(expiryRaw, 10) : 0;
                if (expiry > 0 && Date.now() > expiry) {
                    console.warn('[BOOT] Step 3 — token EXPIRED, clearing');
                    state.token = null;
                    try { await secureStorage.removeItem('token'); } catch (_) { }
                    try { await secureStorage.removeItem('tokenExpiry'); } catch (_) { }
                } else if (expiry === 0) {
                    try { await secureStorage.setItem('tokenExpiry', String(Date.now() + 7 * 24 * 60 * 60 * 1000)); } catch (_) { }
                }
            } else {
                step('3 — no token, skip expiry check');
            }

            // ── Step 4: Progress bar animation ──────────────────────────────
            step('4 — progress bar 100%');
            if (progressBar) progressBar.style.width = '100%';
            await new Promise(r => setTimeout(r, 400));

        } catch (outerErr) {
            console.error('[BOOT] OUTER EXCEPTION in boot sequence:', outerErr);
        } finally {
            // ── GUARANTEED: Always dismiss splash and navigate ───────────────
            // This runs whether or not any step above threw, timed out, or succeeded.
            step('FINAL — dismissing splash and navigating');
            _splashDismiss();
            try { router.handle(); } catch (e) { console.error('[BOOT] router.handle error:', e); }
            try { checkSyncStatus(); } catch (e) { }
            console.log(`[BOOT] ============ BOOT COMPLETE in ${Date.now() - t0}ms ============`);

            // Detailed DOM Inspection Log
            console.log('[DOM] sitam-splash exists:', !!document.getElementById('sitam-splash'));
            console.log('[DOM] sitam-splash opacity:', document.getElementById('sitam-splash')?.style?.opacity);
            console.log('[DOM] sitam-splash display:', document.getElementById('sitam-splash')?.style?.display);
            console.log('[DOM] app-shell display:', document.getElementById('app-shell')?.style?.display);
            console.log('[DOM] app content length:', document.getElementById('app')?.innerHTML?.length);
            console.log('[DOM] login-form exists:', !!document.getElementById('login-form'));
            console.log('[DOM] body child count:', document.body.children.length);

            setTimeout(() => {
                const children = Array.from(document.body.children);
                console.log(`[DOM-LATE] Body children total: ${children.length}`);
                children.forEach((c, idx) => {
                    console.log(`[DOM-LATE] child[${idx}]: tagName=${c.tagName}, id=${c.id || '(no-id)'}, class=${c.className?.substring(0, 50) || '(no-class)'}`);
                });
                const appNode = document.getElementById('app');
                if (appNode) {
                    const rect = appNode.getBoundingClientRect();
                    const style = window.getComputedStyle(appNode);
                    console.log(`[DOM-LATE] app dimensions: width=${rect.width}, height=${rect.height}, top=${rect.top}, left=${rect.left}`);
                    console.log(`[DOM-LATE] app styles: display=${style.display}, opacity=${style.opacity}, visibility=${style.visibility}, zIndex=${style.zIndex}`);
                } else {
                    console.log('[DOM-LATE] app node not found!');
                }
                const bodyStyle = window.getComputedStyle(document.body);
                console.log(`[DOM-LATE] body styles: display=${bodyStyle.display}, opacity=${bodyStyle.opacity}, visibility=${bodyStyle.visibility}`);
                console.log('[DOM-LATE] app content length:', appNode?.innerHTML?.length);
                console.log('[DOM-LATE] login-form exists:', !!document.getElementById('login-form'));
            }, 3000);

            // ── Non-blocking: fire liveness ping AFTER login screen is shown ─
            setTimeout(() => {
                const ctrl = new AbortController();
                const tid = setTimeout(() => ctrl.abort(), 5000);
                fetch(API_BASE + '/health/liveness', { signal: ctrl.signal })
                    .then(r => r.text())
                    .then(t => { clearTimeout(tid); console.log('[BOOT] Liveness:', t); })
                    .catch(e => console.log('[BOOT] Liveness check skipped:', e.message));
            }, 0);

            // ── Non-blocking: warm cache & register FCM push for returning session ──
            if (state.token) {
                setTimeout(() => {
                    prefetchAll().catch(e => console.error('[BOOT] prefetchAll error:', e));
                    registerPush().catch(e => console.error('[BOOT] registerPush error:', e));
                }, 500);
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
