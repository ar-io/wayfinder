import CopyPlugin from "copy-webpack-plugin";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default {
  entry: {
    background: `${__dirname}/src/background.ts`,
    content: `${__dirname}/src/content.ts`,
    popup: `${__dirname}/src/popup.ts`,
  },
  devtool: false,
  output: {
    path: `${__dirname}/dist`,
    filename: "[name].js",
  },
  mode: "production",
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: "ts-loader",
        exclude: /node_modules/,
      },
    ],
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        { from: "manifest.json", to: "./manifest.json" },
        { from: "assets", to: "./assets" },
        { from: "popup.html", to: "./popup.html" },
      ],
    }),
  ],
  resolve: {
    extensions: [".tsx", ".ts", ".js"],
  },
};
