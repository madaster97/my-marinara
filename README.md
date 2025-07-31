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

### Inactivity
Example:
- Timer is running, a couple pings go by
- Extension is about to go inactive
- Just give up and see what happens! **Count as a pause**

## OKAY!
APIs needed:
- Ping loop for active timer
- Storing state to handle resumptions (like click from pause, could be inactive)
- Create/Remove notification
- 

### Constraints
- (Good?) Having a listener keeps stuff open
- `onStartup` and `onSuspend` seem to be CHROME open/closing 

**Design the above to persist all state when we stop timer**

### POC
- Can click the icon
- Two types of notifications

### Long-Break
- [X] Simplify back to 1 notification ID, always clear on icon-click
- [] Remove the 'long-break' state, just make completedToday reflect 'break' status
- [] Change completedToday > cycleCount