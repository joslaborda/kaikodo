package com.kaikodo.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugins propios de la app (no vienen de npm): hay que registrarlos
        // antes de super.onCreate(). Ver KaikodoSpeechPlugin.java.
        registerPlugin(KaikodoSpeechPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
