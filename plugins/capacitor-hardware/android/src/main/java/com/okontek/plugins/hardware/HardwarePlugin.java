package com.okontek.plugins.hardware;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "Hardware")
public class HardwarePlugin extends Plugin {
    @PluginMethod
    public void getPlatform(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("platform", "android");
        call.resolve(ret);
    }
}
