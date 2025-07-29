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
let lastStatus = null; // 'active' or 'break'
// // Local timer (DateTime), 
let nextNotify = null; 
// Heartbeat state (setInterval/setTimeout handles)
let heartbeatInterval;
let lastHeartbeatTimeout;
// Notification state
// No way to know if they (x)'d the notification without button?
// Oh... onClosed! https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/notifications
let activeNotification = null;

// The main event logic
// States: 'asleep','paused','active','break'
// Events: 'heartbeat-complete','notify-active-click','notify-break-click','icon-click'
// Every caller should use this as a *sink*
function runEvent(event) {
  console.log('Event details: event (%s), localStatus (%s), lastStatus (%s), nextNotify (%s)', event, localStatus, lastStatus, nextNotify)
  switch (event) {
    case 'icon-click':
      if (localStatus=='asleep') {
        // If the icon click woke up the SW, default to active
        if (!lastStatus) {
          localStatus='active'
        } else {
          localStatus = lastStatus == 'active'
            ? 'break'
            : 'active';
          lastStatus=''; // Clean up
        }

        // Update badge + timer
        let now = new Date();
        if (localStatus=='active') {
          chrome.action.setBadgeText({ text: 'ON' });
          nextNotify = new Date(+now + 60 * 1000); // 1 minute timer (for now)
        } else {
          chrome.action.setBadgeText({ text: 'X' });
          nextNotify = new Date(+now + 30 * 1000); // 30 second timer (for now)
        }

        // un-register any active notification (of either kind!)
        // Start the heartbeat first!
        if (!!activeNotification) {
          startHeartbeat().then(() => {
            return chrome.notifications.clear(activeNotification);
          });
        } else {
          startHeartbeat();
        }
      } else if (['active','break'].includes(localStatus)) {
        chrome.action.setBadgeText({ text: '-' });
        lastStatus=localStatus
        localStatus='paused'
        // Clears local status + stops heartbeat, to allow SW to go inactive
        saveStatus();
      } else if (localStatus=='paused') {
        console.log('Resuming to "%s" with assumed nextNotify: %o', lastStatus, nextNotify)
        let text = lastStatus == 'active'
          ? 'ON'
          : 'X';
        chrome.action.setBadgeText({ text });
        localStatus=lastStatus;
        lastStatus='';
        // Have to check if there is <1 heartbeat of time left
        const diff = nextNotify - new Date();
        if (diff<(20*1000)) {
          lastHeartbeatOnly(diff)
        } else {
          startHeartbeat();
        }
      }
      break;
    case 'heartbeat-complete':
      // Put a guard in case of heartbeat leaks
      if (['active','break'].includes(localStatus)) {
        const diff = nextNotify - new Date();
        if (diff<0) {
          chrome.action.setBadgeText({ text: 'OFF' });
          lastStatus=localStatus
          localStatus='asleep'
          // Trigger notification
          // If we were active, show break notification (and vice versa)
          activeNotification = lastStatus == 'active'
            ? NOTIFY_GO_BREAK
            : NOTIFY_GO_ACTIVE;
          // TODO: Make different messages for active vs break
          chrome.notifications.create(activeNotification,{
            type: 'basic',
            iconUrl: 'stay_hydrated.png',
            title: 'Time to Hydrate',
            message: "Notification type: " + activeNotification,
            buttons: [{ title: 'Keep it Flowing.' }],
            priority: 0
          });
        } else if (diff<(20*1000)) {
          // Account for drift
          lastHeartbeat(diff);
        }
        // Otherwise, heartbeat will continue!
      } else {
        console.warn('Heartbeat fired while in "%s" status', localStatus)
      }
      break;
    case 'notify-active-click':
      // Only respond on asleep
      // Assume the click removes the notification. Cleanup state
      // TODO: Only clear based on type of active notification
      activeNotification = null;
      if (localStatus=='asleep') {
        chrome.action.setBadgeText({ text: 'ON' });
        localStatus='active';
        lastStatus='';
        let now = new Date();
        nextNotify = new Date(+now + 1 * 60 * 1000); // 1 minute timer (for now)
        startHeartbeat();
      }
      break;
    case 'notify-break-click':
      // Only respond on asleep
      // Assume the click removes the notification. Cleanup state
      // TODO: Only clear based on type of active notification
      activeNotification = null;
      if (localStatus=='asleep') {
        chrome.action.setBadgeText({ text: 'X' });
        localStatus='break';
        lastStatus='';
        let now = new Date();
        nextNotify = new Date(+now + 1 * 30 * 1000); // 30 second timer (for now)
        startHeartbeat();
      }
      break;
  
    default:
      console.warn('Received unrecognized event: %s', event);
      break;
  }
}

