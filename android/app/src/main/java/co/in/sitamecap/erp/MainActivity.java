package co.in.sitamecap.erp;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SecureKeystorePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
