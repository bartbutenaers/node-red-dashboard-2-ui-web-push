/**
 * Used only for development (via `npm run dev`).
 *
 * This file is useful for testing your component in isolation from Node-RED.
 */
import { createApp } from 'vue'

import UIWebPush from './components/UIWebPush.vue'

createApp(UIWebPush).mount('#app')

// Make the service worker js file available for the Vite app.
// This way the service worker is available when the app loads.
//import { register } from "register-service-worker";
//register(`/service-worker.js`)
