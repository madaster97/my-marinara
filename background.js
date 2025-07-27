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
let lastStatus = null;
// Local timer (DateTime), 
let nextNotify = null; 

// Constants for Stored State - Only to handle inactivity
// Will assume pause stops ticking, so SW likely to go inactive
const STORE_PAUSE_LEFTOVER = 'store-pause-leftover'; // milliseconds left on timer
const STORE_PAUSE_LAST_STATUS = 'store-pause-last-status'; // the last status before pause

// Handle case where 1 click starts to load the stored status, but another click comes in
// Global promise for "I'm loading the status into localStatus"
let loading;
async function loadStatus(){
  if (localStatus) {
    // Already loaded
    return;
  } else if (loading) {
    // Someone else loading
    await loading;
    return;
  }

  loading = 
    chrome.storage.local.get([STORE_PAUSE_LAST_STATUS,STORE_PAUSE_LEFTOVER])
    .then(results => {
      // TODO setup localStatus/...
      // TODO assume they clicked the thing for X reason?
      // So maybe caller is responsible for processing next tick/state change?
      console.log('Loaded results: %o', results)
    })
    .then(() => chrome.storage.local.remove([STORE_PAUSE_LAST_STATUS,STORE_PAUSE_LEFTOVER]))
  await loading;
  loading = null;
}

//** Operations that could be on startup */

// Handle someone clicking the button in a notification
// Check stored status because this could be on startup
async function notificationClickListener() {
  await loadStatus();
  // TODO reference localStatus, which is now loaded!
}

// Handle someone clicking the app icon
// Check stored status because this could be on startup
async function iconClickListener() {
  await loadStatus();
  // TODO reference localStatus, which is now loaded!
}

//** Operations only registered after startup */
// TODO... https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers#keep_a_service_worker_alive_continuously
async function runHeartbeat() {
  await chrome.storage.local.set({ 'last-heartbeat': new Date().getTime() });
}

// TODO remove/tweak
chrome.alarms.onAlarm.addListener(() => {
  chrome.action.setBadgeText({ text: '' });
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'stay_hydrated.png',
    title: 'Time to Hydrate',
    message: "Everyday I'm Guzzlin'!",
    buttons: [{ title: 'Keep it Flowing.' }],
    priority: 0
  });
});

chrome.notifications.onButtonClicked.addListener(async () => {
  const item = await chrome.storage.sync.get(['minutes']);
  chrome.action.setBadgeText({ text: 'ON' });
  chrome.alarms.create({ delayInMinutes: item.minutes });
});

// Actually register things
// TODO - notifications + icon click + contextMenus