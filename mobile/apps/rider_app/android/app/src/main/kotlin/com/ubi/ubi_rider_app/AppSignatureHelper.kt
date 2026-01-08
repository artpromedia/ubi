package com.ubi.ubi_rider_app

import android.content.Context
import android.content.ContextWrapper
import android.content.pm.PackageManager
import android.util.Base64
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.security.NoSuchAlgorithmException
import java.util.*

/**
 * Helper class to compute the app's signature hash for SMS Retriever API.
 * 
 * The SMS Retriever API requires that the incoming SMS contains the app's
 * 11-character hash string to verify that the SMS is intended for this app.
 * 
 * This hash is computed from:
 * - The app's package name
 * - The app's signing certificate
 * 
 * Example hash format: "FA+9qCX9VSu" (11 characters)
 */
class AppSignatureHelper(context: Context) : ContextWrapper(context) {
    
    companion object {
        private const val HASH_TYPE = "SHA-256"
        private const val NUM_HASHED_BYTES = 9
        private const val NUM_BASE64_CHAR = 11
    }
    
    /**
     * Get all the app signatures for the current package.
     * 
     * @return ArrayList of app signature hashes
     */
    fun getAppSignatures(): ArrayList<String> {
        val appCodes = ArrayList<String>()
        
        try {
            val packageName = packageName
            val packageManager = packageManager
            val signatures = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
                val signingInfo = packageManager.getPackageInfo(
                    packageName,
                    PackageManager.GET_SIGNING_CERTIFICATES
                ).signingInfo
                
                if (signingInfo?.hasMultipleSigners() == true) {
                    signingInfo.apkContentsSigners
                } else {
                    signingInfo?.signingCertificateHistory
                }
            } else {
                @Suppress("DEPRECATION")
                packageManager.getPackageInfo(
                    packageName,
                    PackageManager.GET_SIGNATURES
                ).signatures
            }
            
            signatures?.forEach { signature ->
                val hash = hash(packageName, signature.toCharsString())
                if (hash != null) {
                    appCodes.add(String.format("%s", hash))
                }
            }
        } catch (e: PackageManager.NameNotFoundException) {
            // Package not found, return empty list
        }
        
        return appCodes
    }
    
    /**
     * Compute the hash of the package name and signature.
     */
    private fun hash(packageName: String, signature: String): String? {
        val appInfo = "$packageName $signature"
        
        try {
            val messageDigest = MessageDigest.getInstance(HASH_TYPE)
            messageDigest.update(appInfo.toByteArray(StandardCharsets.UTF_8))
            
            var hashSignature = messageDigest.digest()
            
            // Truncate to NUM_HASHED_BYTES
            hashSignature = Arrays.copyOfRange(hashSignature, 0, NUM_HASHED_BYTES)
            
            // Encode to Base64
            var base64Hash = Base64.encodeToString(
                hashSignature,
                Base64.NO_PADDING or Base64.NO_WRAP
            )
            
            // Truncate to NUM_BASE64_CHAR
            base64Hash = base64Hash.substring(0, NUM_BASE64_CHAR)
            
            return base64Hash
        } catch (e: NoSuchAlgorithmException) {
            // Algorithm not available
        }
        
        return null
    }
}
