// SITAM Smart ERP — Background Firebase Messaging Service Worker
// Standard service worker setup for PWA and Capacitor packaging fallback PWA targets

importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-messaging-compat.js');

// Standard credentials configuration block (production placeholders automatically mapped inside Android project builds)
firebase.initializeApp({
    apiKey: "AIzaSyDummyKeyForSandboxTestingReadyPlaceholder",
    authDomain: "sitam-smart-erp.firebaseapp.com",
    projectId: "sitam-smart-erp",
    storageBucket: "sitam-smart-erp.appspot.com",
    messagingSenderId: "123456789012",
    appId: "1:123456789012:web:abcdef123456"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
    console.log('[firebase-messaging-sw.js] Received background message: ', payload);
    
    const notificationTitle = payload.notification.title || 'SITAM Smart ERP';
    const notificationOptions = {
        body: payload.notification.body || 'New campus circular published.',
        icon: '/sitam_logo_notification.png', // adaptive icon reference
        badge: '/sitam_logo_notification.png',
        tag: payload.data?.sitam_route || '/dashboard',
        data: payload.data
    };

    self.registration.showNotification(notificationTitle, notificationOptions);
});

// Deep Link Route activation on click
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    
    const targetRoute = event.notification.data?.sitam_route || '/dashboard';
    
    // Resolve standard browser context or bridge
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
            for (let client of windowClients) {
                if (client.url && 'focus' in client) {
                    client.postMessage({ type: 'DEEP_LINK_ROUTE', route: targetRoute });
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow('/#' + targetRoute);
            }
        })
    );
});
