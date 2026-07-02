package co.in.sitamecap.erp;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "SecureKeystore")
public class SecureKeystorePlugin extends Plugin {

    private static final String KEY_ALIAS = "SITAM_ERP_SECURE_KEY";
    private static final String ANDROID_KEYSTORE = "AndroidKeyStore";
    private static final String AES_MODE = "AES/GCM/NoPadding";

    private SecretKey getOrCreateKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance(ANDROID_KEYSTORE);
        keyStore.load(null);
        if (keyStore.containsAlias(KEY_ALIAS)) {
            KeyStore.SecretKeyEntry entry = (KeyStore.SecretKeyEntry) keyStore.getEntry(KEY_ALIAS, null);
            return entry.getSecretKey();
        }

        KeyGenerator keyGenerator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE);
        KeyGenParameterSpec.Builder builder = new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256);
        
        keyGenerator.init(builder.build());
        return keyGenerator.generateKey();
    }

    @PluginMethod
    public void encrypt(PluginCall call) {
        String plaintext = call.getString("value");
        if (plaintext == null) {
            call.reject("Value is required");
            return;
        }

        try {
            SecretKey secretKey = getOrCreateKey();
            Cipher cipher = Cipher.getInstance(AES_MODE);
            cipher.init(Cipher.ENCRYPT_MODE, secretKey);
            byte[] iv = cipher.getIV();
            byte[] ciphertext = cipher.doFinal(plaintext.getBytes("UTF-8"));

            JSObject result = new JSObject();
            result.put("iv", Base64.encodeToString(iv, Base64.NO_WRAP));
            result.put("ciphertext", Base64.encodeToString(ciphertext, Base64.NO_WRAP));
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Encryption failed: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void decrypt(PluginCall call) {
        String ciphertextBase64 = call.getString("ciphertext");
        String ivBase64 = call.getString("iv");

        if (ciphertextBase64 == null || ivBase64 == null) {
            call.reject("Ciphertext and IV are required");
            return;
        }

        try {
            SecretKey secretKey = getOrCreateKey();
            byte[] iv = Base64.decode(ivBase64, Base64.NO_WRAP);
            byte[] ciphertext = Base64.decode(ciphertextBase64, Base64.NO_WRAP);

            Cipher cipher = Cipher.getInstance(AES_MODE);
            GCMParameterSpec spec = new GCMParameterSpec(128, iv);
            cipher.init(Cipher.DECRYPT_MODE, secretKey, spec);
            byte[] plaintext = cipher.doFinal(ciphertext);

            JSObject result = new JSObject();
            result.put("value", new String(plaintext, "UTF-8"));
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Decryption failed: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void logBoot(PluginCall call) {
        String message = call.getString("message");
        if (message != null) {
            android.util.Log.d("SITAM_BOOT", message);
        }
        call.resolve();
    }
}
