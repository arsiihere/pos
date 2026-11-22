package pos.spike.lockalerts;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

// [spike lock-alerts] registers the AlertService plugin before the bridge starts.
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AlertServicePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
