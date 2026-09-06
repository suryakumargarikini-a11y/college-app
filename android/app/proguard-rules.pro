# =============================================================================
# My SITAM / SITAM Smart ERP — ProGuard / R8 Rules
# android/app/proguard-rules.pro
#
# Rules are minimal and targeted.
# Broad rules (-keep class ** {*;}, -dontobfuscate, -dontshrink) are NEVER used.
# Capacitor plugin classes are protected by Capacitor's own consumerProguardFiles
# rule in @capacitor/android/capacitor/build.gradle — NOT duplicated here.
# Firebase is protected by its own AAR consumer rules — NOT duplicated here.
# =============================================================================

# ---------------------------------------------------------------------------
# 1. CRASH REPORTING — Preserve source file name and line number mapping
#
# WHY: When R8 obfuscates and optimises, it renames classes and strips line
#      numbers by default.  Keeping SourceFile + LineNumberTable allows crash
#      reports (Firebase Crashlytics, Play Console, logcat) to be deobfuscated
#      back to human-readable file names and line numbers.
#
# WHAT BREAKS WITHOUT IT: Stack traces become unreadable (e.g., "a.b(Unknown
#      Source:3)") making production crash diagnosis impossible.
# ---------------------------------------------------------------------------
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# ---------------------------------------------------------------------------
# 2. SECURE KEYSTORE PLUGIN — App-specific Capacitor plugin in this package
#
# WHY: SecureKeystorePlugin is annotated with @CapacitorPlugin and registered
#      via MainActivity.registerPlugin(SecureKeystorePlugin.class).
#      Capacitor's consumer rule (-keep public class * extends Plugin { *; })
#      keeps the class, but R8 full-mode may still remove or rename @PluginMethod
#      members if it cannot trace the JS bridge's reflective invocation path.
#      This targeted rule preserves the @PluginMethod-annotated public methods.
#
# WHAT BREAKS WITHOUT IT: Calls from JavaScript to SecureKeystore.encrypt()
#      / SecureKeystore.decrypt() / SecureKeystore.logBoot() would throw a
#      "Method not found" error at runtime.
# ---------------------------------------------------------------------------
-keepclassmembers class co.in.sitamecap.erp.SecureKeystorePlugin {
    @com.getcapacitor.PluginMethod public <methods>;
}

# ---------------------------------------------------------------------------
# 3. MAIN ACTIVITY — Preserve activity lifecycle and bridge access
#
# WHY: MainActivity extends BridgeActivity (Capacitor). R8 may inline or
#      remove overridden lifecycle methods (onCreate, onStart) if it cannot
#      verify they are called via the Android framework's reflection path.
#      The registerPlugin call at line 12 must also survive.
#
# WHAT BREAKS WITHOUT IT: App may not start, WebView may not initialise,
#      mixed-content mode setting (setMixedContentMode) may not apply,
#      or plugin registration may silently fail.
# ---------------------------------------------------------------------------
-keep class co.in.sitamecap.erp.MainActivity {
    public <init>();
    public void onCreate(android.os.Bundle);
    public void onStart();
}

# ---------------------------------------------------------------------------
# 4. ENUM SAFETY — Preserve enum methods required by reflection
#
# WHY: AGP 8.x R8 full-mode can remove Enum.values() and Enum.valueOf()
#      methods if it cannot trace calls to them.  Android framework code,
#      Gson, JSON parsers, and some AndroidX APIs access enums reflectively
#      via these methods.
#
# WHAT BREAKS WITHOUT IT: IllegalArgumentException or NoSuchMethodException
#      at runtime when code calls MyEnum.valueOf("NAME") or MyEnum.values().
# ---------------------------------------------------------------------------
-keepclassmembers enum * {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}

# ---------------------------------------------------------------------------
# 5. SERIALIZABLE CLASSES — Preserve serialization contract
#
# WHY: Classes implementing Serializable rely on specific field names and
#      serialVersionUID.  R8 obfuscation renames fields, breaking the serial
#      form.  This rule preserves only the fields and methods required by
#      Java serialization — not the entire class.
#
# WHAT BREAKS WITHOUT IT: InvalidClassException when deserialising objects
#      (e.g., from SharedPreferences, bundles, or saved state).
# ---------------------------------------------------------------------------
-keepclassmembers class * implements java.io.Serializable {
    static final long serialVersionUID;
    private static final java.io.ObjectStreamField[] serialPersistentFields;
    private void writeObject(java.io.ObjectOutputStream);
    private void readObject(java.io.ObjectInputStream);
    java.lang.Object writeReplace();
    java.lang.Object readResolve();
}

# ---------------------------------------------------------------------------
# 6. PARCELABLE — Preserve CREATOR field required by Android IPC
#
# WHY: Android's Parcel mechanism reads the static CREATOR field by name via
#      reflection.  R8 obfuscation renames fields, making CREATOR inaccessible.
#
# WHAT BREAKS WITHOUT IT: BadParcelableException when passing Parcelable
#      objects across Activities / Services / Fragments via Intents or Bundles.
# ---------------------------------------------------------------------------
-keepclassmembers class * implements android.os.Parcelable {
    public static final android.os.Parcelable$Creator CREATOR;
}

# ---------------------------------------------------------------------------
# 7. JAVASCRIPT INTERFACE SAFETY (WebView)
#
# WHY: The Capacitor bridge exposes Java methods to JavaScript via
#      WebView.addJavascriptInterface().  Methods annotated @JavascriptInterface
#      must not be renamed or removed.  Capacitor's consumer rules handle the
#      bridge class itself; this rule adds an extra safety net for any
#      @JavascriptInterface annotations in the app's own code.
#
# WHAT BREAKS WITHOUT IT: JavaScript calls to native methods silently fail
#      (the method appears to not exist from the JS side).
# ---------------------------------------------------------------------------
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# ---------------------------------------------------------------------------
# NOTE: No Firebase-specific keep rules are added here.
# Firebase libraries (firebase-messaging, firebase-common, etc.) ship their
# own R8/ProGuard consumer rules inside their AARs.  These rules are
# automatically merged by AGP into the final R8 configuration.
# Adding duplicate rules here would be redundant.
#
# NOTE: No Capacitor bridge / plugin keep rules are added here.
# @capacitor/android declares consumerProguardFiles 'proguard-rules.pro' in
# its build.gradle, which ships the following already-active rules:
#   -keep @com.getcapacitor.annotation.CapacitorPlugin public class * { ... }
#   -keep public class * extends com.getcapacitor.Plugin { *; }
#   -keep @com.getcapacitor.NativePlugin public class * { ... }
#   -keep public class * extends org.apache.cordova.* { ... }
# ---------------------------------------------------------------------------

