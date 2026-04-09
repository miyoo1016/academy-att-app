# Walkthrough: Persistent Background SMS Service

We have upgraded the SMS system so that it works automatically even when the app is minimized or the screen is off.

## Key Upgrades

### 1. Automatic "Always-On" Start
- **Previous**: You had to open the "Dashboard" screen to start the SMS service.
- **New**: The service now starts **immediately** as soon as you open the app icon. You don't need to navigate into any specific menu.

### 2. Foreground Service Notification
- We now use a **Foreground Service** with a persistent notification: **"[미래학원] 출결 문자 자동발송"**.
- This notification tells the Android system: "This app is doing important work, please don't kill it to save battery."
- As long as you see this icon in your status bar, the SMS system is active.

### 3. Background Stability
- Even if you swipe the app into the background or use other apps, the SMS service will continue to monitor the database and send messages to parents.

---

## Required Android Settings

To ensure 100% reliability, please check these 2 settings on your **Admin Phone**:

### 1. Disable Battery Optimization
1. Go to **Settings** > **Apps** > **미래학원 출결**.
2. Tap **Battery**.
3. Select **Unrestricted** (or "Exclude from optimization"). 
   - *This prevents Android from "sleeping" the app while it's in the background.*

### 2. Enable Autostart (If available)
- On some phones (Samsung, Xiaomi, etc.), ensure "Autostart" is toggled ON for the academy app.

---

## How to Test
1. Re-deploy or build the latest APK.
2. Open the app on the Admin Phone once.
3. Minimize the app (press Home).
4. Do a test entry on the Tablet's Keypad.
5. **Observe**: The Admin Phone should send the SMS automatically without you touching it!

> [!NOTE]
> The MacBook/PC version will still show a "Simulation" alert because computers cannot send real SMS. Use your **Android Admin Phone** as the primary "SMS Server".
