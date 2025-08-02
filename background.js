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
// Current Pomodoro Cycles
let currentCycle = 0;
// User settings, loaded later
const SETTINGS_KEYS =['cyclePeriod','activeTime','breakTime','longBreakTime'];
let cyclePeriod = null;
let activeTime = null;
let breakTime = null;
let longBreakTime = null;

function isLongBreak() {
  // User must have long breaks enabled (cyclePeriod chosen)
  // Then if their current cycle == the period, done!
  // Greater than check handles changing your settings. This example scenario:
  // 1. Period = 4, you've completed 2
  // 2. While your 3rd cycle is running, you bump the setting down to 2
  // 3. onChanged handler updates the variable
  // 4. Your 3rd cycle completes, now we should long-break
  return !!cyclePeriod && currentCycle >= cyclePeriod;
}

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
        // TODO: Add specific colors, change text to # of minutes
        let now = new Date();
        if (localStatus=='active') {
          chrome.action.setBadgeText({ text: 'ON' });
          nextNotify = new Date(+now + activeTime * 1000); // 1 minute timer (for now)
        } else if (isLongBreak()) {
          chrome.action.setBadgeText({ text: 'Y' });
          nextNotify = new Date(+now + longBreakTime * 1000); // 39 second timer (for now)
        } else {
          chrome.action.setBadgeText({ text: 'X' });
          nextNotify = new Date(+now + breakTime * 1000); // 30 second timer (for now)
        }

        // clear the notification
        // Start the heartbeat first!
        startHeartbeat().then(() => {
          return chrome.notifications.clear('my-notification');
        });
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
          : isLongBreak()
            ? 'Y'
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
          lastStatus = localStatus
          localStatus = 'asleep'
          // Increment Pomodoro cycle
          if (lastStatus == 'active') {
            currentCycle++;
          }
          // Trigger notification
          // If we were active, show break notification (and vice versa)
          let notifyText = lastStatus == 'active'
            ? isLongBreak()
              ? 'long break'
              : 'break'
            : 'active';
          chrome.notifications.create('my-notification',{
            type: 'basic',
            iconUrl: 'stay_hydrated.png',
            title: 'Time to Hydrate',
            message: 
              "Notification type: " + notifyText,
            buttons: [{ title: 'Keep it Flowing.' }],
            priority: 0
          });
          // TODO: Open browser tab with info
          // TODO: store today's pomodoro history
        } else if (diff<(20*1000)) {
          // Account for drift + cases where timer isn't cleanly divisible by heartbeat
          // (Example: 20 second heartbeat, 39 timer, last run is 10 seconds - any drift)
          lastHeartbeat(diff);
        }
        // Otherwise, heartbeat will continue!
        // TODO: Update badge with # of minutes
      } else {
        console.warn('Heartbeat fired while in "%s" status', localStatus)
      }
      break;
    case 'notify-click':
      // Only respond on asleep
      // Assume the click removes the notification, nothing to clear
      if (localStatus=='asleep') {
        localStatus = lastStatus == 'active'
          ? 'break'
          : 'active';
        lastStatus=''; // Clean up

        // Update badge + timer
        // TODO: Add specific colors, change text to # of minutes
        let now = new Date();
        if (localStatus=='active') {
          chrome.action.setBadgeText({ text: 'ON' });
          nextNotify = new Date(+now + activeTime * 1000); // 1 minute timer (for now)
        } else if (isLongBreak()) {
          chrome.action.setBadgeText({ text: 'Y' });
          nextNotify = new Date(+now + longBreakTime * 1000); // 39 second timer (for now)
        } else {
          chrome.action.setBadgeText({ text: 'X' });
          nextNotify = new Date(+now + breakTime * 1000); // 39 second timer (for now)
        }

        startHeartbeat();
      }
      break;
    default:
      console.warn('Received unrecognized event: %s', event);
      break;
  }
}

// Settings for debugging: `await chrome.storage.sync.set({'cyclePeriod': 2, 'activeTime': 60, 'breakTime': 30, 'longBreakTime': 39})`
function getDefault(setting) {
  switch (setting) {
    case 'cyclePeriod':
      return 4;
    case 'activeTime':
      return 25 * 1000;
    case 'breakTime':
      return 5 * 1000;
    case 'longBreakTime':
      return 15 * 1000;

    default:
      break;
  }
}

