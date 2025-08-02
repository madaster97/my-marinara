# My Marinara Retake

## Possible States
- Nothing, OR we completed a timer yesterday
- There is a timer going + what type/time
- We've completed a timer today + what type/time

### Parralel States
- Whether we have an active [notification](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/notifications/create) (by ID)
- Whether we have an active alarm (by ID)

## Events that can happen
- You click the main icon
- You click a specific context menu:
    - ... TODO
- You click a desktop notification
- The app is about to go inactive
- An alarm you registered has fired

## Edge Cases
- Browser goes to sleep (so inactive SW), but you want timer to continue
- Drift over time with 20 second ping?

### Constraints
- (Good?) Having a listener keeps stuff open
- `onStartup` and `onSuspend` seem to be CHROME open/closing 

**Design the above to persist all state when we stop timer**

### Settings Page
Chrome example showing storage sync with an [event](https://developer.chrome.com/docs/extensions/reference/api/storage):
```js
chrome.storage.onChanged.addListener((changes, namespace) => {
  for (let [key, { oldValue, newValue }] of Object.entries(changes)) {
    console.log(
      `Storage key "${key}" in namespace "${namespace}" changed.`,
      `Old value was "${oldValue}", new value is "${newValue}".`
    );
  }
});
```

Need an options item for this

#### Options Menu
... Started thinking through: just need to hook through?
- Open Settings Page
- Restart Timer (from active/break, just set nextNotify + update badge text)
- Pause (treat as icon-click)
- Restart Cycle ()

### Popup Tab on completion