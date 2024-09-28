module.exports = function (RED) {
    const fs = require('fs')
    const path = require('path')
    const webpush = require('web-push')

    function UIWebPushNode (config) {
        RED.nodes.createNode(this, config)
        this.config = config
        const node = this

        // which group are we rendering this widget
        const group = RED.nodes.getNode(config.group)

        const base = group.getBase()

        // Make sure at least at startup an empty list appears in the context sidebar (for visibility)
        if (!node.context().get('subscriptions', node.config.contextStore)) {
            node.context().set('subscriptions', [], node.config.contextStore)
        }

        let subscriptions = node.context().get('subscriptions', node.config.contextStore) || []
        node.status({fill:'blue', shape:"dot", text: subscriptions.length + ' subscriptions'})

        function getProperty(property) {
            // Get the property value specified on the config screen, which can have been overwritten
            // dynamically via input msg.ui_update.<property> (and stored in the state store)
            return base.stores.state.getProperty(node.id, property) ?? node.config[property];
        }

        // server-side event handlers
        const evts = {
            onAction: true,
            // Custom onInput function.  No messages need to be stored on the datastore, because all communication
            // is from the frontend to this backend.  No need to let the dashboard replay messages.
            onInput: function (msg, send, done) {
                // =============================================================
                // STORE DYNAMIC PROPERTIES (FROM INPUT MSG INTO STATE STORE)
                // =============================================================

               const updates = msg.ui_update
                // Store all the dynamic properties, to make sure their values are still available at browser refresh
                // Note that it is NOT possible to dynamically override the VAPID settings (public, private key, subject).
                // Because when dynamically overwritting those, all existing subscriptions would become useless. 
                if (updates) {
                    if (typeof updates.autoLoad !== 'undefined') {
                        if (typeof updates.autoLoad === 'boolean') {
                            base.stores.state.set(group.getBase(), node, msg, 'autoLoad', updates.autoLoad)
                        } else {
                            node.warn('msg.ui_update.autoLoad should be a boolean value')
                        }
                    }
                    if (typeof updates.showSwitchMessage !== 'undefined') {
                        if (typeof updates.showSwitchMessage === 'boolean') {
                            base.stores.state.set(group.getBase(), node, msg, 'showSwitchMessage', updates.showSwitchMessage)
                        } else {
                            node.warn('msg.ui_update.showSwitchMessage should be a boolean value')
                        }
                    }
                    if (typeof updates.switchLabel !== 'undefined') {
                        if (typeof updates.switchLabel === 'string') {
                            base.stores.state.set(group.getBase(), node, msg, 'switchLabel', updates.switchLabel)
                        } else {
                            node.warn('msg.ui_update.switchLabel should be a text value')
                        }
                    }
                    if (typeof updates.title !== 'undefined') {
                        if (typeof updates.title === 'string') {
                            base.stores.state.set(group.getBase(), node, msg, 'title', updates.title)
                        } else {
                            node.warn('msg.ui_update.title should be a text value')
                        }
                    }
                    if (typeof updates.badge !== 'undefined') {
                        if (typeof updates.badge === 'string') {
                            base.stores.state.set(group.getBase(), node, msg, 'badge', updates.badge)
                        } else {
                            node.warn('msg.ui_update.badge should be a text value (i.e. an url)')
                        }
                    }
                    if (typeof updates.icon !== 'undefined') {
                        if (typeof updates.icon === 'string') {
                            base.stores.state.set(group.getBase(), node, msg, 'icon', updates.icon)
                        } else {
                            node.warn('msg.ui_update.icon should be a text value (i.e. an url)')
                        }
                    }
                    if (typeof updates.image !== 'undefined') {
                        if (typeof updates.image === 'string') {
                            base.stores.state.set(group.getBase(), node, msg, 'image', updates.image)
                        } else {
                            node.warn('msg.ui_update.image should be a text value (i.e. an url)')
                        }
                    }
                    if (typeof updates.volume !== 'undefined') {
                        if (['silent', 'default'].includes(updates.volume)) {
                            base.stores.state.set(group.getBase(), node, msg, 'volume', updates.volume)
                        } else {
                            node.warn('msg.ui_update.volume should be TODO')
                        }
                    }
                    if (typeof updates.url !== 'undefined') {
                        if (typeof updates.url === 'string') {
                            base.stores.state.set(group.getBase(), node, msg, 'url', updates.url)
                        } else {
                            node.warn('msg.ui_update.url should be a text value (i.e. an url)')
                        }
                    }
                    if (typeof updates.interaction !== 'undefined') {
                        if (['required', 'optional'].includes(updates.interaction)) {
                            base.stores.state.set(group.getBase(), node, msg, 'interaction', updates.interaction)
                        } else {
                            node.warn('msg.ui_update.interaction should be a boolean value')
                        }
                    }
                    if (typeof updates.timeout !== 'undefined') {
                        if (Number.isInteger(updates.timeout)) {
                            base.stores.state.set(group.getBase(), node, msg, 'timeout', updates.timeout)
                        } else {
                            node.warn('msg.ui_update.timeout should be an integer value')
                        }
                    }
                    if (typeof updates.ttl !== 'undefined') {
                        if (Number.isInteger(updates.timeout)) {
                            base.stores.state.set(group.getBase(), node, msg, 'ttl', updates.ttl)
                        } else {
                            node.warn('msg.ui_update.ttl should be an integer value')
                        }
                    }
                    if (typeof updates.urgency !== 'undefined') {
                        if (['very-low', 'low', 'normal', 'high'].includes(updates.volume)) {
                            base.stores.state.set(group.getBase(), node, msg, 'urgency', updates.urgency)
                        } else {
                            node.warn('msg.ui_update.urgency should be very-low, low, normal or high')
                        }
                    }
                }

                // ===========================================================
                // EXECUTED ACTION SPECIFIED IN MSG.TOPIC (FROM INPUT MSG)
                // ===========================================================

                let subscriptions = node.context().get('subscriptions', node.config.contextStore) || []
// TODO een aantal message topics moeten niet naar de frontend vue gestuurd worden

                switch(msg.topic) {
                    case 'clear_subscriptions':
                        // Remove all current subscriptions available from flow memory
                        node.context().set('subscriptions', [], node.config.contextStore)

                        node.status({fill:'blue', shape:"dot", text: '0 subscriptions'})
                        break

                   case 'push_notification':
                        // The readme page of the web-push npm library only specifies that the notification payload should
                        // be a string or a buffer, which means in fact a json string.  However the readme doesn't specify
                        // which content that json should contain.  That information is available in the Notification API
                        // documentation (see https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API).

                        // The subject can not be overwritten dynamically, otherwise all subscriptions would become invalid
                        if(!node.config.subject || node.config.subject.trim() == '') {
                            node.error('When pushing a notification, a subject should be specified')
                            return
                        }

                        // The public key can not be overwritten dynamically, otherwise all subscriptions would become invalid
                        if(!node.config.publicKey || node.config.publicKey.trim() == '') {
                            node.error('When pushing a notification, a VAPID public key should be specified')
                            return
                        }

                        // The private key can not be overwritten dynamically, otherwise all subscriptions would become invalid
                        if(!node.credentials.privateKey || node.credentials.privateKey.trim() == '') {
                            node.error('When pushing a notification, a VAPID private key should be specified')
                            return
                        }

                        if(subscriptions.length == 0) {
                           node.error('When pushing a notification, at least 1 subscription should be available')
                           return
                        }

                        // Unlike all other dynamic properties, the 'body' can be overwritten via the msg.payload
                        // (instead of via msg.ui_update).  Because the body is in most use case the value of a
                        // notification, which will be different for most of the notifications.
                        let body
                        if (config.bodyType === 'msg') {
                            body = RED.util.getMessageProperty(msg, config.body)
                        } else { // str
                            body = config.body
                        }

                        if (typeof body === 'undefined' || body === '') {
                            node.error('When pushing a notification, a body should be specified')
                            return
                        }

                        // Start from a basic notification based on the required properties.
                        // All other optional properties will be added afterwards to this basic notfication.
                        let notificationPayload = {
                            title: getProperty('title'),
                            // The body is passed as msg payload (instead of a dynamic property) because in most cases
                            // the notification body will be different for every notification.  For example the name of 
                            // the sensor that triggered the value.
                            body: body
                        }

                        // Small monochrome icon to indicate which app sent the notification (on the device’s status bar or notification center) 
                        let badge = getProperty('badge')
                        if (badge && badge !== '') {
                            notificationPayload.badge = badge
                        }

                        // A larger full-color image within the notification, that helps visually identify the notification’s source or content. 
                        let icon = getProperty('icon')
                        if (icon && icon !== '') {
                            notificationPayload.icon = icon
                        }

                        // A larger image inside the notification, to provide additional visual context or information
                        let image = getProperty('image')
                        if (image && image != '') {
                            notificationPayload.image = image
                        }

                        // Group related notifications together. When a new notification with a tag is sent, it replaces the previous notification
                        // with that same tag.  This helps prevent large numbers of notifications, and ensures users see only the latest notification.
                        let tag = getProperty('tag')
                        if (tag && tag != '') {
                            notificationPayload.tag = tag
                        }

                        // Whether the notification should remain active until the user clicks or dismisses it, rather than closing automatically
                        let requireInteraction = (getProperty('interaction') === 'required')
                        notificationPayload.requireInteraction = requireInteraction

                        // Whether the notification should be silent (i.e. no sounds or vibrations), regardless of the device settings.
                        let silent = (getProperty('volume') === 'silent')
                        if (silent) {
                            notificationPayload.silent = true
                        }

                        // TODO optionally add actions (array of objects which have an action ('open' or 'dismiss'), a title and an icon.
                        // notificationPayload.actions = ...

                        // The notificationPayload.data contains (optional) custom key-value pairs, which a web app needs
                        // to handle the notification properly.  For this node it is used to pass the url to the frontend, 
                        // so the url will be opened by the service worker when the notification is clicked.
                        // The most common use case an url referring to the Node-RED dashboard tabsheet, which can provide
                        // extra detailed information about the notification.
                        let url = getProperty('url')
                        if (url && url !== '') {
                            notificationPayload.data = {
                                url: getProperty('url')
                            }
                        }

                        const notificationOptions = {
                            // The VAPID configuration is NOT supported via dynamic properties, because once these values
                            // are overwritten the existing subscriptions would become useless.
                            vapidDetails: {
                                subject: node.config.subject, // mailto: address or url
                                publicKey: node.config.publicKey, // URL-safe base64 encoded
                                privateKey: node.credentials.privateKey // URL-safe base64 encoded
                            },
                            timeout: getProperty('timeout'),
                            TTL: getProperty('ttl'),
                            headers: getProperty('headers') || [], // Headers to be send
                            contentEncoding: 'aesgcm', // Other encoding types (e.g. aes128gcm) possible
                            urgency: getProperty('urgency'), // TODO op config scherm voorzien
// TODO optionally provide an identifier that the push service uses to coalesce notifications. Use a maximum of 32 characters from the URL or filename-safe Base64 characters sets
                            topic: 'todo'
                        }

                        // Send the push notification to all the available subscriptions
                        subscriptions.forEach((subscription) => {
                            webpush.sendNotification(subscription, JSON.stringify(notificationPayload), notificationOptions).catch(exc => {
                                node.error("Cannot push notification: " + exc, msg);
                            })
                        })

                        break

                    case 'refresh_node_status':
                        // Show the current number of subscriptions again in the node status, because the user might have manually updated the flow memory
                        node.status({fill:'blue', shape:"dot", text: subscriptions.length + ' subscriptions'})
                        break

                    case 'reload_service_workers':
                    case 'fetch_subscriptions':
                        // TODO we gaan hier nu nog niks doen, omdat we gewoon de msg naar de frontend willen sturen om daar afgehandeld te worden
                        // Maar zodra we expliciet de default onInput moeten oproepen zal dat veranderen
                        break

                    default:
                        node.error('Unsupported msg.topic')
                }
            },
            beforeSend: function (msg) {
                // ===========================================================
                // EXECUTED ACTION SPECIFIED IN MSG.TOPIC (BY FRONTEND VUE)
                // ===========================================================

                // The frontend code (in the vue file) will send messages to the server-side of the node, in
                // the following two situations:
                //   1. When the user clicks on the button.
                //   2. When the server-side code has asked the frontend code for information (e.g. subscription).
                // The server-side code here will process the information from the frontend messages.
                // CAUTION: the beforeSend is called by the dashboard framework in two situations:
                //   1. When an input msg arrives from the previous node in the flow.
                //   2. When a msg arrives from the fronted, before it is send to the next node in the flow.
                // The code below should only be called in case 2, which is unfortunately not possible.
                // As a result we will also arrive here for input messages (with other topic content) which
                // is useless and very confusing!

                let subscriptions = node.context().get('subscriptions', node.config.contextStore) || []

                switch(msg.topic) {
                    case 'new_subscription':
                    case 'auto_loaded_subscription':
                    case 'fetched_subscription':
                        let subscription = msg.payload

                        // Find all subscriptions for the specified endpoint
                        let endpointSubscriptions = subscriptions.filter( _subscription => {
                            return _subscription.endpoint == subscription.endpoint
                        })

                        // Only add the subscription if it is not available yet
                        if (endpointSubscriptions.length === 0) {
                            subscriptions.push(subscription)
                            node.context().set('subscriptions', subscriptions, node.config.contextStore)
                        }

                        break

                    case 'new_unsubscription':
                        let unsubscription = msg.payload

                        // Find all subscriptions for the specified endpoint
                        let filteredSubscriptions = subscriptions.filter( _subscription => {
                            return _subscription.endpoint != unsubscription.endpoint
                        })

                       // When the subscription is not available yet, it doesn't need to be removed
                       if(filteredSubscriptions.length != subscriptions.length) {
                           node.context().set('subscriptions', filteredSubscriptions, node.config.contextStore)

                           // Make sure the node status is updated with the new subscription count
                           subscriptions = filteredSubscriptions
                       }

                       break
                }

                node.status({fill:'blue', shape:"dot", text: subscriptions.length + ' subscriptions'})
                return msg
            }
        }

        // inform the dashboard UI that we are adding this node
        if (group) {
            group.register(node, config, evts)
        } else {
            node.error('No group configured')
        }
    }

    RED.nodes.registerType('ui-web-push', UIWebPushNode, {
        credentials: {
            privateKey: {type: "password"}
        }
    })

    // Make the key pair generation available to the config screen (in the flow editor)
    RED.httpAdmin.get('/ui_web_push/generate_vapid_key_pair', RED.auth.needsPermission('ui_web_push.write'), async function(req, res){
        try {
            // Generate a VAPID keypair
            const vapidKeys = webpush.generateVAPIDKeys()

            // Return public key and private key to the config screen (since they need to be stored in the node's credentials)
            res.json({
                publicKey: vapidKeys.publicKey,
                privateKey: vapidKeys.privateKey
            })
        }
        catch (err) {
            console.log("Error while generating VAPID keypair: " + err)
            res.status(500).json({error: 'Error while generating VAPID keypair'})
        }
    })

    // By default the UI path in the settings.js file will be in comment:
    //     //ui: { path: "ui" },
    // But as soon as the user has specified a custom UI path there, we will need to use that path:
    //     ui: { path: "mypath" },
    var uiPath = ((RED.settings.ui || {}).path) || 'dashboard'

    // Create the complete server-side path.
    // Normally the node id is not required in the endpoint, however we want to register the (same) service worker script
    // for every ui-web-push node.  Reason is that each service worker registration can have its own push subscription.
    // Indeed each ui-web-push node can have its own vapid configuration, so it needs its own service worker.  That
    // way multiple vapid configurations can be used on a single dashboard, although I don't see any use cases at the moment.
    uiPath = '/ui_web_push/:node_id/web_push_service_worker.js'

    // Replace a sequence of multiple slashes (e.g. // or ///) by a single one
    uiPath = uiPath.replace(/\/+/g, '/')

    // Make all the static resources from this node public available (i.e. Service worker javascript file).
    RED.httpNode.get(uiPath, function(req, res){
        // The node id is passed just to make the url unique per node, to allow us to have a separate service worker
        // per ui node.  See vue file for more explanation.  The node id is not used here...
        let nodeId = req.params.node_id

        const filePath = path.join(__dirname, 'lib', 'service-worker.js')
        var fileContent = fs.readFileSync(filePath).toString()
        if(!fileContent) {
            node.error("Cannot read service worker file from filesystem")
            res.status(404).json({error: 'Cannot read service worker file'})
            return;
        }

        // Send the requested file to the client
        res.type("js").send(fileContent)
    })
}
