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
    if (event.data) {
        console.log('Node-RED dashboard web-push service worker received push event', event.data.text())
    }
    else {
        console.log('Node-RED dashboard web-push service worker received push event (but no data inside)')
    }

    let payload
    try {
        payload = event.data.json()
    }
    catch(exc) {
        console.error('The push message event.data property does not contain valid json')
        return
    }

    // TODO wat doen met de sound:"default" uit de notification ???
    let options = {
        // Mandatory string parameter, representing an extra content to display within the notification.
        body: payload.notification.body
    }

    // The payload always contains a 'notification' field, but not always a 'data' field.
    // Indeed the 'data' field is only available when 'payload' records have been added in the config screen.
    if (payload.data) {
        if (payload.data.badge) {
            // URL of an image to represent the notification as a small icon, when there is not enough space to display
            // the notification itself.  For example in the Android Notification Bar.
            options.badge = payload.data.badge
        }

        if (payload.data.data) {
            // Arbitrary custom data that you want to be associated with the notification. This can be of any data type.
            // This data is not directly displayed to the user but can be accessed by your service worker or client-side JavaScript code.
            // This is used for sending additional information related to the notification (e.g. ID, URL, or any other context-specific data).
            options.data = payload.data.data
        }

        if (payload.data.dir) {
            // The direction of the notification; it can be auto,  ltr or rtl
            options.dir = payload.data.dir
        }

        if (payload.data.icon) {
            // A USVString containing the URL of an image to be used as an icon by the notification
            options.icon = payload.data.icon
        }

        if (payload.data.image) {
            // A USVString containing the URL of a larger image to be displayed in the notification (for preview)
            options.image = payload.data.image
        }

        if (payload.data.lang) {
            // The lang used within the notification. This string must be a valid BCP 47 language tag.
            options.lang = payload.data.lang
        }

        if (payload.data.renotify) {
            // The lang used within the notification. This string must be a valid BCP 47 language tag.
            options.renotify = payload.data.renotify
        }

        if (payload.data.requireInteraction) {
            // Indicates that on devices with sufficiently large screens, a notification should remain active until the user clicks or dismisses it.
            options.requireInteraction = payload.data.requireInteraction
        }

        if (payload.data.silent) {
            // When set indicates that no sounds or vibrations should be made.
            options.silent = payload.data.silent
        }

        if (payload.data.tag) {
            // An ID for a given notification that allows you to find, replace, or remove the notification using a script if necessary.
            options.tag = payload.data.tag
        }

        if (payload.data.timestamp) {
            // A DOMTimeStamp representing the time when the notification was created.
            options.timestamp = payload.data.timestamp
        }

        if (payload.data.vibrate) {
            // A vibration pattern to run with the display of the notification. A vibration pattern can be an array with as few as one member.
            // The values are times in milliseconds where the even indices (0, 2, 4, etc.) indicate how long to vibrate and the odd indices indicate how long to pause.
            // For example, [300, 100, 400] would vibrate 300ms, pause 100ms, then vibrate 400ms.
            // TODO: I tried this vibration pattern [500,110,500,110,450,110,200,110,170,40,450,110,200,110,170,40,500] which should be the Star Wars theme
            // (created with https://tests.peter.sh/notification-generator/).  But it doesn't work ...
            options.vibrate = payload.data.vibrate
        }

        if (payload.data.actions) {
            if (payload.data.actions.length > Notification.maxActions) {
                console.log("The " + payload.data.actions.length + " requested actions exceeds the " + Notification.maxActions + " actions supported by this system")
            }

            // When custom actions are specified, users can interact with these actions (e.g., buttons).
            options.actions = payload.data.actions
        }
    }

    // Show a notification to the user.
    // It is NOT allowed to do other kind of stuff here, e.g. opening directly a browser session for the Node-RED dashboard.
    // Indeed the browser expects a user action (i.e. a click on the notification), otherwise nothing is allowed to happen ...
    // So that kind of stuff will be added to the 'notificationclick' event handler.
    const promiseChain = self.registration.showNotification(payload.notification.title, options)

    //
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
        url = event.notification.data
debugger
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
