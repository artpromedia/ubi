package com.ubi.driver_app

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import androidx.annotation.NonNull
import com.google.android.gms.auth.api.phone.SmsRetriever
import com.google.android.gms.auth.api.phone.SmsRetrieverClient
import com.google.android.gms.common.api.CommonStatusCodes
import com.google.android.gms.common.api.Status
import io.flutter.embedding.engine.plugins.FlutterPlugin
import io.flutter.embedding.engine.plugins.activity.ActivityAware
import io.flutter.embedding.engine.plugins.activity.ActivityPluginBinding
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import io.flutter.plugin.common.MethodChannel.MethodCallHandler
import io.flutter.plugin.common.MethodChannel.Result

/**
 * Flutter plugin for SMS Retriever API integration.
 * 
 * This plugin uses the SMS Retriever API to automatically read SMS containing
 * verification codes without requiring any permissions.
 * 
 * Requirements:
 * - Android 8.0 (API level 26) or higher
 * - Google Play Services installed on device
 * - SMS must contain the app's 11-character hash string
 */
class SmsRetrieverPlugin : FlutterPlugin, MethodCallHandler, EventChannel.StreamHandler, ActivityAware {
    
    private lateinit var methodChannel: MethodChannel
    private lateinit var eventChannel: EventChannel
    private var eventSink: EventChannel.EventSink? = null
    private var activity: Activity? = null
    private var context: Context? = null
    private var smsRetrieverClient: SmsRetrieverClient? = null
    private var smsBroadcastReceiver: SmsBroadcastReceiver? = null
    
    companion object {
        private const val METHOD_CHANNEL = "com.ubi.sms_retriever"
        private const val EVENT_CHANNEL = "com.ubi.sms_retriever/sms_events"
    }
    
    override fun onAttachedToEngine(@NonNull binding: FlutterPlugin.FlutterPluginBinding) {
        context = binding.applicationContext
        
        methodChannel = MethodChannel(binding.binaryMessenger, METHOD_CHANNEL)
        methodChannel.setMethodCallHandler(this)
        
        eventChannel = EventChannel(binding.binaryMessenger, EVENT_CHANNEL)
        eventChannel.setStreamHandler(this)
    }
    
    override fun onDetachedFromEngine(@NonNull binding: FlutterPlugin.FlutterPluginBinding) {
        methodChannel.setMethodCallHandler(null)
        eventChannel.setStreamHandler(null)
        unregisterReceiver()
    }
    
    override fun onAttachedToActivity(binding: ActivityPluginBinding) {
        activity = binding.activity
    }
    
    override fun onDetachedFromActivity() {
        activity = null
    }
    
    override fun onReattachedToActivityForConfigChanges(binding: ActivityPluginBinding) {
        activity = binding.activity
    }
    
    override fun onDetachedFromActivityForConfigChanges() {
        activity = null
    }
    
    override fun onMethodCall(@NonNull call: MethodCall, @NonNull result: Result) {
        when (call.method) {
            "getAppSignature" -> getAppSignature(result)
            "startSmsRetriever" -> startSmsRetriever(result)
            "stopSmsRetriever" -> stopSmsRetriever(result)
            else -> result.notImplemented()
        }
    }
    
    /**
     * Gets the app's signature hash for SMS Retriever.
     * This hash should be included in the SMS sent to the user.
     */
    private fun getAppSignature(result: Result) {
        try {
            val appContext = context ?: run {
                result.error("NO_CONTEXT", "Application context not available", null)
                return
            }
            
            val helper = AppSignatureHelper(appContext)
            val signatures = helper.getAppSignatures()
            
            if (signatures.isNotEmpty()) {
                result.success(signatures[0])
            } else {
                result.error("NO_SIGNATURE", "Could not get app signature", null)
            }
        } catch (e: Exception) {
            result.error("SIGNATURE_ERROR", "Error getting app signature: ${e.message}", null)
        }
    }
    
    /**
     * Starts the SMS Retriever client to listen for incoming SMS.
     * The retriever will timeout after 5 minutes.
     */
    private fun startSmsRetriever(result: Result) {
        val appContext = context ?: run {
            result.error("NO_CONTEXT", "Application context not available", null)
            return
        }
        
        try {
            smsRetrieverClient = SmsRetriever.getClient(appContext)
            
            val task = smsRetrieverClient?.startSmsRetriever()
            task?.addOnSuccessListener {
                registerReceiver()
                result.success(true)
            }?.addOnFailureListener { e ->
                result.error("START_FAILED", "Failed to start SMS Retriever: ${e.message}", null)
            }
        } catch (e: Exception) {
            result.error("SMS_RETRIEVER_ERROR", "Error starting SMS Retriever: ${e.message}", null)
        }
    }
    
    /**
     * Stops the SMS Retriever and unregisters the broadcast receiver.
     */
    private fun stopSmsRetriever(result: Result) {
        unregisterReceiver()
        result.success(true)
    }
    
    private fun registerReceiver() {
        val appContext = context ?: return
        
        unregisterReceiver() // Ensure no duplicate receivers
        
        smsBroadcastReceiver = SmsBroadcastReceiver { status, message, error ->
            activity?.runOnUiThread {
                when {
                    status == CommonStatusCodes.SUCCESS && message != null -> {
                        eventSink?.success(mapOf(
                            "status" to "success",
                            "message" to message
                        ))
                    }
                    status == CommonStatusCodes.TIMEOUT -> {
                        eventSink?.success(mapOf(
                            "status" to "timeout"
                        ))
                    }
                    else -> {
                        eventSink?.success(mapOf(
                            "status" to "error",
                            "error" to (error ?: "Unknown error")
                        ))
                    }
                }
            }
        }
        
        val intentFilter = IntentFilter(SmsRetriever.SMS_RETRIEVED_ACTION)
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            appContext.registerReceiver(
                smsBroadcastReceiver,
                intentFilter,
                Context.RECEIVER_EXPORTED
            )
        } else {
            appContext.registerReceiver(smsBroadcastReceiver, intentFilter)
        }
    }
    
    private fun unregisterReceiver() {
        smsBroadcastReceiver?.let { receiver ->
            try {
                context?.unregisterReceiver(receiver)
            } catch (e: IllegalArgumentException) {
                // Receiver was not registered
            }
        }
        smsBroadcastReceiver = null
    }
    
    // EventChannel.StreamHandler implementation
    override fun onListen(arguments: Any?, events: EventChannel.EventSink?) {
        eventSink = events
    }
    
    override fun onCancel(arguments: Any?) {
        eventSink = null
    }
}

/**
 * BroadcastReceiver for SMS Retriever API messages.
 */
class SmsBroadcastReceiver(
    private val onSmsReceived: (status: Int, message: String?, error: String?) -> Unit
) : BroadcastReceiver() {
    
    override fun onReceive(context: Context?, intent: Intent?) {
        if (intent?.action != SmsRetriever.SMS_RETRIEVED_ACTION) return
        
        val extras = intent.extras ?: return
        val status = extras.get(SmsRetriever.EXTRA_STATUS) as? Status ?: return
        
        when (status.statusCode) {
            CommonStatusCodes.SUCCESS -> {
                val message = extras.getString(SmsRetriever.EXTRA_SMS_MESSAGE)
                onSmsReceived(CommonStatusCodes.SUCCESS, message, null)
            }
            CommonStatusCodes.TIMEOUT -> {
                onSmsReceived(CommonStatusCodes.TIMEOUT, null, "SMS Retriever timed out")
            }
            else -> {
                onSmsReceived(status.statusCode, null, "SMS Retrieval failed: ${status.statusMessage}")
            }
        }
    }
}
