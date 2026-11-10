package africa.ubi.rider

import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  override fun onCreate(savedInstanceState: Bundle?) {
    // react-native-screens requires null savedInstanceState on Activity restart
    super.onCreate(null)
  }

  /**
   * Must match AppRegistry.registerComponent(appName, ...) in index.js / app.json.
   */
  override fun getMainComponentName(): String = "UBI"

  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
