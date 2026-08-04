package com.okontek.app;

import android.os.Bundle;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import android.app.ActivityManager;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;

import android.webkit.WebSettings;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        setupKioskMode();
    }

    @Override
    public void onResume() {
        super.onResume();

        setupKioskMode();
        // configureWebViewMediaAutoplay();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);

        if (hasFocus) {
            hideSystemUI();
            // WindowInsetsControllerCompat controller =
            //         new WindowInsetsControllerCompat(getWindow(), getWindow().getDecorView());

            // controller.hide(
            //         WindowInsetsCompat.Type.statusBars()
            //                 | WindowInsetsCompat.Type.navigationBars()
            //                     | WindowInsetsCompat.Type.systemBars()
            // );
        }
    }

    private void hideSystemUI() {
        WindowInsetsControllerCompat controller = new WindowInsetsControllerCompat(getWindow(), getWindow().getDecorView());

        controller.hide(WindowInsetsCompat.Type.statusBars() | WindowInsetsCompat.Type.navigationBars() | WindowInsetsCompat.Type.systemBars());

        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }

    private void configureWebViewMediaAutoplay() {
        if (getBridge() == null) return;
        WebView webView = getBridge().getWebView();
        if (webView == null) return;
        WebSettings settings = webView.getSettings();
        settings.setMediaPlaybackRequiresUserGesture(false);
    }

    private void setupKioskMode() {
        DevicePolicyManager dpm = (DevicePolicyManager) getSystemService(DEVICE_POLICY_SERVICE);

        ComponentName admin = new ComponentName(this, MyDeviceAdminReceiver.class);

        if (dpm.isDeviceOwnerApp(getPackageName())) {
            dpm.setLockTaskPackages(
                    admin,
                    new String[]{ getPackageName() }
            );

            dpm.setStatusBarDisabled(admin, true);

            dpm.setLockTaskFeatures(
                admin,
                DevicePolicyManager.LOCK_TASK_FEATURE_NONE
            );

            try {
                startLockTask();
            } catch (Exception e) {
                e.printStackTrace();
            }

            hideSystemUI();
        }
    }
}