async function settingsSetup() {
  return chrome.storage.sync.get(SETTINGS_KEYS)
    .then((result) => {
      // Load, apply defaults as needed
      cyclePeriod = result['cyclePeriod'] || getDefault('cyclePeriod');
      activeTime = result['activeTime'] || getDefault('activeTime');
      breakTime = result['breakTime'] || getDefault('breakTime');
      longBreakTime = result['longBreakTime'] || getDefault('longBreakTime');
    });
}

// Handle case where 1 click starts to load the stored status, but another click comes in
// Global promise for "I'm loading the status into localStatus"
// TODO: Make this load any user-settings
// TODO: Make sure restarting from contextMenu loads settings
let loading;
async function loadStatus(){
  if (!!localStatus) {
    // Already loaded - Handles:
    // - clicks during active/break
    // - Clicks in the ~30 seconds a SW might stay awake while status is paused/asleep (no heartbeat)
    return;
  } else if (loading) {
    // Someone else loading
    await loading;
    return;
  }

  // First load our synced settings
  // Then load Pomodoro Cycle state and save history if we've rolled to a new day
  let cycleSetup = settingsSetup().then(() => {
  return chrome.storage.local.get(['store-pause-completed', 'last-heartbeat'])
    .then((result) => {
      // TODO save history and use last-heartbeat to roll over a new day
      // TODO handle cyclePeriod edits that make currentCycle > cyclePeriod (oops!)
      currentCycle = result['store-pause-completed'] || 0;
      return chrome.storage.local.remove(['store-pause-completed']);
    });
  });

  loading = cycleSetup.then(() =>
    chrome.storage.local.get(['store-pause-leftover', 'store-pause-status'])
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
          return chrome.storage.local.remove(['store-pause-leftover', 'store-pause-status']);
      }
      }));
  await loading;
  loading = null;
}

// Clears local status, stops heartbeat, store cycle, to allow SW to go inactive
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
  // TODON'T: No need to store Pomodoro History here
  // Just make sure the history page can read today's count
  // Save the stuff + clear local status
  console.log('Storing time left before "%s" is over: %s (completed %s)', lastStatus, nextNotify - new Date(), currentCycle)
  loading = 
    chrome.storage.local.set({
      'store-pause-leftover': nextNotify - new Date(),
      'store-pause-status': lastStatus,
      'store-pause-completed': currentCycle
    })
    .then(stopHeartbeat);
  await loading;
  loading = null;
  // Keep everything else in memory in case we're paused/asleep for <30 seconds (cached!)
}

//** Operations that could be on startup */

// Handle someone clicking the button in a notification
// Check stored status because this could be on startup
chrome.notifications.onButtonClicked.addListener(async (notificationId) => {
  console.log('Notification button clicked: %s', notificationId)
  await loadStatus();
  switch (notificationId) {
    case 'my-notification':
      runEvent('notify-click')
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

// Handle contextMenu options
// Options: 

// Load Settings from options page as they're changed
chrome.storage.onChanged.addListener((changes, namespace) => {
  // If this handler woke the SW, do nothing. Next *loadStatus* will get the settings
  if (!localStatus) {
    return;
  }
  // Now check if these are settings we care about
  // Only handling synced settings
  if (namespace!=='sync') {
    return;
  }
  let changedSettings = Object.keys(changes).filter(key => SETTINGS_KEYS.includes(key));
  if (changedSettings.length==0) {
    return;
  } else {
    console.log('Loaded %s settings', changedSettings.length)
    changedSettings.forEach(key => {
      // Load, apply defaults as needed
      switch (key) {
        case 'cyclePeriod':
          cyclePeriod = changes[key].newValue || getDefault('cyclePeriod');
          break;
        case 'activeTime':
          activeTime = changes[key].newValue || getDefault('activeTime');
          break;
        case 'breakTime':
          breakTime = changes[key].newValue || getDefault('breakTime');
          break;
        case 'longBreakTime':
          longBreakTime = changes[key].newValue || getDefault('longBreakTime');
          break;
      
        default:
          break;
      }
    });
    // clear localStatus so next `loadStatus` caller will pull new settings
    if (['asleep','paused'].includes(localStatus)) {
      localStatus=null;
      return;
    }
  }
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

// TODO: On startup, archive any pomodoro history from prior days (# + date)