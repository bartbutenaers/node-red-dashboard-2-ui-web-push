// *****************************************************************************************************
// This code will be executed in a Service worker (or Worker thread), which is an independent javascript
// thread running in the browser background.  That thread waits for push messages/events and opens the
// Node-RED dashboard in a new window.  To accomplish that, the thread can run even when the page has
// been closed.  If the browser is offline, the notification is queued until the the browser comes online...
// *****************************************************************************************************

console.log("Node-RED dashboard service worker has been registered")

// Listen for an installation request from the browser
self.addEventListener('install', async function(event) {
    console.log("Node-RED dashboard web-push service worker has been installed")

    // Make sure this service worker immediately becomes "active".
    await self.skipWaiting()
});

// Listen for an activation request from the browser.
// This will be called only once, when the service worker is activated.
// The primary use of onactivate is for cleanup of resources used in previous versions of this Service worker script.
self.addEventListener('activate', async function() {
    console.log("Node-RED dashboard web-push service worker has been activated")
})

// Listen for push event, being send by the Node-RED flow
self.addEventListener('push', function(event) {
    let payload
    try {
        payload = event.data.json()
    }
    catch(exc) {
        console.error('The push message event.data property does not contain valid json')
        return
    }

    // Show a notification to the user.
    // It is NOT allowed to do other kind of stuff here, e.g. opening directly a browser session for the Node-RED dashboard.
    // Indeed the browser expects a user action (i.e. a click on the notification), otherwise nothing is allowed to happen ...
    // So that kind of stuff will be added to the 'notificationclick' event handler.
    const promiseChain = self.registration.showNotification(payload.title, payload)

    event.waitUntil(promiseChain)
})

// Listen for click events from the notification (i.e. when the user has clicked on the notification)
// See https://stackoverflow.com/questions/39418545/chrome-push-notification-how-to-open-url-adress-after-click
self.addEventListener('notificationclick', async function(event) {
    let url = ""

    console.log('Node-RED dashboard web-push service worker called via notification click handler')

    // When the event.action is filled, then the user has clicked on an action button (which is displayed inside the notification).
    // Otherwise the user has clicked on the notification itself ...
    if (event.action) {
        // The action field contains the (full) url path that needs to be accessed (when this action button has been clicked).
        url = event.action

        // Send the request to the backend, by calling the http-in node
        var response = await fetch(url, {
            method: 'get',
        })
    }
    else {
        // By clicking on the notification, we will open the dashboard:
        // - When not open yet, then open it in a new window/tabsheet (depending on browser settings)
        // - When open yet (but possible not visible), then focus on the existing window/tabsheet.
        // This way we will avoid opening new dashboard window/tabsheets over and over again ...

        // Get the (full) url from the notification custom data section
        url = event.notification.data.url

        event.waitUntil(
            // Get all current “window” type clients (i.e. tabs and windows but not web workers).
            // And only clients that are not controlled by this service worker (via includeUncontrolled)
            clients.matchAll({type: 'window', includeUncontrolled: true}).then( windowClients => {
                // Check if there is already a window/tab open with the target URL
                for (var i = 0; i < windowClients.length; i++) {
                    var client = windowClients[i]

                    // Remark: the dashboard url can already be open, but with some extra data in the url path...
                    if (client.url.startsWith(url) && 'focus' in client) {
                        // If so, just focus it.
                        return client.focus()
                    }
                }
                // If not, then open the target URL in a new window/tab.
                if (clients.openWindow) {
                    return clients.openWindow(url)
                }
            })
        )
    }

    event.notification.close() // Android needs explicit close.
})

self.addEventListener('pushsubscriptionchange', async function() {
    // ========================== DUE TO LACK OF SUPPORT, THIS EVENT WON'T BE USED HERE =============================
    // If the user manually decides to remove the notifications
    // https://stackoverflow.com/questions/48729538/chrome-notifications-unsubscribe-event
    // But this doesn't work on Chrome:
    // https://medium.com/@madridserginho/how-to-handle-webpush-api-pushsubscriptionchange-event-in-modern-browsers-6e47840d756f
    // TODO But we can workaround that: when we get status code 410, we should remove the subscription from backend (becaused expired or onsubscribed)
    // https://developers.google.com/web/fundamentals/push-notifications/common-issues-and-reporting-bugs
    // But seems Google is implementing it: https://bugs.chromium.org/p/chromium/issues/detail?id=646721
    // And some other possibilities : https://medium.com/@madridserginho/how-to-handle-webpush-api-pushsubscriptionchange-event-in-modern-browsers-6e47840d756f
})
