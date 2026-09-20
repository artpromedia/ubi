const path = require("path");
const CopyPlugin = require("copy-webpack-plugin");

module.exports = {
  mode: "production",
  entry: {
    index: "./src/index.ts",
    "load-test": "./src/tests/load-test.ts",
    "stress-test": "./src/tests/stress-test.ts",
    "spike-test": "./src/tests/spike-test.ts",
    "soak-test": "./src/tests/soak-test.ts",
    "api-test": "./src/tests/api-test.ts",
  },
  output: {
    path: path.resolve(__dirname, "dist"),
    libraryTarget: "commonjs",
    filename: "[name].js",
  },
  resolve: {
    extensions: [".ts", ".js"],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: "babel-loader",
        exclude: /node_modules/,
      },
    ],
  },
  externals: /^(k6|https?:\/\/)(\/.*)?/,
  target: "web",
  stats: {
    colors: true,
  },
};
