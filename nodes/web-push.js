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

        // server-side event handlers
        const evts = {
            onAction: true,
            // Custom onInput function.  No messages need to be stored on the datastore, because all communication
            // is from the frontend to this backend.  No need to let the dashboard replay messages.
            onInput: function (msg, send, done) {
                let subscriptions = node.context().get('subscriptions', node.config.contextStore) || []
// TODO een aantal message topics moeten niet naar de frontend vue gestuurd worden

                switch(msg.topic) {
                    case 'clear_subscriptions':
                        // Remove all current subscriptions available from flow memory
                        node.context().set('subscriptions', [], node.config.contextStore)

                        node.status({fill:'blue', shape:"dot", text: '0 subscriptions'})
                        break

                   case 'push_notification':
                        let payload = msg.payload

                        if(!node.config.subject || node.config.subject.trim() == '') {
                            node.error('When pushing a notification, a subject should be specified')
                            return
                        }

                        if(!node.config.publicKey || node.config.publicKey.trim() == '') {
                            node.error('When pushing a notification, a VAPID public key should be specified')
                            return
                        }

                        if(!node.credentials.privateKey || node.credentials.privateKey.trim() == '') {
                            node.error('When pushing a notification, a VAPID private key should be specified')
                            return
                        }

                        if(subscriptions.length == 0) {
                           node.error('When pushing a notification, at least 1 subscription should be available')
                           return
                        }

                        if(payload && typeof payload === 'object') {
                            payload.data = payload.data || {}
                            payload = JSON.stringify(payload)
                        }
                        else {
                            node.error('When pushing a notification, the msg.payload should contain a valid object')
                            return
                        }

                        const options = {
                            //gcmAPIKey: '< GCM API Key >',
                            vapidDetails: {
                                subject: node.config.subject, // mailto: address or url
                                publicKey: node.config.publicKey, // URL-safe base64 encoded
                                privateKey: node.credentials.privateKey // URL-safe base64 encoded
                            },
                            timeout: node.config.timeout,
                            TTL: node.config.ttl,
                            headers: node.config.headers || [], // Headers to be send
                            contentEncoding: 'aesgcm', // Other encoding types (e.g. aes128gcm) possible
                            urgency: node.config.urgency, // TODO op config scherm voorzien
                            topic: 'todo'
                        }

                        // Send the push notification to all the available subscriptions
                        subscriptions.forEach((subscription) => { 
                            webpush.sendNotification(subscription, payload, options).catch(exc => {
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
            onSocket: {

            },
            beforeSend: function (msg) {
                let subscriptions = node.context().get('subscriptions', node.config.contextStore) || []
debugger;
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
        let nodeId = req.params.node_id;

        const filePath = path.join(__dirname, 'lib', 'service-worker.js')
        var fileContent = fs.readFileSync(filePath).toString();
        if(!fileContent) {
            node.error("Cannot read service worker file from filesystem");
            res.status(404).json({error: 'Cannot read service worker file'});
            return;
        }
        
        // Send the requested file to the client
        res.type("js").send(fileContent);
    });

  // Make the key pair generation available to the config screen (in the flow editor)
  RED.httpAdmin.get('/ui_web_push/generate_vapid_key_pair', RED.auth.needsPermission('ui_web_push.write'), async function(req, res){
    try {
      // Generate a VAPID keypair
      const vapidKeys = webpush.generateVAPIDKeys();
 
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
  });
}
