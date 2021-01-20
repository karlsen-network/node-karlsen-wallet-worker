const path = require('path');

module.exports = {
	mode: "development", // "production" | "development" | "none"
	entry: "./index.ts",
	output: {
		filename: '[name].js',
		path: path.resolve(__dirname, 'dist'),
	},
	module: {
	    rules: [
	      {
	        test: /\.tsx?$/,
	        use: 'ts-loader',
	        exclude: /node_modules/,
	      },
	    ],
	  },
	devtool:false,
	resolve: {
	    extensions: [ '.tsx', '.ts', '.js', '.json' ],
  	},
	devServer:{
		https: false,
	    port: 8081,
	    contentBase:"./"
	}
};
