<template>
    <v-switch v-model="switchState" :label="switchLabel" :disabled="!switchEnabled" :loading="loadingEnabled" color="primary" :messages="switchMessage" :hide-details="'auto'" @update:model-value="onChange"></v-switch>
</template>

<script>
import { markRaw } from 'vue'
import { mapState } from 'vuex'

export default {
    name: 'UIWebPush',
    inject: ['$socket'],
    props: {
        /* do not remove entries from this - Dashboard's Layout Manager's will pass this data to your component */
        id: { type: String, required: true },
        props: { type: Object, default: () => ({}) },
        state: { type: Object, default: () => ({ enabled: false, visible: false }) }
    },
    setup (props) {
        console.info('UIWebPush setup with:', props)
        console.debug('Vue function loaded correctly', markRaw)
    },
    data () {
        return {
            switchState: false,
            switchEnabled: false,
            switchLabel: this.props.switchLabel,
            switchMessage: '',
            loadingEnabled: false, // Progress bar on top of the switch
            serviceWorkerRegistration: null
        }
    },
    computed: {
        ...mapState('data', ['messages'])
    },
    mounted () {
        this.$socket.on('widget-load:' + this.id, (msg) => {
            // load the latest message from the Node-RED datastore when this widget is loaded
            // storing it in our vuex store so that we have it saved as we navigate around
            this.$store.commit('data/bind', {
                widgetId: this.id,
                msg
            })
        })
        this.$socket.on('msg-input:' + this.id, (msg) => {
            // store the latest message in our client-side vuex store when we receive a new message
            this.$store.commit('data/bind', {
                widgetId: this.id,
                msg
            })

            switch(msg.topic) {
                case 'reload_service_worker':
                    // When a new version of the service_worker.js is available in the Node-RED endpoint, it should be loaded by the browser.
                    // However that isn't the case, since navigator.serviceWorker.register doesn't load the file again when loaded previously already...
                    // There are some workarounds (See more details on https://developers.google.com/web/updates/2019/09/fresher-sw) :
                    // - We could set updateViaCache to 'none' (in navigator.serviceWorker.register), to avoid that the nodered_push_service.js is
                    //   being stored in the http cache.
                    // - Or we could (in the http endpoint) do "res.set('Cache-Control', 'max-age=0');" to make sure the browser will not store
                    //   the nodered_push_service.js in the http cache.  Same as previous point, but now for older browsers.
                    // But in both cases the js file would be downloaded every time the dashboard is being loaded, which would result in a lot of traffic ...
                    // Therefore we will trigger updating the js file manually ...
                    // Remark: within 24 hours your service worker will update (they will check every 24 hours to see if there is a newer version available).
                    if (!('serviceWorker' in navigator)) {
                        console.log('Cannot reload service worker, because service workers are NOT supported by this browser!');
                        return
                    }

                    if (this.serviceWorkerRegistration) {
                        // Fetch the worker's script URL.  If the new worker is not byte-by-byte identical to the current worker, it installs the new worker.
                        // The fetch of the worker bypasses any browser caches if the previous fetch occurred over 24 hours ago.
                        this.serviceWorkerRegistration.update()

                        console.log('The registration has been updated')
                    }

                    // TODO send result back to Node-RED???
                    break

                case 'fetch_subscriptions':
                    // Check whether currently a push subscription is already available for the service worker
                    this.serviceWorkerRegistration.pushManager.getSubscription().then((subscription) => {
                        if(subscription) {
                            // Send the existing push subscription to the subscription manager inside the Node-RED flow
                            this.send({
                                payload: subscription,
                                topic: 'subscribe'
                            })
                        }
                    }).catch((error) => {
                        this.send({
                            payload: 'Cannot get a subscription from the service worker:\n' + error,
                            topic: 'error'
                        })
                    })

                    break
            }
        })
        // tell Node-RED that we're loading a new instance of this widget
        this.$socket.emit('widget-load', this.id)

        this.setSwitchMessage('Not subscribed for receiving notifications')

        if (!('serviceWorker' in navigator)) {
            if (window.location.protocol === 'http:') {
                this.setSwitchMessage('No service worker support (when no https)')
            }
            else {
                this.setSwitchMessage('No service worker support (no browser support or no valid certificate)')
            }

            // Keep the switch in its initial OFF state
            return
        }

        // This feature is available only in secure contexts (HTTPS) !!!!!!!!!!!!!!!!
        // This feature is not available with self signed certificates !!!!!!!!!!!!!!!!
        if (!('PushManager' in window)) {
            this.setSwitchMessage('No push notification support!')

            // Keep the switch in its initial state
            return
        }

        // The service worker js file needs to be downloaded from our endpoint on the Node-RED backend.
        // It is not allowed by modern browsers to bundle the js file by Vite in the umd, for security reasons.
        // Every web-push ui node will get a unique url, by adding the node id into the url.
        // Because a browser allows you to get a subscription from the push manager for each service worker url.
        // That way each web push ui node will have its own subscription, which allows users to use multiple web
        // push ui nodes in the same dashboard.
        let serviceWorkerUrl = '/ui_web_push/' + this.id + '/web_push_service_worker.js'

        // ALWAYS register a service worker, even when the user doesn't subscribe for push notifications.
        // It will run in background (as a separate thread) and won't do anything until the browser calls it.
        // Therefore the user don't has to permit this.  The service.js file will contain all our service worker code.
        // One of the advantages of registering it in advance: it will have very shortly status 'installed' and then
        // get status 'active'.  If we would register immediately before we request a subscription from the push
        // manager, then it will have the incorrect status (i.e. 'installed' instead of 'active') which will cause a failure.
        // When a service worker (with the same url) is already active, then nothing will happen here.
        // But when there is no active service worker, then one will be registered here ...
        navigator.serviceWorker.register(serviceWorkerUrl).then((serviceWorkerRegistration) => {
            this.serviceWorkerRegistration = serviceWorkerRegistration

            // Since the service worker has been registered for this node, enable the switch to allow the user to (un)subscribe
            this.switchEnabled = true

            // Check whether currently a push subscription is already available for the service worker
            this.serviceWorkerRegistration.pushManager.getSubscription().then((subscription) => {
                if (subscription) {
                    if(this.props.autoLoad) {
                        // Send the push subscription to the subscription manager inside the Node-RED flow, to make sure the
                        // subscription manager is up-to-date anyway.  We only send it when requested on the config screen.
                        // But this means that the subscription manager in Node-RED should remove duplicate subscriptions!
                        this.send({
                            payload: subscription,
                            topic: 'subscribe'
                        })
                    }

                    // Set the switch ON, to reflect a subscription was already available for the service worker url of this ui node
                    this.switchState = true
                    this.setSwitchMessage('Subscribed for receiving notifications')
                }
            }).catch((error) => {
                // Seems there is no subscription available yet, so keep the switch in its initial status (OFF)
            })
        }).catch((error) => {
            // Seems the service worker cannot be registered, so keep the switch in its initial status (OFF)
            this.setSwitchMessage('Cannot download and register service worker js file')
        })
    },
    unmounted () {
        /* Make sure, any events you subscribe to on SocketIO are unsubscribed to here */
        this.$socket?.off('widget-load' + this.id)
        this.$socket?.off('msg-input:' + this.id)
    },
    methods: {
        /*
            widget-action just sends a msg to Node-RED, it does not store the msg state server-side
            alternatively, you can use widget-change, which will also store the msg in the Node's datastore
        */
        send (msg) {
            this.$socket.emit('widget-action', this.id, msg)
        },
        alert (text) {
            alert(text)
        },
        /*
            You can also emit custom events to Node-RED, which can be handled by a custom event handler
            See the ui-example.js file for how to subscribe to these.
        */
        test () {
            console.info('custom event handler:')
            this.$socket.emit('my-custom-event', this.id, {
                payload: 'Custom Event'
            })
        },
        onChange(val) {
            // Show a progress bar (on the switch knob), until the current action has been processed
            this.loadingEnabled = true

            // Make sure the user cannot click the switch again, before the current action has been processed
            this.switchEnabled = false

            // The switchState will contain already its updated status here, i.e. the target status
            if(this.switchState) {
                // When the target status of the switch is ON, the user wants to SUBSCRIBE to the notifications.
                // Push notification can only be send to the browser, when the user has granted his permission for this domain.
                // The requestPermission will show a popup to the user, only when this domain hasn't been granted or denied yet.
                // If this domain is already denied in the past, the user will have to remove this domain manually from the
                // blocked domain list (in his browser settings).  And afterwards try this again ...
                // Recently the Notification.requestPermission uses a promise, but Safari still uses a callback function!
                try {
                    // Promise-based approach
                    Notification.requestPermission().then((permission) => {
                        this.subscribe(permission)
                    })
                }
                catch(error) {
                    // Callback-based approach for Safari
                    Notification.requestPermission((permission) => {
                        this.subscribe(permission)
                    })
                }
            }
            else {
                // When the target status of the switch is OFF, the user wants to UNSUBSCRIBE from the notifications.
                this.unsubscribe()
            }

            // The action has completed, so hide the progress bar and enable the switch again
            this.loadingEnabled = false
            this.switchEnabled = true

            //TODO this.$socket.emit('widget-action', this.id, msg)
        },
        subscribe(permission) {
            switch (permission) {
                case 'granted':
                    // This domain is explicit granted to send notifications, in the browser settings.\n You will now be able to receive notifications.
                    // So let's continue ...

                    // The public VAPID key needs to be included in the request
                    const applicationServerKey = this.urlB64ToUint8Array(this.props.publicKey)
                    const options = { applicationServerKey, userVisibleOnly: true }

                    // Subscribe to the push manager (from Google, Mozilla, Apple, ...), if not done yet
                    this.serviceWorkerRegistration.pushManager.subscribe(options).then((subscription) => {
                        // Send the new push subscription to the subscription manager inside the Node-RED flow
                        this.send({
                            payload: subscription,
                            topic: 'subscribe'
                        })

                        this.setSwitchMessage('Subscribed for receiving notifications')
                    }).catch((error) => {
                        this.setSwitchMessage('Cannot subscribe to the browser push manager')
                        alert('Cannot subscribe to the browser push manager:\n' + error)

                        // Set the switch status back to OFF
                        this.switchState = false
                    })
                    break
                case 'denied':
                    alert('This domain is denied to receive notifications!\nIt can be allowed again via the browser settings')

                    // Set the switch status back to OFF
                    this.switchState = false
                    return
                case 'default':
                    // The user decision is unknown, since the user has closed the permission popup via the 'X' switch.
                    // In this case the application will act as if permission was denied.
                    alert('This domain is not explicit granted to receive notifications!\nIt can be allowed again via the browser settings')

                    // Set the switch status back to OFF
                    this.switchState = false
                    return
            }
        },
        unsubscribe() {
            // Check whether currently a push subscription is already available for the service worker
            this.serviceWorkerRegistration.pushManager.getSubscription().then((subscription) => {
                if(subscription) {
                    subscription.unsubscribe().then((successful) => {
                        if (successful) {
                            // Let the Node-RED flow know about the unsubscription
                            this.send({
                                payload: subscription,
                                topic: "unsubscribe"
                            })

                            this.setSwitchMessage('Unsubscribed to receive notifications')
                        }
                        else {
                            alert('Cannot unsubscribe from the browser push manager')

                            // Set the switch status back to ON
                            this.switchState = true
                        }
                    }).catch((error) => {
                        alert('Cannot unsubscribe from the push manager:\n' + error)

                        // Set the switch status back to ON
                        this.switchState = true
                    })
                }
            }).catch((error) => {
                alert('Cannot get a subscription from the service worker:\n' + error)

                // Set the switch status back to ON
                this.switchState = true
            })
        },
        setSwitchMessage(switchMessage) {
            // Only show the switch message if required by the user
            if (this.props.showSwitchMessage) {
                this.switchMessage = switchMessage;
            }
        },
        // Encode the base64 public key to an Array buffer, which is needed by the subscription option
        urlB64ToUint8Array(base64String) {
            const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
            const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/')
            const rawData = atob(base64)
            const outputArray = new Uint8Array(rawData.length)
            for (var i = 0; i < rawData.length; ++i) {
                outputArray[i] = rawData.charCodeAt(i)
            }
            return outputArray
        }
    }
}
</script>

<style scoped>
/* CSS is auto scoped, but using named classes is still recommended */
.v-switch .v-input__details {
    align-items: center;
    padding: 0;
}
</style>
