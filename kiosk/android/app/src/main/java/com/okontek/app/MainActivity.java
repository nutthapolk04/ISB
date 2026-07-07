package com.okontek.app;

import android.os.Bundle;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import android.app.ActivityManager;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

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

            startLockTask();
        }

        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        WindowInsetsControllerCompat controller =
                new WindowInsetsControllerCompat(getWindow(), getWindow().getDecorView());

        controller.hide(
                WindowInsetsCompat.Type.statusBars()
                        | WindowInsetsCompat.Type.navigationBars()
        );

        controller.setSystemBarsBehavior(
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        );
    }

    @Override
    public void onResume() {
        super.onResume();

        WindowInsetsControllerCompat controller =
                new WindowInsetsControllerCompat(getWindow(), getWindow().getDecorView());

        controller.hide(
                WindowInsetsCompat.Type.statusBars()
                        | WindowInsetsCompat.Type.navigationBars()
        );
    }
}
