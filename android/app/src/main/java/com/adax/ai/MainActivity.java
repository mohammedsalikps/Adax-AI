package com.adax.ai;

import android.os.Bundle;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

/**
 * Capacitor's default back-button behaviour finishes the activity, which
 * drops the user straight to the launcher from any screen. This app is a
 * multi-screen single-page application, so the hardware back button should
 * first dismiss an open dialog, then walk back through the app's history,
 * and only leave the app once there is nowhere left to go.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Registered after super.onCreate so this callback takes priority.
        getOnBackPressedDispatcher()
            .addCallback(
                this,
                new OnBackPressedCallback(true) {
                    @Override
                    public void handleOnBackPressed() {
                        if (getBridge() == null) {
                            leaveApp();
                            return;
                        }

                        // The web layer owns dialog state, so ask it first.
                        // This callback runs on the UI thread once the web
                        // view has answered.
                        getBridge()
                            .getWebView()
                            .evaluateJavascript(
                                "!!(window.adaxCloseTopOverlay && window.adaxCloseTopOverlay())",
                                value -> {
                                    if ("true".equals(value)) {
                                        // A dialog was dismissed; back is consumed.
                                        return;
                                    }
                                    if (getBridge() != null && getBridge().getWebView().canGoBack()) {
                                        getBridge().getWebView().goBack();
                                    } else {
                                        leaveApp();
                                    }
                                }
                            );
                    }

                    private void leaveApp() {
                        // Nothing left in the app — let the system handle it.
                        setEnabled(false);
                        getOnBackPressedDispatcher().onBackPressed();
                    }
                }
            );
    }
}
