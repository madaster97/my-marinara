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

function getBadgeTextFromSeconds(seconds) {
  if (seconds <= 60) {
    return "<1"
  } else {
    return (Math.ceil(seconds/60)).toString()
  }
}

function changeBadgeStatus() {
  // Update badge + timer
  // Add specific colors, change text to # of minutes
  let now = new Date();
  if (localStatus=='active') {
    chrome.action.setBadgeText({ text: getBadgeTextFromSeconds(activeTime) });
    nextNotify = new Date(+now + activeTime * 1000);
  } else if (isLongBreak()) {
    chrome.action.setBadgeText({ text: getBadgeTextFromSeconds(longBreakTime) });
    nextNotify = new Date(+now + longBreakTime * 1000);
  } else {
    chrome.action.setBadgeText({ text: getBadgeTextFromSeconds(breakTime) });
    nextNotify = new Date(+now + breakTime * 1000);
  }

  let color = localStatus == 'active' ? '#bb0000' : '#11aa11';
  chrome.action.setBadgeBackgroundColor({ color });
}

function startTimer(clearNotification) {
  // If the click (icon, notification, or splash page) woke up the SW, default to active
  if (!lastStatus) {
    localStatus='active'
  } else {
    localStatus = lastStatus == 'active'
      ? 'break'
      : 'active';
    lastStatus=''; // Clean up
  }

  // Update badge + set nextNotify
  changeBadgeStatus();

  // Start the heartbeat
  // Then optionally clear the notification
  if (clearNotification) {
    startHeartbeat().then(() => {
      return self.registration.getNotifications({tag:'my-notification'})
      .then(notifications => {
        // Should only be one with requested tag
        if (notifications.length ==0) {
          console.warn('Tried to close a notifiation that was not there')
        } else {
          notifications[0].close();
        }
      })
    });
  } else {
    startHeartbeat();
  }
}

function pauseTimer() {
  chrome.action.setBadgeText({ text: '-' });
  lastStatus=localStatus
  localStatus='paused'
  // Clears local status + stops heartbeat, to allow SW to go inactive
  saveStatus();
}

function resumeTimer() {
  console.log('Resuming to "%s" with assumed nextNotify: %o', lastStatus, nextNotify)
  // Have to check if there is <1 heartbeat of time left
  const diff = nextNotify - new Date();
  localStatus=lastStatus;
  lastStatus='';

  chrome.action.setBadgeText({ text: getBadgeTextFromSeconds(diff / 1000)});
  let color = localStatus == 'active' ? '#bb0000' : '#11aa11';
  chrome.action.setBadgeBackgroundColor({ color });
  if (diff<(20*1000)) {
    lastHeartbeatOnly(diff)
  } else {
    startHeartbeat();
  }
}

function completeTimer() {
  chrome.action.setBadgeText({ text: '' });
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
  // TODO: Use maxAction to not show the action if it isn't supported
  // Used `show`... instead of constructor: https://stackoverflow.com/questions/29774836/failed-to-construct-notification-illegal-constructor
  // But first save off status, so re-activating can handle it
  saveCompletion().then(() => {
   self.registration.showNotification("Time to Hydrate", {
     tag: 'my-notification',
     icon: 'stay_hydrated.png',
     body: "Notification type: " + notifyText,
     actions: [{action: 'my-action', title: 'begin'}]
   })
  });
  // TODO: Open browser tab with info
  // TODO: store today's pomodoro history
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
        startTimer(true);
      } else if (['active','break'].includes(localStatus)) {
        pauseTimer();
      } else if (localStatus=='paused') {
        resumeTimer();
      }
      break;
    case 'heartbeat-complete':
      // Put a guard in case of heartbeat leaks
      if (['active','break'].includes(localStatus)) {
        const diff = nextNotify - new Date();
        if (diff<0) {
          completeTimer();
        } else if (diff<(20*1000)) {
          // Account for drift + cases where timer isn't cleanly divisible by heartbeat
          // (Example: 20 second heartbeat, 30 second timer, last run is 10 seconds - any drift)
          lastHeartbeat(diff);
        } else {
          // Otherwise, heartbeat will continue!
          // Update badge with # of minutes
          // TODO: Account for drift, shorten heartbeat to better hit next minute mark
          chrome.action.setBadgeText({ text: getBadgeTextFromSeconds(diff / 1000)});
        }
      } else {
        console.warn('Heartbeat fired while in "%s" status', localStatus)
      }
      break;
    case 'notify-click':
      // Only respond on asleep
      // Assume the click removes the notification, nothing to clear
      if (localStatus=='asleep') {
        startTimer(false);
      }
      break;
    default:
      console.warn('Received unrecognized event: %s', event);
      break;
  }
}

