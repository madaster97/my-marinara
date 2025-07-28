// Copyright 2017 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
'use strict';

// In-Memory Status: 'asleep','paused','active','break'
// 'asleep' will cover 2 things:
// - Startup
// - Time after a timer completes, but the user has not started the next
let localStatus = null; 
// Need to compare status to 'lastStatus' for full context
// let lastStatus = null;
// Local timer (DateTime), 
let nextNotify = null; 
// Heartbeat state (setInterval handle)
let heartbeatInterval;
// Notification state
// No way to know if they (x)'d the notification without button?
// Oh... onClosed! https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/notifications
let activeNotification = null;

// The main event logic
// States: 'asleep','paused','active','break'
// Events: 'heartbeat-complete','notify-active-click','notify-break-click','icon-click'
// Every caller should use this as a *sink*
function runEvent(event) {
  switch (event) {
    case 'icon-click':
      if (localStatus=='asleep') {
        chrome.action.setBadgeText({ text: 'ON' });
        localStatus='active';
        let now = new Date();
        nextNotify = new Date(+now + 1 * 60 * 1000); // 1 minute timer (for now)
        // un-register any active notification (of either kind!)
        if (activeNotification) {
          startHeartbeat().then(() => {
            return chrome.notifications.clear(activeNotification);
          });
        } else {
          startHeartbeat();
        }
      } else if (localStatus=='active') {
        chrome.action.setBadgeText({ text: '-' });
        // TODO: Bug when storing last status?
        localStatus='paused'
        // Clears local status + stops heartbeat, to allow SW to go inactive
        saveStatus();
      } else if (localStatus=='paused') {
        console.log('Resuming with assumed nextNotify: %o', nextNotify)
        chrome.action.setBadgeText({ text: 'ON' });
        localStatus='active';
        startHeartbeat();
      }
      break;
    case 'heartbeat-complete':
      const diff = nextNotify - new Date();
      if (diff<0) {
        chrome.action.setBadgeText({ text: 'OFF' });
        localStatus='asleep'
        // TODO: use lastStatus to figure what's next
        // Trigger notification
        activeNotification = NOTIFY_GO_ACTIVE;
        chrome.notifications.create(NOTIFY_GO_ACTIVE,{
          type: 'basic',
          iconUrl: 'stay_hydrated.png',
          title: 'Time to Hydrate',
          message: "Everyday I'm Guzzlin'!",
          buttons: [{ title: 'Keep it Flowing.' }],
          priority: 0
        });
      } else if (diff<(20*1000)) {
        // Account for drift
        lastHeartbeat(diff)
      }
      // Otherwise, heartbeat will continue!
      break;
    case 'notify-active-click':
      // Only respond on asleep
      // Assume the click removes the notification. Cleanup state
      // TODO: Only clear based on type of active notification
      activeNotification = null;
      if (localStatus=='asleep') {
        chrome.action.setBadgeText({ text: 'ON' });
        localStatus='active';
        let now = new Date();
        nextNotify = new Date(+now + 1 * 60 * 1000); // 1 minute timer (for now)
        startHeartbeat();
      }
      break;
  
    default:
      console.warn('Received unrecognized event: %s', event);
      break;
  }
}

// Constants for Stored State - Only to handle inactivity
// Will assume pause stops ticking, so SW likely to go inactive
const STORE_PAUSE_LEFTOVER = 'store-pause-leftover'; // milliseconds left on timer
// const STORE_PAUSE_LAST_STATUS = 'store-pause-last-status'; // the last status before pause

// Constants for Notification IDs
const NOTIFY_GO_ACTIVE = 'start-active';
// const NOTIFY_GO_BREAK = 'start-break';

// Handle case where 1 click starts to load the stored status, but another click comes in
// Global promise for "I'm loading the status into localStatus"
let loading;
async function loadStatus(){
  if (!!localStatus) {
    // Already loaded
    return;
  } else if (loading) {
    // Someone else loading
    await loading;
    return;
  }

  // TODO handle lastStatus too
  loading = 
    chrome.storage.local.get({STORE_PAUSE_LEFTOVER})
    .then(result => {
      console.log('Result received: %o', result)
      if (!result[STORE_PAUSE_LEFTOVER]) {
        // We're asleep, resumed without a stored pause
        localStatus = 'asleep'
        return; // Nothing stored, nothing to remove!
      } else {
        localStatus = 'paused'
        let now = new Date();
        nextNotify = new Date(+now + result[STORE_PAUSE_LEFTOVER])
        return chrome.storage.local.remove({STORE_PAUSE_LEFTOVER})
      }
    });
  await loading;
  loading = null;
}

// Save the status, stop the heartbeat, clear localStatus
// Re-use same promise for saving status on pause
async function saveStatus() {
  if (!localStatus) {
    // No status to save?
    console.warn('Attempted to save status when no status was loaded')
    return;
  } else if (loading) {
    // Someone else is loading or saving
    console.log('Someone else is loading')
    await loading;
    return;
  }
  // Save the thing + clear local status
  // TODO: also handle lastStatus
  console.log('Storing time left: %s', nextNotify - new Date())
  loading = 
    chrome.storage.local.set({STORE_PAUSE_LEFTOVER: nextNotify - new Date()})
    .then(stopHeartbeat);
  await loading;
  loading=null;
  localStatus = null;
}

//** Operations that could be on startup */

// Handle someone clicking the button in a notification
// Check stored status because this could be on startup
chrome.notifications.onButtonClicked.addListener(async (notificationId) => {
  await loadStatus();
  switch (notificationId) {
    case NOTIFY_GO_ACTIVE:
      runEvent('notify-active-click')
      break;
    // case NOTIFY_GO_BREAK:
    //   runEvent('notify-break-click')
    //   break;
    default:
      console.warn('Unknown notification sent: %s', notificationId)
      break;
  }
});

// Handle someone clicking the app icon
// Check stored status because this could be on startup
chrome.action.onClicked.addListener(async () => {
  await loadStatus();
  runEvent('icon-click')
});

//** Operations only registered after startup */
// https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers#keep_a_service_worker_alive_continuously
async function runHeartbeat() {
  console.log('Heartbeat started')
  await chrome.storage.local.set({ 'last-heartbeat': new Date().getTime() });
  console.log('Heartbeat completed')
  runEvent('heartbeat-complete')
}

async function startHeartbeat() {
  heartbeatInterval = setInterval(runHeartbeat, 20 * 1000); // Default to 20 seconds
}

// Called when there are <20 seconds in timer
async function lastHeartbeat(timeLeft) {
  clearInterval(heartbeatInterval);
  setTimeout(runHeartbeat, timeLeft)
}

// Called when you pause
async function stopHeartbeat() {
  clearInterval(heartbeatInterval);
}

// TODO remove/tweak
// chrome.alarms.onAlarm.addListener(() => {
//   chrome.action.setBadgeText({ text: '' });
//   chrome.notifications.create({
//     type: 'basic',
//     iconUrl: 'stay_hydrated.png',
//     title: 'Time to Hydrate',
//     message: "Everyday I'm Guzzlin'!",
//     buttons: [{ title: 'Keep it Flowing.' }],
//     priority: 0
//   });
// });

// chrome.notifications.onButtonClicked.addListener(async () => {
//   const item = await chrome.storage.sync.get(['minutes']);
//   chrome.action.setBadgeText({ text: 'ON' });
//   chrome.alarms.create({ delayInMinutes: item.minutes });
// });