/** The unique actions that can happen */

// Constants for Notification IDs
const NOTIFY_GO_ACTIVE = 'start-active';
const NOTIFY_GO_BREAK = 'start-break';

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
    chrome.storage.local.get(['store-pause-leftover','store-pause-status'])
    .then(result => {
      console.log('Result received: %o', result)
      const leftover = result['store-pause-leftover'];
      if (!leftover) {
        // We're asleep, resumed without a stored pause
        console.log('Resuming as if asleep')
        localStatus = 'asleep'
        // Don't set lastStatus, that defaulting should only run for icon-click event
        return; // Nothing stored, nothing to remove!
      } else {
        console.log('Resuming as if paused')
        localStatus = 'paused'
        lastStatus = result['store-pause-status'];
        let now = new Date();
        nextNotify = new Date(+now + leftover)
        return chrome.storage.local.remove(['store-pause-leftover','store-pause-status']);
      }
    });
  await loading;
  loading = null;
}

// Save the status, stop the heartbeat, clear localStatus
// Re-use same promise for saving status on pause
// Save while paused, assuming SW will go inactive
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
  console.log('Storing time left before "%s" is over: %s', lastStatus, nextNotify - new Date())
  loading = 
    chrome.storage.local.set({
      'store-pause-leftover': nextNotify - new Date(),
      'store-pause-status': lastStatus
    })
    .then(stopHeartbeat);
  await loading;
  loading=null;
  localStatus=null;
  lastStatus=null;
}

//** Operations that could be on startup */

// Handle someone clicking the button in a notification
// Check stored status because this could be on startup
chrome.notifications.onButtonClicked.addListener(async (notificationId) => {
  console.log('Notification button clicked: %s', notificationId)
  await loadStatus();
  switch (notificationId) {
    case NOTIFY_GO_ACTIVE:
      runEvent('notify-active-click')
      break;
    case NOTIFY_GO_BREAK:
      runEvent('notify-break-click')
      break;
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
  await chrome.storage.local.set({ 'last-heartbeat': new Date().getTime() });
  console.log('Heartbeat ran')
  // This requirement was painful to find... 
  // Completing a timeout doesn't clear this reference, need to clear yourself
  if (lastHeartbeatTimeout) {
    lastHeartbeatTimeout=null;
  }
  runEvent('heartbeat-complete')
}

async function startHeartbeat() {
  console.log('Heartbeat started during "%s" status, due at %s',localStatus,nextNotify)
  heartbeatInterval = setInterval(runHeartbeat, 20 * 1000); // Default to 20 seconds
}

// Called when there are <20 seconds in timer
async function lastHeartbeat(timeLeft) {
  console.log('Final heartbeat started')
  clearInterval(heartbeatInterval);
  lastHeartbeatTimeout = setTimeout(runHeartbeat, timeLeft)
}

// Called when there are <20 seconds in timer started from a pause
async function lastHeartbeatOnly(timeLeft) {
  console.log('Final heartbeat (only) started')
  lastHeartbeatTimeout = setTimeout(runHeartbeat, timeLeft)
}

// Called when you pause
async function stopHeartbeat() {
  if (lastHeartbeatTimeout) {
    clearTimeout(lastHeartbeatTimeout);
    console.log('Final heartbeat stopped')
    // lastHeartbeatTimeout=null; // TODO: Is this needed? Note we clear after last run too
  } else {
    console.log('Heartbeat stopped')
    clearInterval(heartbeatInterval);
  }
}