// Settings for debugging (short timers):
// `await chrome.storage.sync.set({'cyclePeriod': 2, 'activeTime': 60, 'breakTime': 30, 'longBreakTime': 39})`
// To restore defaults:
// `await chrome.storage.sync.remove(SETTINGS_KEYS)`
function getDefault(setting) {
  switch (setting) {
    case 'cyclePeriod':
      return 4;
    case 'activeTime':
      return 25 * 60;
    case 'breakTime':
      return 5 * 60;
    case 'longBreakTime':
      return 15 * 60;

    default:
      break;
  }
}

async function settingsSetup() {
  return chrome.storage.sync.get(SETTINGS_KEYS)
    .then((result) => {
      // Load, apply defaults as needed
      cyclePeriod = result['cyclePeriod'] ?? getDefault('cyclePeriod');
      activeTime = result['activeTime'] ?? getDefault('activeTime');
      breakTime = result['breakTime'] ?? getDefault('breakTime');
      longBreakTime = result['longBreakTime'] ?? getDefault('longBreakTime');
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
  return chrome.storage.local.get(['store-completed', 'last-heartbeat'])
    .then((result) => {
      // TODO save history and use last-heartbeat to roll over a new day
      // TODO handle cyclePeriod edits that make currentCycle > cyclePeriod (oops!)
      currentCycle = result['store-completed'] || 0;
      return chrome.storage.local.remove(['store-completed']);
    });
  });

  loading = cycleSetup.then(() =>
    chrome.storage.local.get(['store-pause-leftover', 'store-pause-status','store-asleep-last-status'])
    .then(result => {
      console.log('Result received: %o', result)
      const leftover = result['store-pause-leftover'];
      if (!leftover) {
        // We're asleep, resumed without a stored pause
        console.log('Resuming as if asleep, with lastStatus: %s',result['store-asleep-last-status'])
        localStatus = 'asleep'
        // Setting lastStatus to handle resume from inactivity
        lastStatus=result['store-asleep-last-status']
        return chrome.storage.local.remove(['store-asleep-last-status']);
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

// Only store completion info (lastStatus, currentCycle already incremented), then stop heartbeat
async function saveCompletion() {
  // If you change cyclePeriod during a 'break',
  // status check here prevents cycle reset after that break (could be weird...)
  if (lastStatus=='active' && isLongBreak()) {
    // Reset `currentCylce`, store rest to Pomodoro History
    // TODO: Actually store off... Need to promise chain
    console.log('Storing cycles: %s', currentCycle);
    currentCycle=0;
  }
  loading = 
    chrome.storage.local.set({
      'store-asleep-last-status': lastStatus,
      'store-completed': currentCycle
    })
    .then(stopHeartbeat);
  await loading;
  loading = null;
  // TODO: for above History, maybe register a promise here but don't await it?
  // TODO: When to store History for users without long breaks configured?
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
  // Save the stuff + clear local status
  console.log('Storing time left before "%s" is over: %s (completed %s)', lastStatus, nextNotify - new Date(), currentCycle)
  loading = 
    chrome.storage.local.set({
      'store-pause-leftover': nextNotify - new Date(),
      'store-pause-status': lastStatus,
      'store-completed': currentCycle
    })
    .then(stopHeartbeat);
  await loading;
  loading = null;
  // Keep everything else in memory in case we're paused/asleep for <30 seconds (cached!)
}

//** Operations that could be on startup */

// Handle notificationClick in SW event handler (self == SW)
// Call `loadStatus`, since this event can wake up the extension (with no other events called)
self.addEventListener('notificationclick',
  async (event) => {
    // This should do it!
    await loadStatus();
    // event.notification.close(); - TODO: Do I want to close it?
    if (event.action === "my-action") {
      // User chose to resume
      runEvent('notify-click')
    } else {
      // User just clicked the notification
      console.log("And here is where I'd put the tab in focus, IF I HAD ONE")
    }
  },
false);

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
          cyclePeriod = changes[key].newValue ?? getDefault('cyclePeriod');
          break;
        case 'activeTime':
          activeTime = changes[key].newValue ?? getDefault('activeTime');
          break;
        case 'breakTime':
          breakTime = changes[key].newValue ?? getDefault('breakTime');
          break;
        case 'longBreakTime':
          longBreakTime = changes[key].newValue ?? getDefault('longBreakTime');
          break;
      
        default:
          break;
      }
    });
    // Clear localStatus so next `loadStatus` caller will pull new settings
    // Otherwise we keep it populated, so things can stay cached
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